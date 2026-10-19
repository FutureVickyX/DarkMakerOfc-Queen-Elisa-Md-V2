"use client";

import Link from "next/link";
import { useRepository } from "@/components/RepositoryProvider";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { DEFAULT_THRESHOLDS } from "@/lib/calibration/calibrationEngine";
import { DEFAULT_CARD } from "@/lib/calibration/cardSpec";
import { DEFAULT_QUALITY_THRESHOLDS } from "@/lib/cv/imageQuality";
import { MEASUREMENT_ENGINE_VERSION } from "@/lib/measurement/measurementEngine";
import { DEFAULT_RULES } from "@/lib/measurement/measurementValidator";
import { GRABCUT_INFO } from "@/lib/segmentation/grabCutSegmenter";
import { MODEL_INTEGRATION_NOTE } from "@/lib/segmentation/nailSegmenter";

export default function SettingsPage() {
  const { mode, session, imageUploadConsent, setImageUploadConsent } = useRepository();
  return (
    <div className="space-y-5">
      <PageHeader title="Settings & instructions" />

      <Card title="Storage">
        {mode === "local" ? (
          <div className="space-y-2 text-sm">
            <p>
              <Badge>Local mode</Badge> Scans, photos and customers are stored only in this browser (IndexedDB). Nothing is uploaded. Clearing site data deletes
              them.
            </p>
            <p className="text-muted">To enable accounts and cloud persistence, configure Supabase (see README → “Supabase setup”).</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              <Badge tone="info">Cloud mode</Badge> {session ? `Signed in as ${session.user.email}.` : <Link href="/login" className="underline">Sign in</Link>}
            </p>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={imageUploadConsent} onChange={(e) => setImageUploadConsent(e.target.checked)} />
              <span>
                <strong>Upload capture photos to private cloud storage.</strong> Off by default. When off, only measurements, outlines and calibration data are
                saved; photos stay on this device for the current session, so outlines cannot be edited later from another device.
              </span>
            </label>
          </div>
        )}
      </Card>

      <Card title="Capture instructions">
        <div id="instructions" className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Print the <Link href="/card" className="underline">calibration card</Link> at 100% and verify the {DEFAULT_CARD.verificationBarMm} mm bar.
            </li>
            <li>Remove polish, tips or rings where possible. Clean nails measure more reliably.</li>
            <li>Lay the hand flat and relaxed on a plain, non-reflective surface; spread the fingers.</li>
            <li>
              Place the card right next to the fingertips with the arrow pointing the same way as the fingers. <strong>Raise it to roughly the height of the
              nails</strong> (e.g. on a 1 cm block): the calibration is exact only for the card’s plane, and every centimetre of height difference at 25 cm
              distance changes the scale by about 4%.
            </li>
            <li>Hold the phone directly above the nails (perpendicular), 20–30 cm away. Avoid zoom; tap to focus on the nails.</li>
            <li>Use even, diffuse light. Avoid flash and reflections on the card and nails.</li>
            <li>Photograph the four fingers of one hand per photo; the thumb usually needs its own photo with the thumb nail facing the camera.</li>
          </ol>
          <ButtonLink href="/scan/new" variant="primary">
            Start a scan
          </ButtonLink>
        </div>
      </Card>

      <Card title="Measurement method">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Four ArUco markers with known positions give 16 point correspondences; a perspective transform (homography) maps the photo onto the card plane.</li>
          <li>Width = longest chord perpendicular to the nail axis. Length = chord along the axis through the outline’s area centroid. Area = projected outline area.</li>
          <li>These are <strong>projected planar</strong> dimensions. Curved nail plates have larger true surface dimensions.</li>
          <li>Values are computed in full precision and displayed to 0.1 mm. Measurement engine v{MEASUREMENT_ENGINE_VERSION}.</li>
          <li>Accuracy has not been validated against physically measured nails. See the <Link className="underline" href="/validation">validation tool</Link>.</li>
        </ul>
      </Card>

      <Card title="Nail detection">
        <p className="text-sm">
          <Badge tone="warn">Experimental</Badge> {GRABCUT_INFO.label}: {GRABCUT_INFO.description}
        </p>
        <p className="mt-2 text-sm text-muted">{MODEL_INTEGRATION_NOTE}</p>
      </Card>

      <Card title="Quality thresholds">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-muted">Required markers</dt>
          <dd>{DEFAULT_THRESHOLDS.minMarkers}</dd>
          <dt className="text-muted">Max corner RMS residual</dt>
          <dd>{DEFAULT_THRESHOLDS.maxRmsResidualMm} mm</dd>
          <dt className="text-muted">Max single corner residual</dt>
          <dd>{DEFAULT_THRESHOLDS.maxResidualMm} mm</dd>
          <dt className="text-muted">Min marker size</dt>
          <dd>{DEFAULT_THRESHOLDS.minMarkerSidePx} px</dd>
          <dt className="text-muted">Max perspective scale variation</dt>
          <dd>{((DEFAULT_THRESHOLDS.maxScaleAnisotropy - 1) * 100).toFixed(0)}%</dd>
          <dt className="text-muted">Max marker edge blur</dt>
          <dd>{DEFAULT_QUALITY_THRESHOLDS.maxMarkerEdgeWidthPx} px</dd>
          <dt className="text-muted">Min image long side</dt>
          <dd>{DEFAULT_QUALITY_THRESHOLDS.minLongSidePx} px</dd>
          <dt className="text-muted">Min nail width in image</dt>
          <dd>{DEFAULT_RULES.minWidthPx} px</dd>
        </dl>
      </Card>
    </div>
  );
}
