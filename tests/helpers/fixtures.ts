import { calibrateFromMarkers, type DetectedMarker } from "@/lib/calibration/calibrationEngine";
import { NM_CARD_1, markerCornersMm } from "@/lib/calibration/cardSpec";
import { applyHomography } from "@/lib/geometry/homography";
import { createScan, type Capture, type Scan } from "@/lib/scan/model";
import { addNail } from "@/lib/scan/scanService";
import { ellipsePolygon, poseHomography, projectPolygon } from "./synth";

export const IMAGE = { width: 3000, height: 4000 };
export const H = poseHomography({ f: 3200, width: IMAGE.width, height: IMAGE.height, distanceMm: 260, lookAt: { x: 43, y: -10 } });

export function markers(): DetectedMarker[] {
  return [0, 1, 2, 3].map((id) => {
    const c = markerCornersMm(NM_CARD_1, id).map((p) => applyHomography(H, p));
    return { id, corners: [c[0]!, c[1]!, c[2]!, c[3]!] };
  });
}

export function capture(id = "11111111-1111-4111-8111-111111111111"): Capture {
  return {
    id,
    createdAt: "2026-10-19T10:00:00.000Z",
    captureMethod: "upload",
    deviceInfo: { userAgent: "test" },
    imageAssetId: null,
    width: IMAGE.width,
    height: IMAGE.height,
    handHint: "left",
    calibration: calibrateFromMarkers(markers(), IMAGE, { now: new Date("2026-10-19T10:00:00Z") }),
    quality: null,
  };
}

/** A nail ellipse of known size (width 2*rx, length 2*ry) projected into the image. */
export function nailContour(cx: number, cy: number, rx = 7, ry = 6) {
  return projectPolygon(H, ellipsePolygon({ x: cx, y: cy }, rx, ry, 64));
}

export function scanWithNail(): Scan {
  const s = { ...createScan("Fixture"), id: "22222222-2222-4222-8222-222222222222", captures: [capture()] };
  return addNail(s, {
    captureId: s.captures[0]!.id,
    slot: { hand: "left", finger: "index" },
    contour: nailContour(43, -30),
    contourSource: "manual",
    manuallyEdited: true,
    axis: { source: "card" },
    detection: null,
  }).scan;
}
