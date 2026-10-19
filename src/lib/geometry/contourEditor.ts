import type { ImagePoint } from "@/lib/core/types";

/**
 * Immutable, undoable state for editing one nail boundary (image coordinates).
 * UI components dispatch operations; all geometry lives here so it can be tested.
 */
export interface ContourEditorState {
  readonly points: readonly ImagePoint[];
  readonly past: readonly (readonly ImagePoint[])[];
  readonly future: readonly (readonly ImagePoint[])[];
  /** True once the user has changed the boundary from its initial source. */
  readonly edited: boolean;
}

export const MIN_POINTS = 4;
const HISTORY_LIMIT = 200;

export function createEditor(points: readonly ImagePoint[]): ContourEditorState {
  return { points: points.map((p) => ({ x: p.x, y: p.y })), past: [], future: [], edited: false };
}

function commit(state: ContourEditorState, points: readonly ImagePoint[]): ContourEditorState {
  const past = [...state.past, state.points];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { points, past, future: [], edited: true };
}

export function movePoint(state: ContourEditorState, index: number, to: ImagePoint): ContourEditorState {
  if (index < 0 || index >= state.points.length) return state;
  const points = state.points.slice();
  points[index] = { x: to.x, y: to.y };
  return commit(state, points);
}

/**
 * Applies a drag without growing history on every pointer move: call `beginDrag`
 * once (records history), then `dragTo` for intermediate positions.
 */
export function beginDrag(state: ContourEditorState): ContourEditorState {
  return commit(state, state.points.slice());
}

export function dragTo(state: ContourEditorState, index: number, to: ImagePoint): ContourEditorState {
  if (index < 0 || index >= state.points.length) return state;
  const points = state.points.slice();
  points[index] = { x: to.x, y: to.y };
  return { ...state, points, edited: true };
}

export function removePoint(state: ContourEditorState, index: number): ContourEditorState {
  if (state.points.length <= MIN_POINTS || index < 0 || index >= state.points.length) return state;
  return commit(state, state.points.filter((_, i) => i !== index));
}

/** Inserts a point on the edge nearest to `at`; returns the new state and the inserted index. */
export function insertPointNear(state: ContourEditorState, at: ImagePoint): { state: ContourEditorState; index: number } {
  const n = state.points.length;
  if (n < 2) return { state: commit(state, [...state.points, at]), index: n };
  let bestEdge = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = distanceToSegment(at, state.points[i]!, state.points[(i + 1) % n]!);
    if (d < bestDist) {
      bestDist = d;
      bestEdge = i;
    }
  }
  const points = state.points.slice();
  points.splice(bestEdge + 1, 0, { x: at.x, y: at.y });
  return { state: commit(state, points), index: bestEdge + 1 };
}

export function replacePoints(state: ContourEditorState, points: readonly ImagePoint[]): ContourEditorState {
  return commit(state, points.map((p) => ({ x: p.x, y: p.y })));
}

export function undo(state: ContourEditorState): ContourEditorState {
  const prev = state.past[state.past.length - 1];
  if (!prev) return state;
  return { points: prev, past: state.past.slice(0, -1), future: [state.points, ...state.future], edited: true };
}

export function redo(state: ContourEditorState): ContourEditorState {
  const next = state.future[0];
  if (!next) return state;
  return { points: next, past: [...state.past, state.points], future: state.future.slice(1), edited: true };
}

export const canUndo = (s: ContourEditorState) => s.past.length > 0;
export const canRedo = (s: ContourEditorState) => s.future.length > 0;

export function nearestPointIndex(points: readonly ImagePoint[], at: ImagePoint, maxDist: number): number {
  let best = -1;
  let bestD = maxDist;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function distanceToSegment(p: ImagePoint, a: ImagePoint, b: ImagePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Creates an initial elliptical contour (used when the user places a nail manually). */
export function ellipseContour(centre: ImagePoint, rx: number, ry: number, angleRad = 0, count = 16): ImagePoint[] {
  const out: ImagePoint[] = [];
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  for (let i = 0; i < count; i++) {
    const t = (2 * Math.PI * i) / count;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push({ x: centre.x + x * c - y * s, y: centre.y + x * s + y * c });
  }
  return out;
}
