import { describe, expect, it } from "vitest";
import { calibrateFromMarkers } from "@/lib/calibration/calibrationEngine";
import { capture, nailContour, scanWithNail } from "../../../tests/helpers/fixtures";
import { addNail, buildProfile, compareScans, scanStatus, setCaptureCalibration, updateNail } from "./scanService";

describe("scanService", () => {
  it("computes calibrated measurements when a nail is added", () => {
    const scan = scanWithNail();
    const m = scan.nails[0]!.measurement!;
    expect(m.widthMm).toBeCloseTo(14, 1);
    expect(m.lengthMm).toBeCloseTo(12, 1);
    expect(m.calibrationStatus).toBe("valid");
    expect(scan.nails[0]!.revisions).toHaveLength(1);
  });

  it("only counts confirmed, valid measurements in the ten-nail profile", () => {
    let scan = scanWithNail();
    const id = scan.nails[0]!.id;
    expect(buildProfile(scan).find((e) => e.slot.finger === "index" && e.slot.hand === "left")!.status).toBe("unconfirmed");
    scan = updateNail(scan, id, { reviewStatus: "confirmed" }, "confirm");
    const profile = buildProfile(scan);
    expect(profile.filter((e) => e.status === "measured")).toHaveLength(1);
    expect(profile.filter((e) => e.status === "incomplete")).toHaveLength(9);
    expect(scanStatus(scan)).toBe("partial");
  });

  it("flags conflicts instead of picking one when two confirmed nails share a finger", () => {
    let scan = scanWithNail();
    scan = updateNail(scan, scan.nails[0]!.id, { reviewStatus: "confirmed" }, "confirm");
    const added = addNail(scan, {
      captureId: scan.captures[0]!.id,
      slot: { hand: "left", finger: "index" },
      contour: nailContour(20, -30),
      contourSource: "manual",
      manuallyEdited: true,
      axis: { source: "card" },
      detection: null,
    });
    scan = updateNail(added.scan, added.nail.id, { reviewStatus: "confirmed" }, "confirm");
    expect(buildProfile(scan).find((e) => e.slot.hand === "left" && e.slot.finger === "index")!.status).toBe("conflict");
  });

  it("re-opens review and records a revision when geometry changes after confirmation", () => {
    let scan = scanWithNail();
    const id = scan.nails[0]!.id;
    scan = updateNail(scan, id, { reviewStatus: "confirmed" }, "confirm");
    scan = updateNail(scan, id, { contour: nailContour(43, -30, 8, 6), manuallyEdited: true }, "edited");
    const n = scan.nails[0]!;
    expect(n.reviewStatus).toBe("pending");
    expect(n.measurement!.widthMm).toBeCloseTo(16, 1);
    expect(n.revisions.at(-1)!.previous!.widthMm).toBeCloseTo(14, 1);
  });

  it("drops measurements when calibration is replaced by a rejected one", () => {
    let scan = scanWithNail();
    const rejected = calibrateFromMarkers([], capture());
    scan = setCaptureCalibration(scan, scan.captures[0]!.id, rejected);
    expect(scan.nails[0]!.measurement).toBeNull();
    expect(buildProfile(scan).every((e) => e.status === "incomplete")).toBe(true);
  });

  it("compares two scans slot by slot", () => {
    let a = scanWithNail();
    a = updateNail(a, a.nails[0]!.id, { reviewStatus: "confirmed" }, "c");
    let b = scanWithNail();
    b = updateNail(b, b.nails[0]!.id, { contour: nailContour(43, -30, 7.2, 6), reviewStatus: "confirmed" }, "c");
    const row = compareScans(a, b).find((r) => r.slot.hand === "left" && r.slot.finger === "index")!;
    expect(row.deltaWidthMm).toBeCloseTo(0.4, 1);
    expect(compareScans(a, b).filter((r) => r.deltaWidthMm === null)).toHaveLength(9);
  });
});
