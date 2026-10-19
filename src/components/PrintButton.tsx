"use client";

import { Button } from "./ui";

export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      Print card
    </Button>
  );
}
