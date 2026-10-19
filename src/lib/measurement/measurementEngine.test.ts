import { describe, expect, it } from "vitest";
import { applyHomography, invert, type Matrix3 } from "@/lib/geometry/homography";
import { ellipsePolygon, poseHomography, rectPolygon } from "../../../tests/helpers/synth";
import { measureNail, principalAxis } from "./measurementEngine";

const DISTAL = { x: 0, y: -1 };
const planeToImage = poseHomography({ f: 3000, width: 3000, height: 4000, distanceMm: 250, tiltXDeg: 7, tiltYDeg: -5, rollDeg: 20, lookAt: { x: 40, y: -20 } });
const imageToPlane: Matrix3 = invert(planeToImage);
const toImage = (poly: { x: number; y: number }[]) => poly.map((p) => applyHomography(planeToImage, p));

describe("measureNail", () => {
  it("measures a rectangle exactly through a perspective calibration", () => {
    const g = measureNail({ contour: toImage(rectPolygon(30, -40, 14, 11)), imageToPlane, referenceDistal: DISTAL, axis: { source: "card" } });
    expect(g.widthMm).toBeCloseTo(14, 3);
    expect(g.lengthMm).toBeCloseTo(11, 3);
    expect(g.areaMm2).toBeCloseTo(154, 2);
    expect(g.axialExtentMm).toBeCloseTo(11, 3);
  });

  it("measures an ellipse's axes as width and length", () => {
    const g = measureNail({ contour: toImage(ellipsePolygon({ x: 20, y: -30 }, 7.5, 6, 720)), imageToPlane, referenceDistal: DISTAL, axis: { source: "card" } });
    expect(g.widthMm).toBeCloseTo(15, 2);
    expect(g.lengthMm).toBeCloseTo(12, 2);
    expect(g.areaMm2).toBeCloseTo(Math.PI * 7.5 * 6, 0);
  });

  it("uses a manually rotated axis", () => {
    // Rectangle rotated 30 degrees clockwise (y-down): width 10 across, 16 along.
    const t = (30 * Math.PI) / 180;
    const base = rectPolygon(-5, -8, 10, 16);
    const rotated = base.map((p) => ({ x: 50 + p.x * Math.cos(t) - p.y * Math.sin(t), y: -30 + p.x * Math.sin(t) + p.y * Math.cos(t) }));
    const g = measureNail({ contour: toImage(rotated), imageToPlane, referenceDistal: DISTAL, axis: { source: "manual", angleDeg: 30 } });
    expect(g.widthMm).toBeCloseTo(10, 3);
    expect(g.lengthMm).toBeCloseTo(16, 3);
    const pca = measureNail({ contour: toImage(rotated), imageToPlane, referenceDistal: DISTAL, axis: { source: "pca" } });
    expect(pca.widthMm).toBeCloseTo(10, 3);
    expect(pca.lengthMm).toBeCloseTo(16, 3);
  });

  it("returns the maximum width for a tapered shape", () => {
    // Trapezoid wider at the distal end (top, y smaller).
    const trap = [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 13, y: 12 },
      { x: 3, y: 12 },
    ];
    const g = measureNail({ contour: toImage(trap), imageToPlane, referenceDistal: DISTAL, axis: { source: "card" } });
    expect(g.widthMm).toBeCloseTo(16, 2);
    expect(g.lengthMm).toBeCloseTo(12, 3);
  });

  it("is independent of contour winding", () => {
    const poly = ellipsePolygon({ x: 0, y: 0 }, 6, 5, 200);
    const a = measureNail({ contour: toImage(poly), imageToPlane, referenceDistal: DISTAL, axis: { source: "pca" } });
    const b = measureNail({ contour: toImage([...poly].reverse()), imageToPlane, referenceDistal: DISTAL, axis: { source: "pca" } });
    expect(a.widthMm).toBeCloseTo(b.widthMm, 9);
    expect(a.lengthMm).toBeCloseTo(b.lengthMm, 9);
  });

  it("finds the major principal axis regardless of winding", () => {
    const poly = ellipsePolygon({ x: 3, y: 4 }, 3, 9, 200);
    for (const p of [poly, [...poly].reverse()]) {
      const ax = principalAxis(p);
      expect(Math.abs(ax.y)).toBeCloseTo(1, 6);
    }
  });

  it("rejects degenerate contours", () => {
    expect(() => measureNail({ contour: [{ x: 0, y: 0 }, { x: 1, y: 1 }], imageToPlane, referenceDistal: DISTAL, axis: { source: "card" } })).toThrow();
    expect(() =>
      measureNail({ contour: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], imageToPlane, referenceDistal: DISTAL, axis: { source: "card" } }),
    ).toThrow();
  });
});
