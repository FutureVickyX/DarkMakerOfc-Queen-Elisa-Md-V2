"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/core/format";
import type { Customer, ScanSummary } from "@/lib/scan/model";
import { useRepository } from "./RepositoryProvider";
import { ScanStatusBadge } from "./StatusBadges";
import { Button, EmptyState, ErrorBox, Spinner } from "./ui";

/** Scan list with open, rename and delete. Optional selection for comparison. */
export function ScanList({
  limit,
  customerId,
  selectable = false,
  selected = [],
  onSelect,
}: {
  limit?: number;
  customerId?: string;
  selectable?: boolean;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
}) {
  const { repo } = useRepository();
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!repo) return;
    setError(null);
    try {
      const [s, c] = await Promise.all([repo.listScans(), repo.listCustomers()]);
      setScans(customerId ? s.filter((x) => x.customerId === customerId) : s);
      setCustomers(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repo, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rename = async (id: string, current: string) => {
    if (!repo) return;
    const name = window.prompt("Rename scan", current)?.trim();
    if (!name || name === current) return;
    try {
      const scan = await repo.getScan(id);
      if (scan) await repo.saveScan({ ...scan, name: name.slice(0, 120), updatedAt: new Date().toISOString() });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string, name: string) => {
    if (!repo) return;
    if (!window.confirm(`Delete "${name}" and all of its photos and measurements? This cannot be undone.`)) return;
    try {
      await repo.deleteScan(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!scans) return <Spinner label="Loading scans…" />;
  if (scans.length === 0) return <EmptyState title="No scans yet">Start a new scan to measure a hand.</EmptyState>;

  const customerName = (id: string | null) => customers.find((c) => c.id === id)?.customerReference;
  const filtered = scans.filter((s) => !query || `${s.name} ${customerName(s.customerId) ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const shown = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div>
      {!limit && (
        <label className="mb-3 block">
          <span className="sr-only">Search scans</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by scan name or customer"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
          />
        </label>
      )}
      <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
        {shown.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
            {selectable && (
              <input
                type="checkbox"
                aria-label={`Select ${s.name} for comparison`}
                checked={selected.includes(s.id)}
                onChange={(e) => onSelect?.(e.target.checked ? [...selected, s.id].slice(-2) : selected.filter((x) => x !== s.id))}
                className="h-4 w-4"
              />
            )}
            <div className="min-w-0 flex-1">
              <Link href={`/scan/${s.id}`} className="font-medium hover:underline">
                {s.name}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{formatDate(s.createdAt)}</span>
                {customerName(s.customerId) && <span>· {customerName(s.customerId)}</span>}
                <span>
                  · {s.captureCount} photo{s.captureCount === 1 ? "" : "s"} · {s.measuredCount}/10 confirmed
                </span>
              </div>
            </div>
            <ScanStatusBadge status={s.status} />
            <div className="flex gap-1">
              <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => rename(s.id, s.name)}>
                Rename
              </Button>
              <Button variant="ghost" className="min-h-8 px-2 text-xs text-bad" onClick={() => remove(s.id, s.name)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
