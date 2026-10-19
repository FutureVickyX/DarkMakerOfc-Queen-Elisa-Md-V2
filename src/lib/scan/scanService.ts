import { ALL_SLOTS, slotKey, type FingerSlot, type ImagePoint, type ReviewStatus } from "@/lib/core/types";
import { getCardSpec } from "@/lib/calibration/cardSpec";
import { isUsableCalibration } from "@/lib/calibration/calibrationEngine";
import { applyHomography } from "@/lib/geometry/homography";
import { MEASUREMENT_ENGINE_VERSION, measureNail, type AxisSpec } from "@/lib/measurement/measurementEngine";
import { validateMeasurement } from "@/lib/measurement/measurementValidator";
import {
  newId,
  type Capture,
  type NailMeasurement,
  type NailRecord,
  type RevisionValues,
  type Scan,
  type ScanStatus,
  type ScanSummary,
} from "./model";

/**
 * Recomputes a nail's measurement from its contour and its capture's calibration.
 * Returns null when the contour cannot be measured at all; otherwise the result
 * carries validity and issues (including "not calibrated").
 */
export function computeMeasurement(contour: readonly ImagePoint[], axis: AxisSpec, capture: Capture, now = new Date()): NailMeasurement | null {
  const cal = capture.calibration;
  if (!isUsableCalibration(cal)) return null;
  const referenceDistal = cal.layoutId ? getCardSpec(cal.layoutId).distalDirection : { x: 0, y: -1 };
  let geometry;
  try {
    geometry = measureNail({ contour, imageToPlane: cal.imageToPlane, referenceDistal, axis });
  } catch {
    return null;
  }
  const v = validateMeasurement({ geometry, contour, calibration: cal, image: capture });
  const toImg = (p: { x: number; y: number }) => applyHomography(cal.planeToImage, p);
  return {
    widthMm: geometry.widthMm,
    lengthMm: geometry.lengthMm,
    areaMm2: geometry.areaMm2,
    axialExtentMm: geometry.axialExtentMm,
    perimeterMm: geometry.perimeterMm,
    validity: v.validity,
    issues: v.issues,
    calibrationUncertaintyMm: v.calibrationUncertaintyMm,
    calibrationStatus: cal.status,
    calibrationMethod: cal.method,
    engineVersion: MEASUREMENT_ENGINE_VERSION,
    computedAt: now.toISOString(),
    widthChordImage: [toImg(geometry.widthChord.a), toImg(geometry.widthChord.b)],
    lengthChordImage: [toImg(geometry.lengthChord.a), toImg(geometry.lengthChord.b)],
  };
}

const revisionValues = (n: NailRecord): RevisionValues => ({
  widthMm: n.measurement?.widthMm ?? null,
  lengthMm: n.measurement?.lengthMm ?? null,
  areaMm2: n.measurement?.areaMm2 ?? null,
  reviewStatus: n.reviewStatus,
  slot: n.slot,
  contourEdited: n.manuallyEdited,
});

/** Applies a change to a nail, recomputes its measurement and appends a revision. */
export function updateNail(
  scan: Scan,
  nailId: string,
  change: Partial<Pick<NailRecord, "contour" | "axis" | "slot" | "reviewStatus" | "manuallyEdited">>,
  reason: string,
  now = new Date(),
): Scan {
  const nails = scan.nails.map((n) => {
    if (n.id !== nailId) return n;
    const capture = scan.captures.find((c) => c.id === n.captureId);
    const geometryChanged = change.contour !== undefined || change.axis !== undefined;
    const next: NailRecord = {
      ...n,
      ...change,
      // Any geometry change after confirmation requires re-confirmation.
      reviewStatus: change.reviewStatus ?? (geometryChanged && n.reviewStatus === "confirmed" ? "pending" : n.reviewStatus),
      updatedAt: now.toISOString(),
    };
    const measurement = geometryChanged && capture ? computeMeasurement(next.contour, next.axis, capture, now) : n.measurement;
    const withMeasurement: NailRecord = { ...next, measurement };
    return {
      ...withMeasurement,
      revisions: [
        ...n.revisions,
        { id: newId(), createdAt: now.toISOString(), reason, previous: revisionValues(n), updated: revisionValues(withMeasurement) },
      ],
    };
  });
  return { ...scan, nails, updatedAt: now.toISOString() };
}

