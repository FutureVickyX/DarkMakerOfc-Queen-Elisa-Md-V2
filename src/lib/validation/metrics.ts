/**
 * Accuracy and repeatability metrics for validating measurements against
 * physically measured ground truth (e.g. calipers). Pure functions; used by the
 * in-app validation tool and scripts/validation-report.mjs.
 */

export interface ValidationSample {
  readonly sampleId: string;
  readonly subjectId: string;
  /** e.g. "left-index" */
  readonly slot: string;
  /** Repeat number for repeatability (1, 2, 3...). */
  readonly repeat: number;
  readonly trueWidthMm: number | null;
  readonly trueLengthMm: number | null;
  readonly measuredWidthMm: number | null;
  readonly measuredLengthMm: number | null;
  readonly calibrationStatus: string;
  readonly detected: boolean;
  readonly manuallyCorrected: boolean;
}

export interface ErrorStats {
  readonly n: number;
  readonly meanAbsoluteError: number | null;
  readonly medianAbsoluteError: number | null;
  readonly bias: number | null;
  readonly p95AbsoluteError: number | null;
  readonly maxAbsoluteError: number | null;
}

export interface Targets {
  readonly medianWidthErrorMm: number;
  readonly medianLengthErrorMm: number;
  readonly widthRepeatabilityMm: number;
}

export const ENGINEERING_TARGETS: Targets = {
  medianWidthErrorMm: 0.3,
  medianLengthErrorMm: 0.5,
  widthRepeatabilityMm: 0.3,
};

