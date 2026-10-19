import type { ImagePoint, PlanePoint, ValidationIssue } from "@/lib/core/types";
import { calibrationLengthUncertaintyMm, isUsableCalibration, type CalibrationRecord } from "@/lib/calibration/calibrationEngine";
import { getCardSpec } from "@/lib/calibration/cardSpec";
import { signedArea, type NailGeometry } from "./measurementEngine";

export type MeasurementValidity = "ok" | "warning" | "invalid";

export interface MeasurementRules {
  readonly plausibleWidthMm: readonly [number, number];
  readonly plausibleLengthMm: readonly [number, number];
  readonly hardWidthMm: readonly [number, number];
  readonly hardLengthMm: readonly [number, number];
  /** Minimum nail width in image pixels for a usable measurement. */
  readonly minWidthPx: number;
  /** Max distance (mm) of the nail centroid from the card edge before extrapolation is flagged. */
  readonly maxDistanceFromCardMm: number;
  readonly borderMarginPx: number;
  readonly maxGlareFraction: number;
}

export const DEFAULT_RULES: MeasurementRules = {
  plausibleWidthMm: [5, 24],
  plausibleLengthMm: [4, 26],
  hardWidthMm: [2, 40],
  hardLengthMm: [2, 40],
  minWidthPx: 80,
  maxDistanceFromCardMm: 120,
  borderMarginPx: 2,
  maxGlareFraction: 0.15,
};

export interface ValidationResult {
  readonly validity: MeasurementValidity;
  readonly issues: ValidationIssue[];
  /** 1-sigma calibration contribution to width/length uncertainty, mm (excludes boundary placement). */
  readonly calibrationUncertaintyMm: number | null;
}

/** Proper segment intersection (shared endpoints of adjacent edges excluded). */
function segmentsIntersect(a: ImagePoint, b: ImagePoint, c: ImagePoint, d: ImagePoint): boolean {
  const o = (p: ImagePoint, q: ImagePoint, r: ImagePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function isSelfIntersecting(points: readonly ImagePoint[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through wrap-around
      if (segmentsIntersect(a, b, points[j]!, points[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

export function validateContour(points: readonly ImagePoint[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (points.length < 4) {
    issues.push({ code: "contour_too_few_points", severity: "error", message: "A nail boundary needs at least 4 points." });
    return issues;
  }
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    issues.push({ code: "contour_invalid_coordinates", severity: "error", message: "The boundary contains invalid coordinates." });
    return issues;
  }
  if (Math.abs(signedArea(points as readonly PlanePoint[])) < 1) {
    issues.push({ code: "contour_degenerate", severity: "error", message: "The boundary encloses no area." });
  }
  if (isSelfIntersecting(points)) {
    issues.push({ code: "contour_self_intersecting", severity: "error", message: "The boundary crosses itself. Move points so the outline does not overlap." });
  }
  return issues;
}

function distanceToCardMm(p: PlanePoint, w: number, h: number): number {
  const dx = Math.max(0, -p.x, p.x - w);
  const dy = Math.max(0, -p.y, p.y - h);
  return Math.hypot(dx, dy);
}

/** Enforces measurement and quality rules; never alters the measurement itself. */
export function validateMeasurement(params: {
  geometry: NailGeometry | null;
  contour: readonly ImagePoint[];
  calibration: CalibrationRecord | null;
  image: { width: number; height: number };
  glareFraction?: number | null;
  rules?: MeasurementRules;
}): ValidationResult {
  const rules = params.rules ?? DEFAULT_RULES;
  const issues: ValidationIssue[] = [...validateContour(params.contour)];
  const cal = params.calibration;

  if (!isUsableCalibration(cal)) {
    issues.push({
      code: "not_calibrated",
      severity: "error",
      message: "No valid calibration: physical dimensions cannot be established for this image.",
    });
  } else if (cal.status === "manual") {
    issues.push({
      code: "manual_calibration",
      severity: "warning",
      message: "Measured with a manual reference length; perspective is not corrected.",
    });
  }

  const m = rules.borderMarginPx;
  if (params.contour.some((p) => p.x <= m || p.y <= m || p.x >= params.image.width - 1 - m || p.y >= params.image.height - 1 - m)) {
    issues.push({ code: "nail_at_image_border", severity: "warning", message: "The nail touches the image border and may be cut off." });
  }

  const g = params.geometry;
  if (g) {
    const w = g.widthMm as number;
    const l = g.lengthMm as number;
    if (w < rules.hardWidthMm[0] || w > rules.hardWidthMm[1] || l < rules.hardLengthMm[0] || l > rules.hardLengthMm[1]) {
      issues.push({
        code: "dimensions_impossible",
        severity: "error",
        message: `Measured ${w.toFixed(1)} x ${l.toFixed(1)} mm is outside the possible range for a fingernail. Check the boundary and calibration.`,
      });
    } else if (
      w < rules.plausibleWidthMm[0] || w > rules.plausibleWidthMm[1] || l < rules.plausibleLengthMm[0] || l > rules.plausibleLengthMm[1]
    ) {
      issues.push({
        code: "dimensions_unusual",
        severity: "warning",
        message: `Measured ${w.toFixed(1)} x ${l.toFixed(1)} mm is unusual for a fingernail. Please double-check the boundary.`,
      });
    }

    if (isUsableCalibration(cal) && cal.quality.pxPerMmAtCard) {
      const widthPx = w * cal.quality.pxPerMmAtCard;
      if (widthPx < rules.minWidthPx) {
        issues.push({
          code: "nail_low_resolution",
          severity: "warning",
          message: `The nail is only ~${widthPx.toFixed(0)} px wide (1 px ≈ ${(1 / cal.quality.pxPerMmAtCard).toFixed(2)} mm). Move closer for better precision.`,
        });
      }
    }

    if (cal?.status === "valid" && cal.layoutId) {
      const card = getCardSpec(cal.layoutId);
      const dCard = distanceToCardMm(g.centroid, card.cardWidthMm, card.cardHeightMm);
      if (dCard > rules.maxDistanceFromCardMm) {
        issues.push({
          code: "far_from_card",
          severity: "warning",
          message: `The nail is ${dCard.toFixed(0)} mm from the card; keep the card closer to the fingertips to limit extrapolation error.`,
        });
      }
    }
  }

  if (params.glareFraction != null && params.glareFraction > rules.maxGlareFraction) {
    issues.push({
      code: "nail_glare",
      severity: "warning",
      message: `${(params.glareFraction * 100).toFixed(0)}% of this nail is blown out by glare; the boundary may be unreliable.`,
    });
  }

  const validity: MeasurementValidity = issues.some((i) => i.severity === "error")
    ? "invalid"
    : issues.some((i) => i.severity === "warning")
      ? "warning"
      : "ok";
  return { validity, issues, calibrationUncertaintyMm: cal ? calibrationLengthUncertaintyMm(cal) : null };
}
