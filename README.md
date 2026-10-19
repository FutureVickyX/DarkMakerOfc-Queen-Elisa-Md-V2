# NailMeasure

NailMeasure is a mobile-first web app that measures natural fingernails for custom press-on nail sizing. You take or upload a photo with a printed calibration card next to the fingertips. The app corrects perspective from the card's ArUco markers, you outline each nail plate, and it reports width, length and projected area in millimetres. The results build a ten-nail profile that you can export as PDF, CSV or JSON.

> **Status: engineering prototype, not validated.** The geometric pipeline is tested on synthetic images, but accuracy on real nails has **not** been measured. No profile produced by this app is manufacturing-certified. See [docs/VALIDATION.md](docs/VALIDATION.md).

Physical calibration provides the scale. Nail detection only helps with outlining. The app never invents a scale: if the card can't be calibrated, it produces no millimetre values.

## Features

| Area | What is implemented |
|---|---|
| Capture | Live rear camera (`getUserMedia`, `ImageCapture.takePhoto` where available) with a file-input fallback that opens the native camera app. It handles permission denial, missing APIs, interrupted streams and tab suspension. You confirm a capture checklist before taking the photo. |
| Upload | Checks file type and size (25 MB). Decoding applies EXIF orientation. It rejects files that won't decode and images under 640 px. |
| Calibration | ArUco `DICT_4X4_50` detection (OpenCV.js) with sub-pixel corners and 16-point normalised-DLT homography. It reports RMS and max residuals in mm, perspective strength, marker size, blur (marker edge width), glare, exposure and resolution. Configurable rejection thresholds. A clearly labelled manual reference-length fallback. |
| Nail outlines | A model-agnostic `NailSegmenter` interface. Includes an **experimental** tap-to-outline baseline (seeded GrabCut, confidence always `null`) and manual outlines. The editor supports zoom/pan/pinch, dragging points, adding and removing points, undo/redo and keyboard nudging. |
| Measurement | Max width perpendicular to the nail axis, centreline length through the area centroid, projected area, axial extent and perimeter, all computed in the rectified card plane. The axis comes from the card arrow, a manual rotation or the outline shape. Each measurement carries a calibration-only uncertainty, validity checks and provenance. |
| Review | Per-nail status badges (calibration, detection, validity, manual edit, review). Confirm/reject, finger assignment and reassignment, retake. Any geometry edit re-opens review. Every change appends a revision. |
| Profile | Ten slots. A slot counts as *Measured* only with exactly one confirmed, calibrated, valid measurement. Otherwise it shows Incomplete, Unconfirmed or Conflict; values are never filled in. |
| Persistence | **Local mode** (IndexedDB, default, no setup) or **Supabase** (auth, Postgres with RLS, private storage). Scans, customers, history, rename, delete and compare. |
| Export | PDF report (method, units, calibration, warnings, disclaimer), CSV (formula-injection safe) and JSON (full precision, schema-versioned). |
| Validation | Metrics library, the `/validation` tool for ground-truth CSVs, a synthetic benchmark generator and a report template. |

## Quick start (local mode, no cloud services)

Requirements: Node 20.9+.

```bash
npm install          # also copies OpenCV.js into public/vendor/ (postinstall)
npm run dev          # http://localhost:3000
```

1. Open **/card**, print it at 100 % and check that the 50 mm bar measures 50.0 ± 0.3 mm.
2. Go to **New scan → Add a photo**, tick the checklist, then take or upload a photo of one hand with the card beside the fingertips.
3. If calibration succeeds, use **Draw outline** or **Tap to outline (experimental)** on each nail. Adjust the points, set the finger and confirm.
4. Open **Ten-nail profile → Export**.

The live camera needs HTTPS (or `localhost`). To test on a phone over your LAN, use an HTTPS tunnel or deploy a preview.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest: geometry, calibration, OpenCV pipeline on synthetic images, segmentation, scan logic, exports, IndexedDB, server trust boundary, SQL migrations and RLS (PGlite) |
| `npm run test:e2e` | Playwright on desktop and mobile Chromium: upload → calibrate → outline → confirm → export, plus failure cases. Builds must exist (`npm run build`). |
| `npm run benchmark` | Regenerates `docs/validation/synthetic-benchmark.md` |

Set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled Chromium. Otherwise run `npx playwright install chromium` once.

## Architecture

```
src/
  lib/
    core/          types (branded mm / mm² / px, image vs plane points), display formatting
    calibration/   cardSpec (NM-CARD-1), cardSvg (printable), calibrationEngine (pure TS)
    geometry/      homography (normalised DLT, Jacobi eigen), contourEditor (undoable state)
    cv/            OpenCV.js boundary: imageLoader, imageQuality, markerDetector, imageRectifier,
                   captureAnalysis, cvClient (main-thread facade for the worker)
    segmentation/  nailSegmenter interface, grabCutSegmenter (experimental baseline)
    measurement/   measurementEngine (pure), measurementValidator
    scan/          domain model, scanService (measure/update/profile/compare), session image cache
    persistence/   scanRepository interface, localRepository (IndexedDB), supabaseRepository, row mapping
    server/        zod payload schema, recomputeScan (server-side recomputation)
    export/        reportExporter (PDF/CSV/JSON)
    validation/    accuracy and repeatability metrics
  workers/cv.worker.ts   decoding, marker detection, quality, segmentation off the main thread
  app/                   App Router screens + POST /api/scans
supabase/migrations/     schema, RLS, storage policies
docs/                    card spec, validation procedure, synthetic benchmark
tests/                   synthetic scene renderer, fixtures, RLS tests, E2E, benchmark
```

