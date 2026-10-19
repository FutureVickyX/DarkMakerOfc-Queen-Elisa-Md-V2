"use client";

import { useState } from "react";
import { ScanList } from "@/components/ScanList";
import { ButtonLink, PageHeader } from "@/components/ui";

export default function HistoryPage() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Scan history"
        subtitle="Select two scans to compare their confirmed measurements (e.g. repeat scans of the same customer)."
        actions={
          <>
            <ButtonLink href={selected.length === 2 ? `/history/compare?a=${selected[0]}&b=${selected[1]}` : "#"} variant={selected.length === 2 ? "primary" : "secondary"} className={selected.length === 2 ? "" : "pointer-events-none opacity-50"}>
              Compare selected ({selected.length}/2)
            </ButtonLink>
            <ButtonLink href="/scan/new">New scan</ButtonLink>
          </>
        }
      />
      <ScanList selectable selected={selected} onSelect={setSelected} />
    </div>
  );
}
