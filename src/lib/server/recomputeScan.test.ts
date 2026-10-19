import { describe, expect, it } from "vitest";
import { rowsToScan, scanToRows } from "@/lib/persistence/supabaseRows";
import { updateNail } from "@/lib/scan/scanService";
import { scanWithNail } from "../../../tests/helpers/fixtures";
import { recomputeScan } from "./recomputeScan";
import { scanPayloadSchema } from "./scanPayload";

/** Simulates what a browser would POST: the scan serialised to JSON. */
const asPayload = (v: unknown) => scanPayloadSchema.parse(JSON.parse(JSON.stringify(v)));

describe("server-side recompute (trust boundary)", () => {
  it("ignores client-submitted dimensions and recomputes them", () => {
    const scan = scanWithNail();
    const n = scan.nails[0]!;
    const forged = { ...scan, nails: [{ ...n, measurement: { ...n.measurement!, widthMm: 99, lengthMm: 99 } }] };
    const result = recomputeScan(asPayload(forged), null);
    expect(result.nails[0]!.measurement!.widthMm).toBeCloseTo(14, 1);
  });

  it("does not accept a forged 'valid' calibration status", () => {
    const scan = scanWithNail();
    const c = scan.captures[0]!;
    const forged = {
      ...scan,
      captures: [{ ...c, calibration: { ...c.calibration!, status: "valid", detectedMarkers: c.calibration!.detectedMarkers.slice(0, 2) } }],
    };
    const result = recomputeScan(asPayload(forged), null);
    expect(result.captures[0]!.calibration!.status).toBe("rejected");
    expect(result.nails[0]!.measurement).toBeNull();
  });

  it("keeps a client-side rejection (e.g. blur) instead of upgrading it", () => {
    const scan = scanWithNail();
    const c = scan.captures[0]!;
    const blurred = {
      ...scan,
      captures: [{ ...c, calibration: { ...c.calibration!, status: "rejected", issues: [{ code: "blurry", severity: "error", message: "blurred" }] } }],
    };
    const result = recomputeScan(asPayload(blurred), null);
    expect(result.captures[0]!.calibration!.status).toBe("rejected");
  });

  it("nulls confidence for non-model contours and blocks confirming invalid measurements", () => {
    const scan = scanWithNail();
    const n = scan.nails[0]!;
    const forged = {
      ...scan,
      nails: [
        {
          ...n,
          contourSource: "heuristic",
          detection: { segmenterId: "x", segmenterVersion: "1", status: "detected", confidence: 0.99, diagnostics: {}, issues: [] },
          reviewStatus: "confirmed",
        },
      ],
    };
    const result = recomputeScan(asPayload(forged), null);
    expect(result.nails[0]!.detection!.confidence).toBeNull();
    expect(result.nails[0]!.reviewStatus).toBe("confirmed");

    const tiny = { ...forged, nails: [{ ...forged.nails[0]!, contour: forged.nails[0]!.contour.map((p) => ({ x: p.x * 0.01 + 1500, y: p.y * 0.01 + 2000 })) }] };
    expect(recomputeScan(asPayload(tiny), null).nails[0]!.reviewStatus).toBe("pending");
  });

  it("marks a changed heuristic contour as manually edited and appends a revision", () => {
    const original = scanWithNail();
    const n = original.nails[0]!;
    const heuristic = { ...original, nails: [{ ...n, contourSource: "heuristic" as const, manuallyEdited: false }] };
    const stored = recomputeScan(asPayload(heuristic), null);
    expect(stored.nails[0]!.manuallyEdited).toBe(false);
    const moved = { ...heuristic, nails: [{ ...heuristic.nails[0]!, contour: n.contour.map((p) => ({ x: p.x + 30, y: p.y })) }] };
    const next = recomputeScan(asPayload(moved), stored);
    expect(next.nails[0]!.manuallyEdited).toBe(true);
    expect(next.nails[0]!.revisions.length).toBe(stored.nails[0]!.revisions.length + 1);
  });

  it("rejects malformed payloads", () => {
    const scan = scanWithNail();
    expect(scanPayloadSchema.safeParse({ ...scan, id: "not-a-uuid" }).success).toBe(false);
    expect(scanPayloadSchema.safeParse({ ...scan, nails: [{ ...scan.nails[0]!, captureId: "33333333-3333-4333-8333-333333333333" }] }).success).toBe(false);
    expect(scanPayloadSchema.safeParse({ ...scan, nails: [{ ...scan.nails[0]!, contour: [{ x: 0, y: 0 }] }] }).success).toBe(false);
  });

  it("round-trips through database rows", () => {
    let scan = scanWithNail();
    scan = updateNail(scan, scan.nails[0]!.id, { reviewStatus: "confirmed" }, "confirm");
    const rows = scanToRows(scan, "owner");
    expect(rows.nailRows[0]!.width_mm).toBeCloseTo(14, 1);
    expect(rows.scanRow.calibration_status).toBe("valid");
    const back = rowsToScan(rows.scanRow, rows.captureRows, rows.nailRows, rows.revisionRows);
    expect(back.nails[0]!.measurement!.widthMm).toBe(scan.nails[0]!.measurement!.widthMm);
    expect(back.nails[0]!.revisions).toHaveLength(scan.nails[0]!.revisions.length);
    expect(back.captures[0]!.calibration!.status).toBe("valid");
  });
});
