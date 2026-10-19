import {
  mm,
  mm2,
  type ImagePoint,
  type Millimetres,
  type PlanePoint,
  type SquareMillimetres,
} from "@/lib/core/types";
import { applyHomography, type Matrix3 } from "@/lib/geometry/homography";

/**
 * Measurement engine: calibrated planar geometry of a nail-plate contour.
 *
 * All dimensions are computed in the rectified card plane (mm) after mapping the
 * image-space contour through the calibration homography. They are PROJECTED
 * planar dimensions: a curved nail plate's true surface length/width/area are
 * larger than these values.
 *
 * Definitions (relative to the nail axis u, pointing proximal -> distal):
 *  - widthMm: the longest straight chord of the plate perpendicular to u
 *    (maximum transverse width).
 *  - lengthMm: the chord of the plate along the line parallel to u through the
 *    plate's area centroid (centreline length, proximal fold to free edge as
 *    traced by the contour).
 *  - axialExtentMm: the plate's total extent along u (informational).
 *  - areaMm2: projected area enclosed by the contour.
 */

export const MEASUREMENT_ENGINE_VERSION = "1.0.0";

export type AxisSource = "card" | "manual" | "pca";

export interface AxisSpec {
  readonly source: AxisSource;
  /** For `manual`: rotation in degrees (clockwise in the image) relative to the card's distal direction. */
  readonly angleDeg?: number;
}

export interface Chord {
  readonly a: PlanePoint;
  readonly b: PlanePoint;
}

export interface NailGeometry {
  readonly widthMm: Millimetres;
  readonly lengthMm: Millimetres;
  readonly axialExtentMm: Millimetres;
  readonly areaMm2: SquareMillimetres;
  readonly perimeterMm: Millimetres;
  readonly centroid: PlanePoint;
  /** Unit vector of the nail axis in plane coordinates (proximal -> distal). */
  readonly axis: PlanePoint;
  readonly widthChord: Chord;
  readonly lengthChord: Chord;
  readonly planeContour: readonly PlanePoint[];
}

export interface MeasureInput {
  readonly contour: readonly ImagePoint[];
  readonly imageToPlane: Matrix3;
  /** Distal direction of the calibration frame (card arrow), unit vector in plane mm. */
  readonly referenceDistal: PlanePoint;
  readonly axis: AxisSpec;
}

const dot = (a: PlanePoint, b: PlanePoint) => a.x * b.x + a.y * b.y;

