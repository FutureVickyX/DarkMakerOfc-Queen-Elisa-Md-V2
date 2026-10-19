import { describe, expect, it } from "vitest";
import { updateNail } from "@/lib/scan/scanService";
import { scanWithNail } from "../../../tests/helpers/fixtures";
import { exportCsv, exportJson, exportPdf, profileRows } from "./reportExporter";

describe("reportExporter", () => {
  const confirmed = () => {
    const s = scanWithNail();
    return updateNail(s, s.nails[0]!.id, { reviewStatus: "confirmed" }, "confirm");
  };

  it("exports all ten fingers and leaves unmeasured fingers empty", () => {
    const rows = profileRows(confirmed());
    expect(rows).toHaveLength(10);
    const li = rows.find((r) => r.hand === "left" && r.finger === "index")!;
    expect(li.status).toBe("measured");
    expect(li.width_mm).toBeCloseTo(14, 1);
    expect(li.calibration_status).toBe("valid");
    expect(li.manually_edited).toBe(true);
    const rt = rows.find((r) => r.hand === "right" && r.finger === "thumb")!;
    expect(rt.status).toBe("incomplete");
    expect(rt.width_mm).toBeNull();
  });

  it("writes CSV with header, units in column names and empty cells for missing values", () => {
    const csv = exportCsv(confirmed());
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(11);
    expect(lines[0]).toMatch(/^hand,finger,status,width_mm,length_mm,area_mm2/);
    expect(lines.find((l) => l.startsWith("right,thumb"))).toMatch(/^right,thumb,incomplete,,,,/);
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    const s = confirmed();
    const n = s.nails[0]!;
    const tampered = { ...s, nails: [{ ...n, measurement: { ...n.measurement!, issues: [{ code: "x", severity: "warning" as const, message: "=HYPERLINK(1)" }] } }] };
    expect(exportCsv(tampered)).toContain("'=HYPERLINK(1)");
  });

  it("includes method, disclaimer and calibration details in JSON", () => {
    const j = exportJson(confirmed(), { id: "c", customerReference: "Order 1", createdAt: "" });
    expect(j.units).toEqual({ length: "mm", area: "mm2" });
    expect(j.disclaimer).toMatch(/not been validated/);
    expect(j.captures[0]!.calibration!.layoutId).toBe("NM-CARD-1");
    expect(j.scan.customerReference).toBe("Order 1");
  });

  it("produces a PDF", async () => {
    const blob = await exportPdf(confirmed(), null);
    const head = new Uint8Array(await blob.arrayBuffer()).subarray(0, 4);
    expect(String.fromCharCode(...head)).toBe("%PDF");
  });
});
