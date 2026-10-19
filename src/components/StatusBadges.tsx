"use client";

import type { CalibrationStatus, ContourSource, ReviewStatus } from "@/lib/core/types";
import type { MeasurementValidity } from "@/lib/measurement/measurementValidator";
import type { ScanStatus } from "@/lib/scan/model";
import type { ProfileEntryStatus } from "@/lib/scan/scanService";
import type { DetectionStatus } from "@/lib/segmentation/nailSegmenter";
import { Badge } from "./ui";

export function CalibrationBadge({ status }: { status: CalibrationStatus | null | undefined }) {
  switch (status) {
    case "valid":
      return <Badge tone="ok" title="Calibrated with the printed card; perspective corrected">✓ Calibrated</Badge>;
    case "manual":
      return <Badge tone="manual" title="Scale from a user-marked reference; no perspective correction">Manual scale</Badge>;
    case "rejected":
      return <Badge tone="bad" title="Physical scale could not be established">✕ Calibration failed</Badge>;
    default:
      return <Badge tone="neutral">Not calibrated</Badge>;
  }
}

export function ValidityBadge({ validity }: { validity: MeasurementValidity | null | undefined }) {
  if (!validity) return <Badge tone="neutral">No measurement</Badge>;
  if (validity === "ok") return <Badge tone="ok">Checks passed</Badge>;
  if (validity === "warning") return <Badge tone="warn">! Check warnings</Badge>;
  return <Badge tone="bad">✕ Invalid</Badge>;
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status === "confirmed") return <Badge tone="ok">Confirmed</Badge>;
  if (status === "rejected") return <Badge tone="bad">Rejected</Badge>;
  return <Badge tone="neutral">Needs review</Badge>;
}

export function SourceBadge({ source, edited }: { source: ContourSource; edited: boolean }) {
  if (source === "manual") return <Badge tone="manual" title="Outline drawn by hand">Manual outline</Badge>;
  const label = source === "model" ? "Model" : "Tap-to-outline";
  return edited ? (
    <Badge tone="manual" title="Automatic outline corrected by hand">{label} · edited</Badge>
  ) : (
    <Badge tone="info" title={source === "heuristic" ? "Experimental colour-based outline, not a trained model" : "Trained model output"}>
      {label}
    </Badge>
  );
}

export function DetectionBadge({ status, confidence }: { status: DetectionStatus; confidence: number | null }) {
  const conf = confidence === null ? "confidence n/a" : `confidence ${(confidence * 100).toFixed(0)}%`;
  if (status === "detected") return <Badge tone="info" title={conf}>Outline found · {conf}</Badge>;
  if (status === "uncertain") return <Badge tone="warn" title={conf}>Outline uncertain · {conf}</Badge>;
  return <Badge tone="bad">Outline failed</Badge>;
}

export function ProfileStatusBadge({ status }: { status: ProfileEntryStatus }) {
  if (status === "measured") return <Badge tone="ok">Measured</Badge>;
  if (status === "unconfirmed") return <Badge tone="warn">Unconfirmed</Badge>;
  if (status === "conflict") return <Badge tone="bad">Conflict</Badge>;
  return <Badge tone="neutral">Incomplete</Badge>;
}

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const map: Record<ScanStatus, [string, Parameters<typeof Badge>[0]["tone"]]> = {
    empty: ["No photos", "neutral"],
    needs_calibration: ["Needs calibration", "bad"],
    in_review: ["In review", "warn"],
    partial: ["Partial profile", "warn"],
    complete: ["10 / 10 measured", "ok"],
  };
  const [label, tone] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
