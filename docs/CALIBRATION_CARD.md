# Calibration card specification — NM-CARD-1 (v1)

NailMeasure gets its physical scale from a printed card whose geometry is known exactly. Nothing else in the
photo (rulers, coins, the hand itself) is assumed to have a known size.

| Property | Value |
|---|---|
| Layout ID / version | `NM-CARD-1` / 1 |
| Card size | 85.6 × 54.0 mm (credit-card size) |
| Marker dictionary | ArUco `DICT_4X4_50` (OpenCV), IDs 0, 1, 2, 3 |
| Marker size | 15.0 mm square including the 1-cell black border (6 × 6 cells of 2.5 mm) |
| Quiet zone | ≥ 2.5 mm white around every marker (keep clear of print, dirt, fingers) |
| Verification bar | 50.0 mm, tolerance ± 0.3 mm |
| Distal arrow | Points to the card's top edge (−y); place it pointing the same way as the fingertips |

## Coordinate frame and marker positions

Origin at the card's top-left corner, x to the right, y down, millimetres. Marker origin = top-left corner of the
marker's black border; corners are listed in OpenCV order (TL, TR, BR, BL).

| ID | Origin (mm) | TL | TR | BR | BL |
|---|---|---|---|---|---|
| 0 | (4, 4) | (4, 4) | (19, 4) | (19, 19) | (4, 19) |
| 1 | (66.6, 4) | (66.6, 4) | (81.6, 4) | (81.6, 19) | (66.6, 19) |
| 2 | (66.6, 35) | (66.6, 35) | (81.6, 35) | (81.6, 50) | (66.6, 50) |
| 3 | (4, 35) | (4, 35) | (19, 35) | (19, 50) | (4, 50) |

The 16 corners give 16 point correspondences for the homography (8 degrees of freedom), so the fit residual is
a real consistency check: a bent, misprinted or wrong-version card produces a high residual and is rejected.

The source of truth is `src/lib/calibration/cardSpec.ts`; the printable SVG
(`docs/calibration-card/NM-CARD-1.svg`, also served at `/card`) is generated from it and a test fails if they drift.
The bit patterns are verified against OpenCV's `generateImageMarker` in `src/lib/cv/pipeline.cv.test.ts`.

## Printing and preparation

1. Print `/card` (or the SVG) at **100 % / actual size**. Disable "fit to page". Laser printing is preferred.
2. Measure the bar with a ruler or calipers: it must be 50.0 ± 0.3 mm. **A uniformly mis-scaled print cannot be
   detected from the photo** (all marker positions scale together and still fit perfectly), and would scale every
   measurement by the same percentage. This check is mandatory.
3. Mount on stiff, flat card. Matte finish; avoid glossy lamination (glare).
4. Replace the card if it bends, gets dirty, or the corners wear.

## Use

* Place the card beside the fingertips, arrow pointing along the fingers.
* Raise it to approximately the height of the nail surfaces (e.g. on a 10 mm block). The homography is exact only
  for the card's plane; an object `h` mm above the plane at camera distance `D` mm is magnified by roughly
  `D / (D − h)` — about 4 % for h = 10 mm at D = 250 mm, i.e. ~0.6 mm on a 15 mm nail.
* Keep the card within ~120 mm of the nails (the app warns beyond that).

## Rejection rules (defaults, `src/lib/calibration/calibrationEngine.ts`)

| Check | Default | Result |
|---|---|---|
| Card markers found | all 4 | otherwise rejected (`missing_markers`) |
| Duplicate marker IDs | none | rejected (`ambiguous_markers`) — e.g. two cards visible |
| Marker winding | consistent with layout | rejected (`marker_order_invalid`) — mirrored image |
| Smallest marker side | ≥ 40 px | rejected (`markers_too_small`) |
| Corner RMS residual | ≤ 0.20 mm | rejected (`residual_too_high`) |
| Max corner residual | ≤ 0.50 mm | rejected (`residual_too_high`) |
| Local scale variation over the card | ≤ 30 % | rejected (`perspective_too_strong`) |
| Marker edge blur (10–90 % width) | ≤ 4.5 px | rejected (`blurry`) |
| Image long side | ≥ 1000 px | rejected (`resolution_too_low`) |

There is no silent fallback: if calibration is rejected, no millimetre values are produced. A manual
reference-length fallback exists but is labelled "Manual scale" and does not correct perspective.

## Future card versions

Add a new `CalibrationCardSpec` with a new `layoutId`, keep old layouts for re-processing saved scans, and add a
row to `public.calibration_devices`.
