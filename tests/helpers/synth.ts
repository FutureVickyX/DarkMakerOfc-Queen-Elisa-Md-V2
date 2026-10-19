/**
 * Synthetic scene renderer for deterministic CV tests: renders a calibration card
 * and nail-like shapes defined in card-plane millimetres through a known camera
 * homography, with optional blur, glare and noise.
 */
import { DICT_4X4_50_PATTERNS, type CalibrationCardSpec } from "@/lib/calibration/cardSpec";
import { applyHomography, invert, multiply, type Matrix3 } from "@/lib/geometry/homography";
import type { PlanePoint } from "@/lib/core/types";
import type { RasterImage } from "@/lib/cv/raster";

export interface CameraPose {
  /** Focal length in px. */
  f: number;
  width: number;
  height: number;
  /** Distance from camera to plane origin region, mm. */
  distanceMm: number;
  tiltXDeg?: number;
  tiltYDeg?: number;
  rollDeg?: number;
  /** Plane point (mm) that appears at the image centre. */
  lookAt: PlanePoint;
}

/** Plane(mm) -> image(px) homography for a pinhole camera looking at the plane z=0. */
export function poseHomography(pose: CameraPose): Matrix3 {
  const rx = ((pose.tiltXDeg ?? 0) * Math.PI) / 180;
  const ry = ((pose.tiltYDeg ?? 0) * Math.PI) / 180;
  const rz = ((pose.rollDeg ?? 0) * Math.PI) / 180;
  const Rx = [1, 0, 0, 0, Math.cos(rx), -Math.sin(rx), 0, Math.sin(rx), Math.cos(rx)];
  const Ry = [Math.cos(ry), 0, Math.sin(ry), 0, 1, 0, -Math.sin(ry), 0, Math.cos(ry)];
  const Rz = [Math.cos(rz), -Math.sin(rz), 0, Math.sin(rz), Math.cos(rz), 0, 0, 0, 1];
  const R = multiply(multiply(Rz as unknown as Matrix3, Ry as unknown as Matrix3), Rx as unknown as Matrix3);
  // Plane point P = (X - lookAt) in world; camera at distance d along the rotated optical axis.
  const t = [0, 0, pose.distanceMm];
  const K: Matrix3 = [pose.f, 0, pose.width / 2 - 0.5, 0, pose.f, pose.height / 2 - 0.5, 0, 0, 1];
  // [r1 r2 t]
  const M: Matrix3 = [R[0], R[1], t[0]!, R[3], R[4], t[1]!, R[6], R[7], t[2]!];
  const T: Matrix3 = [1, 0, -pose.lookAt.x, 0, 1, -pose.lookAt.y, 0, 0, 1];
  return multiply(multiply(K, M), T);
}

export interface SceneNail {
  /** Polygon in plane mm. */
  polygon: PlanePoint[];
  color?: [number, number, number];
}

export interface SceneOptions {
  pose: CameraPose;
  card: CalibrationCardSpec;
  /** Optional alternative card geometry actually printed (to simulate wrong/misprinted cards). */
  printedCard?: CalibrationCardSpec;
  nails?: SceneNail[];
  /** Marker IDs to omit (simulate occlusion). */
  hideMarkers?: number[];
  /** Additional card instances offset in mm (simulate two cards visible). */
  extraCardOffsets?: PlanePoint[];
  background?: [number, number, number];
  supersample?: number;
  blurRadius?: number;
  /** Disc of clipped white pixels (glare), plane mm. */
  glare?: { centre: PlanePoint; radiusMm: number };
  noiseAmplitude?: number;
}

export function ellipsePolygon(centre: PlanePoint, rx: number, ry: number, n = 96): PlanePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { x: centre.x + rx * Math.cos(t), y: centre.y + ry * Math.sin(t) };
  });
}

