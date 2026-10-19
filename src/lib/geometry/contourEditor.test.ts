import { describe, expect, it } from "vitest";
import { isSelfIntersecting, validateContour } from "@/lib/measurement/measurementValidator";
import { canRedo, canUndo, createEditor, insertPointNear, movePoint, redo, removePoint, undo, beginDrag, dragTo } from "./contourEditor";

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("contourEditor", () => {
  it("moves points with undo and redo", () => {
    let s = createEditor(square);
    expect(s.edited).toBe(false);
    s = movePoint(s, 1, { x: 12, y: -1 });
    expect(s.points[1]).toEqual({ x: 12, y: -1 });
    expect(s.edited).toBe(true);
    s = undo(s);
    expect(s.points[1]).toEqual({ x: 10, y: 0 });
    expect(canRedo(s)).toBe(true);
    s = redo(s);
    expect(s.points[1]).toEqual({ x: 12, y: -1 });
    expect(canUndo(s)).toBe(true);
  });

  it("inserts a point on the nearest edge and keeps a minimum point count on removal", () => {
    let s = createEditor(square);
    const r = insertPointNear(s, { x: 5, y: 10.5 });
    s = r.state;
    expect(r.index).toBe(3);
    expect(s.points).toHaveLength(5);
    s = removePoint(s, 3);
    expect(s.points).toHaveLength(4);
    expect(removePoint(s, 0).points).toHaveLength(4);
  });

  it("records a drag as a single undo step", () => {
    let s = createEditor(square);
    s = beginDrag(s);
    s = dragTo(s, 0, { x: 1, y: 1 });
    s = dragTo(s, 0, { x: 2, y: 2 });
    s = undo(s);
    expect(s.points[0]).toEqual({ x: 0, y: 0 });
  });
});

describe("contour validation", () => {
  it("detects self-intersection", () => {
    expect(isSelfIntersecting(square)).toBe(false);
    const bowtie = [square[0]!, square[2]!, square[1]!, square[3]!];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    expect(validateContour(bowtie).map((i) => i.code)).toContain("contour_self_intersecting");
  });

  it("requires at least four points", () => {
    expect(validateContour(square.slice(0, 3)).map((i) => i.code)).toContain("contour_too_few_points");
  });
});
