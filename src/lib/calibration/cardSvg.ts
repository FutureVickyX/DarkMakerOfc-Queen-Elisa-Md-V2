import { DICT_4X4_50_PATTERNS, type CalibrationCardSpec } from "./cardSpec";

/**
 * Renders a printable SVG of a calibration card at true physical size
 * (width/height in mm). Print at 100% / "actual size" with scaling disabled,
 * then verify the bar with a ruler before use.
 */
export function renderCardSvg(spec: CalibrationCardSpec): string {
  const w = spec.cardWidthMm;
  const h = spec.cardHeightMm;
  const cell = spec.markerSizeMm / 6;
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" stroke="#999999" stroke-width="0.2" stroke-dasharray="1 1"/>`);

  for (const marker of spec.markers) {
    const pattern = DICT_4X4_50_PATTERNS[marker.id];
    if (!pattern) throw new Error(`No printable pattern for marker ${marker.id}`);
    const { x: ox, y: oy } = marker.originMm;
    // Quiet zone: the white card background around each marker (>= 1 cell) must stay clear.
    parts.push(`<rect x="${ox}" y="${oy}" width="${spec.markerSizeMm}" height="${spec.markerSizeMm}" fill="#000000"/>`);
    pattern.forEach((row, r) => {
      [...row].forEach((bit, c) => {
        if (bit === "1") {
          parts.push(
            `<rect x="${fmt(ox + c * cell)}" y="${fmt(oy + r * cell)}" width="${fmt(cell)}" height="${fmt(cell)}" fill="#ffffff"/>`,
          );
        }
      });
    });
  }

  // Verification bar centred horizontally between the marker rows.
  const barX = (w - spec.verificationBarMm) / 2;
  const barY = h / 2 + 4;
  parts.push(`<rect x="${fmt(barX)}" y="${fmt(barY)}" width="${spec.verificationBarMm}" height="1.2" fill="#000"/>`);
  for (let i = 0; i <= spec.verificationBarMm; i += 10) {
    parts.push(`<rect x="${fmt(barX + i - 0.15)}" y="${fmt(barY - 1.5)}" width="0.3" height="1.5" fill="#000"/>`);
  }
  parts.push(
    `<text x="${fmt(w / 2)}" y="${fmt(barY + 4)}" font-size="2.2" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#000">Bar = ${spec.verificationBarMm.toFixed(1)} mm ± ${spec.printToleranceMm}</text>`,
  );

  // Distal-direction arrow (points toward -y = top of card).
  const ax = w / 2;
  parts.push(`<path d="M ${fmt(ax)} 6 L ${fmt(ax - 3)} 11 L ${fmt(ax - 1)} 11 L ${fmt(ax - 1)} 18 L ${fmt(ax + 1)} 18 L ${fmt(ax + 1)} 11 L ${fmt(ax + 3)} 11 Z" fill="#000"/>`);
  parts.push(
    `<text x="${fmt(ax)}" y="22" font-size="2.2" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#000">Fingertips this way</text>`,
  );
  parts.push(
    `<text x="${fmt(w / 2)}" y="${fmt(h - 2)}" font-size="1.8" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#555">${spec.layoutId} · ${spec.dictionary} · markers ${spec.markerSizeMm} mm</text>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`,
    ...parts,
    `</svg>`,
  ].join("\n");
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}
