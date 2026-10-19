"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileTable } from "@/components/ProfileTable";
import { useRepository } from "@/components/RepositoryProvider";
import { CalibrationBadge, ScanStatusBadge } from "@/components/StatusBadges";
import { SaveIndicator, useScan } from "@/components/useScan";
import { Button, ButtonLink, Card, EmptyState, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/core/format";
import type { Customer } from "@/lib/scan/model";
import { scanStatus, updateNail } from "@/lib/scan/scanService";

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { repo } = useRepository();
  const { scan, loading, error, reload, update, saveState, saveError } = useScan(id);
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    repo?.listCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, [repo]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!scan) return <ErrorBox title="Scan not found" message="This scan does not exist or you do not have access to it." />;

  const rename = () => {
    const name = window.prompt("Rename scan", scan.name)?.trim();
    if (name) update((s) => ({ ...s, name: name.slice(0, 120), updatedAt: new Date().toISOString() }));
  };

  const remove = async () => {
    if (!repo || !window.confirm(`Delete "${scan.name}" and all of its photos and measurements? This cannot be undone.`)) return;
    await repo.deleteScan(scan.id);
    router.push("/history");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={scan.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>Created {formatDate(scan.createdAt)}</span>
            <ScanStatusBadge status={scanStatus(scan)} />
            <SaveIndicator state={saveState} error={saveError} />
          </span>
        }
        actions={
          <>
            <Button onClick={rename}>Rename</Button>
            <ButtonLink href={`/scan/${scan.id}/export`}>Export</ButtonLink>
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          </>
        }
      />

      <Card title="Customer">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="sr-only">Customer</span>
          <select
            value={scan.customerId ?? ""}
            onChange={(e) => update((s) => ({ ...s, customerId: e.target.value || null, updatedAt: new Date().toISOString() }))}
            className="rounded-md border border-line bg-white px-3 py-2"
          >
            <option value="">No customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.customerReference}
              </option>
            ))}
          </select>
          {scan.customerId && (
            <Link className="underline" href={`/customers/${scan.customerId}`}>
              View customer
            </Link>
          )}
        </label>
      </Card>

      <Card title="Photos" actions={<ButtonLink href={`/scan/${scan.id}/capture`} variant="primary">Add photo</ButtonLink>}>
        {scan.captures.length === 0 ? (
          <EmptyState title="No photos yet">Add a photo of each hand with the calibration card next to the fingertips.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {scan.captures.map((c, i) => {
              const count = scan.nails.filter((n) => n.captureId === c.id).length;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link href={`/scan/${scan.id}/capture/${c.id}`} className="font-medium underline">
                    Photo {i + 1}
                  </Link>
                  <span className="text-xs text-muted">
                    {c.handHint ? `${c.handHint} hand · ` : ""}
                    {formatDate(c.createdAt)} · {count} nail{count === 1 ? "" : "s"}
                  </span>
                  <CalibrationBadge status={c.calibration?.status} />
                  {c.calibration?.quality.rmsResidualMm != null && (
                    <span className="tabular text-xs text-muted">RMS {c.calibration.quality.rmsResidualMm.toFixed(3)} mm</span>
                  )}
                  {!c.imageAssetId && <span className="text-xs text-muted">photo not stored</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Ten-nail profile">
        <ProfileTable scan={scan} onReassign={(nail, slot) => update((s) => updateNail(s, nail.id, { slot }, "finger reassigned"))} />
        <p className="mt-3 text-xs text-muted">
          Values are projected planar dimensions in millimetres, displayed to 0.1 mm. A finger is only “Measured” when exactly one confirmed, calibrated and
          validated measurement is assigned to it.
        </p>
      </Card>
    </div>
  );
}
