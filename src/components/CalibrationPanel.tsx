"use client";

import { useState } from "react";
import type { CalibrationRecord } from "@/lib/calibration/calibrationEngine";
import type { ImagePoint } from "@/lib/core/types";
import type { QualitySummary } from "@/lib/scan/model";
import { CalibrationBadge } from "./StatusBadges";
import { Button, IssueList } from "./ui";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular text-sm font-medium">{value}</dd>
    </div>
  );
}

export function CalibrationPanel({
  calibration,
  quality,
  manualPoints,
  manualActive,
  onStartManual,
  onCancelManual,
  onApplyManual,
  onRetake,
}: {
  calibration: CalibrationRecord | null;
  quality: QualitySummary | null;
  manualPoints: ImagePoint[];
  manualActive: boolean;
  onStartManual: () => void;
  onCancelManual: () => void;
  onApplyManual: (lengthMm: number) => void;
  onRetake: () => void;
}) {
  const [length, setLength] = useState("50");
  const q = calibration?.quality;
  const f = (v: number | null | undefined, d = 2, unit = "") => (v === null || v === undefined ? "—" : `${v.toFixed(d)}${unit}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalibrationBadge status={calibration?.status} />
        {calibration?.method === "card" && calibration.layoutId && (
          <span className="text-xs text-muted">
            {calibration.layoutId} v{calibration.layoutVersion}
          </span>
        )}
      </div>

      {calibration && (
        <dl className="grid grid-cols-2 gap-3">
          <Metric label="Markers found" value={`${q?.markerCount ?? 0} / 4`} />
          <Metric label="Corner RMS residual" value={f(q?.rmsResidualMm, 3, " mm")} hint="How well detected marker corners fit the known card layout" />
          <Metric label="Max residual" value={f(q?.maxResidualMm, 3, " mm")} />
          <Metric label="Resolution at card" value={f(q?.pxPerMmAtCard, 1, " px/mm")} />
          <Metric label="Smallest marker side" value={f(q?.minMarkerSidePx, 0, " px")} />
          <Metric label="Approx. camera tilt" value={f(q?.approxTiltDeg, 0, "°")} hint="Rough estimate from foreshortening" />
          {quality && (
            <>
              <Metric label="Marker edge sharpness" value={quality.markerEdgeWidthPx === null ? "—" : `${quality.markerEdgeWidthPx.toFixed(1)} px`} hint="10–90% edge transition width; lower is sharper" />
              <Metric label="Clipped (glare) pixels" value={`${(quality.clippedFraction * 100).toFixed(1)}%`} />
            </>
          )}
        </dl>
      )}

      {calibration && <IssueList issues={[...calibration.issues, ...(quality?.issues ?? []).filter((i) => !calibration.issues.some((c) => c.code === i.code))]} />}

      {calibration?.status === "rejected" && (
        <div className="rounded-md border border-bad/30 bg-bad/5 p-3 text-sm">
          <p className="font-medium text-bad">Physical scale could not be established.</p>
          <p className="mt-1">No millimetre measurements will be produced for this photo. Retake it following the instructions, or use a manual reference length as a last resort.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onRetake}>
              Retake photo
            </Button>
          </div>
        </div>
      )}

      <details className="rounded-md border border-line p-3" open={manualActive}>
        <summary className="cursor-pointer text-sm font-medium">Manual reference length (fallback)</summary>
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-muted">
            Mark both ends of an object of known length lying in the same plane as the nails (e.g. a ruler). This gives a single scale with
            <strong> no perspective correction</strong>; results are labelled “Manual scale”.
          </p>
          {!manualActive ? (
            <Button onClick={onStartManual}>Mark reference points</Button>
          ) : (
            <>
              <p>
                {manualPoints.length < 2 ? `Tap point ${manualPoints.length + 1} of 2 on the image.` : "Both points marked. Enter the true distance between them:"}
              </p>
              <label className="flex items-center gap-2">
                <span>Length</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step={0.1}
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-24 rounded border border-line px-2 py-1"
                />
                <span>mm</span>
              </label>
              <div className="flex gap-2">
                <Button variant="primary" disabled={manualPoints.length < 2 || !(Number(length) > 0)} onClick={() => onApplyManual(Number(length))}>
                  Apply manual scale
                </Button>
                <Button onClick={onCancelManual}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  );
}
