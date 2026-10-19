import type { Metadata } from "next";
import { PrintButton } from "@/components/PrintButton";
import { DEFAULT_CARD } from "@/lib/calibration/cardSpec";
import { renderCardSvg } from "@/lib/calibration/cardSvg";

export const metadata: Metadata = { title: "Calibration card" };

export default function CardPage() {
  const svg = renderCardSvg(DEFAULT_CARD);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div className="space-y-5">
      <div className="no-print">
        <h1 className="text-xl font-semibold sm:text-2xl">Calibration card {DEFAULT_CARD.layoutId}</h1>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>Print this page at <strong>100% / Actual size</strong> (disable “fit to page”). Use a laser printer if possible.</li>
          <li>
            Measure the bar with a ruler or calipers. It must be <strong>{DEFAULT_CARD.verificationBarMm.toFixed(1)} mm ± {DEFAULT_CARD.printToleranceMm} mm</strong>. If not, fix the printer scaling and reprint — a
            uniformly scaled card cannot be detected automatically and would scale every measurement by the same error.
          </li>
          <li>Glue the print flat onto stiff card. Keep it clean, flat and unbent; do not laminate with a glossy film (glare).</li>
          <li>Keep the white margin around each marker clear.</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <PrintButton />
          <a href={dataUrl} download={`${DEFAULT_CARD.layoutId}.svg`} className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:border-ink">
            Download SVG
          </a>
        </div>
      </div>
      <div className="flex justify-center rounded-lg border border-line bg-white p-6 print:border-0 print:p-0">
        {/* Rendered at physical size via mm units in the SVG. */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <section className="no-print rounded-lg border border-line bg-panel p-4 text-sm">
        <h2 className="font-semibold">Specification</h2>
        <ul className="mt-2 space-y-1 text-muted">
          <li>Card: {DEFAULT_CARD.cardWidthMm} × {DEFAULT_CARD.cardHeightMm} mm</li>
          <li>Markers: ArUco {DEFAULT_CARD.dictionary}, IDs {DEFAULT_CARD.markers.map((m) => m.id).join(", ")}, {DEFAULT_CARD.markerSizeMm} mm including black border</li>
          <li>Marker origins (top-left, mm): {DEFAULT_CARD.markers.map((m) => `ID ${m.id} (${m.originMm.x}, ${m.originMm.y})`).join("; ")}</li>
          <li>Arrow points toward the fingertips (card −y direction).</li>
        </ul>
      </section>
    </div>
  );
}
