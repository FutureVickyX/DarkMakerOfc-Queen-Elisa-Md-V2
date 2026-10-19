import type { CalibrationStatus, ImagePoint, PlanePoint, ValidationIssue } from "@/lib/core/types";
import {
  applyHomography,
  estimateHomography,
  invert,
  localScale,
  type Correspondence,
  type Matrix3,
} from "@/lib/geometry/homography";
import { DEFAULT_CARD, getCardSpec, markerCornersMm, type CalibrationCardSpec } from "./cardSpec";

/** One detected marker: its dictionary ID and four image-space corners (TL, TR, BR, BL). */
export interface DetectedMarker {
  readonly id: number;
  readonly corners: readonly [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
}

export interface CalibrationThresholds {
  /** Minimum number of distinct card markers required. */
  readonly minMarkers: number;
  /** Minimum marker side length in image pixels. */
  readonly minMarkerSidePx: number;
  /** Maximum RMS residual of marker corners after fitting, in mm. */
  readonly maxRmsResidualMm: number;
  /** Maximum single-corner residual, in mm. */
  readonly maxResidualMm: number;
  /** Maximum ratio between the largest and smallest local scale over the card (perspective strength). */
  readonly maxScaleAnisotropy: number;
}

export const DEFAULT_THRESHOLDS: CalibrationThresholds = {
  minMarkers: 4,
  minMarkerSidePx: 40,
  maxRmsResidualMm: 0.2,
  maxResidualMm: 0.5,
  maxScaleAnisotropy: 1.3,
};

export interface CalibrationQuality {
  readonly markerCount: number;
  readonly rmsResidualMm: number | null;
  readonly maxResidualMm: number | null;
  readonly minMarkerSidePx: number;
  /** Pixels per millimetre at the card centre (geometric mean of the two local scales). */
  readonly pxPerMmAtCard: number | null;
  readonly scaleAnisotropy: number | null;
  /** Rough camera tilt relative to the card normal, from foreshortening. Approximate only. */
  readonly approxTiltDeg: number | null;
}

export interface CalibrationRecord {
  readonly method: "card" | "manual";
  readonly status: CalibrationStatus;
  readonly layoutId: string | null;
  readonly layoutVersion: number | null;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Image px -> plane mm. Null when calibration was rejected. */
  readonly imageToPlane: Matrix3 | null;
  /** Plane mm -> image px. */
  readonly planeToImage: Matrix3 | null;
  readonly detectedMarkers: readonly DetectedMarker[];
  /** For manual calibration: the two image points and the user-supplied length. */
  readonly manualReference: ManualReference | null;
  readonly quality: CalibrationQuality;
  readonly issues: readonly ValidationIssue[];
  readonly thresholds: CalibrationThresholds;
  readonly createdAt: string;
}

export interface ManualReference {
  readonly a: ImagePoint;
  readonly b: ImagePoint;
  readonly lengthMm: number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function polygonArea(points: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function emptyQuality(markers: readonly DetectedMarker[]): CalibrationQuality {
  return {
    markerCount: markers.length,
    rmsResidualMm: null,
    maxResidualMm: null,
    minMarkerSidePx: minSide(markers),
    pxPerMmAtCard: null,
    scaleAnisotropy: null,
    approxTiltDeg: null,
  };
}

function minSide(markers: readonly DetectedMarker[]): number {
  let m = Infinity;
  for (const marker of markers) {
    for (let i = 0; i < 4; i++) m = Math.min(m, dist(marker.corners[i]!, marker.corners[(i + 1) % 4]!));
  }
  return Number.isFinite(m) ? m : 0;
}

/**
 * Fits the card-plane homography from detected ArUco markers and evaluates it.
 * Pure and deterministic: the same inputs always give the same record, so the
 * server can recompute calibration from client-submitted marker detections.
 */
export function calibrateFromMarkers(
  detected: readonly DetectedMarker[],
  image: { width: number; height: number },
  options: { card?: CalibrationCardSpec; thresholds?: Partial<CalibrationThresholds>; now?: Date } = {},
): CalibrationRecord {
  const card = options.card ?? DEFAULT_CARD;
  const thresholds: CalibrationThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const issues: ValidationIssue[] = [];
  const createdAt = (options.now ?? new Date()).toISOString();

  const cardIds = new Set(card.markers.map((m) => m.id));
  const relevant = detected.filter((m) => cardIds.has(m.id));
  const foreign = detected.filter((m) => !cardIds.has(m.id));
  if (foreign.length > 0) {
    issues.push({
      code: "foreign_markers",
      severity: "info",
      message: `Ignored ${foreign.length} marker(s) that are not part of ${card.layoutId}.`,
    });
  }

  const counts = new Map<number, number>();
  for (const m of relevant) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  const base = {
    method: "card" as const,
    layoutId: card.layoutId,
    layoutVersion: card.version,
    imageWidth: image.width,
    imageHeight: image.height,
    detectedMarkers: relevant,
    manualReference: null,
    thresholds,
    createdAt,
  };

  const reject = (quality: CalibrationQuality): CalibrationRecord => ({
    ...base,
    status: "rejected",
    imageToPlane: null,
    planeToImage: null,
    quality,
    issues,
  });

  if (duplicates.length > 0) {
    issues.push({
      code: "ambiguous_markers",
      severity: "error",
      message: `Marker ID(s) ${duplicates.join(", ")} were detected more than once. Make sure only one calibration card is visible.`,
    });
    return reject(emptyQuality(relevant));
  }

  if (relevant.length < thresholds.minMarkers) {
    const missing = card.markers.map((m) => m.id).filter((id) => !counts.has(id));
    issues.push({
      code: "missing_markers",
      severity: "error",
      message: `Found ${relevant.length} of ${card.markers.length} calibration markers (missing ID ${missing.join(", ")}). Keep the whole card visible, flat and in focus.`,
    });
    return reject(emptyQuality(relevant));
  }

  // Marker orientation sanity: corners must be ordered consistently (same winding as the card).
  const flipped = relevant.filter((m) => polygonArea(m.corners) <= 0);
  if (flipped.length > 0) {
    issues.push({
      code: "marker_order_invalid",
      severity: "error",
      message: "Marker corners are in an unexpected order (mirrored image or misprinted card). Disable mirroring and retake.",
    });
    return reject(emptyQuality(relevant));
  }

  const side = minSide(relevant);
  if (side < thresholds.minMarkerSidePx) {
    issues.push({
      code: "markers_too_small",
      severity: "error",
      message: `Calibration markers are too small in the image (${side.toFixed(0)} px, minimum ${thresholds.minMarkerSidePx} px). Move the camera closer.`,
    });
    return reject(emptyQuality(relevant));
  }

  const correspondences: Correspondence[] = [];
  for (const m of relevant) {
    const known = markerCornersMm(card, m.id);
    for (let i = 0; i < 4; i++) correspondences.push({ from: m.corners[i]!, to: known[i]! });
  }

  let imageToPlane: Matrix3;
  let planeToImage: Matrix3;
  try {
    imageToPlane = estimateHomography(correspondences);
    planeToImage = invert(imageToPlane);
  } catch {
    issues.push({ code: "homography_failed", severity: "error", message: "Could not compute a perspective transform from the markers." });
    return reject(emptyQuality(relevant));
  }

  // Orientation check: the mapped card must not be mirrored relative to the known layout.
  const residuals = correspondences.map((c) => dist(applyHomography(imageToPlane, c.from), c.to));
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  const maxRes = Math.max(...residuals);

  // Perspective strength: compare px/mm at each marker centre (plane -> image local scales).
  const scales: number[] = [];
  for (const m of relevant) {
    const known = markerCornersMm(card, m.id);
    const centre = { x: (known[0]!.x + known[2]!.x) / 2, y: (known[0]!.y + known[2]!.y) / 2 };
    const s = localScale(planeToImage, centre);
    scales.push(s.max, s.min);
  }
  const cardCentre = { x: card.cardWidthMm / 2, y: card.cardHeightMm / 2 };
  const centreScale = localScale(planeToImage, cardCentre);
  const anisotropy = Math.max(...scales) / Math.min(...scales);
  const quality: CalibrationQuality = {
    markerCount: relevant.length,
    rmsResidualMm: rms,
    maxResidualMm: maxRes,
    minMarkerSidePx: side,
    pxPerMmAtCard: Math.sqrt(centreScale.max * centreScale.min),
    scaleAnisotropy: anisotropy,
    approxTiltDeg: (Math.acos(Math.min(1, centreScale.min / centreScale.max)) * 180) / Math.PI,
  };

  if (rms > thresholds.maxRmsResidualMm || maxRes > thresholds.maxResidualMm) {
    issues.push({
      code: "residual_too_high",
      severity: "error",
      message: `Marker positions do not fit the card layout (RMS ${rms.toFixed(2)} mm, max ${maxRes.toFixed(2)} mm). The card may be bent, misprinted, the wrong version, or the image too blurry.`,
    });
  }
  if (anisotropy > thresholds.maxScaleAnisotropy) {
    issues.push({
      code: "perspective_too_strong",
      severity: "error",
      message: `The camera is too far from perpendicular to the card (scale varies by ${((anisotropy - 1) * 100).toFixed(0)}%). Hold the phone directly above the hand.`,
    });
  }
  if (issues.some((i) => i.severity === "error")) return reject(quality);

  issues.push({
    code: "uniform_scale_unverifiable",
    severity: "info",
    message: `Accuracy depends on the card being printed at exactly 100% scale. Verify the ${card.verificationBarMm} mm bar with a ruler.`,
  });

  return { ...base, status: "valid", imageToPlane, planeToImage, quality, issues };
}

/**
 * Manual fallback: a user marks two points a known physical distance apart.
 * This yields a single isotropic scale with NO perspective correction, so it is
 * always labelled `manual` and carries a warning.
 */
export function calibrateManually(
  reference: ManualReference,
  image: { width: number; height: number },
  now: Date = new Date(),
): CalibrationRecord {
  const issues: ValidationIssue[] = [];
  const lengthPx = dist(reference.a, reference.b);
  const base = {
    method: "manual" as const,
    layoutId: null,
    layoutVersion: null,
    imageWidth: image.width,
    imageHeight: image.height,
    detectedMarkers: [],
    manualReference: reference,
    thresholds: DEFAULT_THRESHOLDS,
    createdAt: now.toISOString(),
  };
  const quality: CalibrationQuality = {
    markerCount: 0,
    rmsResidualMm: null,
    maxResidualMm: null,
    minMarkerSidePx: 0,
    pxPerMmAtCard: null,
    scaleAnisotropy: null,
    approxTiltDeg: null,
  };
  if (!(reference.lengthMm > 0) || !Number.isFinite(reference.lengthMm)) {
    issues.push({ code: "manual_length_invalid", severity: "error", message: "Reference length must be a positive number of millimetres." });
  }
  if (lengthPx < 100) {
    issues.push({
      code: "manual_reference_too_short",
      severity: "error",
      message: `The reference points are only ${lengthPx.toFixed(0)} px apart; use a reference of at least 100 px for a usable scale.`,
    });
  }
  if (issues.length > 0) {
    return { ...base, status: "rejected", imageToPlane: null, planeToImage: null, quality, issues };
  }
  const s = reference.lengthMm / lengthPx;
  const imageToPlane: Matrix3 = [s, 0, 0, 0, s, 0, 0, 0, 1];
  issues.push({
    code: "manual_scale_no_perspective",
    severity: "warning",
    message: "Manual scale: perspective is NOT corrected and accuracy depends entirely on how precisely the reference was marked and how flat-on the photo was taken.",
  });
  return {
    ...base,
    status: "manual",
    imageToPlane,
    planeToImage: invert(imageToPlane),
    quality: { ...quality, pxPerMmAtCard: 1 / s },
    issues,
  };
}

export function isUsableCalibration(c: CalibrationRecord | null | undefined): c is CalibrationRecord & { imageToPlane: Matrix3; planeToImage: Matrix3 } {
  return !!c && (c.status === "valid" || c.status === "manual") && !!c.imageToPlane && !!c.planeToImage;
}

export function toPlane(c: CalibrationRecord & { imageToPlane: Matrix3 }, p: ImagePoint): PlanePoint {
  return applyHomography(c.imageToPlane, p);
}

export function toImage(c: CalibrationRecord & { planeToImage: Matrix3 }, p: PlanePoint): ImagePoint {
  return applyHomography(c.planeToImage, p);
}

/**
 * Rough standard uncertainty (1 sigma, mm) that calibration alone contributes to a
 * length measured between two points. Derived from the corner residual RMS; it does
 * NOT include boundary-placement error or nail-to-card height differences.
 */
export function calibrationLengthUncertaintyMm(c: CalibrationRecord): number | null {
  if (c.status !== "valid" || c.quality.rmsResidualMm === null) return null;
  return Math.SQRT2 * c.quality.rmsResidualMm;
}

export { getCardSpec };
