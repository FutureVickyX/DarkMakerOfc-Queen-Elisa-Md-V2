import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NM_CARD_1 } from "../../src/lib/calibration/cardSpec";
import { applyHomography } from "../../src/lib/geometry/homography";
import { encodePng } from "../helpers/png";
import { ellipsePolygon, renderScene } from "../helpers/synth";

export const FIXTURE_DIR = resolve("tests/e2e/.fixtures");

/** Renders synthetic calibrated "hand" photos with known nail sizes for browser tests. */
export default async function globalSetup() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const pose = { f: 1500, width: 1600, height: 1200, distanceMm: 230, tiltXDeg: 4, rollDeg: 5, lookAt: { x: 43, y: -10 } };
  const nail = ellipsePolygon({ x: 43, y: -30 }, 7, 6, 360); // 14.0 mm wide, 12.0 mm long
  const { image, planeToImage } = renderScene({ pose, card: NM_CARD_1, nails: [{ polygon: nail, color: [240, 196, 200] }], noiseAmplitude: 4 });
  writeFileSync(join(FIXTURE_DIR, "calibrated.png"), encodePng(image));
  const centre = applyHomography(planeToImage, { x: 43, y: -30 });
  writeFileSync(join(FIXTURE_DIR, "calibrated.json"), JSON.stringify({ width: image.width, height: image.height, nailCentre: centre, trueWidthMm: 14, trueLengthMm: 12 }));

  const { image: noCard } = renderScene({ pose, card: NM_CARD_1, hideMarkers: [0, 1, 2, 3], nails: [{ polygon: nail }] });
  writeFileSync(join(FIXTURE_DIR, "no-markers.png"), encodePng(noCard));
  writeFileSync(join(FIXTURE_DIR, "not-an-image.png"), "this is not a png");
}
