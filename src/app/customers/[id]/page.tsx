"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRepository } from "@/components/RepositoryProvider";
import { ScanList } from "@/components/ScanList";
import { Button, ButtonLink, Card, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import type { Customer } from "@/lib/scan/model";

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { repo } = useRepository();
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repo?.getCustomer(id).then(setCustomer).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [repo, id]);

  if (error) return <ErrorBox message={error} />;
  if (customer === undefined) return <Spinner />;
  if (customer === null) return <ErrorBox title="Customer not found" message="This customer does not exist or you do not have access." />;

  const rename = async () => {
    const ref = window.prompt("Customer reference", customer.customerReference)?.trim();
    if (!ref || !repo) return;
    const next = { ...customer, customerReference: ref.slice(0, 120) };
    await repo.saveCustomer(next);
    setCustomer(next);
  };

  const remove = async () => {
    if (!repo || !window.confirm("Delete this customer? Their scans are kept but no longer linked.")) return;
    await repo.deleteCustomer(customer.id);
    router.push("/customers");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={customer.customerReference}
        subtitle="Customer profile"
        actions={
          <>
            <ButtonLink href={`/scan/new?customer=${customer.id}`} variant="primary">
              New scan for this customer
            </ButtonLink>
            <Button onClick={rename}>Rename</Button>
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          </>
        }
      />
      <Card title="Scans" actions={<ButtonLink href="/history">Compare in history</ButtonLink>}>
        <ScanList customerId={customer.id} />
      </Card>
    </div>
  );
}
