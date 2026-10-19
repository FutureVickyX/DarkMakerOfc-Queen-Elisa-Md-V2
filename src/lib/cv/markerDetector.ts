import type { DetectedMarker } from "@/lib/calibration/calibrationEngine";
import type { CalibrationCardSpec } from "@/lib/calibration/cardSpec";
import type { CV } from "./opencv";
import type { RasterImage } from "./raster";

export interface MarkerDetectionResult {
  readonly markers: DetectedMarker[];
  /** Number of square candidates that did not decode to a dictionary marker. */
  readonly rejectedCandidates: number;
  /** Factor the image was downscaled by before detection (1 = full resolution). */
  readonly detectionScale: number;
  readonly durationMs: number;
}

export interface MarkerDetectionOptions {
  /** Longest image side used for detection; larger images are downscaled. */
  readonly maxDetectionSide?: number;
}

const DICTIONARY_IDS: Record<CalibrationCardSpec["dictionary"], string> = {
  DICT_4X4_50: "DICT_4X4_50",
};

/**
 * Detects ArUco markers with OpenCV's ArucoDetector and sub-pixel corner refinement.
 * Corners are returned in ORIGINAL image pixel coordinates (pixel-centre convention),
 * ordered TL, TR, BR, BL in the marker's own frame.
 */
export function detectMarkers(
  cv: CV,
  image: RasterImage,
  card: CalibrationCardSpec,
  options: MarkerDetectionOptions = {},
): MarkerDetectionResult {
  const started = Date.now();
  const maxSide = options.maxDetectionSide ?? 4096;
  const longSide = Math.max(image.width, image.height);
  const scale = longSide > maxSide ? maxSide / longSide : 1;

  const mats: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(m: T) => {
    mats.push(m);
    return m;
  };
  try {
    const rgba = track(cv.matFromImageData(image));
    const gray = track(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    let input = gray;
    if (scale < 1) {
      input = track(new cv.Mat());
      cv.resize(gray, input, new cv.Size(Math.round(image.width * scale), Math.round(image.height * scale)), 0, 0, cv.INTER_AREA);
    }

    const dictionary = track(cv.getPredefinedDictionary(cv[DICTIONARY_IDS[card.dictionary]]));
    const params = track(new cv.aruco_DetectorParameters());
    params.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX ?? 1;
    const refine = track(new cv.aruco_RefineParameters(10, 3, true));
    const detector = track(new cv.aruco_ArucoDetector(dictionary, params, refine));
    const corners = track(new cv.MatVector());
    const ids = track(new cv.Mat());
    const rejected = track(new cv.MatVector());
    detector.detectMarkers(input, corners, ids, rejected);

    const markers: DetectedMarker[] = [];
    const count: number = corners.size();
    for (let i = 0; i < count; i++) {
      const c = corners.get(i);
      const d = c.data32F as Float32Array;
      // Map from detection-scale pixel centres back to original pixel centres.
      const map = (x: number, y: number) => ({ x: (x + 0.5) / scale - 0.5, y: (y + 0.5) / scale - 0.5 });
      markers.push({
        id: ids.data32S[i] as number,
        corners: [map(d[0]!, d[1]!), map(d[2]!, d[3]!), map(d[4]!, d[5]!), map(d[6]!, d[7]!)],
      });
      c.delete();
    }
    markers.sort((a, b) => a.id - b.id);
    return { markers, rejectedCandidates: rejected.size(), detectionScale: scale, durationMs: Date.now() - started };
  } finally {
    for (const m of mats.reverse()) {
      try {
        m.delete();
      } catch {
        /* already released */
      }
    }
  }
}
