/**
 * Synthetic benchmark: renders calibrated scenes with nails of known size under
 * varied camera poses, runs the real pipeline (OpenCV ArUco detection ->
 * calibration -> measurement) and writes docs/validation/synthetic-benchmark.md.
 *
 * This measures the GEOMETRIC pipeline on idealised images only. It says nothing
 * about real-world accuracy (skin, curvature, lighting, card height, segmentation
 * on real nails). Run: npm run benchmark
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { calibrateFromMarkers } from "@/lib/calibration/calibrationEngine";
import { NM_CARD_1 } from "@/lib/calibration/cardSpec";
import { detectMarkers } from "@/lib/cv/markerDetector";
import { loadOpenCvNode } from "@/lib/cv/opencv.node";
import { applyHomography } from "@/lib/geometry/homography";
import { measureNail } from "@/lib/measurement/measurementEngine";
import { createGrabCutSegmenter } from "@/lib/segmentation/grabCutSegmenter";
import { buildValidationReport, type ValidationReport, type ValidationSample } from "@/lib/validation/metrics";
import { ellipsePolygon, projectPolygon, renderScene, type CameraPose } from "../helpers/synth";

it("synthetic benchmark", async () => {
  const cv = await loadOpenCvNode();
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const exact: ValidationSample[] = [];
  const grab: ValidationSample[] = [];
  const calErrors: number[] = [];
  let scenes = 0;

  for (let subject = 0; subject < 8; subject++) {
    const w = 10 + rnd() * 8; // true width 10-18 mm
    const l = 8 + rnd() * 7; // true length 8-15 mm
    for (let repeat = 1; repeat <= 3; repeat++) {
      const pose: CameraPose = {
        f: 1800,
        width: 2000,
        height: 1500,
        distanceMm: 220 + rnd() * 60,
        tiltXDeg: (rnd() - 0.5) * 16,
        tiltYDeg: (rnd() - 0.5) * 16,
        rollDeg: (rnd() - 0.5) * 40,
        lookAt: { x: 30 + rnd() * 25, y: -15 + rnd() * 10 },
      };
      const centre = { x: 25 + rnd() * 35, y: -32 + rnd() * 6 };
      const nail = ellipsePolygon(centre, w / 2, l / 2, 360);
      const { image, planeToImage } = renderScene({ pose, card: NM_CARD_1, nails: [{ polygon: nail, color: [240, 196, 200] }], noiseAmplitude: 5 });
      scenes++;
      const cal = calibrateFromMarkers(detectMarkers(cv, image, NM_CARD_1).markers, image);
      const base = { sampleId: `${subject}-${repeat}`, subjectId: `S${subject}`, slot: "synthetic", repeat, trueWidthMm: w, trueLengthMm: l, calibrationStatus: cal.status };
      if (cal.status !== "valid") {
        exact.push({ ...base, measuredWidthMm: null, measuredLengthMm: null, detected: false, manuallyCorrected: false });
        grab.push({ ...base, measuredWidthMm: null, measuredLengthMm: null, detected: false, manuallyCorrected: false });
        continue;
      }
      // Calibration error: a 60 mm reference segment beyond the card.
      const a = applyHomography(cal.imageToPlane!, applyHomography(planeToImage, { x: 10, y: -40 }));
      const b = applyHomography(cal.imageToPlane!, applyHomography(planeToImage, { x: 70, y: -40 }));
      calErrors.push(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 60));

      const g = measureNail({ contour: projectPolygon(planeToImage, nail), imageToPlane: cal.imageToPlane!, referenceDistal: NM_CARD_1.distalDirection, axis: { source: "card" } });
      exact.push({ ...base, measuredWidthMm: g.widthMm, measuredLengthMm: g.lengthMm, detected: true, manuallyCorrected: false });

      const det = await createGrabCutSegmenter(cv).segmentAtSeed!({ image, imageToPlane: cal.imageToPlane, planeToImage: cal.planeToImage }, applyHomography(planeToImage, centre));
      if (det.status === "failed") {
        grab.push({ ...base, measuredWidthMm: null, measuredLengthMm: null, detected: false, manuallyCorrected: false });
      } else {
        const gg = measureNail({ contour: det.contour, imageToPlane: cal.imageToPlane!, referenceDistal: NM_CARD_1.distalDirection, axis: { source: "card" } });
        grab.push({ ...base, measuredWidthMm: gg.widthMm, measuredLengthMm: gg.lengthMm, detected: true, manuallyCorrected: false });
      }
    }
  }

  const re = buildValidationReport(exact);
  const rg = buildValidationReport(grab);
  calErrors.sort((x, y) => x - y);
  const f = (v: number | null, d = 3) => (v === null ? "—" : v.toFixed(d));
  const table = (r: ValidationReport) =>
    [
      "| Metric | Width | Length |",
      "|---|---|---|",
      `| n | ${r.width.n} | ${r.length.n} |`,
      `| Mean absolute error (mm) | ${f(r.width.meanAbsoluteError)} | ${f(r.length.meanAbsoluteError)} |`,
      `| Median absolute error (mm) | ${f(r.width.medianAbsoluteError)} | ${f(r.length.medianAbsoluteError)} |`,
      `| Signed bias (mm) | ${f(r.width.bias)} | ${f(r.length.bias)} |`,
      `| 95th percentile abs. error (mm) | ${f(r.width.p95AbsoluteError)} | ${f(r.length.p95AbsoluteError)} |`,
      `| Max abs. error (mm) | ${f(r.width.maxAbsoluteError)} | ${f(r.length.maxAbsoluteError)} |`,
      `| Repeatability, pooled SD (mm) | ${f(r.widthRepeatabilitySd)} | ${f(r.lengthRepeatabilitySd)} |`,
      `| Detection success rate | ${f(r.detectionSuccessRate, 2)} | |`,
      `| Failed calibration rate | ${f(r.failedCalibrationRate, 2)} | |`,
    ].join("\n");

  const md = `# Synthetic benchmark (generated)

> **Synthetic data only.** Images are rendered from a pinhole camera model with a flat, perfectly printed card,
> flat elliptical "nails" in the card plane, uniform colours and mild noise. These numbers bound the error of the
> geometric pipeline; they are **not** evidence of real-world accuracy and must not be used to claim that the
> engineering targets are met. Real validation requires physically measured nails (see VALIDATION.md).

Generated: ${new Date().toISOString()} · scenes: ${scenes} (8 synthetic subjects × 3 repeats, 2000×1500 px, random tilt ±8°, roll ±20°, distance 220–280 mm)

## Calibration
Absolute error of a 60 mm reference segment located beyond the card, after calibration:
median ${f(calErrors[Math.floor(calErrors.length / 2)] ?? null)} mm, max ${f(calErrors[calErrors.length - 1] ?? null)} mm (n = ${calErrors.length}).

## Measurement with exact outlines (calibration + geometry only)
${table(re)}

## Measurement with the experimental tap-to-outline baseline (GrabCut)
${table(rg)}

Note: repeatability here only reflects pose variation in rendering; real repeatability also includes hand placement,
lighting and outline placement.
`;
  const dir = join(process.cwd(), "docs", "validation");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "synthetic-benchmark.md"), md);
  console.log(md);
}, 600_000);
