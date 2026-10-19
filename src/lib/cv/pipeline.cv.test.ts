/**
 * End-to-end calibration tests on synthetic rendered images using the real
 * OpenCV.js ArUco detector (same runtime the browser worker uses).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { calibrateFromMarkers } from "@/lib/calibration/calibrationEngine";
import { DICT_4X4_50_PATTERNS, NM_CARD_1 } from "@/lib/calibration/cardSpec";
import { applyHomography } from "@/lib/geometry/homography";
import { measureNail } from "@/lib/measurement/measurementEngine";
import { ellipsePolygon, projectPolygon, renderScene, type CameraPose } from "../../../tests/helpers/synth";
import { analyzeImageQuality } from "./imageQuality";
import { detectMarkers } from "./markerDetector";
import { loadOpenCvNode, type CV } from "./opencv";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCvNode();
});

const basePose: CameraPose = { f: 1500, width: 1600, height: 1200, distanceMm: 230, lookAt: { x: 43, y: -10 } };

describe("printable card patterns", () => {
  it("match OpenCV's DICT_4X4_50 markers", () => {
    const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50);
    for (const id of [0, 1, 2, 3]) {
      const m = new cv.Mat();
      cv.generateImageMarker(dict, id, 6, m, 1);
      const rows: string[] = [];
      for (let y = 0; y < 6; y++) {
        let row = "";
        for (let x = 0; x < 6; x++) row += m.ucharAt(y, x) > 127 ? "1" : "0";
        rows.push(row);
      }
      m.delete();
      expect(rows).toEqual(DICT_4X4_50_PATTERNS[id]);
    }
    dict.delete();
  });
});

describe("marker detection + calibration on rendered scenes", () => {
  const scenarios: [string, Partial<CameraPose>][] = [
    ["fronto-parallel", {}],
    ["tilted 10° about x", { tiltXDeg: 10 }],
    ["tilted and rolled", { tiltYDeg: -8, rollDeg: 25 }],
    ["card off-centre, rolled 90°", { rollDeg: 90, lookAt: { x: 10, y: 40 } }],
  ];

  for (const [name, overrides] of scenarios) {
    it(`calibrates and measures known geometry: ${name}`, () => {
      const pose = { ...basePose, ...overrides };
      const nailPoly = ellipsePolygon({ x: 43, y: -30 }, 7, 6, 360);
      const { image, planeToImage } = renderScene({ pose, card: NM_CARD_1, nails: [{ polygon: nailPoly }] });
      const det = detectMarkers(cv, image, NM_CARD_1);
      expect(det.markers.map((m) => m.id)).toEqual([0, 1, 2, 3]);

      const cal = calibrateFromMarkers(det.markers, image);
      expect(cal.status).toBe("valid");
      expect(cal.quality.rmsResidualMm!).toBeLessThan(0.1);

      // Known distance between two plane points 60 mm apart, away from the card.
      const a = applyHomography(cal.imageToPlane!, applyHomography(planeToImage, { x: 10, y: -25 }));
      const b = applyHomography(cal.imageToPlane!, applyHomography(planeToImage, { x: 70, y: -25 }));
      expect(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 60)).toBeLessThan(0.3);

      // Measuring the true nail outline through the estimated calibration.
      const g = measureNail({
        contour: projectPolygon(planeToImage, nailPoly),
        imageToPlane: cal.imageToPlane!,
        referenceDistal: NM_CARD_1.distalDirection,
        axis: { source: "card" },
      });
      expect(Math.abs(g.widthMm - 14)).toBeLessThan(0.15);
      expect(Math.abs(g.lengthMm - 12)).toBeLessThan(0.15);

      const q = analyzeImageQuality(image, det.markers);
      expect(q.issues.find((i) => i.code === "blurry")).toBeUndefined();
    });
  }

  it("fails safely when a marker is occluded", () => {
    const { image } = renderScene({ pose: basePose, card: NM_CARD_1, hideMarkers: [2] });
    const det = detectMarkers(cv, image, NM_CARD_1);
    const cal = calibrateFromMarkers(det.markers, image);
    expect(cal.status).toBe("rejected");
    expect(cal.imageToPlane).toBeNull();
  });

  it("fails safely when two cards are visible", () => {
    const { image } = renderScene({
      pose: { ...basePose, distanceMm: 330, lookAt: { x: 43, y: 50 } },
      card: NM_CARD_1,
      extraCardOffsets: [{ x: 0, y: 60 }],
    });
    const det = detectMarkers(cv, image, NM_CARD_1);
    expect(det.markers.length).toBe(8);
    const cal = calibrateFromMarkers(det.markers, image);
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("ambiguous_markers");
  });

  it("rejects a misprinted card whose markers are the wrong size", () => {
    const printed = { ...NM_CARD_1, markerSizeMm: 12.5 };
    const { image } = renderScene({ pose: basePose, card: NM_CARD_1, printedCard: printed });
    const det = detectMarkers(cv, image, NM_CARD_1);
    expect(det.markers.length).toBe(4);
    const cal = calibrateFromMarkers(det.markers, image);
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("residual_too_high");
  });

  it("flags blurry images", () => {
    const { image } = renderScene({ pose: basePose, card: NM_CARD_1, blurRadius: 2 });
    const det = detectMarkers(cv, image, NM_CARD_1);
    expect(det.markers.length).toBe(4);
    const q = analyzeImageQuality(image, det.markers);
    expect(q.issues.find((i) => i.code === "blurry")?.severity).toBe("error");
  });

  it("flags glare", () => {
    const { image } = renderScene({ pose: basePose, card: NM_CARD_1, glare: { centre: { x: 43, y: -40 }, radiusMm: 20 } });
    const q = analyzeImageQuality(image);
    expect(q.issues.map((i) => i.code)).toContain("glare");
  });

  it("rejects low-resolution images", () => {
    const { image } = renderScene({ pose: { f: 300, width: 640, height: 480, distanceMm: 300, lookAt: { x: 43, y: 27 } }, card: NM_CARD_1 });
    const q = analyzeImageQuality(image);
    expect(q.issues.map((i) => i.code)).toContain("resolution_too_low");
    const cal = calibrateFromMarkers(detectMarkers(cv, image, NM_CARD_1).markers, image);
    expect(cal.status).toBe("rejected");
  });

  it("downscales very large images for detection and maps corners back", () => {
    const pose = { ...basePose, f: 3000, width: 3200, height: 2400 };
    const { image, planeToImage } = renderScene({ pose, card: NM_CARD_1, supersample: 1 });
    const det = detectMarkers(cv, image, NM_CARD_1, { maxDetectionSide: 1600 });
    expect(det.detectionScale).toBeCloseTo(0.5, 6);
    const cal = calibrateFromMarkers(det.markers, image);
    expect(cal.status).toBe("valid");
    const truth = applyHomography(planeToImage, { x: 4, y: 4 });
    const m0 = det.markers.find((m) => m.id === 0)!;
    expect(Math.hypot(m0.corners[0].x - truth.x, m0.corners[0].y - truth.y)).toBeLessThan(1.5);
  });
});
