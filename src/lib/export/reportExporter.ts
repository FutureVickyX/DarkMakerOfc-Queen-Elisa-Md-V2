import { slotLabel } from "@/lib/core/types";
import { buildProfile, type ProfileEntry } from "@/lib/scan/scanService";
import type { Customer, Scan } from "@/lib/scan/model";
import { MEASUREMENT_ENGINE_VERSION } from "@/lib/measurement/measurementEngine";

export const EXPORT_SCHEMA_VERSION = "nailmeasure.profile/1";

export const METHOD_STATEMENT =
  "Dimensions are projected planar measurements in millimetres, computed after perspective correction from a printed ArUco calibration card " +
  "(or a user-marked reference length where stated). Width is the maximum chord perpendicular to the nail axis; length is the chord along the " +
  "nail axis through the plate's area centroid; area is the projected contour area. Curved nail plates have larger true surface dimensions.";

export const NOT_CERTIFIED_STATEMENT =
  "This profile has not been validated for manufacturing. Measurement accuracy has not been certified; verify critical sizes before production.";

export interface ExportRow {
  hand: string;
  finger: string;
  status: string;
  width_mm: number | null;
  length_mm: number | null;
  area_mm2: number | null;
  calibration_status: string | null;
  calibration_method: string | null;
  calibration_rms_mm: number | null;
  calibration_uncertainty_mm: number | null;
  contour_source: string | null;
  manually_edited: boolean | null;
  detection_status: string | null;
  detection_confidence: number | null;
  review_status: string | null;
  validity: string | null;
  warnings: string;
}

export function profileRows(scan: Scan): ExportRow[] {
  return buildProfile(scan).map((e) => rowFor(scan, e));
}

function rowFor(scan: Scan, e: ProfileEntry): ExportRow {
  const n = e.nail;
  const m = n?.measurement ?? null;
  const capture = n ? scan.captures.find((c) => c.id === n.captureId) : undefined;
  const warnings = [
    ...(m?.issues ?? []).filter((i) => i.severity !== "info").map((i) => i.message),
    ...(e.status === "conflict" ? ["More than one confirmed measurement is assigned to this finger."] : []),
    ...(e.status === "unconfirmed" ? ["Measurement exists but has not been confirmed in review."] : []),
    ...(e.status === "incomplete" ? ["No reliable measurement for this finger."] : []),
  ];
  return {
    hand: e.slot.hand,
    finger: e.slot.finger,
    status: e.status,
    width_mm: m ? m.widthMm : null,
    length_mm: m ? m.lengthMm : null,
    area_mm2: m ? m.areaMm2 : null,
    calibration_status: m?.calibrationStatus ?? null,
    calibration_method: m?.calibrationMethod ?? null,
    calibration_rms_mm: capture?.calibration?.quality.rmsResidualMm ?? null,
    calibration_uncertainty_mm: m?.calibrationUncertaintyMm ?? null,
    contour_source: n?.contourSource ?? null,
    manually_edited: n ? n.manuallyEdited : null,
    detection_status: n?.detection?.status ?? null,
    detection_confidence: n?.detection?.confidence ?? null,
    review_status: n?.reviewStatus ?? null,
    validity: m?.validity ?? null,
    warnings: warnings.join(" | "),
  };
}

const CSV_COLUMNS: (keyof ExportRow)[] = [
  "hand",
  "finger",
  "status",
  "width_mm",
  "length_mm",
  "area_mm2",
  "calibration_status",
  "calibration_method",
  "calibration_rms_mm",
  "calibration_uncertainty_mm",
  "contour_source",
  "manually_edited",
  "detection_status",
  "detection_confidence",
  "review_status",
  "validity",
  "warnings",
];

function csvCell(v: unknown, decimals: number): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(decimals)) : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export. Values are written with 2 decimals (display uses 1); raw precision is in JSON. */
export function exportCsv(scan: Scan): string {
  const rows = profileRows(scan);
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c], 2)).join(","));
  return lines.join("\r\n") + "\r\n";
}

export interface JsonExport {
  schema: string;
  generatedAt: string;
  engineVersion: string;
  units: { length: "mm"; area: "mm2" };
  method: string;
  disclaimer: string;
  scan: { id: string; name: string; createdAt: string; customerReference: string | null };
  captures: {
    id: string;
    captureMethod: string;
    width: number;
    height: number;
    calibration: {
      method: string;
      status: string;
      layoutId: string | null;
      layoutVersion: number | null;
      rmsResidualMm: number | null;
      maxResidualMm: number | null;
      pxPerMm: number | null;
      issues: string[];
    } | null;
  }[];
  nails: ExportRow[];
}

