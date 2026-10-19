/**
 * Planar projective transforms (homographies) in pure TypeScript.
 *
 * A homography is stored as a row-major 3x3 matrix [h0..h8] mapping
 * (x, y, 1) -> (x', y', w') with the result (x'/w', y'/w').
 * Kept free of OpenCV so it runs identically in the browser, worker,
 * server routes and unit tests.
 */

export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface Correspondence {
  readonly from: Point2;
  readonly to: Point2;
}

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function applyHomography(h: Matrix3, p: Point2): Point2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) throw new Error("Point maps to infinity under homography");
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k]! * b[k * 3 + j]!;
      r[i * 3 + j] = s;
    }
  }
  return r as unknown as Matrix3;
}

export function invert(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error("Homography is singular");
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((v) => v / det);
  return normalizeScale(inv as unknown as Matrix3);
}

/** Scales the matrix so h[8] = 1 when possible (purely cosmetic; transforms are scale invariant). */
export function normalizeScale(m: Matrix3): Matrix3 {
  const s = Math.abs(m[8]) > 1e-12 ? m[8] : 1;
  return m.map((v) => v / s) as unknown as Matrix3;
}

/** Similarity transform used for normalisation (Hartley conditioning). */
function conditioner(points: readonly Point2[]): Matrix3 {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let meanDist = 0;
  for (const p of points) meanDist += Math.hypot(p.x - cx, p.y - cy);
  meanDist /= n;
  const s = meanDist > 1e-12 ? Math.SQRT2 / meanDist : 1;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

/**
 * Estimates the homography mapping `from` -> `to` by the normalised Direct
 * Linear Transform (least squares with h33 fixed after conditioning).
 * Requires at least 4 correspondences with no three collinear.
 */
export function estimateHomography(correspondences: readonly Correspondence[]): Matrix3 {
  if (correspondences.length < 4) throw new Error("At least 4 correspondences are required");
  const Tf = conditioner(correspondences.map((c) => c.from));
  const Tt = conditioner(correspondences.map((c) => c.to));
  const src = correspondences.map((c) => applyHomography(Tf, c.from));
  const dst = correspondences.map((c) => applyHomography(Tt, c.to));

  // Build the 2n x 9 system A h = 0 and solve via the 9x9 normal matrix's
  // smallest eigenvector (Jacobi eigen-decomposition; robust and dependency free).
  const ata = new Array<number>(81).fill(0);
  const addRow = (row: readonly number[]) => {
    for (let i = 0; i < 9; i++) {
      const ri = row[i]!;
      if (ri === 0) continue;
      for (let j = 0; j < 9; j++) ata[i * 9 + j]! += ri * row[j]!;
    }
  };
  for (let k = 0; k < src.length; k++) {
    const { x, y } = src[k]!;
    const { x: u, y: v } = dst[k]!;
    addRow([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    addRow([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }
  const { values, vectors } = jacobiEigen(ata, 9);
  let minIdx = 0;
  for (let i = 1; i < 9; i++) if (values[i]! < values[minIdx]!) minIdx = i;
  const hn = Array.from({ length: 9 }, (_, i) => vectors[i * 9 + minIdx]!) as unknown as Matrix3;

  // Denormalise: H = Tt^-1 * Hn * Tf
  const h = multiply(multiply(invert(Tt), hn), Tf);
  return normalizeScale(h);
}

/** Symmetric Jacobi eigen-decomposition. Returns eigenvalues and column eigenvectors (row-major n x n). */
export function jacobiEigen(matrix: readonly number[], n: number): { values: number[]; vectors: number[] } {
  const a = matrix.slice();
  const v = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p * n + p]!;
        const aqq = a[q * n + q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]!;
          const akq = a[k * n + q]!;
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]!;
          const aqk = a[q * n + k]!;
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]!;
          const vkq = v[k * n + q]!;
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => a[i * n + i]!), vectors: v };
}

/**
 * Local linear scale of a homography at a point: the singular values of its
 * Jacobian, i.e. the max/min output length per unit input length.
 */
export function localScale(h: Matrix3, p: Point2): { max: number; min: number } {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const X = h[0] * p.x + h[1] * p.y + h[2];
  const Y = h[3] * p.x + h[4] * p.y + h[5];
  const j00 = (h[0] * w - X * h[6]) / (w * w);
  const j01 = (h[1] * w - X * h[7]) / (w * w);
  const j10 = (h[3] * w - Y * h[6]) / (w * w);
  const j11 = (h[4] * w - Y * h[7]) / (w * w);
  // Singular values of 2x2 J
  const a = j00 * j00 + j10 * j10;
  const b = j00 * j01 + j10 * j11;
  const d = j01 * j01 + j11 * j11;
  const tr = a + d;
  const disc = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
  return { max: Math.sqrt(tr / 2 + disc), min: Math.sqrt(Math.max(0, tr / 2 - disc)) };
}