export function addNail(
  scan: Scan,
  params: Omit<NailRecord, "id" | "measurement" | "revisions" | "createdAt" | "updatedAt" | "reviewStatus">,
  now = new Date(),
): { scan: Scan; nail: NailRecord } {
  const capture = scan.captures.find((c) => c.id === params.captureId);
  const base: NailRecord = {
    ...params,
    id: newId(),
    measurement: null,
    reviewStatus: "pending",
    revisions: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const nail: NailRecord = {
    ...base,
    measurement: capture ? computeMeasurement(base.contour, base.axis, capture, now) : null,
  };
  const withRevision: NailRecord = {
    ...nail,
    revisions: [{ id: newId(), createdAt: now.toISOString(), reason: "created", previous: null, updated: revisionValues(nail) }],
  };
  return { scan: { ...scan, nails: [...scan.nails, withRevision], updatedAt: now.toISOString() }, nail: withRevision };
}

export function removeNail(scan: Scan, nailId: string, now = new Date()): Scan {
  return { ...scan, nails: scan.nails.filter((n) => n.id !== nailId), updatedAt: now.toISOString() };
}

/** Replaces a capture's calibration and recomputes all of its nails. */
export function setCaptureCalibration(scan: Scan, captureId: string, calibration: Capture["calibration"], now = new Date()): Scan {
  const captures = scan.captures.map((c) => (c.id === captureId ? { ...c, calibration } : c));
  const capture = captures.find((c) => c.id === captureId);
  const nails = scan.nails.map((n) => {
    if (n.captureId !== captureId || !capture) return n;
    const measurement = computeMeasurement(n.contour, n.axis, capture, now);
    return { ...n, measurement, reviewStatus: n.reviewStatus === "confirmed" ? ("pending" as ReviewStatus) : n.reviewStatus, updatedAt: now.toISOString() };
  });
  return { ...scan, captures, nails, updatedAt: now.toISOString() };
}

export function removeCapture(scan: Scan, captureId: string, now = new Date()): Scan {
  return {
    ...scan,
    captures: scan.captures.filter((c) => c.id !== captureId),
    nails: scan.nails.filter((n) => n.captureId !== captureId),
    updatedAt: now.toISOString(),
  };
}

export type ProfileEntryStatus = "measured" | "unconfirmed" | "incomplete" | "conflict";

export interface ProfileEntry {
  readonly slot: FingerSlot;
  readonly status: ProfileEntryStatus;
  /** The confirmed nail used for this slot, if exactly one exists. */
  readonly nail: NailRecord | null;
  /** All nails assigned to this slot (for conflict resolution). */
  readonly candidates: readonly NailRecord[];
}

/**
 * Ten-nail profile. A slot is only "measured" when exactly one confirmed,
 * calibrated, non-invalid measurement is assigned to it. Nothing is filled in
 * or averaged to complete the profile.
 */
export function buildProfile(scan: Scan): ProfileEntry[] {
  return ALL_SLOTS.map((slot) => {
    const candidates = scan.nails.filter((n) => n.slot && slotKey(n.slot) === slotKey(slot) && n.reviewStatus !== "rejected");
    const confirmed = candidates.filter((n) => n.reviewStatus === "confirmed" && n.measurement && n.measurement.validity !== "invalid");
    if (confirmed.length > 1) return { slot, status: "conflict", nail: null, candidates };
    if (confirmed.length === 1) return { slot, status: "measured", nail: confirmed[0]!, candidates };
    if (candidates.some((n) => n.measurement && n.measurement.validity !== "invalid")) return { slot, status: "unconfirmed", nail: null, candidates };
    return { slot, status: "incomplete", nail: null, candidates };
  });
}

export function scanStatus(scan: Scan): ScanStatus {
  if (scan.captures.length === 0) return "empty";
  if (!scan.captures.some((c) => isUsableCalibration(c.calibration))) return "needs_calibration";
  const profile = buildProfile(scan);
  const measured = profile.filter((p) => p.status === "measured").length;
  if (measured === 10) return "complete";
  if (scan.nails.some((n) => n.reviewStatus === "pending")) return "in_review";
  return measured > 0 ? "partial" : "in_review";
}

export function summarize(scan: Scan): ScanSummary {
  return {
    id: scan.id,
    name: scan.name,
    customerId: scan.customerId,
    createdAt: scan.createdAt,
    updatedAt: scan.updatedAt,
    status: scanStatus(scan),
    measuredCount: buildProfile(scan).filter((p) => p.status === "measured").length,
    captureCount: scan.captures.length,
  };
}

export interface ComparisonRow {
  readonly slot: FingerSlot;
  readonly a: { widthMm: number; lengthMm: number } | null;
  readonly b: { widthMm: number; lengthMm: number } | null;
  readonly deltaWidthMm: number | null;
  readonly deltaLengthMm: number | null;
}

/** Compares two scans' confirmed profiles slot by slot (b - a). */
export function compareScans(a: Scan, b: Scan): ComparisonRow[] {
  const pa = buildProfile(a);
  const pb = buildProfile(b);
  return pa.map((ea, i) => {
    const eb = pb[i]!;
    const va = ea.nail?.measurement ? { widthMm: ea.nail.measurement.widthMm, lengthMm: ea.nail.measurement.lengthMm } : null;
    const vb = eb.nail?.measurement ? { widthMm: eb.nail.measurement.widthMm, lengthMm: eb.nail.measurement.lengthMm } : null;
    return {
      slot: ea.slot,
      a: va,
      b: vb,
      deltaWidthMm: va && vb ? vb.widthMm - va.widthMm : null,
      deltaLengthMm: va && vb ? vb.lengthMm - va.lengthMm : null,
    };
  });
}
