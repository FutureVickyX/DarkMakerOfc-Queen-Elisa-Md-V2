"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useRepository } from "@/components/RepositoryProvider";
import { Button, Card, ErrorBox, PageHeader } from "@/components/ui";
import { createScan, newId, type Customer } from "@/lib/scan/model";

function NewScanForm() {
  const { repo } = useRepository();
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>(params.get("customer") ?? "");
  const [newCustomer, setNewCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repo?.listCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, [repo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      let cid: string | null = customerId || null;
      if (customerId === "__new") {
        const ref = newCustomer.trim();
        if (!ref) throw new Error("Enter a customer reference or choose “No customer”.");
        const c: Customer = { id: newId(), customerReference: ref.slice(0, 120), createdAt: new Date().toISOString() };
        await repo.saveCustomer(c);
        cid = c.id;
      }
      const scan = createScan(name, cid);
      const saved = await repo.saveScan(scan);
      router.push(`/scan/${saved.id}/capture`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <Card>
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Scan name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={`Scan ${new Date().toLocaleDateString()}`}
              className="mt-1 w-full rounded-md border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Customer (optional)</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2">
              <option value="">No customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerReference}
                </option>
              ))}
              <option value="__new">+ New customer…</option>
            </select>
          </label>
          {customerId === "__new" && (
            <label className="block">
              <span className="text-sm font-medium">Customer reference</span>
              <input
                value={newCustomer}
                onChange={(e) => setNewCustomer(e.target.value)}
                maxLength={120}
                placeholder="e.g. order number or initials"
                className="mt-1 w-full rounded-md border border-line px-3 py-2"
              />
              <span className="mt-1 block text-xs text-muted">Use a reference rather than personal details where possible.</span>
            </label>
          )}
        </div>
      </Card>
      {error && <ErrorBox message={error} />}
      <Button type="submit" variant="primary" disabled={busy || !repo}>
        {busy ? "Creating…" : "Create scan and add a photo"}
      </Button>
    </form>
  );
}

export default function NewScanPage() {
  return (
    <div>
      <PageHeader title="New scan" subtitle="A scan groups the photos and measurements for one customer session (both hands)." />
      <Suspense>
        <NewScanForm />
      </Suspense>
    </div>
  );
}
