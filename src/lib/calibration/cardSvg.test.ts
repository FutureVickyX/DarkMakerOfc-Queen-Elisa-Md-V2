import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NM_CARD_1 } from "./cardSpec";
import { renderCardSvg } from "./cardSvg";

const DOC_SVG = join(process.cwd(), "docs", "calibration-card", "NM-CARD-1.svg");

describe("printable card", () => {
  it("renders at physical size with all four markers", () => {
    const svg = renderCardSvg(NM_CARD_1);
    expect(svg).toContain('width="85.6mm"');
    expect(svg).toContain('height="54mm"');
    expect(svg.match(/fill="#000000"/g)).toHaveLength(4);
  });

  it("matches the committed SVG in docs (regenerate with UPDATE_CARD=1)", () => {
    const svg = renderCardSvg(NM_CARD_1);
    if (process.env.UPDATE_CARD || !existsSync(DOC_SVG)) writeFileSync(DOC_SVG, svg + "\n");
    expect(readFileSync(DOC_SVG, "utf8").trim()).toBe(svg.trim());
  });
});