export function signedArea(points: readonly PlanePoint[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonCentroid(points: readonly PlanePoint[]): PlanePoint {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-12) {
    const n = points.length;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function perimeter(points: readonly PlanePoint[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    s += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return s;
}

/** Principal (major) axis of the polygon's area distribution, as a unit vector. */
export function principalAxis(points: readonly PlanePoint[]): PlanePoint {
  // Second moments of area of the polygon about its centroid.
  const c = polygonCentroid(points);
  let ixx = 0;
  let iyy = 0;
  let ixy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = { x: points[i]!.x - c.x, y: points[i]!.y - c.y };
    const q = { x: points[(i + 1) % points.length]!.x - c.x, y: points[(i + 1) % points.length]!.y - c.y };
    const cross = p.x * q.y - q.x * p.y;
    ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
    iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross;
    ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cross;
  }
  // ∫x² dA = iyy/12, ∫y² dA = ixx/12, ∫xy dA = ixy/24; the sums carry the winding sign, so normalise it.
  const sign = Math.sign(signedArea(points)) || 1;
  const sxx = (sign * iyy) / 12;
  const syy = (sign * ixx) / 12;
  const sxy = (sign * ixy) / 24;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

export function resolveAxis(planeContour: readonly PlanePoint[], referenceDistal: PlanePoint, axis: AxisSpec): PlanePoint {
  const ref = normalize(referenceDistal);
  switch (axis.source) {
    case "card":
      return ref;
    case "manual": {
      const t = ((axis.angleDeg ?? 0) * Math.PI) / 180;
      // Clockwise rotation in a y-down frame.
      return normalize({ x: ref.x * Math.cos(t) - ref.y * Math.sin(t), y: ref.x * Math.sin(t) + ref.y * Math.cos(t) });
    }
    case "pca": {
      const p = principalAxis(planeContour);
      return dot(p, ref) >= 0 ? p : { x: -p.x, y: -p.y };
    }
  }
}

function normalize(p: PlanePoint): PlanePoint {
  const l = Math.hypot(p.x, p.y);
  if (l < 1e-12) throw new Error("Zero-length axis");
  return { x: p.x / l, y: p.y / l };
}

/**
 * Intersections of the line { q : q·n = s } with the polygon, returned as the
 * inside intervals along the line direction d (parameterised by q·d).
 */
function lineIntervals(points: readonly PlanePoint[], n: PlanePoint, d: PlanePoint, s: number): [number, number][] {
  const ts: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const sp = dot(p, n) - s;
    const sq = dot(q, n) - s;
    // Half-open rule avoids double counting vertices exactly on the line.
    if ((sp < 0 && sq >= 0) || (sq < 0 && sp >= 0)) {
      const t = sp / (sp - sq);
      ts.push(dot(p, d) + t * (dot(q, d) - dot(p, d)));
    }
  }
  ts.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) out.push([ts[i]!, ts[i + 1]!]);
  return out;
}

const fromCoords = (n: PlanePoint, d: PlanePoint, s: number, t: number): PlanePoint => ({
  x: n.x * s + d.x * t,
  y: n.y * s + d.y * t,
});

/** Computes calibrated planar geometry for one nail contour. Pure and deterministic. */
export function measureNail(input: MeasureInput): NailGeometry {
  if (input.contour.length < 3) throw new Error("A contour needs at least 3 points");
  const plane = input.contour.map((p) => applyHomography(input.imageToPlane, p) as PlanePoint);
  const area = Math.abs(signedArea(plane));
  if (area < 1e-6) throw new Error("Contour encloses no area");

  const u = resolveAxis(plane, input.referenceDistal, input.axis);
  const v: PlanePoint = { x: -u.y, y: u.x };
  const centroid = polygonCentroid(plane);

  // Width: maximum perpendicular chord, scanned along u.
  const along = plane.map((p) => dot(p, u));
  const minU = Math.min(...along);
  const maxU = Math.max(...along);
  const extent = maxU - minU;
  let best = { len: 0, s: minU, t0: 0, t1: 0 };
  const scan = (s: number) => {
    for (const [t0, t1] of lineIntervals(plane, u, v, s)) {
      if (t1 - t0 > best.len) best = { len: t1 - t0, s, t0, t1 };
    }
  };
  const coarseSteps = 400;
  for (let i = 1; i < coarseSteps; i++) scan(minU + (extent * i) / coarseSteps);
  // Refine around the best coarse position.
  const step = extent / coarseSteps;
  const s0 = best.s;
  for (let i = -50; i <= 50; i++) scan(s0 + (step * i) / 50);

  // Length: chord along u through the centroid.
  const sC = dot(centroid, v);
  const tC = dot(centroid, u);
  const intervals = lineIntervals(plane, v, u, sC);
  const containing = intervals.find(([a, b]) => a <= tC && tC <= b) ?? intervals.reduce<[number, number]>((m, iv) => (iv[1] - iv[0] > m[1] - m[0] ? iv : m), [tC, tC]);

  return {
    widthMm: mm(best.len),
    lengthMm: mm(containing[1] - containing[0]),
    axialExtentMm: mm(extent),
    areaMm2: mm2(area),
    perimeterMm: mm(perimeter(plane)),
    centroid,
    axis: u,
    widthChord: { a: fromCoords(u, v, best.s, best.t0), b: fromCoords(u, v, best.s, best.t1) },
    lengthChord: { a: fromCoords(v, u, sC, containing[0]), b: fromCoords(v, u, sC, containing[1]) },
    planeContour: plane,
  };
}
