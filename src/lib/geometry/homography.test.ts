import { describe, expect, it } from "vitest";
import { applyHomography, estimateHomography, invert, jacobiEigen, localScale, multiply, type Matrix3 } from "./homography";

const H_TRUE: Matrix3 = [1.8, 0.21, 340, -0.15, 1.65, 220, 0.0004, -0.0003, 1];

describe("homography", () => {
  it("recovers a known projective transform from exact correspondences", () => {
    const from = [
      { x: 0, y: 0 },
      { x: 85, y: 0 },
      { x: 85, y: 54 },
      { x: 0, y: 54 },
      { x: 40, y: 20 },
      { x: 10, y: 45 },
    ];
    const h = estimateHomography(from.map((p) => ({ from: p, to: applyHomography(H_TRUE, p) })));
    for (const p of [{ x: 12, y: 33 }, { x: 70, y: 5 }, { x: -50, y: 120 }]) {
      const a = applyHomography(h, p);
      const b = applyHomography(H_TRUE, p);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it("inverts consistently", () => {
    const inv = invert(H_TRUE);
    const id = multiply(H_TRUE, inv);
    const s = id[8];
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(id[i]! / s).toBeCloseTo(v, 9));
  });

  it("rejects fewer than four correspondences", () => {
    expect(() => estimateHomography([{ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }])).toThrow();
  });

  it("computes local scale of a similarity transform", () => {
    const s = localScale([3, 0, 10, 0, 3, 5, 0, 0, 1], { x: 4, y: 7 });
    expect(s.max).toBeCloseTo(3, 9);
    expect(s.min).toBeCloseTo(3, 9);
  });

  it("diagonalises a symmetric matrix", () => {
    const m = [4, 1, 2, 1, 3, 0, 2, 0, 5];
    const { values, vectors } = jacobiEigen(m, 3);
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 3; i++) {
        let mv = 0;
        for (let j = 0; j < 3; j++) mv += m[i * 3 + j]! * vectors[j * 3 + k]!;
        expect(mv).toBeCloseTo(values[k]! * vectors[i * 3 + k]!, 9);
      }
    }
  });
});
