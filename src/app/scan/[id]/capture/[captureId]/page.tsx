"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { ImageViewport } from "@/components/ImageViewport";
import { MarkerOverlay, NailsOverlay, PolylineOverlay, nailColor, nailLabel } from "@/components/NailOverlay";
import { NailPanel } from "@/components/NailPanel";
import { useRepository } from "@/components/RepositoryProvider";
import { CalibrationBadge } from "@/components/StatusBadges";
import { SaveIndicator, useScan } from "@/components/useScan";
import { Badge, Button, ButtonLink, Card, ErrorBox, Spinner } from "@/components/ui";
import { calibrateManually, isUsableCalibration } from "@/lib/calibration/calibrationEngine";
import { getCardSpec } from "@/lib/calibration/cardSpec";
import { slotKey, type ImagePoint } from "@/lib/core/types";
import { formatMm } from "@/lib/core/format";
import { getCvClient } from "@/lib/cv/cvClient";
import {
  beginDrag,
  canRedo,
  canUndo,
  createEditor,
  dragTo,
  ellipseContour,
  insertPointNear,
  redo,
  removePoint,
  undo,
  type ContourEditorState,
} from "@/lib/geometry/contourEditor";
import { applyHomography, localScale } from "@/lib/geometry/homography";
import { getCachedImage } from "@/lib/scan/imageCache";
import type { NailRecord } from "@/lib/scan/model";
import { addNail, removeCapture, removeNail, setCaptureCalibration, updateNail } from "@/lib/scan/scanService";
import { GRABCUT_INFO } from "@/lib/segmentation/grabCutSegmenter";

type Mode = "select" | "tap" | "draw" | "manualScale" | "addPoint";
type Tab = "calibration" | "nails";

