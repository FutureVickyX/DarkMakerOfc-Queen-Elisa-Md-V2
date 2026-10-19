"use client";

import { useState } from "react";
import { Badge, Card, ErrorBox, PageHeader } from "@/components/ui";
import { buildValidationReport, parseValidationCsv, VALIDATION_CSV_HEADER, type ErrorStats, type ValidationReport } from "@/lib/validation/metrics";

const TEMPLATE = `${VALIDATION_CSV_HEADER.join(",")}\n# one row per nail per scan; true_* from calipers, measured_* from the NailMeasure export\nS001,subject01,left-index,1,12.40,11.10,,,valid,yes,no\n`;

function fmt(v: number | null, d = 2) {
  return v === null ? "—" : v.toFixed(d);
}

function Stats({ title, s }: { title: string; s: ErrorStats }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title} (n = {s.n})</h3>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 text-sm">
        <dt className="text-muted">Mean absolute error</dt>
        <dd className="tabular">{fmt(s.meanAbsoluteError)} mm</dd>
        <dt className="text-muted">Median absolute error</dt>
        <dd className="tabular">{fmt(s.medianAbsoluteError)} mm</dd>
        <dt className="text-muted">Signed bias</dt>
        <dd className="tabular">{fmt(s.bias)} mm</dd>
        <dt className="text-muted">95th percentile abs. error</dt>
        <dd className="tabular">{fmt(s.p95AbsoluteError)} mm</dd>
        <dt className="text-muted">Max abs. error</dt>
        <dd className="tabular">{fmt(s.maxAbsoluteError)} mm</dd>
      </dl>
    </div>
  );
}

function Verdict({ v }: { v: boolean | null }) {
  if (v === null) return <Badge>Not evaluable (no data)</Badge>;
  return v ? <Badge tone="ok">Meets target on this dataset</Badge> : <Badge tone="bad">Does not meet target</Badge>;
}

export default function ValidationPage() {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = async (f: File) => {
    const { samples, errors: errs } = parseValidationCsv(await f.text());
    setErrors(errs);
    setReport(samples.length ? buildValidationReport(samples) : null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Validation tool"
        subtitle="Compare app measurements with physically measured ground truth. Accuracy is unvalidated until this is done on a real dataset."
      />
      <Card title="1 · Prepare the dataset">
        <p className="text-sm">
          Measure each nail’s maximum width and centreline length with calipers. Scan each subject 3 times (re-placing the hand and card), export JSON/CSV and
          fill the template. See <code>docs/VALIDATION.md</code> for the full protocol.
        </p>
        <a
          className="mt-3 inline-flex min-h-10 items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:border-ink"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="nailmeasure-validation-template.csv"
        >
          Download CSV template
        </a>
      </Card>
      <Card title="2 · Analyse">
        <input type="file" accept=".csv,text/csv" aria-label="Validation CSV" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        {errors.length > 0 && (
          <div className="mt-3">
            <ErrorBox title="Some rows were skipped" message={errors.join(" ")} />
          </div>
        )}
      </Card>
      {report && (
        <Card title="Report">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Stats title="Width" s={report.width} />
              <p className="text-sm">
                Target median ≤ {report.targets.medianWidthErrorMm} mm: <Verdict v={report.meetsTargets.width} />
              </p>
            </div>
            <div className="space-y-2">
              <Stats title="Length" s={report.length} />
              <p className="text-sm">
                Target median ≤ {report.targets.medianLengthErrorMm} mm: <Verdict v={report.meetsTargets.length} />
              </p>
            </div>
          </div>
          <dl className="mt-5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <dt className="text-muted">Width repeatability (pooled SD, {report.repeatabilityGroups} nails with repeats)</dt>
            <dd className="tabular">
              {fmt(report.widthRepeatabilitySd)} mm <Verdict v={report.meetsTargets.repeatability} />
            </dd>
            <dt className="text-muted">Length repeatability (pooled SD)</dt>
            <dd className="tabular">{fmt(report.lengthRepeatabilitySd)} mm</dd>
            <dt className="text-muted">Detection success rate</dt>
            <dd className="tabular">{report.detectionSuccessRate === null ? "—" : `${(report.detectionSuccessRate * 100).toFixed(0)}%`}</dd>
            <dt className="text-muted">Manual correction rate</dt>
            <dd className="tabular">{report.manualCorrectionRate === null ? "—" : `${(report.manualCorrectionRate * 100).toFixed(0)}%`}</dd>
            <dt className="text-muted">Failed calibration rate</dt>
            <dd className="tabular">{report.failedCalibrationRate === null ? "—" : `${(report.failedCalibrationRate * 100).toFixed(0)}%`}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted">Results apply only to this dataset, devices and operators. Small datasets give unreliable estimates.</p>
        </Card>
      )}
    </div>
  );
}