Key decisions:

* **Coordinates.** Contours are stored in original image pixels (pixel-centre convention). They're measured by mapping through the homography into the card plane in mm. The rectified raster is used for display only, never for measuring.
* **OpenCV.js** (`@techstark/opencv-js` 4.12, including ArUco) is copied to `public/vendor/opencv.js` at install time and loaded inside a Web Worker. This keeps it out of app bundles and off the main thread. The homography, measurement and validation code is plain TypeScript, so the server can rerun it.
* **Segmentation is swappable.** A trained model (e.g. ONNX Runtime Web) only has to implement `NailSegmenter.segmentAll()` and return image-space contours. No trained model or weights are included in this repository.
* **Precision.** Values are stored as doubles and displayed to 0.1 mm. CSV uses 2 decimals and JSON keeps full precision.

## Supabase setup (optional cloud mode)

1. Create a Supabase project. Apply the migrations in `supabase/migrations/` in filename order, using `supabase db push` or the SQL editor. They create the tables (profiles, customers, calibration_devices, scans, scan_captures, nail_measurements, measurement_revisions, scan_assets), indexes, RLS policies, a private `scan-images` bucket and its storage policies.
2. Copy `.env.example` to `.env.local` and set:
   * `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public; access is enforced by RLS)
   * `SUPABASE_SERVICE_ROLE_KEY`: **server only**. Never prefix it with `NEXT_PUBLIC_` and never import `src/lib/supabase/adminClient.ts` from client code.
3. Enable email/password auth (Authentication → Providers).
4. Restart the app. The header shows "Cloud", and screens other than `/card`, `/settings`, `/validation` and `/login` require sign-in.

Security model:

* Users can **read and delete** only their own rows, and manage their own customers.
* Scans, captures, measurements and revisions are **written only by `POST /api/scans`**. It verifies the bearer token, validates the payload with zod and checks ownership of the scan, customer and image path. It then **recomputes calibration from the raw marker corners and every measurement from the raw contours.** Client-sent dimensions, homographies, "valid" statuses and confidence values for non-model outlines are ignored. A client-side *rejection* (for example blur, which needs the photo) is kept and never upgraded. It writes with the service role.
* A database trigger stops a scan from referencing another user's customer.
* Photo upload is **opt-in** (Settings). Without consent, only measurements, outlines and calibration data are stored.
* Deleting a scan removes its storage objects and cascades to its captures, measurements, revisions and asset rows.

The RLS policies are tested against PGlite with stand-in `auth`/`storage` schemas (`tests/db/rls.test.ts`). The cloud mode itself has **not** been run against a live Supabase project in this repository.

## Deployment (Vercel)

* Framework preset: Next.js. The build command is `npm run build`; `npm install` runs the OpenCV copy step.
* Add the environment variables above, or none for a local-mode deployment.
* `/vendor/opencv.js` (~10 MB) is served as a static asset with long-lived caching.
* Security headers include `Permissions-Policy: camera=(self)`.

## Known limitations

* **Accuracy is unvalidated on real nails.** The engineering targets (median width error ≤ 0.3 mm, length ≤ 0.5 mm, width repeatability ≤ 0.3 mm) are goals, not claims. The synthetic benchmark only bounds the geometric pipeline.
* **Projected dimensions.** Measurements are planar projections. Curved plates have larger true surface width and length.
* **Card height.** The calibration is exact only in the card's plane. Nails above that plane appear larger, by about 4 % per 10 mm of height at 25 cm, so raise the card to nail height.
* **Print scale can't be detected.** A uniformly mis-scaled card print scales every measurement. The printed verification bar must be checked.
* **No trained segmentation model.** Tap-to-outline is a colour-based GrabCut baseline. On synthetic images it shrinks outlines by about 0.14 mm, and on real skin and nail contrast it may leak or fail. Every outline needs review.
* **Finger identity is assigned manually.** Nothing assigns fingers automatically.
* **Uncertainty** covers the calibration contribution only, not boundary placement.
* **Blur rejection is client-side only.** The server cannot repeat image-quality checks without the photo. It keeps a client-side rejection but can't detect a client that hides one.
* **Cloud saves are not transactional.** The API writes several tables sequentially. A failure part-way leaves a partially updated scan until the next save.
* **Browser support.** HEIC decodes only in Safari. In-page camera resolution is limited by the video stream, so the native camera app (file input) usually gives sharper photos. Measure performance on your own target devices.

## License

UNLICENSED: proprietary unless a license is added.
