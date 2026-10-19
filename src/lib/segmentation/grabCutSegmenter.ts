import type { ImagePoint, ValidationIssue } from "@/lib/core/types";
import { localScale } from "@/lib/geometry/homography";
import type { CV } from "@/lib/cv/opencv";
import type { NailDetection, NailSegmenter, SegmentationContext, SegmenterInfo } from "./nailSegmenter";

export const GRABCUT_INFO: SegmenterInfo = {
  id: "grabcut-seeded",
  version: "0.1.0",
  label: "Tap-to-outline (experimental)",
  experimental: true,
  mode: "seeded",
  description:
    "Classical colour-based GrabCut around a point you tap on the nail. Not a trained model: it can leak into skin when contrast is low, so always review and edit the outline.",
};

export interface GrabCutOptions {
  /** Search window side length in mm (or px if uncalibrated, see fallbackWindowPx). */
  readonly windowMm: number;
  readonly fallbackWindowPx: number;
  /** Working resolution of the search window. */
  readonly workingSidePx: number;
  readonly iterations: number;
  /** Radius (mm) of the region assumed to be nail around the seed. */
  readonly seedRadiusMm: number;
  /** Output contour simplification tolerance in mm. */
  readonly simplifyMm: number;
}

export const DEFAULT_GRABCUT_OPTIONS: GrabCutOptions = {
  windowMm: 30,
  fallbackWindowPx: 400,
  workingSidePx: 320,
  iterations: 5,
  seedRadiusMm: 1.5,
  simplifyMm: 0.12,
};

/**
 * Seeded GrabCut baseline. Returns status "failed" rather than an invented
 * contour when nothing plausible is found. `confidence` is always null.
 */