export interface ValidationReport {
  readonly sampleCount: number;
  readonly width: ErrorStats;
  readonly length: ErrorStats;
  /** Pooled within-nail standard deviation of width across repeats, mm. */
  readonly widthRepeatabilitySd: number | null;
  readonly lengthRepeatabilitySd: number | null;
  readonly repeatabilityGroups: number;
  readonly detectionSuccessRate: number | null;
  readonly manualCorrectionRate: number | null;
  readonly failedCalibrationRate: number | null;
  readonly targets: Targets;
  /** True/false only when there is data for the metric; null = not evaluable. */
  readonly meetsTargets: { width: boolean | null; length: boolean | null; repeatability: boolean | null };
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function errorStats(pairs: readonly [measured: number, truth: number][]): ErrorStats {
  if (pairs.length === 0) return { n: 0, meanAbsoluteError: null, medianAbsoluteError: null, bias: null, p95AbsoluteError: null, maxAbsoluteError: null };
  const signed = pairs.map(([m, t]) => m - t);
  const abs = signed.map(Math.abs).sort((a, b) => a - b);
  return {
    n: pairs.length,
    meanAbsoluteError: abs.reduce((s, v) => s + v, 0) / abs.length,
    medianAbsoluteError: quantile(abs, 0.5),
    bias: signed.reduce((s, v) => s + v, 0) / signed.length,
    p95AbsoluteError: quantile(abs, 0.95),
    maxAbsoluteError: abs[abs.length - 1]!,
  };
}

/** Pooled within-group SD: sqrt(sum((x - mean_g)^2) / sum(n_g - 1)). */
export function pooledSd(groups: readonly (readonly number[])[]): number | null {
  let ss = 0;
  let dof = 0;
  for (const g of groups) {
    if (g.length < 2) continue;
    const mean = g.reduce((s, v) => s + v, 0) / g.length;
    ss += g.reduce((s, v) => s + (v - mean) ** 2, 0);
    dof += g.length - 1;
  }
  return dof > 0 ? Math.sqrt(ss / dof) : null;
}

export function buildValidationReport(samples: readonly ValidationSample[], targets: Targets = ENGINEERING_TARGETS): ValidationReport {
  const usable = samples.filter((s) => s.calibrationStatus === "valid" || s.calibrationStatus === "manual");
  const widthPairs = usable.filter((s) => s.measuredWidthMm !== null && s.trueWidthMm !== null).map((s) => [s.measuredWidthMm!, s.trueWidthMm!] as [number, number]);
  const lengthPairs = usable.filter((s) => s.measuredLengthMm !== null && s.trueLengthMm !== null).map((s) => [s.measuredLengthMm!, s.trueLengthMm!] as [number, number]);

  const groups = new Map<string, ValidationSample[]>();
  for (const s of usable) {
    const key = `${s.subjectId}|${s.slot}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const widthGroups = [...groups.values()].map((g) => g.map((s) => s.measuredWidthMm).filter((v): v is number => v !== null));
  const lengthGroups = [...groups.values()].map((g) => g.map((s) => s.measuredLengthMm).filter((v): v is number => v !== null));
  const repeatGroups = widthGroups.filter((g) => g.length >= 2).length;

  const n = samples.length;
  const width = errorStats(widthPairs);
  const length = errorStats(lengthPairs);
  const widthRep = pooledSd(widthGroups);

  return {
    sampleCount: n,
    width,
    length,
    widthRepeatabilitySd: widthRep,
    lengthRepeatabilitySd: pooledSd(lengthGroups),
    repeatabilityGroups: repeatGroups,
    detectionSuccessRate: n ? samples.filter((s) => s.detected).length / n : null,
    manualCorrectionRate: n ? samples.filter((s) => s.manuallyCorrected).length / n : null,
    failedCalibrationRate: n ? samples.filter((s) => s.calibrationStatus === "rejected" || s.calibrationStatus === "not_calibrated").length / n : null,
    targets,
    meetsTargets: {
      width: width.medianAbsoluteError === null ? null : width.medianAbsoluteError <= targets.medianWidthErrorMm,
      length: length.medianAbsoluteError === null ? null : length.medianAbsoluteError <= targets.medianLengthErrorMm,
      repeatability: widthRep === null ? null : widthRep <= targets.widthRepeatabilityMm,
    },
  };
}

export const VALIDATION_CSV_HEADER = [
  "sample_id",
  "subject_id",
  "slot",
  "repeat",
  "true_width_mm",
  "true_length_mm",
  "measured_width_mm",
  "measured_length_mm",
  "calibration_status",
  "detected",
  "manually_corrected",
] as const;

/** Parses the validation CSV template (simple comma-separated, no embedded commas). */
export function parseValidationCsv(text: string): { samples: ValidationSample[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const errors: string[] = [];
  if (lines.length === 0) return { samples: [], errors: ["The file is empty."] };
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const missing = VALIDATION_CSV_HEADER.filter((h) => !header.includes(h));
  if (missing.length) return { samples: [], errors: [`Missing column(s): ${missing.join(", ")}`] };
  const idx = (h: string) => header.indexOf(h);
  const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v));
  const bool = (v: string | undefined) => /^(1|true|yes|y)$/i.test((v ?? "").trim());
  const samples: ValidationSample[] = [];
  lines.slice(1).forEach((line, i) => {
    const c = line.split(",");
    const s: ValidationSample = {
      sampleId: c[idx("sample_id")]?.trim() ?? `row${i + 2}`,
      subjectId: c[idx("subject_id")]?.trim() ?? "",
      slot: c[idx("slot")]?.trim() ?? "",
      repeat: Number(c[idx("repeat")] ?? 1),
      trueWidthMm: num(c[idx("true_width_mm")]),
      trueLengthMm: num(c[idx("true_length_mm")]),
      measuredWidthMm: num(c[idx("measured_width_mm")]),
      measuredLengthMm: num(c[idx("measured_length_mm")]),
      calibrationStatus: (c[idx("calibration_status")] ?? "").trim(),
      detected: bool(c[idx("detected")]),
      manuallyCorrected: bool(c[idx("manually_corrected")]),
    };
    const nums = [s.trueWidthMm, s.trueLengthMm, s.measuredWidthMm, s.measuredLengthMm];
    if (nums.some((v) => v !== null && !Number.isFinite(v))) errors.push(`Row ${i + 2}: invalid number.`);
    else samples.push(s);
  });
  return { samples, errors };
}
