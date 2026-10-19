import { calibrateFromMarkers, type CalibrationRecord, type CalibrationThresholds } from "@/lib/calibration/calibrationEngine";
import type { CalibrationCardSpec } from "@/lib/calibration/cardSpec";
import { analyzeImageQuality, type ImageQualityReport } from "./imageQuality";
import { detectMarkers, type MarkerDetectionResult } from "./markerDetector";
import type { CV } from "./opencv";
import type { RasterImage } from "./raster";

export interface CaptureAnalysis {
  readonly detection: Omit<MarkerDetectionResult, "markers">;
  readonly quality: ImageQualityReport;
  readonly calibration: CalibrationRecord;
}

/**
 * Runs marker detection, image-quality checks and calibration for one image.
 * Image-quality errors that make the scale untrustworthy (e.g. blurred marker
 * edges, too-low resolution) downgrade an otherwise valid calibration to rejected.
 */
export function analyzeCapture(
  cv: CV,
  image: RasterImage,
  card: CalibrationCardSpec,
  thresholds?: Partial<CalibrationThresholds>,
): CaptureAnalysis {
  const detection = detectMarkers(cv, image, card);
  const quality = analyzeImageQuality(image, detection.markers);
  let calibration = calibrateFromMarkers(detection.markers, image, { card, thresholds });
  const blocking = quality.issues.filter((i) => i.severity === "error");
  if (calibration.status === "valid" && blocking.length > 0) {
    calibration = {
      ...calibration,
      status: "rejected",
      imageToPlane: null,
      planeToImage: null,
      issues: [...blocking, ...calibration.issues],
    };
  } else {
    calibration = { ...calibration, issues: [...blocking, ...calibration.issues] };
  }
  const { markers: _markers, ...detectionMeta } = detection;
  return { detection: detectionMeta, quality, calibration };
}