export function createGrabCutSegmenter(cv: CV, options: Partial<GrabCutOptions> = {}): NailSegmenter {
  const opts = { ...DEFAULT_GRABCUT_OPTIONS, ...options };
  return {
    info: GRABCUT_INFO,
    segmentAtSeed(ctx: SegmentationContext, seed: ImagePoint): NailDetection {
      const started = Date.now();
      const { image } = ctx;
      const pxPerMm = ctx.planeToImage && ctx.imageToPlane ? pxPerMmAt(ctx, seed) : null;
      const windowPx = pxPerMm ? opts.windowMm * pxPerMm : opts.fallbackWindowPx;
      const half = windowPx / 2;
      const x0 = Math.max(0, Math.floor(seed.x - half));
      const y0 = Math.max(0, Math.floor(seed.y - half));
      const x1 = Math.min(image.width, Math.ceil(seed.x + half));
      const y1 = Math.min(image.height, Math.ceil(seed.y + half));
      const issues: ValidationIssue[] = [];
      const fail = (message: string, diagnostics: Record<string, number> = {}): NailDetection => ({
        contour: [],
        status: "failed",
        confidence: null,
        source: "heuristic",
        segmenterId: GRABCUT_INFO.id,
        segmenterVersion: GRABCUT_INFO.version,
        diagnostics,
        issues: [...issues, { code: "segmentation_failed", severity: "error", message }],
        durationMs: Date.now() - started,
      });
      if (seed.x < 0 || seed.y < 0 || seed.x > image.width - 1 || seed.y > image.height - 1) {
        return fail("The tapped point is outside the image.");
      }
      if (x1 - x0 < 16 || y1 - y0 < 16) return fail("The tapped point is too close to the image edge.");

      const k = Math.min(1, opts.workingSidePx / Math.max(x1 - x0, y1 - y0));
      const mats: { delete(): void }[] = [];
      const t = <T extends { delete(): void }>(m: T) => (mats.push(m), m);
      try {
        const full = t(cv.matFromImageData(image));
        const roiRgba = full.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
        t(roiRgba);
        const rgb = t(new cv.Mat());
        cv.cvtColor(roiRgba, rgb, cv.COLOR_RGBA2RGB);
        const work = t(new cv.Mat());
        const ww = Math.max(16, Math.round((x1 - x0) * k));
        const wh = Math.max(16, Math.round((y1 - y0) * k));
        cv.resize(rgb, work, new cv.Size(ww, wh), 0, 0, cv.INTER_AREA);

        // Mask: probable background everywhere, probable foreground near the seed,
        // definite foreground at the seed, definite background on the window border.
        const mask = t(new cv.Mat(wh, ww, cv.CV_8UC1, new cv.Scalar(cv.GC_PR_BGD)));
        const sx = (seed.x + 0.5 - x0) * k - 0.5;
        const sy = (seed.y + 0.5 - y0) * k - 0.5;
        const scaleWork = (pxPerMm ?? windowPx / opts.windowMm) * k; // work px per mm
        const seedR = Math.max(2, opts.seedRadiusMm * scaleWork);
        const probR = Math.max(seedR + 2, 5 * scaleWork);
        cv.circle(mask, new cv.Point(Math.round(sx), Math.round(sy)), Math.round(probR), new cv.Scalar(cv.GC_PR_FGD), -1);
        cv.circle(mask, new cv.Point(Math.round(sx), Math.round(sy)), Math.round(seedR), new cv.Scalar(cv.GC_FGD), -1);
        cv.rectangle(mask, new cv.Point(0, 0), new cv.Point(ww - 1, wh - 1), new cv.Scalar(cv.GC_BGD), 2);

        const bgd = t(new cv.Mat());
        const fgd = t(new cv.Mat());
        try {
          cv.grabCut(work, mask, new cv.Rect(0, 0, 1, 1), bgd, fgd, opts.iterations, cv.GC_INIT_WITH_MASK);
        } catch {
          return fail("Colour segmentation could not separate the nail from its surroundings.");
        }

        // Binary foreground mask.
        const fg = t(new cv.Mat(wh, ww, cv.CV_8UC1, new cv.Scalar(0)));
        for (let i = 0; i < ww * wh; i++) {
          const v = mask.data[i];
          fg.data[i] = v === cv.GC_FGD || v === cv.GC_PR_FGD ? 255 : 0;
        }
        const kernel = t(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
        cv.morphologyEx(fg, fg, cv.MORPH_OPEN, kernel);
        cv.morphologyEx(fg, fg, cv.MORPH_CLOSE, kernel);

        const contours = t(new cv.MatVector());
        const hierarchy = t(new cv.Mat());
        cv.findContours(fg, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
        let chosen = -1;
        let chosenArea = 0;
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const inside = cv.pointPolygonTest(c, new cv.Point(sx, sy), false) >= 0;
          const area = cv.contourArea(c);
          if (inside && area > chosenArea) {
            chosen = i;
            chosenArea = area;
          }
          c.delete();
        }
        if (chosen < 0) return fail("No region was found around the tapped point.");

        const contour = contours.get(chosen);
        t(contour);
        const approx = t(new cv.Mat());
        cv.approxPolyDP(contour, approx, Math.max(0.6, opts.simplifyMm * scaleWork), true);
        const hull = t(new cv.Mat());
        cv.convexHull(contour, hull, false, true);
        const solidity = chosenArea / Math.max(1e-9, cv.contourArea(hull));
        const rect = cv.boundingRect(contour);
        const touchesBorder = rect.x <= 2 || rect.y <= 2 || rect.x + rect.width >= ww - 3 || rect.y + rect.height >= wh - 3;
        const areaMm2 = chosenArea / (scaleWork * scaleWork);

        const points: ImagePoint[] = [];
        const d = approx.data32S as Int32Array;
        for (let i = 0; i + 1 < d.length; i += 2) {
          points.push({ x: (d[i]! + 0.5) / k - 0.5 + x0, y: (d[i + 1]! + 0.5) / k - 0.5 + y0 });
        }
        if (points.length < 4) return fail("The detected region is too small to outline.", { solidity, areaMm2 });

        if (touchesBorder) {
          issues.push({ code: "segmentation_leak", severity: "warning", message: "The outline reached the search window edge and probably leaked into the finger or background." });
        }
        if (solidity < 0.85) {
          issues.push({ code: "segmentation_irregular", severity: "warning", message: `The outline is irregular (solidity ${(solidity * 100).toFixed(0)}%). Edit it before confirming.` });
        }
        if (pxPerMm && (areaMm2 < 15 || areaMm2 > 400)) {
          issues.push({ code: "segmentation_implausible_size", severity: "warning", message: `Outlined area ${areaMm2.toFixed(0)} mm² is unusual for a nail plate.` });
        }

        return {
          contour: points,
          status: issues.length > 0 ? "uncertain" : "detected",
          confidence: null,
          source: "heuristic",
          segmenterId: GRABCUT_INFO.id,
          segmenterVersion: GRABCUT_INFO.version,
          diagnostics: { solidity, areaMm2: pxPerMm ? areaMm2 : NaN, workingScale: k },
          issues,
          durationMs: Date.now() - started,
        };
      } finally {
        for (const m of mats.reverse()) {
          try {
            m.delete();
          } catch {
            /* released */
          }
        }
      }
    },
  };
}

function pxPerMmAt(ctx: SegmentationContext, seed: ImagePoint): number {
  // image px per mm at the seed = 1 / (mm per px) from imageToPlane's local scale.
  const s = localScale(ctx.imageToPlane!, seed);
  return 1 / Math.sqrt(s.max * s.min);
}
