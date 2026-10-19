"use client";

import { useRef } from "react";
import type { ImagePoint } from "@/lib/core/types";
import type { DetectedMarker } from "@/lib/calibration/calibrationEngine";
import type { NailRecord } from "@/lib/scan/model";
import type { ViewportApi } from "./ImageViewport";

const FINGER_ABBR: Record<string, string> = { thumb: "T", index: "I", middle: "M", ring: "R", little: "L" };

export function nailColor(n: NailRecord): string {
  if (n.reviewStatus === "rejected") return "#9ca3af";
  if (!n.measurement || n.measurement.validity === "invalid") return "#ef4444";
  if (n.reviewStatus === "confirmed") return "#10b981";
  if (n.measurement.validity === "warning") return "#f59e0b";
  return "#38bdf8";
}

export function nailLabel(n: NailRecord): string {
  if (!n.slot) return "?";
  return `${n.slot.hand === "left" ? "L" : "R"}${FINGER_ABBR[n.slot.finger]}`;
}

const pts = (p: readonly ImagePoint[]) => p.map((q) => `${q.x},${q.y}`).join(" ");

export function MarkerOverlay({ markers, valid, api }: { markers: readonly DetectedMarker[]; valid: boolean; api: ViewportApi }) {
  const sw = 2 / api.scale;
  return (
    <g aria-hidden>
      {markers.map((m, i) => (
        <g key={`${m.id}-${i}`}>
          <polygon points={pts(m.corners)} fill="none" stroke={valid ? "#10b981" : "#ef4444"} strokeWidth={sw * 1.5} />
          <circle cx={m.corners[0].x} cy={m.corners[0].y} r={4 / api.scale} fill="#facc15" />
          <text x={m.corners[0].x} y={m.corners[0].y - 6 / api.scale} fontSize={14 / api.scale} fill="#facc15" stroke="#000" strokeWidth={0.6 / api.scale} paintOrder="stroke">
            ID {m.id}
          </text>
        </g>
      ))}
    </g>
  );
}

export function PolylineOverlay({ points, api, color = "#facc15", closed = false }: { points: readonly ImagePoint[]; api: ViewportApi; color?: string; closed?: boolean }) {
  if (points.length === 0) return null;
  const Tag = closed ? "polygon" : "polyline";
  return (
    <g aria-hidden>
      <Tag points={pts(points)} fill="none" stroke={color} strokeWidth={2 / api.scale} strokeDasharray={`${6 / api.scale} ${4 / api.scale}`} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5 / api.scale} fill={color} stroke="#000" strokeWidth={1 / api.scale} />
      ))}
    </g>
  );
}

/**
 * Renders all nails; the selected one shows draggable handles. Handles stop
 * propagation so dragging a point never pans the image.
 */
export function NailsOverlay({
  nails,
  selectedId,
  editingPoints,
  selectedPoint,
  api,
  showChords,
  onDragStart,
  onDrag,
  onDragEnd,
  onSelectPoint,
}: {
  nails: readonly NailRecord[];
  selectedId: string | null;
  editingPoints: readonly ImagePoint[] | null;
  selectedPoint: number | null;
  api: ViewportApi;
  showChords: boolean;
  onDragStart: (index: number) => void;
  onDrag: (index: number, p: ImagePoint) => void;
  onDragEnd: (index: number) => void;
  onSelectPoint: (index: number) => void;
}) {
  const dragging = useRef<number | null>(null);
  const s = api.scale;
  // Shrink handles when points are close together on screen so the outline stays visible.
  let handleR = 7;
  if (editingPoints && editingPoints.length > 1) {
    let total = 0;
    for (let i = 0; i < editingPoints.length; i++) {
      const a = editingPoints[i]!;
      const b = editingPoints[(i + 1) % editingPoints.length]!;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    handleR = Math.max(2.5, Math.min(7, ((total / editingPoints.length) * s) / 3));
  }
  return (
    <g>
      {nails.map((n) => {
        const selected = n.id === selectedId;
        const contour = selected && editingPoints ? editingPoints : n.contour;
        const color = nailColor(n);
        const cx = contour.reduce((a, p) => a + p.x, 0) / Math.max(1, contour.length);
        const cy = contour.reduce((a, p) => a + p.y, 0) / Math.max(1, contour.length);
        const m = n.measurement;
        return (
          <g key={n.id} aria-hidden>
            <polygon points={pts(contour)} fill={color} fillOpacity={selected ? 0.12 : 0.22} stroke={color} strokeWidth={(selected ? 2.5 : 1.8) / s} />
            {showChords && m && !(selected && editingPoints && editingPoints !== n.contour) && (
              <>
                <line x1={m.widthChordImage[0].x} y1={m.widthChordImage[0].y} x2={m.widthChordImage[1].x} y2={m.widthChordImage[1].y} stroke="#fff" strokeWidth={1.5 / s} strokeDasharray={`${5 / s} ${3 / s}`} />
                <line x1={m.lengthChordImage[0].x} y1={m.lengthChordImage[0].y} x2={m.lengthChordImage[1].x} y2={m.lengthChordImage[1].y} stroke="#fde047" strokeWidth={1.5 / s} strokeDasharray={`${5 / s} ${3 / s}`} />
              </>
            )}
            <text x={cx} y={cy} fontSize={15 / s} textAnchor="middle" dominantBaseline="middle" fill="#fff" stroke="#000" strokeWidth={2.5 / s} paintOrder="stroke" fontWeight={700}>
              {nailLabel(n)}
            </text>
          </g>
        );
      })}
      {editingPoints &&
        editingPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={(selectedPoint === i ? handleR + 2 : handleR) / s}
            fill={selectedPoint === i ? "#facc15" : "#ffffff"}
            stroke="#111418"
            strokeWidth={Math.min(1.5, handleR / 4) / s}
            style={{ cursor: "grab", touchAction: "none" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
              dragging.current = i;
              onSelectPoint(i);
              onDragStart(i);
            }}
            onPointerMove={(e) => {
              if (dragging.current !== i) return;
              e.stopPropagation();
              onDrag(i, api.toImage(e.clientX, e.clientY));
            }}
            onPointerUp={(e) => {
              if (dragging.current !== i) return;
              e.stopPropagation();
              dragging.current = null;
              onDragEnd(i);
            }}
            onPointerCancel={() => {
              if (dragging.current === i) {
                dragging.current = null;
                onDragEnd(i);
              }
            }}
          />
        ))}
    </g>
  );
}