function pointInPolygon(p: ImagePoint, poly: readonly ImagePoint[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export default function CaptureWorkspacePage() {
  const { id, captureId } = useParams<{ id: string; captureId: string }>();
  const router = useRouter();
  const { repo } = useRepository();
  const { scan, loading, error, update, saveState, saveError } = useScan(id);
  const capture = scan?.captures.find((c) => c.id === captureId) ?? null;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("calibration");
  const [mode, setMode] = useState<Mode>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ContourEditorState | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [manualPoints, setManualPoints] = useState<ImagePoint[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showChords, setShowChords] = useState(true);

  // Load the capture image (session cache first, then repository).
  useEffect(() => {
    if (!capture || imageBlob) return;
    let cancelled = false;
    (async () => {
      const cached = getCachedImage(capture.id);
      const blob = cached ?? (capture.imageAssetId && repo ? await repo.getImage(capture.imageAssetId) : null);
      if (cancelled) return;
      if (!blob) {
        setImageError("The photo for this capture is not stored (cloud mode without photo upload). Measurements can be viewed but not edited.");
        return;
      }
      setImageBlob(blob);
      setImageUrl(URL.createObjectURL(blob));
    })().catch((e) => setImageError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [capture, repo, imageBlob]);

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  // Open the nails tab automatically once calibration is usable.
  const calibrated = isUsableCalibration(capture?.calibration);
  useEffect(() => {
    if (calibrated) setTab("nails");
  }, [calibrated]);

  const nails = useMemo(() => scan?.nails.filter((n) => n.captureId === captureId) ?? [], [scan, captureId]);
  const selected = nails.find((n) => n.id === selectedId) ?? null;
  const takenSlots = useMemo(() => new Set((scan?.nails ?? []).filter((n) => n.slot && n.reviewStatus !== "rejected").map((n) => slotKey(n.slot!))), [scan]);

  const select = useCallback((n: NailRecord | null) => {
    setSelectedId(n?.id ?? null);
    setEditor(n ? createEditor(n.contour) : null);
    setSelectedPoint(null);
    if (n) setTab("nails");
  }, []);

  const commitContour = useCallback(
    (state: ContourEditorState, reason: string) => {
      if (!selectedId) return;
      update((s) => updateNail(s, selectedId, { contour: state.points, manuallyEdited: true }, reason));
    },
    [selectedId, update],
  );

  const applyEditor = useCallback(
    (next: ContourEditorState, reason: string) => {
      setEditor(next);
      commitContour(next, reason);
    },
    [commitContour],
  );

  const ensureWorkerImage = useCallback(async () => {
    if (!imageBlob || !capture) throw new Error("Image not available");
    const cv = getCvClient();
    if (!cv.isLoaded(capture.id)) await cv.load(capture.id, imageBlob);
    return cv;
  }, [imageBlob, capture]);

  const pxPerMmAt = (p: ImagePoint): number | null => {
    const cal = capture?.calibration;
    if (!isUsableCalibration(cal)) return null;
    const s = localScale(cal.imageToPlane, p);
    return 1 / Math.sqrt(s.max * s.min);
  };

  const onTap = async (p: ImagePoint) => {
    if (!capture || !scan) return;
    setActionError(null);
    if (p.x < 0 || p.y < 0 || p.x > capture.width - 1 || p.y > capture.height - 1) return;
    if (mode === "manualScale") {
      setManualPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
      return;
    }
    if (mode === "addPoint" && editor) {
      const r = insertPointNear(editor, p);
      setSelectedPoint(r.index);
      applyEditor(r.state, "point added");
      return;
    }
    if (mode === "draw") {
      const k = pxPerMmAt(p) ?? 8;
      const cal = capture.calibration;
      // Orient the starting ellipse along the card's distal direction in the image.
      let angle = 0;
      if (isUsableCalibration(cal) && cal.layoutId) {
        const card = getCardSpec(cal.layoutId);
        const planeP = applyHomography(cal.imageToPlane, p);
        const tip = applyHomography(cal.planeToImage, { x: planeP.x + card.distalDirection.x * 5, y: planeP.y + card.distalDirection.y * 5 });
        angle = Math.atan2(tip.y - p.y, tip.x - p.x) - Math.PI / 2;
      }
      const contour = ellipseContour(p, 7 * k, 6 * k, angle, 16);
      const { scan: next, nail } = addNail(scan, {
        captureId: capture.id,
        slot: null,
        contour,
        contourSource: "manual",
        manuallyEdited: true,
        axis: { source: "card" },
        detection: null,
      });
      update(() => next);
      select(nail);
      setMode("select");
      return;
    }
    if (mode === "tap") {
      setBusy("Outlining nail (experimental)…");
      try {
        const cv = await ensureWorkerImage();
        const cal = capture.calibration;
        const det = await cv.segment(capture.id, p, isUsableCalibration(cal) ? cal.imageToPlane : null, isUsableCalibration(cal) ? cal.planeToImage : null);
        if (det.status === "failed" || det.contour.length < 4) {
          setActionError(det.issues.map((i) => i.message).join(" ") || "No outline found. Try tapping the centre of the nail, or draw it manually.");
          return;
        }
        const { scan: next, nail } = addNail(scan, {
          captureId: capture.id,
          slot: null,
          contour: det.contour,
          contourSource: det.source,
          manuallyEdited: false,
          axis: { source: "card" },
          detection: {
            segmenterId: det.segmenterId,
            segmenterVersion: det.segmenterVersion,
            status: det.status,
            confidence: det.confidence,
            diagnostics: det.diagnostics,
            issues: det.issues,
          },
        });
        update(() => next);
        select(nail);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    // select mode
    const hit = [...nails].reverse().find((n) => pointInPolygon(p, n.contour));
    select(hit ?? null);
  };

  // Keyboard shortcuts for the contour editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editor || !selectedId) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        applyEditor(e.shiftKey ? redo(editor) : undo(editor), e.shiftKey ? "redo" : "undo");
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedPoint !== null) {
        e.preventDefault();
        applyEditor(removePoint(editor, selectedPoint), "point removed");
        setSelectedPoint(null);
      } else if (selectedPoint !== null && e.key.startsWith("Arrow") && !e.shiftKey) {
        e.preventDefault();
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as "ArrowLeft"]!;
        const p = editor.points[selectedPoint]!;
        applyEditor(dragTo(beginDrag(editor), selectedPoint, { x: p.x + d[0]!, y: p.y + d[1]! }), "point nudged");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, selectedId, selectedPoint, applyEditor]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!scan || !capture) return <ErrorBox title="Photo not found" message="This capture does not exist in the scan." />;

  const cal = capture.calibration;
  const cursor = mode === "select" ? "default" : "crosshair";
  const cardOutline =
    isUsableCalibration(cal) && cal.method === "card" && cal.layoutId
      ? (() => {
          const c = getCardSpec(cal.layoutId);
          return [
            { x: 0, y: 0 },
            { x: c.cardWidthMm, y: 0 },
            { x: c.cardWidthMm, y: c.cardHeightMm },
            { x: 0, y: c.cardHeightMm },
          ].map((p) => applyHomography(cal.planeToImage, p));
        })()
      : [];

  const retake = () => {
    if (window.confirm("Remove this photo (and any nails outlined on it) and take a new one?")) {
      const assetId = capture.imageAssetId;
      void Promise.resolve(update((s) => removeCapture(s, capture.id), true)).then(async () => {
        if (assetId) await repo?.deleteImage(assetId).catch(() => undefined);
        router.push(`/scan/${scan.id}/capture`);
      });
    }
  };

  const modeButton = (m: Mode, label: string, disabled = false, title?: string) => (
    <Button
      key={m}
      onClick={() => {
        setMode(mode === m ? "select" : m);
        setManualPoints([]);
      }}
      disabled={disabled}
      title={title}
      aria-pressed={mode === m}
      variant={mode === m ? "primary" : "secondary"}
    >
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold sm:text-xl">
            <Link href={`/scan/${scan.id}`} className="hover:underline">
              {scan.name}
            </Link>{" "}
            <span className="text-muted">· photo {scan.captures.findIndex((c) => c.id === capture.id) + 1}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <CalibrationBadge status={cal?.status} />
            <span className="text-xs text-muted">
              {capture.width}×{capture.height}px · {capture.captureMethod}
            </span>
            <SaveIndicator state={saveState} error={saveError} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={retake}>Retake</Button>
          <ButtonLink href={`/scan/${scan.id}/capture`}>Add another photo</ButtonLink>
          <ButtonLink href={`/scan/${scan.id}`} variant="primary">
            Ten-nail profile
          </ButtonLink>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Image tools">
            {modeButton("select", "Select / edit")}
            {modeButton("tap", "Tap to outline", !imageBlob, GRABCUT_INFO.description)}
            {modeButton("draw", "Draw outline", !imageBlob)}
            {selected && editor && modeButton("addPoint", "Add point")}
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} />
              Show measurement lines
            </label>
          </div>
          {mode === "tap" && (
            <p className="text-xs text-warn">
              <Badge tone="warn">Experimental</Badge> Tap the centre of a nail. {GRABCUT_INFO.description}
            </p>
          )}
          {mode === "draw" && <p className="text-xs text-muted">Tap the centre of a nail to place an outline, then drag its points onto the nail edge.</p>}
          {mode === "manualScale" && <p className="text-xs text-manual">Tap the two ends of the reference object.</p>}
          {!calibrated && (mode === "tap" || mode === "draw") && (
            <p className="text-xs text-bad">This photo is not calibrated: outlines can be drawn but no millimetre values will be produced.</p>
          )}
          {imageUrl ? (
            <ImageViewport
              src={imageUrl}
              width={capture.width}
              height={capture.height}
              onTap={(p) => void onTap(p)}
              cursor={cursor}
              label="Hand photo with nail outlines"
              className="h-[58vh] lg:h-[74vh]"
            >
              {(api) => (
                <>
                  {cardOutline.length > 0 && <polygon points={cardOutline.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#10b981" strokeWidth={1.5 / api.scale} strokeDasharray={`${8 / api.scale} ${5 / api.scale}`} />}
                  {cal && <MarkerOverlay markers={cal.detectedMarkers} valid={cal.status === "valid"} api={api} />}
                  {cal?.manualReference && <PolylineOverlay points={[cal.manualReference.a, cal.manualReference.b]} api={api} color="#a78bfa" />}
                  <NailsOverlay
                    nails={nails}
                    selectedId={selectedId}
                    editingPoints={editor?.points ?? null}
                    selectedPoint={selectedPoint}
                    api={api}
                    showChords={showChords}
                    onDragStart={() => editor && setEditor(beginDrag(editor))}
                    onDrag={(i, p) => setEditor((ed) => (ed ? dragTo(ed, i, p) : ed))}
                    onDragEnd={() => editor && commitContour(editor, "point moved")}
                    onSelectPoint={setSelectedPoint}
                  />
                  {mode === "manualScale" && <PolylineOverlay points={manualPoints} api={api} color="#a78bfa" />}
                </>
              )}
            </ImageViewport>
          ) : imageError ? (
            <ErrorBox title="Photo unavailable" message={imageError} />
          ) : (
            <div className="flex h-[50vh] items-center justify-center rounded-lg border border-line bg-panel">
              <Spinner label="Loading photo…" />
            </div>
          )}
          {busy && <Spinner label={busy} />}
          {actionError && <ErrorBox title="Could not outline" message={actionError} />}
        </div>

        <div className="space-y-4">
          <div role="tablist" aria-label="Review panels" className="flex rounded-md border border-line bg-white p-1">
            {(["calibration", "nails"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded px-3 py-2 text-sm font-medium ${tab === t ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
              >
                {t === "calibration" ? "Calibration" : `Nails (${nails.length})`}
              </button>
            ))}
          </div>

          {tab === "calibration" ? (
            <Card>
              <CalibrationPanel
                calibration={cal}
                quality={capture.quality}
                manualPoints={manualPoints}
                manualActive={mode === "manualScale"}
                onStartManual={() => {
                  setMode("manualScale");
                  setManualPoints([]);
                }}
                onCancelManual={() => {
                  setMode("select");
                  setManualPoints([]);
                }}
                onApplyManual={(lengthMm) => {
                  const [a, b] = manualPoints;
                  if (!a || !b) return;
                  const record = calibrateManually({ a, b, lengthMm }, capture);
                  if (record.status === "rejected") {
                    setActionError(record.issues.map((i) => i.message).join(" "));
                    return;
                  }
                  update((s) => setCaptureCalibration(s, capture.id, record));
                  setMode("select");
                  setManualPoints([]);
                }}
                onRetake={retake}
              />
            </Card>
          ) : (
            <>
              <Card title="Nails on this photo">
                {nails.length === 0 ? (
                  <p className="text-sm text-muted">
                    No nails yet. Use <strong>Tap to outline</strong> (experimental) or <strong>Draw outline</strong>, then tap each nail.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {nails.map((n) => (
                      <li key={n.id}>
                        <button
                          onClick={() => select(n)}
                          aria-current={n.id === selectedId}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${n.id === selectedId ? "bg-ink/5 ring-1 ring-ink" : "hover:bg-black/5"}`}
                        >
                          <span className="h-3 w-3 rounded-full" style={{ background: nailColor(n) }} aria-hidden />
                          <span className="w-8 font-mono text-xs">{nailLabel(n)}</span>
                          <span className="tabular flex-1">
                            {n.measurement ? `${formatMm(n.measurement.widthMm)} × ${formatMm(n.measurement.lengthMm)}` : "not measurable"}
                          </span>
                          <span className="text-xs text-muted">{n.reviewStatus}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {selected && editor ? (
                <Card title={`Selected nail · ${nailLabel(selected)}`}>
                  <NailPanel
                    nail={selected}
                    canUndo={canUndo(editor)}
                    canRedo={canRedo(editor)}
                    selectedPoint={selectedPoint}
                    addPointMode={mode === "addPoint"}
                    onUndo={() => applyEditor(undo(editor), "undo")}
                    onRedo={() => applyEditor(redo(editor), "redo")}
                    onDeletePoint={() => {
                      if (selectedPoint === null) return;
                      applyEditor(removePoint(editor, selectedPoint), "point removed");
                      setSelectedPoint(null);
                    }}
                    onToggleAddPoint={() => setMode(mode === "addPoint" ? "select" : "addPoint")}
                    onAssign={(slot) => update((s) => updateNail(s, selected.id, { slot }, "finger assignment"))}
                    onAxis={(axis) => update((s) => updateNail(s, selected.id, { axis }, "axis changed"))}
                    onReview={(reviewStatus) => update((s) => updateNail(s, selected.id, { reviewStatus }, `review: ${reviewStatus}`))}
                    onRemove={() => {
                      if (!window.confirm("Remove this nail outline?")) return;
                      update((s) => removeNail(s, selected.id));
                      select(null);
                    }}
                    takenSlots={takenSlots}
                  />
                </Card>
              ) : (
                nails.length > 0 && <p className="text-sm text-muted">Select a nail on the image or in the list to review it.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
