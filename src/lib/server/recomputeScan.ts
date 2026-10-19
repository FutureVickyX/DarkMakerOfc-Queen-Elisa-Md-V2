import { calibrateFromMarkers, calibrateManually, type CalibrationRecord } from "@/lib/calibration/calibrationEngine";
import { CARD_SPECS } from "@/lib/calibration/cardSpec";
import type { ValidationIssue } from "@/lib/core/types";
import { newId, type Capture, type NailRecord, type RevisionValues, type Scan } from "@/lib/scan/model";
import { computeMeasurement } from "@/lib/scan/scanService";
import type { ScanPayload } from "./scanPayload";

/**
 * Rebuilds a scan from validated raw inputs, recomputing every calibration and
 * measurement server-side. Client-submitted dimensions, statuses and
 * homographies are never used. Revisions are derived by diffing against the
 * previously stored scan.
 */
export function recomputeScan(payload: ScanPayload, previous: Scan | null, now = new Date()): Scan {
  const ts = now.toISOString();

  const captures: Capture[] = payload.captures.map((c) => ({
    id: c.id,
    createdAt: c.createdAt,
    captureMethod: c.captureMethod,
    deviceInfo: c.deviceInfo,
    imageAssetId: c.imageAssetId,
    width: c.width,
    height: c.height,
    handHint: c.handHint,
    quality: c.quality,
    calibration: c.calibration ? recomputeCalibration(c.calibration, c, now) : null,
  }));
  const captureById = new Map(captures.map((c) => [c.id, c]));
  const prevNails = new Map((previous?.nails ?? []).map((n) => [n.id, n]));

  const nails: NailRecord[] = payload.nails.map((n) => {
    const capture = captureById.get(n.captureId)!;
    const prev = prevNails.get(n.id) ?? null;
    const measurement = computeMeasurement(n.contour, n.axis, capture, now);
    const contourChanged = prev ? JSON.stringify(prev.contour) !== JSON.stringify(n.contour) : false;
    const manuallyEdited = n.contourSource === "manual" || n.manuallyEdited || (prev?.manuallyEdited ?? false) || contourChanged;
    // A review decision is only kept if the measurement exists and is not invalid.
    const reviewStatus = n.reviewStatus === "confirmed" && (!measurement || measurement.validity === "invalid") ? "pending" : n.reviewStatus;
    const detection = n.detection
      ? {
          ...n.detection,
          diagnostics: Object.fromEntries(Object.entries(n.detection.diagnostics).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>,
          // Confidence is only meaningful for trained-model output.
          confidence: n.contourSource === "model" ? n.detection.confidence : null,
        }
      : null;
    const record: NailRecord = {
      id: n.id,
      captureId: n.captureId,
      slot: n.slot,
      contour: n.contour,
      contourSource: n.contourSource,
      manuallyEdited,
      axis: n.axis,
      detection,
      measurement,
      reviewStatus,
      revisions: prev?.revisions ?? [],
      createdAt: prev?.createdAt ?? n.createdAt,
      updatedAt: prev ? prev.updatedAt : ts,
    };
    const before = prev ? values(prev) : null;
    const after = values(record);
    if (!before || JSON.stringify(before) !== JSON.stringify(after)) {
      return {
        ...record,
        updatedAt: ts,
        revisions: [...record.revisions, { id: newId(), createdAt: ts, reason: prev ? describeChange(before!, after) : "created", previous: before, updated: after }],
      };
    }
    return record;
  });

  return {
    id: payload.id,
    name: payload.name,
    customerId: payload.customerId,
    notes: payload.notes,
    createdAt: previous?.createdAt ?? payload.createdAt,
    updatedAt: ts,
    captures,
    nails,
  };
}

function recomputeCalibration(input: NonNullable<ScanPayload["captures"][number]["calibration"]>, image: { width: number; height: number }, now: Date): CalibrationRecord {
  let record: CalibrationRecord;
  if (input.method === "manual") {
    if (!input.manualReference) {
      return calibrateManually({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, lengthMm: 0 }, image, now);
    }
    record = calibrateManually(input.manualReference, image, now);
  } else {
    const card = input.layoutId ? CARD_SPECS[input.layoutId] : undefined;
    if (!card) {
      return {
        ...calibrateFromMarkers([], image, { now }),
        status: "rejected",
        issues: [{ code: "unknown_layout", severity: "error", message: `Unknown calibration card layout ${input.layoutId ?? "(none)"}.` }],
      };
    }
    record = calibrateFromMarkers(input.detectedMarkers, image, { card, now });
  }
  // Keep a client-side rejection (e.g. image-quality checks the server cannot repeat without the photo).
  if (input.status === "rejected" && record.status !== "rejected") {
    const clientIssues: ValidationIssue[] = input.issues.filter((i) => i.severity === "error");
    return { ...record, status: "rejected", imageToPlane: null, planeToImage: null, issues: [...clientIssues, ...record.issues] };
  }
  return record;
}

function values(n: NailRecord): RevisionValues {
  return {
    widthMm: n.measurement?.widthMm ?? null,
    lengthMm: n.measurement?.lengthMm ?? null,
    areaMm2: n.measurement?.areaMm2 ?? null,
    reviewStatus: n.reviewStatus,
    slot: n.slot,
    contourEdited: n.manuallyEdited,
  };
}

function describeChange(a: RevisionValues, b: RevisionValues): string {
  const parts: string[] = [];
  if (a.widthMm !== b.widthMm || a.lengthMm !== b.lengthMm || a.areaMm2 !== b.areaMm2) parts.push("geometry");
  if (a.reviewStatus !== b.reviewStatus) parts.push(`review ${a.reviewStatus}→${b.reviewStatus}`);
  if (JSON.stringify(a.slot) !== JSON.stringify(b.slot)) parts.push("finger assignment");
  if (a.contourEdited !== b.contourEdited) parts.push("manual edit");
  return parts.join(", ") || "updated";
}
