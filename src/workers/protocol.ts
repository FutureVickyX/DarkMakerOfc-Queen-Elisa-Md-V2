import type { ImagePoint } from "@/lib/core/types";
import type { CaptureAnalysis } from "@/lib/cv/captureAnalysis";
import type { RasterImage } from "@/lib/cv/raster";
import type { Matrix3 } from "@/lib/geometry/homography";
import type { NailDetection } from "@/lib/segmentation/nailSegmenter";

export type WorkerRequest =
  | { id: number; type: "warmup" }
  | { id: number; type: "load"; imageKey: string; blob?: Blob; raster?: RasterImage }
  | { id: number; type: "analyze"; imageKey: string; layoutId: string }
  | { id: number; type: "segment"; imageKey: string; seed: ImagePoint; imageToPlane: Matrix3 | null; planeToImage: Matrix3 | null }
  | { id: number; type: "release"; imageKey: string };

export type WorkerResponse =
  | { id: number; type: "ready" }
  | { id: number; type: "progress"; stage: string }
  | { id: number; type: "loaded"; width: number; height: number; scale: number; originalWidth: number; originalHeight: number }
  | { id: number; type: "analysis"; analysis: CaptureAnalysis }
  | { id: number; type: "segmentation"; detection: NailDetection }
  | { id: number; type: "released" }
  | { id: number; type: "error"; message: string };
