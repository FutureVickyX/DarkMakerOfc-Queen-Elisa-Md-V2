"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ImagePoint } from "@/lib/core/types";

export interface ViewportApi {
  /** Current zoom (screen px per image px). */
  scale: number;
  /** Converts a client (screen) coordinate to image coordinates. */
  toImage: (clientX: number, clientY: number) => ImagePoint;
}

interface Transform {
  s: number;
  tx: number;
  ty: number;
}

const MIN_ZOOM_FACTOR = 0.5;
const MAX_SCALE = 8;

/**
 * Zoomable, pannable image with an SVG overlay in image pixel coordinates.
 * - Drag on the background to pan; pinch or wheel to zoom; buttons for keyboard users.
 * - A press-and-release without movement is reported as a tap in image coordinates.
 * Overlay children receive the viewport API so handles can be drawn at a
 * constant screen size and dragged in image space.
 */
export function ImageViewport({
  src,
  width,
  height,
  onTap,
  cursor = "default",
  children,
  label,
  className = "",
}: {
  src: string;
  width: number;
  height: number;
  onTap?: (p: ImagePoint) => void;
  cursor?: string;
  children?: (api: ViewportApi) => ReactNode;
  label: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>({ s: 0, tx: 0, ty: 0 });
  const fitScale = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; start: Transform; pinchDist?: number; pinchMid?: { x: number; y: number } } | null>(null);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / width, r.height / height);
    fitScale.current = s;
    setT({ s, tx: (r.width - width * s) / 2, ty: (r.height - height * s) / 2 });
  }, [width, height]);

  useLayoutEffect(() => {
    fit();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setT((prev) => {
      const s = Math.min(MAX_SCALE, Math.max(fitScale.current * MIN_ZOOM_FACTOR, prev.s * factor));
      const k = s / prev.s;
      return { s, tx: cx - (cx - prev.tx) * k, ty: cy - (cy - prev.ty) * k };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const toImage = useCallback(
    (clientX: number, clientY: number): ImagePoint => {
      const r = containerRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - t.tx) / t.s - 0.5, y: (clientY - r.top - t.ty) / t.s - 0.5 };
    },
    [t],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, moved: false, start: t };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = containerRef.current!.getBoundingClientRect();
      gesture.current = {
        startX: 0,
        startY: 0,
        moved: true,
        start: t,
        pinchDist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        pinchMid: { x: (a!.x + b!.x) / 2 - r.left, y: (a!.y + b!.y) / 2 - r.top },
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size >= 2 && g.pinchDist && g.pinchMid) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const s = Math.min(MAX_SCALE, Math.max(fitScale.current * MIN_ZOOM_FACTOR, g.start.s * (d / g.pinchDist)));
      const k = s / g.start.s;
      setT({ s, tx: g.pinchMid.x - (g.pinchMid.x - g.start.tx) * k, ty: g.pinchMid.y - (g.pinchMid.y - g.start.ty) * k });
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 5) g.moved = true;
    if (g.moved) setT({ ...g.start, tx: g.start.tx + dx, ty: g.start.ty + dy });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (g && wasSingle && !g.moved && onTap) onTap(toImage(e.clientX, e.clientY));
      gesture.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return;
    const step = 60;
    if (e.key === "+" || e.key === "=") zoomAt(1.25, r.width / 2, r.height / 2);
    else if (e.key === "-") zoomAt(0.8, r.width / 2, r.height / 2);
    else if (e.key === "0") fit();
    else if (e.key === "ArrowLeft" && e.shiftKey) setT((p) => ({ ...p, tx: p.tx + step }));
    else if (e.key === "ArrowRight" && e.shiftKey) setT((p) => ({ ...p, tx: p.tx - step }));
    else if (e.key === "ArrowUp" && e.shiftKey) setT((p) => ({ ...p, ty: p.ty + step }));
    else if (e.key === "ArrowDown" && e.shiftKey) setT((p) => ({ ...p, ty: p.ty - step }));
    else return;
    e.preventDefault();
  };

  const api: ViewportApi = { scale: t.s || 1, toImage };
  const zoomBtn = "flex h-9 w-9 items-center justify-center rounded border border-line bg-white/95 text-lg shadow-sm hover:border-ink";

  return (
    <div className={`relative overflow-hidden rounded-lg border border-line bg-neutral-800 ${className}`}>
      <div
        ref={containerRef}
        role="application"
        aria-label={`${label}. Drag to pan, pinch or scroll to zoom. Keyboard: plus and minus to zoom, 0 to fit, Shift+arrows to pan.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="absolute inset-0 touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {t.s > 0 && (
          <div style={{ transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.s})`, transformOrigin: "0 0", width, height, position: "absolute" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} width={width} height={height} alt="" draggable={false} style={{ width, height, maxWidth: "none" }} />
            <svg className="absolute left-0 top-0 overflow-visible" width={width} height={height} viewBox={`-0.5 -0.5 ${width} ${height}`}>
              {children?.(api)}
            </svg>
          </div>
        )}
      </div>
      <div className="no-print absolute right-2 top-2 flex flex-col gap-1">
        <button className={zoomBtn} aria-label="Zoom in" onClick={() => { const r = containerRef.current!.getBoundingClientRect(); zoomAt(1.4, r.width / 2, r.height / 2); }}>
          +
        </button>
        <button className={zoomBtn} aria-label="Zoom out" onClick={() => { const r = containerRef.current!.getBoundingClientRect(); zoomAt(1 / 1.4, r.width / 2, r.height / 2); }}>
          −
        </button>
        <button className={`${zoomBtn} text-xs`} aria-label="Fit image" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}
