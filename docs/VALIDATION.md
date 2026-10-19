# Validation procedure and accuracy report template

NailMeasure must not be presented as a reliable measurement tool until this procedure has been carried out on real,
physically measured nails. The synthetic benchmark (`docs/validation/synthetic-benchmark.md`, `npm run benchmark`)
only checks the geometric pipeline on rendered images.

## Engineering targets (targets, not claims)

| Metric | Target |
|---|---|
| Median absolute width error | ≤ 0.3 mm |
| Median absolute length error | ≤ 0.5 mm |
| Width repeatability (pooled within-nail SD across repeat scans) | ≤ 0.3 mm |

## Reference measurements (ground truth)

* Instrument: digital calipers with 0.01 mm resolution, checked against a gauge block before each session.
* Width: maximum transverse width of the nail plate, jaws parallel to the nail surface, perpendicular to the finger axis.
* Length: along the finger axis through the middle of the plate, from the proximal nail fold (cuticle line) to the
  distal end of the plate as visible from above (same definition the app's outline uses).
* Measure each nail 3 times; use the mean. Record the spread — if the reference itself varies by more than ~0.1 mm,
  the reference, not the app, limits what can be validated.
* Note: calipers measure chord distances on a curved plate, which is close to — but not identical with — the app's
  projected planar width. Report the method alongside results.

## Dataset

* ≥ 20 subjects, covering a range of nail sizes, skin tones and nail shapes; both hands (≥ 200 nails).
* Each subject scanned **3 times**, re-placing the hand and card each time; at least 2 phone models.
* Include deliberate failure captures (missing marker, blur, glare, strong tilt, card far from nails) to measure
  failure handling, but keep them out of the accuracy statistics.
* Record per capture: device, lighting, card height, operator.

## Running the app for validation

1. Create one scan per subject session; outline every nail; assign fingers; confirm.
2. Note for each nail whether automatic outlines needed manual correction.
3. Export CSV (or JSON) from each scan.
4. Fill the template (download from `/validation`):

```
sample_id,subject_id,slot,repeat,true_width_mm,true_length_mm,measured_width_mm,measured_length_mm,calibration_status,detected,manually_corrected
S001,subject01,left-index,1,12.40,11.10,12.52,11.03,valid,yes,no
```

5. Load the CSV at `/validation` (or call `buildValidationReport` from `src/lib/validation/metrics.ts`).

## Metrics computed

Calibration error, width/length mean absolute error, median absolute error, signed bias, 95th-percentile absolute
error, maximum error, pooled repeatability SD, detection success rate, manual correction rate and failed
calibration rate. Calibration error is checked separately by photographing a ruler/gauge (known distances) at
several positions and tilts, and measuring it with the manual-outline tool.

---

## Accuracy report template

**Report ID / date:**
**App version / engine version:** (Settings page shows the engine version)
**Card:** NM-CARD-1 v1 — print verified bar length: ____ mm
**Devices:**
**Operators:**
**Reference instrument and procedure:**

### Dataset summary
| Subjects | Nails | Captures | Repeats per nail | Excluded captures (reason) |
|---|---|---|---|---|
| | | | | |

### Calibration
| Known distance | Positions × tilts | Mean abs. error (mm) | Max abs. error (mm) | Failed calibration rate |
|---|---|---|---|---|
| | | | | |

### Measurement accuracy (calibrated captures only)
| Metric | Width | Length |
|---|---|---|
| n | | |
| Mean absolute error (mm) | | |
| Median absolute error (mm) | | |
| Signed bias (mm) | | |
| 95th percentile absolute error (mm) | | |
| Max absolute error (mm) | | |
| Target | ≤ 0.3 median | ≤ 0.5 median |
| Met on this dataset? | | |

### Repeatability
| Metric | Width | Length |
|---|---|---|
| Pooled within-nail SD (mm) | | |
| Target | ≤ 0.3 | — |
| Met on this dataset? | | |

### Workflow metrics
| Detection success rate | Manual correction rate | Failed calibration rate |
|---|---|---|
| | | |

### Failure-case behaviour
| Case | Expected | Observed |
|---|---|---|
| Missing marker | Calibration rejected | |
| Wrong card dimensions | Rejected (residual) | |
| Excessive perspective | Rejected | |
| Blurry photo | Rejected (blur) | |
| Glare | Warning | |
| Low resolution | Rejected / warning | |
| Overlapping fingers | Manual outline required | |
| Incomplete nail visibility | Border warning | |
| Incorrectly ordered markers | Rejected | |
| Invalid / unsupported file | Error before processing | |

### Conclusions and limitations
State clearly whether the targets were met *on this dataset*, the conditions under which they hold, and any
known biases (e.g. card height, curvature). Do not generalise beyond the tested devices and conditions.
