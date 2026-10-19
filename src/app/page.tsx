"use client";

import { ScanList } from "@/components/ScanList";
import { useRepository } from "@/components/RepositoryProvider";
import { ButtonLink, Card, PageHeader } from "@/components/ui";

export default function DashboardPage() {
  const { mode } = useRepository();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Measure natural nails from a calibrated photo and build a ten-nail sizing profile."
        actions={
          <ButtonLink href="/scan/new" variant="primary">
            New scan
          </ButtonLink>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="1 · Print the card">
          <p className="text-sm text-muted">Print the NM-CARD-1 calibration card at 100% scale and verify the 50 mm bar with a ruler.</p>
          <ButtonLink href="/card" className="mt-3">
            Open printable card
          </ButtonLink>
        </Card>
        <Card title="2 · Photograph">
          <p className="text-sm text-muted">Hand flat, fingers apart, card beside the fingertips at nail height, camera directly above.</p>
          <ButtonLink href="/settings#instructions" className="mt-3">
            Capture instructions
          </ButtonLink>
        </Card>
        <Card title="3 · Review & export">
          <p className="text-sm text-muted">Outline each nail, check the measurements, confirm, then export PDF, CSV or JSON.</p>
          {mode === "local" && <p className="mt-3 text-xs text-muted">Local mode: scans stay in this browser only.</p>}
        </Card>
      </div>

      <Card title="Recent scans" actions={<ButtonLink href="/history">All scans</ButtonLink>}>
        <ScanList limit={5} />
      </Card>
    </div>
  );
}
