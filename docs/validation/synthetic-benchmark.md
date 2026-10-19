# Synthetic benchmark (generated)

> **Synthetic data only.** Images are rendered from a pinhole camera model with a flat, perfectly printed card,
> flat elliptical "nails" in the card plane, uniform colours and mild noise. These numbers bound the error of the
> geometric pipeline; they are **not** evidence of real-world accuracy and must not be used to claim that the
> engineering targets are met. Real validation requires physically measured nails (see VALIDATION.md).

Generated: 2026-10-19T14:35:22.787Z · scenes: 24 (8 synthetic subjects × 3 repeats, 2000×1500 px, random tilt ±8°, roll ±20°, distance 220–280 mm)

## Calibration
Absolute error of a 60 mm reference segment located beyond the card, after calibration:
median 0.006 mm, max 0.039 mm (n = 24).

## Measurement with exact outlines (calibration + geometry only)
| Metric | Width | Length |
|---|---|---|
| n | 24 | 24 |
| Mean absolute error (mm) | 0.002 | 0.004 |
| Median absolute error (mm) | 0.002 | 0.003 |
| Signed bias (mm) | 0.002 | 0.003 |
| 95th percentile abs. error (mm) | 0.005 | 0.008 |
| Max abs. error (mm) | 0.010 | 0.014 |
| Repeatability, pooled SD (mm) | 0.003 | 0.003 |
| Detection success rate | 1.00 | |
| Failed calibration rate | 0.00 | |

## Measurement with the experimental tap-to-outline baseline (GrabCut)
| Metric | Width | Length |
|---|---|---|
| n | 24 | 24 |
| Mean absolute error (mm) | 0.144 | 0.142 |
| Median absolute error (mm) | 0.133 | 0.156 |
| Signed bias (mm) | -0.139 | -0.142 |
| 95th percentile abs. error (mm) | 0.332 | 0.313 |
| Max abs. error (mm) | 0.382 | 0.317 |
| Repeatability, pooled SD (mm) | 0.072 | 0.063 |
| Detection success rate | 1.00 | |
| Failed calibration rate | 0.00 | |

Note: repeatability here only reflects pose variation in rendering; real repeatability also includes hand placement,
lighting and outline placement.
