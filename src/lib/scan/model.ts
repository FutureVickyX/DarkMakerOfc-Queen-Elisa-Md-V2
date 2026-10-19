import type {
  CaptureMethod,
  ContourSource,
  FingerSlot,
  Hand,
  ImagePoint,
  ReviewStatus,
  ValidationIssue,
} from "@/lib/core/types";
import type { CalibrationRecord } from "@/lib/calibration/calibrationEngine";
import type { AxisSpec } from "@/lib/measurement/measurementEngine";
import type { MeasurementValidity } from "@/lib/measurement/measurementValidator";
import type { DetectionStatus } from "@/lib/segmentation/nailSegmenter";

export interface DeviceInfo {
  readonly userAgent: string;
  readonly platform?: string;
  readonly screen?: string;
}

export interface QualitySummary {
  readonly meanLuma: number;
  readonly clippedFraction: number;
  readonly laplacianVariance: number;
  readonly markerEdgeWidthPx: number | null;
  readonly issues: readonly ValidationIssue[];
}

export interface Capture {
  readonly id: string;
  readonly createdAt: string;
  readonly captureMethod: CaptureMethod;
  readonly deviceInfo: DeviceInfo;
  /** Key of the stored image blob (local IndexedDB key or storage path). Null if not stored. */
  readonly imageAssetId: string | null;
  /** Dimensions of the analysed image; all coordinates in this capture use this pixel space. */
  readonly width: number;
  readonly height: number;
  readonly handHint: Hand | "both" | null;
  readonly calibration: CalibrationRecord | null;
  readonly quality: QualitySummary | null;
}

export interface DetectionInfo {
  readonly segmenterId: string;
  readonly segmenterVersion: string;
  readonly status: DetectionStatus;
  readonly confidence: number | null;
  readonly diagnostics: Readonly<Record<string, number>>;
  readonly issues: readonly ValidationIssue[];
}

export interface NailMeasurement {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly areaMm2: number;
  readonly axialExtentMm: number;
  readonly perimeterMm: number;
  readonly validity: MeasurementValidity;
  readonly issues: readonly ValidationIssue[];
  /** 1-sigma calibration-only uncertainty contribution, mm. Null when not quantified. */
  readonly calibrationUncertaintyMm: number | null;
  readonly calibrationStatus: CalibrationRecord["status"];
  readonly calibrationMethod: CalibrationRecord["method"] | null;
  readonly engineVersion: string;
  readonly computedAt: string;
  /** Chord endpoints in image coordinates, for overlays. */
  readonly widthChordImage: readonly [ImagePoint, ImagePoint];
  readonly lengthChordImage: readonly [ImagePoint, ImagePoint];
}

export interface MeasurementRevision {
  readonly id: string;
  readonly createdAt: string;
  readonly reason: string;
  readonly previous: RevisionValues | null;
  readonly updated: RevisionValues;
}

export interface RevisionValues {
  readonly widthMm: number | null;
  readonly lengthMm: number | null;
  readonly areaMm2: number | null;
  readonly reviewStatus: ReviewStatus;
  readonly slot: FingerSlot | null;
  readonly contourEdited: boolean;
}

export interface NailRecord {
  readonly id: string;
  readonly captureId: string;
  readonly slot: FingerSlot | null;
  readonly contour: readonly ImagePoint[];
  readonly contourSource: ContourSource;
  /** True once a user modified an automatic/heuristic contour (or drew it manually). */
  readonly manuallyEdited: boolean;
  readonly axis: AxisSpec;
  readonly detection: DetectionInfo | null;
  readonly measurement: NailMeasurement | null;
  readonly reviewStatus: ReviewStatus;
  readonly revisions: readonly MeasurementRevision[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Scan {
  readonly id: string;
  readonly name: string;
  readonly customerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly captures: readonly Capture[];
  readonly nails: readonly NailRecord[];
  readonly notes: string;
}

export type ScanStatus = "empty" | "needs_calibration" | "in_review" | "complete" | "partial";

export interface ScanSummary {
  readonly id: string;
  readonly name: string;
  readonly customerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ScanStatus;
  readonly measuredCount: number;
  readonly captureCount: number;
}

export interface Customer {
  readonly id: string;
  /** Free-text reference (e.g. order number or initials). Avoid storing unnecessary personal data. */
  readonly customerReference: string;
  readonly createdAt: string;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // RFC4122 v4 fallback
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createScan(name: string, customerId: string | null = null, now = new Date()): Scan {
  const ts = now.toISOString();
  return { id: newId(), name: name.trim() || `Scan ${now.toLocaleDateString()}`, customerId, createdAt: ts, updatedAt: ts, captures: [], nails: [], notes: "" };
}