export function exportJson(scan: Scan, customer: Customer | null, now = new Date()): JsonExport {
  return {
    schema: EXPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    engineVersion: MEASUREMENT_ENGINE_VERSION,
    units: { length: "mm", area: "mm2" },
    method: METHOD_STATEMENT,
    disclaimer: NOT_CERTIFIED_STATEMENT,
    scan: { id: scan.id, name: scan.name, createdAt: scan.createdAt, customerReference: customer?.customerReference ?? null },
    captures: scan.captures.map((c) => ({
      id: c.id,
      captureMethod: c.captureMethod,
      width: c.width,
      height: c.height,
      calibration: c.calibration
        ? {
            method: c.calibration.method,
            status: c.calibration.status,
            layoutId: c.calibration.layoutId,
            layoutVersion: c.calibration.layoutVersion,
            rmsResidualMm: c.calibration.quality.rmsResidualMm,
            maxResidualMm: c.calibration.quality.maxResidualMm,
            pxPerMm: c.calibration.quality.pxPerMmAtCard,
            issues: c.calibration.issues.map((i) => `${i.severity}: ${i.message}`),
          }
        : null,
    })),
    nails: profileRows(scan),
  };
}

/** Builds a PDF report (client-side). jsPDF is imported lazily to keep it out of the main bundle. */
export async function exportPdf(scan: Scan, customer: Customer | null, now = new Date()): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const rows = profileRows(scan);
  const marginX = 14;
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("NailMeasure — measurement report", marginX, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Scan: ${scan.name}`, marginX, y);
  y += 4.5;
  if (customer) {
    doc.text(`Customer reference: ${customer.customerReference}`, marginX, y);
    y += 4.5;
  }
  doc.text(`Scan created: ${new Date(scan.createdAt).toLocaleString()}   Report generated: ${now.toLocaleString()}`, marginX, y);
  y += 4.5;
  doc.text(`Units: millimetres (mm), square millimetres (mm²). Engine ${MEASUREMENT_ENGINE_VERSION}.`, marginX, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const header = ["Finger", "Width", "Length", "Area", "Calibration", "Review", "Status"];
  const colX = [marginX, 58, 78, 98, 118, 148, 172];
  header.forEach((h, i) => doc.text(h, colX[i]!, y));
  y += 2;
  doc.line(marginX, y, 196, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (const r of rows) {
    const label = slotLabel({ hand: r.hand as "left" | "right", finger: r.finger as "thumb" });
    const cells = [
      label,
      r.width_mm === null ? "—" : r.width_mm.toFixed(1),
      r.length_mm === null ? "—" : r.length_mm.toFixed(1),
      r.area_mm2 === null ? "—" : r.area_mm2.toFixed(0),
      r.calibration_status ?? "—",
      r.review_status ?? "—",
      r.status,
    ];
    cells.forEach((c, i) => doc.text(c, colX[i]!, y));
    y += 5;
  }
  y += 3;

  const warnings = rows.filter((r) => r.warnings).map((r) => `${slotLabel({ hand: r.hand as "left", finger: r.finger as "thumb" })}: ${r.warnings}`);
  const calWarnings = scan.captures.flatMap((c) =>
    (c.calibration?.issues ?? []).filter((i) => i.severity !== "info").map((i) => `Capture ${c.id.slice(0, 8)}: ${i.message}`),
  );
  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    if (y > 260) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, marginX, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, 182) as string[];
      if (y + wrapped.length * 4 > 285) {
        doc.addPage();
        y = 18;
      }
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 4 + 1;
    }
    y += 2;
  };

  section(
    "Calibration",
    scan.captures.map((c) => {
      const cal = c.calibration;
      if (!cal) return `Capture ${c.id.slice(0, 8)}: not calibrated.`;
      const rms = cal.quality.rmsResidualMm;
      return `Capture ${c.id.slice(0, 8)}: ${cal.method === "card" ? `card ${cal.layoutId} v${cal.layoutVersion}` : "manual reference length"}, status ${cal.status}${rms !== null ? `, RMS residual ${rms.toFixed(3)} mm` : ""}.`;
    }),
  );
  section("Warnings", [...calWarnings, ...warnings]);
  section("Method", [METHOD_STATEMENT]);
  section("Disclaimer", [NOT_CERTIFIED_STATEMENT]);

  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "scan";
}
