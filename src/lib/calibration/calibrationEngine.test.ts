import { describe, expect, it } from "vitest";
import { applyHomography, type Matrix3 } from "@/lib/geometry/homography";
import { poseHomography } from "../../../tests/helpers/synth";
import { calibrateFromMarkers, calibrateManually, type DetectedMarker } from "./calibrationEngine";
import { NM_CARD_1, markerCornersMm, type CalibrationCardSpec } from "./cardSpec";

const IMAGE = { width: 3000, height: 4000 };
const pose = (extra: Partial<Parameters<typeof poseHomography>[0]> = {}) =>
  poseHomography({ f: 3200, width: IMAGE.width, height: IMAGE.height, distanceMm: 260, lookAt: { x: 43, y: 27 }, ...extra });

function markersFor(H: Matrix3, card: CalibrationCardSpec = NM_CARD_1, noisePx = 0, ids = [0, 1, 2, 3]): DetectedMarker[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2 * noisePx;
  };
  return ids.map((id) => {
    const c = markerCornersMm(card, id).map((p) => {
      const q = applyHomography(H, p);
      return { x: q.x + rnd(), y: q.y + rnd() };
    });
    return { id, corners: [c[0]!, c[1]!, c[2]!, c[3]!] };
  });
}

describe("calibrateFromMarkers", () => {
  it("produces a valid calibration with near-zero residual from exact corners", () => {
    const cal = calibrateFromMarkers(markersFor(pose()), IMAGE);
    expect(cal.status).toBe("valid");
    expect(cal.quality.rmsResidualMm).toBeLessThan(1e-6);
    expect(cal.quality.pxPerMmAtCard).toBeCloseTo(3200 / 260, 3);
    expect(cal.layoutId).toBe("NM-CARD-1");
  });

  it("recovers known distances at multiple image positions and perspective angles", () => {
    const poses = [
      pose(),
      pose({ tiltXDeg: 8, lookAt: { x: 10, y: -40 } }),
      pose({ tiltYDeg: -10, rollDeg: 35, lookAt: { x: 80, y: 60 } }),
      pose({ tiltXDeg: -6, tiltYDeg: 6, rollDeg: -120, lookAt: { x: -30, y: 20 } }),
    ];
    for (const H of poses) {
      const cal = calibrateFromMarkers(markersFor(H, NM_CARD_1, 0.3), IMAGE);
      expect(cal.status).toBe("valid");
      // A 15 mm segment located 40 mm beyond the card.
      const a = { x: 30, y: -40 };
      const b = { x: 45, y: -40 };
      const ma = applyHomography(cal.imageToPlane!, applyHomography(H, a));
      const mb = applyHomography(cal.imageToPlane!, applyHomography(H, b));
      expect(Math.abs(Math.hypot(mb.x - ma.x, mb.y - ma.y) - 15)).toBeLessThan(0.1);
    }
  });

  it("rejects when a marker is missing", () => {
    const cal = calibrateFromMarkers(markersFor(pose(), NM_CARD_1, 0, [0, 1, 2]), IMAGE);
    expect(cal.status).toBe("rejected");
    expect(cal.imageToPlane).toBeNull();
    expect(cal.issues.map((i) => i.code)).toContain("missing_markers");
  });

  it("rejects ambiguous duplicate markers", () => {
    const m = markersFor(pose());
    const cal = calibrateFromMarkers([...m, m[0]!], IMAGE);
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("ambiguous_markers");
  });

  it("rejects a card whose marker geometry does not match the layout", () => {
    const wrong: CalibrationCardSpec = { ...NM_CARD_1, markerSizeMm: 13 };
    const cal = calibrateFromMarkers(markersFor(pose(), wrong), IMAGE);
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("residual_too_high");
  });

  it("rejects incorrectly ordered (swapped) markers", () => {
    const m = markersFor(pose());
    const swapped = [m[0]!, { ...m[1]!, id: 2 }, { ...m[2]!, id: 1 }, m[3]!];
    const cal = calibrateFromMarkers(swapped, IMAGE);
    expect(cal.status).toBe("rejected");
  });

  it("rejects mirrored marker corners", () => {
    const m = markersFor(pose()).map((mk) => ({ ...mk, corners: [mk.corners[1], mk.corners[0], mk.corners[3], mk.corners[2]] as DetectedMarker["corners"] }));
    const cal = calibrateFromMarkers(m, IMAGE);
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("marker_order_invalid");
  });

  it("rejects excessive perspective distortion", () => {
    const H = poseHomography({ f: 3200, width: IMAGE.width, height: IMAGE.height, distanceMm: 120, tiltXDeg: 50, lookAt: { x: 43, y: 27 } });
    const cal = calibrateFromMarkers(markersFor(H), IMAGE);
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("perspective_too_strong");
  });

  it("rejects markers that are too small", () => {
    const H = poseHomography({ f: 600, width: 800, height: 600, distanceMm: 400, lookAt: { x: 43, y: 27 } });
    const cal = calibrateFromMarkers(markersFor(H), { width: 800, height: 600 });
    expect(cal.status).toBe("rejected");
    expect(cal.issues.map((i) => i.code)).toContain("markers_too_small");
  });

  it("rejects noisy detections that exceed the residual threshold", () => {
    const cal = calibrateFromMarkers(markersFor(pose(), NM_CARD_1, 8), IMAGE);
    expect(cal.status).toBe("rejected");
    expect(cal.quality.rmsResidualMm).toBeGreaterThan(0.2);
  });

  it("honours configurable thresholds", () => {
    const cal = calibrateFromMarkers(markersFor(pose(), NM_CARD_1, 8), IMAGE, { thresholds: { maxRmsResidualMm: 5, maxResidualMm: 5 } });
    expect(cal.status).toBe("valid");
  });
});

describe("calibrateManually", () => {
  it("creates a scale-only manual calibration with a warning", () => {
    const cal = calibrateManually({ a: { x: 100, y: 100 }, b: { x: 600, y: 100 }, lengthMm: 50 }, IMAGE);
    expect(cal.status).toBe("manual");
    expect(applyHomography(cal.imageToPlane!, { x: 600, y: 100 }).x).toBeCloseTo(60, 9);
    expect(cal.issues.some((i) => i.code === "manual_scale_no_perspective" && i.severity === "warning")).toBe(true);
  });

  it("rejects invalid manual references instead of assuming a scale", () => {
    expect(calibrateManually({ a: { x: 0, y: 0 }, b: { x: 30, y: 0 }, lengthMm: 10 }, IMAGE).status).toBe("rejected");
    expect(calibrateManually({ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, lengthMm: -1 }, IMAGE).status).toBe("rejected");
  });
});
