import type { ContourSource, ImagePoint, ValidationIssue } from "@/lib/core/types";
import type { Matrix3 } from "@/lib/geometry/homography";
import type { RasterImage } from "@/lib/cv/raster";

/**
 * Nail segmentation interface.
 *
 * Any segmenter (heuristic baseline today, a trained model later via ONNX
 * Runtime Web or an inference service) returns one contour per nail plate in
 * ORIGINAL image pixel coordinates. The measurement engine only consumes these
 * contours plus the calibration, so swapping the segmenter requires no changes
 * to calibration or measurement code.
 */

export type DetectionStatus = "detected" | "uncertain" | "failed";

export interface NailDetection {
  readonly contour: readonly ImagePoint[];
  readonly status: DetectionStatus;
  /**
   * Model confidence in [0, 1] when produced by a trained model that reports one.
   * Null for heuristic and manual contours: no fabricated scores.
   */
  readonly confidence: number | null;
  readonly source: ContourSource;
  readonly segmenterId: string;
  readonly segmenterVersion: string;
  /** Segmenter-specific diagnostics (e.g. solidity), shown to the user as such. */
  readonly diagnostics: Readonly<Record<string, number>>;
  readonly issues: readonly ValidationIssue[];
  readonly durationMs: number;
}

export interface SegmentationContext {
  readonly image: RasterImage;
  /** Calibration homographies when available, used to size search windows in mm. */
  readonly imageToPlane: Matrix3 | null;
  readonly planeToImage: Matrix3 | null;
}

export interface SegmenterInfo {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  /** True when accuracy has not been validated on real data. */
  readonly experimental: boolean;
  /** "automatic": finds all nails; "seeded": needs one tap per nail. */
  readonly mode: "automatic" | "seeded";
  readonly description: string;
}

export interface NailSegmenter {
  readonly info: SegmenterInfo;
  /** Seeded segmentation: segment the nail plate containing `seed`. */
  segmentAtSeed?(ctx: SegmentationContext, seed: ImagePoint): Promise<NailDetection> | NailDetection;
  /** Automatic segmentation: return every nail plate found. */
  segmentAll?(ctx: SegmentationContext): Promise<NailDetection[]> | NailDetection[];
}

/** Placeholder describing how a trained model plugs in; not registered unless configured. */
export const MODEL_INTEGRATION_NOTE =
  "No trained nail-segmentation model is bundled. Implement NailSegmenter.segmentAll() in src/lib/segmentation/ (e.g. ONNX Runtime Web) and register it in segmenterRegistry.ts.";
