import { describe, expect, it } from "vitest";
import { buildValidationReport, errorStats, parseValidationCsv, pooledSd, quantile, type ValidationSample } from "./metrics";

const sample = (over: Partial<ValidationSample>): ValidationSample => ({
  sampleId: "s",
  subjectId: "A",
  slot: "left-index",
  repeat: 1,
  trueWidthMm: 12,
  trueLengthMm: 10,
  measuredWidthMm: 12,
  measuredLengthMm: 10,
  calibrationStatus: "valid",
  detected: true,
  manuallyCorrected: false,
  ...over,
});

describe("validation metrics", () => {
  it("computes error statistics including signed bias", () => {
    const s = errorStats([
      [10.2, 10],
      [9.9, 10],
      [10.4, 10],
      [10, 10],
    ]);
    expect(s.n).toBe(4);
    expect(s.meanAbsoluteError).toBeCloseTo(0.175, 9);
    expect(s.medianAbsoluteError).toBeCloseTo(0.15, 9);
    expect(s.bias).toBeCloseTo(0.125, 9);
    expect(s.maxAbsoluteError).toBeCloseTo(0.4, 9);
    expect(quantile([0, 1, 2, 3, 4], 0.95)).toBeCloseTo(3.8, 9);
  });

  it("computes pooled repeatability", () => {
    expect(pooledSd([[1, 3], [5, 5]])).toBeCloseTo(Math.sqrt(2 / 2), 9);
    expect(pooledSd([[1]])).toBeNull();
  });

  it("does not claim targets are met without data", () => {
    const r = buildValidationReport([]);
    expect(r.meetsTargets).toEqual({ width: null, length: null, repeatability: null });
  });

  it("evaluates targets and rates", () => {
    const r = buildValidationReport([
      sample({ measuredWidthMm: 12.1, repeat: 1 }),
      sample({ measuredWidthMm: 12.2, repeat: 2 }),
      sample({ subjectId: "B", calibrationStatus: "rejected", measuredWidthMm: null, detected: false }),
      sample({ subjectId: "C", measuredWidthMm: 13.5, manuallyCorrected: true }),
    ]);
    expect(r.width.n).toBe(3);
    expect(r.width.medianAbsoluteError).toBeCloseTo(0.2, 9);
    expect(r.meetsTargets.width).toBe(true);
    expect(r.failedCalibrationRate).toBeCloseTo(0.25, 9);
    expect(r.detectionSuccessRate).toBeCloseTo(0.75, 9);
    expect(r.manualCorrectionRate).toBeCloseTo(0.25, 9);
    expect(r.repeatabilityGroups).toBe(1);
  });

  it("parses the CSV template and reports missing columns", () => {
    const csv = [
      "sample_id,subject_id,slot,repeat,true_width_mm,true_length_mm,measured_width_mm,measured_length_mm,calibration_status,detected,manually_corrected",
      "1,A,left-index,1,12.0,10.0,12.2,10.1,valid,yes,no",
    ].join("\n");
    const p = parseValidationCsv(csv);
    expect(p.errors).toEqual([]);
    expect(p.samples[0]!.measuredWidthMm).toBe(12.2);
    expect(parseValidationCsv("a,b\n1,2").errors[0]).toMatch(/Missing column/);
  });
});
