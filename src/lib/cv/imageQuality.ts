import type { ImagePoint, ValidationIssue } from "@/lib/core/types";
import type { DetectedMarker } from "@/lib/calibration/calibrationEngine";
import { downscaleGray, toGray, type RasterImage } from "./raster";

export interface QualityThresholds {
  readonly minLongSidePx: number;
  readonly recommendedLongSidePx: number;
  readonly minMeanLuma: number;
  readonly maxMeanLuma: number;
  /** Fraction of pixels with all channels clipped (>= 250) above which glare is reported. */
  readonly maxClippedFraction: number;
  /** Median 10-90% edge rise distance on marker borders, in px, above which the image is blurry. */
  readonly maxMarkerEdgeWidthPx: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  minLongSidePx: 1000,
  recommendedLongSidePx: 2000,
  minMeanLuma: 50,
  maxMeanLuma: 225,
  maxClippedFraction: 0.02,
  maxMarkerEdgeWidthPx: 4.5,
};

export interface ImageQualityReport {
  readonly width: number;
  readonly height: number;
  readonly meanLuma: number;
  readonly clippedFraction: number;
  /** Variance of the Laplacian on a <=1600 px working copy; content dependent, informational. */
  readonly laplacianVariance: number;
  /** Median marker edge width (px, original resolution), or null if no markers were analysed. */
  readonly markerEdgeWidthPx: number | null;
  readonly issues: ValidationIssue[];
}

/**
 * Global image checks that are actually computed (resolution, exposure, clipping,
 * sharpness). Marker-edge sharpness is only evaluated when markers are supplied.
 */
export function analyzeImageQuality(
  img: RasterImage,
  markers: readonly DetectedMarker[] = [],
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): ImageQualityReport {
  const issues: ValidationIssue[] = [];
  const longSide = Math.max(img.width, img.height);
  if (longSide < thresholds.minLongSidePx) {
    issues.push({
      code: "resolution_too_low",
      severity: "error",
      message: `Image is ${img.width}x${img.height}px; at least ${thresholds.minLongSidePx}px on the long side is required.`,
    });
  } else if (longSide < thresholds.recommendedLongSidePx) {
    issues.push({
      code: "resolution_low",
      severity: "warning",
      message: `Image is ${img.width}x${img.height}px; ${thresholds.recommendedLongSidePx}px or more is recommended.`,
    });
  }

  let lumaSum = 0;
  let clipped = 0;
  const d = img.data;
  const n = img.width * img.height;
  for (let j = 0; j < d.length; j += 4) {
    const r = d[j]!;
    const g = d[j + 1]!;
    const b = d[j + 2]!;
    lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
    if (r >= 250 && g >= 250 && b >= 250) clipped++;
  }
  const meanLuma = lumaSum / n;
  const clippedFraction = clipped / n;
  if (meanLuma < thresholds.minMeanLuma) {
    issues.push({ code: "too_dark", severity: "warning", message: "Image is underexposed. Use brighter, even lighting." });
  } else if (meanLuma > thresholds.maxMeanLuma) {
    issues.push({ code: "too_bright", severity: "warning", message: "Image is overexposed. Reduce direct light." });
  }
  if (clippedFraction > thresholds.maxClippedFraction) {
    issues.push({
      code: "glare",
      severity: "warning",
      message: `${(clippedFraction * 100).toFixed(1)}% of pixels are blown out (glare). Avoid direct flash or reflections on nails and card.`,
    });
  }

  const gray = toGray(img);
  const factor = Math.max(1, Math.ceil(longSide / 1600));
  const small = downscaleGray(gray, img.width, img.height, factor);
  const laplacianVariance = laplacianVar(small.gray, small.width, small.height);

  let markerEdgeWidthPx: number | null = null;
  if (markers.length > 0) {
    markerEdgeWidthPx = markerEdgeWidth(gray, img.width, img.height, markers);
    if (markerEdgeWidthPx !== null && markerEdgeWidthPx > thresholds.maxMarkerEdgeWidthPx) {
      issues.push({
        code: "blurry",
        severity: "error",
        message: `Calibration marker edges are blurred (${markerEdgeWidthPx.toFixed(1)} px transition). Hold still, tap to focus and retake.`,
      });
    }
  }

  return { width: img.width, height: img.height, meanLuma, clippedFraction, laplacianVariance, markerEdgeWidthPx, issues };
}

function laplacianVar(g: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = g[i - 1]! + g[i + 1]! + g[i - w]! + g[i + w]! - 4 * g[i]!;
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export function sampleBilinear(g: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = g[y0 * w + x0]!;
  const b = g[y0 * w + x1]!;
  const c = g[y1 * w + x0]!;
  const d = g[y1 * w + x1]!;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * Median 10-90% intensity rise distance across the outer border of each marker,
 * sampled perpendicular to each side (outside = white quiet zone, inside = black border).
 */
export function markerEdgeWidth(
  gray: Float32Array,
  w: number,
  h: number,
  markers: readonly DetectedMarker[],
): number | null {
  const widths: number[] = [];
  for (const m of markers) {
    const c = m.corners;
    for (let s = 0; s < 4; s++) {
      const a = c[s]!;
      const b = c[(s + 1) % 4]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 8) continue;
      // Outward normal for a clockwise (in image coords) polygon TL->TR->BR->BL.
      const nx = (b.y - a.y) / len;
      const ny = -(b.x - a.x) / len;
      // Profile half-length: a fraction of a marker cell (side / 6) so we stay on the border.
      const half = Math.max(3, len / 12);
      for (const t of [0.3, 0.5, 0.7]) {
        const p: ImagePoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const ew = edgeRise(gray, w, h, p, nx, ny, half);
        if (ew !== null) widths.push(ew);
      }
    }
  }
  if (widths.length === 0) return null;
  widths.sort((x, y) => x - y);
  return widths[Math.floor(widths.length / 2)]!;
}

function edgeRise(g: Float32Array, w: number, h: number, p: ImagePoint, nx: number, ny: number, half: number): number | null {
  const step = 0.25;
  const samples: number[] = [];
  for (let t = -half; t <= half; t += step) samples.push(sampleBilinear(g, w, h, p.x + nx * t, p.y + ny * t));
  const inside = samples[0]!;
  const outside = samples[samples.length - 1]!;
  const range = outside - inside;
  if (range < 40) return null; // not a clear black/white edge (occluded or glare)
  const lo = inside + 0.1 * range;
  const hi = inside + 0.9 * range;
  let tLo: number | null = null;
  let tHi: number | null = null;
  for (let i = 1; i < samples.length; i++) {
    const v0 = samples[i - 1]!;
    const v1 = samples[i]!;
    if (tLo === null && v0 < lo && v1 >= lo) tLo = (i - 1 + (lo - v0) / (v1 - v0)) * step;
    if (v0 < hi && v1 >= hi) tHi = (i - 1 + (hi - v0) / (v1 - v0)) * step;
  }
  if (tLo === null || tHi === null || tHi < tLo) return null;
  return tHi - tLo;
}
