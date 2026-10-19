"use client";

import { FINGERS, HANDS, type Finger, type Hand } from "@/lib/core/types";
import { formatMm, formatMm2 } from "@/lib/core/format";
import type { NailRecord } from "@/lib/scan/model";
import { DetectionBadge, ReviewBadge, SourceBadge, ValidityBadge } from "./StatusBadges";
import { Button, IssueList } from "./ui";

export function NailPanel({
  nail,
  canUndo,
  canRedo,
  selectedPoint,
  addPointMode,
  onUndo,
  onRedo,
  onDeletePoint,
  onToggleAddPoint,
  onAssign,
  onAxis,
  onReview,
  onRemove,
  takenSlots,
}: {
  nail: NailRecord;
  canUndo: boolean;
  canRedo: boolean;
  selectedPoint: number | null;
  addPointMode: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDeletePoint: () => void;
  onToggleAddPoint: () => void;
  onAssign: (slot: { hand: Hand; finger: Finger } | null) => void;
  onAxis: (axis: NailRecord["axis"]) => void;
  onReview: (status: NailRecord["reviewStatus"]) => void;
  onRemove: () => void;
  takenSlots: Set<string>;
}) {
  const m = nail.measurement;
  const angle = nail.axis.source === "manual" ? (nail.axis.angleDeg ?? 0) : 0;
  const canConfirm = !!m && m.validity !== "invalid";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <SourceBadge source={nail.contourSource} edited={nail.manuallyEdited} />
        {nail.detection && <DetectionBadge status={nail.detection.status} confidence={nail.detection.confidence} />}
        <ValidityBadge validity={m?.validity} />
        <ReviewBadge status={nail.reviewStatus} />
      </div>

      <div>
        <h3 className="sr-only">Measurement</h3>
        {m ? (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-canvas p-2">
              <dt className="text-xs text-muted">Width</dt>
              <dd className="tabular text-lg font-semibold">{formatMm(m.widthMm)}</dd>
            </div>
            <div className="rounded-md bg-canvas p-2">
              <dt className="text-xs text-muted">Length</dt>
              <dd className="tabular text-lg font-semibold">{formatMm(m.lengthMm)}</dd>
            </div>
            <div className="rounded-md bg-canvas p-2">
              <dt className="text-xs text-muted">Area (proj.)</dt>
              <dd className="tabular text-lg font-semibold">{formatMm2(m.areaMm2)}</dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-md bg-bad/5 p-3 text-sm text-bad">No measurement: this photo has no valid calibration or the outline is degenerate.</p>
        )}
        {m && (
          <p className="mt-2 text-xs text-muted">
            Projected planar dimensions. Calibration uncertainty (1σ, calibration only):{" "}
            {m.calibrationUncertaintyMm === null ? "not quantified" : `±${m.calibrationUncertaintyMm.toFixed(2)} mm`}. Boundary placement error is not included.
          </p>
        )}
      </div>

      {m && <IssueList issues={m.issues} hideInfo />}
      {nail.detection && nail.detection.issues.length > 0 && <IssueList issues={nail.detection.issues} />}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Finger</legend>
        <div className="flex gap-2">
          <select
            aria-label="Hand"
            value={nail.slot?.hand ?? ""}
            onChange={(e) => {
              const hand = e.target.value as Hand | "";
              onAssign(hand ? { hand, finger: nail.slot?.finger ?? "index" } : null);
            }}
            className="flex-1 rounded-md border border-line bg-white px-2 py-2 text-sm"
          >
            <option value="">Unassigned</option>
            {HANDS.map((h) => (
              <option key={h} value={h}>
                {h === "left" ? "Left hand" : "Right hand"}
              </option>
            ))}
          </select>
          <select
            aria-label="Finger"
            value={nail.slot?.finger ?? ""}
            disabled={!nail.slot}
            onChange={(e) => onAssign({ hand: nail.slot!.hand, finger: e.target.value as Finger })}
            className="flex-1 rounded-md border border-line bg-white px-2 py-2 text-sm"
          >
            {!nail.slot && <option value="">—</option>}
            {FINGERS.map((f) => (
              <option key={f} value={f}>
                {f}
                {nail.slot && takenSlots.has(`${nail.slot.hand}-${f}`) && !(nail.slot.finger === f) ? " (already used)" : ""}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Nail axis (direction of the finger)</legend>
        <div className="flex flex-wrap gap-2">
          <Button className={nail.axis.source === "card" ? "border-ink" : ""} onClick={() => onAxis({ source: "card" })}>
            Card arrow
          </Button>
          <Button className={nail.axis.source === "pca" ? "border-ink" : ""} onClick={() => onAxis({ source: "pca" })}>
            Outline shape
          </Button>
        </div>
        <label className="block text-sm">
          <span className="text-muted">Rotate: {angle.toFixed(0)}°</span>
          <input
            type="range"
            min={-60}
            max={60}
            step={1}
            value={angle}
            onChange={(e) => onAxis({ source: "manual", angleDeg: Number(e.target.value) })}
            className="w-full"
            aria-label="Axis rotation relative to the card arrow, degrees"
          />
        </label>
        <p className="text-xs text-muted">The white dashed line is the width; the yellow line is the length along this axis.</p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Edit outline</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={onUndo} disabled={!canUndo} aria-keyshortcuts="Control+Z">
            Undo
          </Button>
          <Button onClick={onRedo} disabled={!canRedo} aria-keyshortcuts="Control+Shift+Z">
            Redo
          </Button>
          <Button onClick={onToggleAddPoint} className={addPointMode ? "border-ink bg-ink/5" : ""} aria-pressed={addPointMode}>
            {addPointMode ? "Tap image to add…" : "Add point"}
          </Button>
          <Button onClick={onDeletePoint} disabled={selectedPoint === null} aria-keyshortcuts="Delete">
            Delete point
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">Drag the white handles. Select a handle and press Delete to remove it; arrow keys nudge it by 1 px.</p>
      </fieldset>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="primary" disabled={!canConfirm || nail.reviewStatus === "confirmed"} onClick={() => onReview("confirmed")}>
          Confirm measurement
        </Button>
        <Button disabled={nail.reviewStatus === "rejected"} onClick={() => onReview("rejected")}>
          Reject
        </Button>
        {nail.reviewStatus !== "pending" && <Button onClick={() => onReview("pending")}>Reopen</Button>}
        <Button variant="danger" onClick={onRemove}>
          Remove nail
        </Button>
      </div>
      {!canConfirm && <p className="text-xs text-bad">A measurement can only be confirmed when it is calibrated and passes validation.</p>}
      <p className="text-xs text-muted">{nail.revisions.length} revision{nail.revisions.length === 1 ? "" : "s"} recorded.</p>
    </div>
  );
}
