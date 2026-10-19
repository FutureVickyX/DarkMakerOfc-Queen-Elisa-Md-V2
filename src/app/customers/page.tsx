"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRepository } from "@/components/RepositoryProvider";
import { Button, Card, EmptyState, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/core/format";
import { newId, type Customer } from "@/lib/scan/model";

export default function CustomersPage() {
  const { repo } = useRepository();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    if (!repo) return;
    try {
      setCustomers(await repo.listCustomers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo || !reference.trim()) return;
    try {
      await repo.saveCustomer({ id: newId(), customerReference: reference.trim().slice(0, 120), createdAt: new Date().toISOString() });
      setReference("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Customers" subtitle="Optional customer profiles group repeat scans. Store a reference, not unnecessary personal details." />
      <Card title="Add customer">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Customer reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              placeholder="Customer reference, e.g. order #1042"
              className="w-full rounded-md border border-line px-3 py-2"
            />
          </label>
          <Button type="submit" variant="primary" disabled={!reference.trim()}>
            Add
          </Button>
        </form>
      </Card>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!customers ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <EmptyState title="No customers yet" />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-3">
              <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                {c.customerReference}
              </Link>
              <span className="text-xs text-muted">Added {formatDate(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
