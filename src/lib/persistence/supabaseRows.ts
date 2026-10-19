import type { CalibrationRecord } from "@/lib/calibration/calibrationEngine";
import type { Capture, MeasurementRevision, NailRecord, Scan } from "@/lib/scan/model";

/** Row shapes and mapping between the Scan domain model and the Supabase tables. */

export interface ScanRow {
  id: string;
  owner_id: string;
  customer_id: string | null;
  name: string;
  notes: string;
  capture_method: "camera" | "upload" | "mixed" | null;
  device_info: unknown;
  calibration_status: string;
  created_at: string;
  updated_at: string;
}

export interface CaptureRow {
  id: string;
  scan_id: string;
  owner_id: string;
  capture_method: string;
  device_info: unknown;
  width: number;
  height: number;
  hand_hint: string | null;
  calibration_device_id?: string | null;
  calibration_method: string | null;
  calibration_status: string;
  calibration: CalibrationRecord | null;
  detected_markers: unknown;
  manual_reference: unknown;
  quality: unknown;
  image_storage_path: string | null;
  created_at: string;
}

export interface NailRow {
  id: string;
  scan_id: string;
  capture_id: string;
  owner_id: string;
  hand: string | null;
  finger: string | null;
  width_mm: number | null;
  length_mm: number | null;
  area_mm2: number | null;
  axial_extent_mm: number | null;
  perimeter_mm: number | null;
  confidence: number | null;
  review_status: string;
  validity: string | null;
  calibration_status: string;
  contour: unknown;
  contour_source: string;
  manually_edited: boolean;
  axis: unknown;
  detection: unknown;
  issues: unknown;
  calibration_uncertainty_mm: number | null;
  engine_version: string;
  created_at: string;
  updated_at: string;
}

export interface RevisionRow {
  id: string;
  measurement_id: string;
  owner_id: string;
  previous_values: unknown;
  updated_values: unknown;
  reason: string;
  created_at: string;
}

function overallCalibrationStatus(scan: Scan): string {
  const statuses = scan.captures.map((c) => c.calibration?.status ?? "not_calibrated");
  if (statuses.includes("valid")) return "valid";
  if (statuses.includes("manual")) return "manual";
  if (statuses.includes("rejected")) return "rejected";
  return "not_calibrated";
}

export function scanToRows(scan: Scan, ownerId: string) {
  const methods = new Set(scan.captures.map((c) => c.captureMethod));
  const scanRow: ScanRow = {
    id: scan.id,
    owner_id: ownerId,
    customer_id: scan.customerId,
    name: scan.name,
    notes: scan.notes,
    capture_method: methods.size === 0 ? null : methods.size > 1 ? "mixed" : [...methods][0]!,
    device_info: scan.captures[0]?.deviceInfo ?? null,
    calibration_status: overallCalibrationStatus(scan),
    created_at: scan.createdAt,
    updated_at: scan.updatedAt,
  };
  const captureRows: CaptureRow[] = scan.captures.map((c) => ({
    id: c.id,
    scan_id: scan.id,
    owner_id: ownerId,
    capture_method: c.captureMethod,
    device_info: c.deviceInfo,
    width: c.width,
    height: c.height,
    hand_hint: c.handHint,
    calibration_method: c.calibration?.method ?? null,
    calibration_status: c.calibration?.status ?? "not_calibrated",
    calibration: c.calibration,
    detected_markers: c.calibration?.detectedMarkers ?? null,
    manual_reference: c.calibration?.manualReference ?? null,
    quality: c.quality,
    image_storage_path: c.imageAssetId,
    created_at: c.createdAt,
  }));
  const nailRows: NailRow[] = scan.nails.map((n) => ({
    id: n.id,
    scan_id: scan.id,
    capture_id: n.captureId,
    owner_id: ownerId,
    hand: n.slot?.hand ?? null,
    finger: n.slot?.finger ?? null,
    width_mm: n.measurement?.widthMm ?? null,
    length_mm: n.measurement?.lengthMm ?? null,
    area_mm2: n.measurement?.areaMm2 ?? null,
    axial_extent_mm: n.measurement?.axialExtentMm ?? null,
    perimeter_mm: n.measurement?.perimeterMm ?? null,
    confidence: n.detection?.confidence ?? null,
    review_status: n.reviewStatus,
    validity: n.measurement?.validity ?? null,
    calibration_status: n.measurement?.calibrationStatus ?? scan.captures.find((c) => c.id === n.captureId)?.calibration?.status ?? "not_calibrated",
    contour: n.contour,
    contour_source: n.contourSource,
    manually_edited: n.manuallyEdited,
    axis: n.axis,
    // The full measurement snapshot (chords, issues) rides along in the detection JSON for round trips.
    detection: n.detection ? { ...n.detection, measurement: n.measurement } : { measurement: n.measurement },
    issues: n.measurement?.issues ?? [],
    calibration_uncertainty_mm: n.measurement?.calibrationUncertaintyMm ?? null,
    engine_version: n.measurement?.engineVersion ?? "n/a",
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  }));
  const revisionRows: RevisionRow[] = scan.nails.flatMap((n) =>
    n.revisions.map((r) => ({
      id: r.id,
      measurement_id: n.id,
      owner_id: ownerId,
      previous_values: r.previous,
      updated_values: r.updated,
      reason: r.reason.slice(0, 200),
      created_at: r.createdAt,
    })),
  );
  return { scanRow, captureRows, nailRows, revisionRows };
}

export function rowsToScan(scanRow: ScanRow, captureRows: CaptureRow[], nailRows: NailRow[], revisionRows: RevisionRow[]): Scan {
  const captures: Capture[] = captureRows
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      captureMethod: r.capture_method as Capture["captureMethod"],
      deviceInfo: (r.device_info ?? { userAgent: "" }) as Capture["deviceInfo"],
      imageAssetId: r.image_storage_path,
      width: r.width,
      height: r.height,
      handHint: r.hand_hint as Capture["handHint"],
      calibration: r.calibration,
      quality: r.quality as Capture["quality"],
    }));
  const revByNail = new Map<string, MeasurementRevision[]>();
  for (const r of revisionRows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = revByNail.get(r.measurement_id) ?? [];
    list.push({ id: r.id, createdAt: r.created_at, reason: r.reason, previous: r.previous_values as MeasurementRevision["previous"], updated: r.updated_values as MeasurementRevision["updated"] });
    revByNail.set(r.measurement_id, list);
  }
  const nails: NailRecord[] = nailRows
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => {
      const det = (r.detection ?? {}) as Record<string, unknown>;
      const { measurement, ...detection } = det;
      return {
        id: r.id,
        captureId: r.capture_id,
        slot: r.hand && r.finger ? ({ hand: r.hand, finger: r.finger } as NailRecord["slot"]) : null,
        contour: r.contour as NailRecord["contour"],
        contourSource: r.contour_source as NailRecord["contourSource"],
        manuallyEdited: r.manually_edited,
        axis: r.axis as NailRecord["axis"],
        detection: "segmenterId" in detection ? (detection as unknown as NailRecord["detection"]) : null,
        measurement: (measurement ?? null) as NailRecord["measurement"],
        reviewStatus: r.review_status as NailRecord["reviewStatus"],
        revisions: revByNail.get(r.id) ?? [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  return {
    id: scanRow.id,
    name: scanRow.name,
    customerId: scanRow.customer_id,
    notes: scanRow.notes,
    createdAt: scanRow.created_at,
    updatedAt: scanRow.updated_at,
    captures,
    nails,
  };
}
