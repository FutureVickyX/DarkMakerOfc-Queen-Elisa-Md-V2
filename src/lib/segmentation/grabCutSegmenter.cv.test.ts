import { beforeAll, describe, expect, it } from "vitest";
import { calibrateFromMarkers } from "@/lib/calibration/calibrationEngine";
import { NM_CARD_1 } from "@/lib/calibration/cardSpec";
import { detectMarkers } from "@/lib/cv/markerDetector";
import { type CV } from "@/lib/cv/opencv";
import { loadOpenCvNode } from "@/lib/cv/opencv.node";
import { applyHomography } from "@/lib/geometry/homography";
import { measureNail } from "@/lib/measurement/measurementEngine";
import { ellipsePolygon, renderScene } from "../../../tests/helpers/synth";
import { createGrabCutSegmenter } from "./grabCutSegmenter";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCvNode();
});

describe("GrabCut seeded segmenter (experimental baseline)", () => {
  it("outlines a contrasting synthetic nail and measures it within 0.5 mm", () => {
    const nail = ellipsePolygon({ x: 43, y: -30 }, 7, 6, 360);
    const { image, planeToImage } = renderScene({
      pose: { f: 1500, width: 1600, height: 1200, distanceMm: 230, lookAt: { x: 43, y: -10 } },
      card: NM_CARD_1,
      nails: [{ polygon: nail, color: [240, 196, 200] }],
      noiseAmplitude: 6,
    });
    const cal = calibrateFromMarkers(detectMarkers(cv, image, NM_CARD_1).markers, image);
    expect(cal.status).toBe("valid");
    const seg = createGrabCutSegmenter(cv);
    const det = seg.segmentAtSeed!({ image, imageToPlane: cal.imageToPlane, planeToImage: cal.planeToImage }, applyHomography(planeToImage, { x: 43, y: -30 }));
    if (det instanceof Promise) throw new Error("expected sync");
    expect(det.status).not.toBe("failed");
    expect(det.confidence).toBeNull();
    expect(det.source).toBe("heuristic");
    const g = measureNail({ contour: det.contour, imageToPlane: cal.imageToPlane!, referenceDistal: NM_CARD_1.distalDirection, axis: { source: "card" } });
    expect(Math.abs(g.widthMm - 14)).toBeLessThan(0.5);
    expect(Math.abs(g.lengthMm - 12)).toBeLessThan(0.5);
  });

  it("reports failure instead of inventing a contour near the image edge", () => {
    const { image } = renderScene({ pose: { f: 1500, width: 1600, height: 1200, distanceMm: 230, lookAt: { x: 43, y: -10 } }, card: NM_CARD_1 });
    const det = createGrabCutSegmenter(cv).segmentAtSeed!({ image, imageToPlane: null, planeToImage: null }, { x: -50, y: -50 });
    if (det instanceof Promise) throw new Error("expected sync");
    expect(det.status).toBe("failed");
    expect(det.contour).toHaveLength(0);
  });
});