export function rectPolygon(x: number, y: number, w: number, h: number): PlanePoint[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function insidePolygon(p: PlanePoint, poly: readonly PlanePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function cardColor(card: CalibrationCardSpec, hide: Set<number>, p: PlanePoint): number | null {
  if (p.x < 0 || p.y < 0 || p.x > card.cardWidthMm || p.y > card.cardHeightMm) return null;
  const cell = card.markerSizeMm / 6;
  for (const m of card.markers) {
    if (hide.has(m.id)) continue;
    const lx = p.x - m.originMm.x;
    const ly = p.y - m.originMm.y;
    if (lx >= 0 && ly >= 0 && lx < card.markerSizeMm && ly < card.markerSizeMm) {
      const row = DICT_4X4_50_PATTERNS[m.id]![Math.floor(ly / cell)]!;
      return row[Math.floor(lx / cell)] === "1" ? 245 : 15;
    }
  }
  return 245;
}

export function renderScene(opts: SceneOptions): { image: RasterImage; planeToImage: Matrix3 } {
  const { pose } = opts;
  const H = poseHomography(pose);
  const Hinv = invert(H);
  const W = pose.width;
  const Ht = pose.height;
  const ss = opts.supersample ?? 4;
  const bg = opts.background ?? [176, 132, 112];
  const printed = opts.printedCard ?? opts.card;
  const hide = new Set(opts.hideMarkers ?? []);
  const offsets = [{ x: 0, y: 0 }, ...(opts.extraCardOffsets ?? [])];
  const data = new Uint8ClampedArray(W * Ht * 4);

  const nailBoxes = (opts.nails ?? []).map((nail) => ({
    nail,
    minX: Math.min(...nail.polygon.map((p) => p.x)),
    maxX: Math.max(...nail.polygon.map((p) => p.x)),
    minY: Math.min(...nail.polygon.map((p) => p.y)),
    maxY: Math.max(...nail.polygon.map((p) => p.y)),
  }));

  const shade = (p: PlanePoint): [number, number, number] => {
    if (opts.glare && Math.hypot(p.x - opts.glare.centre.x, p.y - opts.glare.centre.y) < opts.glare.radiusMm) return [255, 255, 255];
    for (const b of nailBoxes) {
      if (p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && insidePolygon(p, b.nail.polygon)) {
        return b.nail.color ?? [236, 170, 175];
      }
    }
    for (const o of offsets) {
      const c = cardColor(printed, hide, { x: p.x - o.x, y: p.y - o.y });
      if (c !== null) return [c, c, c];
    }
    return bg;
  };
  const shadeAt = (x: number, y: number) => shade(applyHomography(Hinv, { x, y }));

  // Adaptive anti-aliasing: shade the pixel-corner lattice once and only
  // supersample pixels whose four corners disagree (i.e. edge pixels).
  const lattice: [number, number, number][] = new Array((W + 1) * (Ht + 1));
  for (let y = 0; y <= Ht; y++) for (let x = 0; x <= W; x++) lattice[y * (W + 1) + x] = shadeAt(x - 0.5, y - 0.5);
  const same = (a: [number, number, number], b: [number, number, number]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  for (let y = 0; y < Ht; y++) {
    for (let x = 0; x < W; x++) {
      const c00 = lattice[y * (W + 1) + x]!;
      const k = (y * W + x) * 4;
      if (
        ss <= 1 ||
        (same(c00, lattice[y * (W + 1) + x + 1]!) && same(c00, lattice[(y + 1) * (W + 1) + x]!) && same(c00, lattice[(y + 1) * (W + 1) + x + 1]!))
      ) {
        const c = ss <= 1 ? shadeAt(x, y) : c00;
        data[k] = c[0];
        data[k + 1] = c[1];
        data[k + 2] = c[2];
        data[k + 3] = 255;
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shadeAt(x - 0.5 + (sx + 0.5) / ss, y - 0.5 + (sy + 0.5) / ss);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = ss * ss;
      data[k] = r / n;
      data[k + 1] = g / n;
      data[k + 2] = b / n;
      data[k + 3] = 255;
    }
  }

  let image: RasterImage = { width: W, height: Ht, data };
  if (opts.blurRadius && opts.blurRadius > 0) image = boxBlur(image, opts.blurRadius);
  if (opts.noiseAmplitude) addNoise(image, opts.noiseAmplitude);
  return { image, planeToImage: H };
}

/** Three-pass box blur (approximately Gaussian). */
export function boxBlur(img: RasterImage, radius: number): RasterImage {
  let cur = new Float32Array(img.data);
  const { width: w, height: h } = img;
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let x = -radius; x <= radius; x++) acc += cur[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]!;
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 4 + c] = acc / (2 * radius + 1);
          const add = Math.min(w - 1, x + radius + 1);
          const sub = Math.max(0, x - radius);
          acc += cur[(y * w + add) * 4 + c]! - cur[(y * w + sub) * 4 + c]!;
        }
      }
    }
    const out = new Float32Array(cur.length);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let y = -radius; y <= radius; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c]!;
        for (let y = 0; y < h; y++) {
          out[(y * w + x) * 4 + c] = acc / (2 * radius + 1);
          const add = Math.min(h - 1, y + radius + 1);
          const sub = Math.max(0, y - radius);
          acc += tmp[(add * w + x) * 4 + c]! - tmp[(sub * w + x) * 4 + c]!;
        }
      }
    }
    cur = out;
  }
  return { width: w, height: h, data: new Uint8ClampedArray(cur) };
}

function addNoise(img: RasterImage, amplitude: number) {
  // Deterministic LCG so tests are reproducible.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const d = img.data as Uint8ClampedArray;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 2 * amplitude;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
}

/** Projects a plane polygon to image coordinates through a plane->image homography. */
export function projectPolygon(H: Matrix3, poly: readonly PlanePoint[]) {
  return poly.map((p) => applyHomography(H, p));
}
