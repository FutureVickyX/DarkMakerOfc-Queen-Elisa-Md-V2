"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useRepository } from "@/components/RepositoryProvider";
import { Card, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { formatMm } from "@/lib/core/format";
import { slotLabel } from "@/lib/core/types";
import type { Scan } from "@/lib/scan/model";
import { compareScans } from "@/lib/scan/scanService";

function signed(v: number | null) {
  if (v === null) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)} mm`;
}

function Compare() {
  const params = useSearchParams();
  const { repo } = useRepository();
  const [scans, setScans] = useState<[Scan, Scan] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = params.get("a");
  const b = params.get("b");

  useEffect(() => {
    if (!repo || !a || !b) return;
    Promise.all([repo.getScan(a), repo.getScan(b)])
      .then(([sa, sb]) => {
        if (!sa || !sb) throw new Error("One of the scans could not be found.");
        // Older scan first so deltas read "later minus earlier".
        setScans(sa.createdAt <= sb.createdAt ? [sa, sb] : [sb, sa]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [repo, a, b]);

  if (!a || !b) return <ErrorBox message="Choose two scans on the history page to compare." />;
  if (error) return <ErrorBox message={error} />;
  if (!scans) return <Spinner />;
  const rows = compareScans(scans[0], scans[1]);
  const deltas = rows.flatMap((r) => [r.deltaWidthMm]).filter((d): d is number => d !== null);
  const meanAbs = deltas.length ? deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length : null;

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Finger</th>
              <th className="py-2 pr-3 text-right font-medium">
                <Link className="underline" href={`/scan/${scans[0].id}`}>
                  {scans[0].name}
                </Link>{" "}
                W × L
              </th>
              <th className="py-2 pr-3 text-right font-medium">
                <Link className="underline" href={`/scan/${scans[1].id}`}>
                  {scans[1].name}
                </Link>{" "}
                W × L
              </th>
              <th className="py-2 pr-3 text-right font-medium">Δ width</th>
              <th className="py-2 text-right font-medium">Δ length</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.slot.hand}-${r.slot.finger}`} className="border-b border-line/70">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {slotLabel(r.slot)}
                </th>
                <td className="tabular py-2 pr-3 text-right">{r.a ? `${formatMm(r.a.widthMm)} × ${formatMm(r.a.lengthMm)}` : "—"}</td>
                <td className="tabular py-2 pr-3 text-right">{r.b ? `${formatMm(r.b.widthMm)} × ${formatMm(r.b.lengthMm)}` : "—"}</td>
                <td className="tabular py-2 pr-3 text-right">{signed(r.deltaWidthMm)}</td>
                <td className="tabular py-2 text-right">{signed(r.deltaLengthMm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        {meanAbs === null
          ? "No finger has confirmed measurements in both scans."
          : `Mean absolute width difference over ${deltas.length} finger(s): ${meanAbs.toFixed(2)} mm. Differences combine true change and measurement repeatability.`}
      </p>
    </Card>
  );
}

export default function ComparePage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Compare scans" subtitle="Only confirmed, calibrated measurements are compared." />
      <Suspense>
        <Compare />
      </Suspense>
    </div>
  );
}
