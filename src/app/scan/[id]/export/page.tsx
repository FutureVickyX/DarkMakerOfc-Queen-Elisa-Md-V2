"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileTable } from "@/components/ProfileTable";
import { useRepository } from "@/components/RepositoryProvider";
import { useScan } from "@/components/useScan";
import { Button, Card, ErrorBox, IssueList, PageHeader, Spinner } from "@/components/ui";
import { downloadBlob, exportCsv, exportJson, exportPdf, METHOD_STATEMENT, NOT_CERTIFIED_STATEMENT, safeFilename } from "@/lib/export/reportExporter";
import type { Customer } from "@/lib/scan/model";
import { buildProfile } from "@/lib/scan/scanService";

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const { repo } = useRepository();
  const { scan, loading, error } = useScan(id);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (scan?.customerId && repo) repo.getCustomer(scan.customerId).then(setCustomer).catch(() => setCustomer(null));
  }, [scan?.customerId, repo]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!scan) return <ErrorBox title="Scan not found" message="This scan does not exist." />;

  const profile = buildProfile(scan);
  const measured = profile.filter((p) => p.status === "measured").length;
  const base = safeFilename(scan.name);
  const calibrationIssues = scan.captures.flatMap((c) => c.calibration?.issues.filter((i) => i.severity !== "info") ?? []);

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    setExportError(null);
    try {
      await fn();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Export report"
        subtitle={
          <Link href={`/scan/${scan.id}`} className="underline">
            {scan.name}
          </Link>
        }
      />
      <Card title="Summary">
        <p className="text-sm">
          <strong>{measured} of 10</strong> fingers have a confirmed, calibrated measurement.
          {measured < 10 && " Missing fingers are exported as incomplete with no values."}
        </p>
        {calibrationIssues.length > 0 && (
          <div className="mt-3">
            <IssueList issues={calibrationIssues} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => run(async () => downloadBlob(await exportPdf(scan, customer), `${base}.pdf`))}>
            Download PDF report
          </Button>
          <Button disabled={busy} onClick={() => run(() => downloadBlob(new Blob([exportCsv(scan)], { type: "text/csv;charset=utf-8" }), `${base}.csv`))}>
            Download CSV
          </Button>
          <Button
            disabled={busy}
            onClick={() => run(() => downloadBlob(new Blob([JSON.stringify(exportJson(scan, customer), null, 2)], { type: "application/json" }), `${base}.json`))}
          >
            Download JSON
          </Button>
        </div>
        {exportError && (
          <div className="mt-3">
            <ErrorBox message={exportError} />
          </div>
        )}
      </Card>
      <Card title="Profile">
        <ProfileTable scan={scan} />
      </Card>
      <Card title="Method and limitations">
        <p className="text-sm">{METHOD_STATEMENT}</p>
        <p className="mt-2 text-sm font-medium text-warn">{NOT_CERTIFIED_STATEMENT}</p>
      </Card>
    </div>
  );
}
