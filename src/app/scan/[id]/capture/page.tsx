"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { CaptureGuidance, GuidanceIllustration, emptyChecklist, type ChecklistState } from "@/components/CaptureGuidance";
import { useRepository } from "@/components/RepositoryProvider";
import { useScan } from "@/components/useScan";
import { Button, Card, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { DEFAULT_CARD } from "@/lib/calibration/cardSpec";
import type { CaptureMethod, Hand } from "@/lib/core/types";
import { getCvClient } from "@/lib/cv/cvClient";
import { ImageValidationError, validateImageFile } from "@/lib/cv/imageLoader";
import { cacheImage } from "@/lib/scan/imageCache";
import { newId, type Capture } from "@/lib/scan/model";

export default function CapturePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { repo, mode, imageUploadConsent } = useRepository();
  const { scan, loading, error, update } = useScan(id);
  const [checklist, setChecklist] = useState<ChecklistState>(emptyChecklist());
  const [method, setMethod] = useState<CaptureMethod | null>(null);
  const [handHint, setHandHint] = useState<Hand | "both" | "">("");
  const [stage, setStage] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const allChecked = Object.values(checklist).every(Boolean);

  const process = async (blob: Blob, captureMethod: CaptureMethod) => {
    if (!repo || !scan) return;
    setProcessError(null);
    try {
      validateImageFile({ type: blob.type, size: blob.size, name: (blob as File).name });
      const captureId = newId();
      const cv = getCvClient();
      setStage("Decoding image");
      const loaded = await cv.load(captureId, blob, setStage);
      const analysis = await cv.analyze(captureId, DEFAULT_CARD.layoutId, setStage);
      setStage("Saving");
      cacheImage(captureId, blob);
      const assetId = await repo.putImage(scan.id, captureId, blob);
      const capture: Capture = {
        id: captureId,
        createdAt: new Date().toISOString(),
        captureMethod,
        deviceInfo: {
          userAgent: navigator.userAgent.slice(0, 400),
          platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.slice(0, 80),
          screen: `${window.screen.width}x${window.screen.height}`,
        },
        imageAssetId: assetId,
        width: loaded.width,
        height: loaded.height,
        handHint: handHint || null,
        calibration: analysis.calibration,
        quality: {
          meanLuma: analysis.quality.meanLuma,
          clippedFraction: analysis.quality.clippedFraction,
          laplacianVariance: analysis.quality.laplacianVariance,
          markerEdgeWidthPx: analysis.quality.markerEdgeWidthPx,
          issues: analysis.quality.issues,
        },
      };
      await update((s) => ({ ...s, captures: [...s.captures, capture], updatedAt: new Date().toISOString() }), true);
      router.push(`/scan/${scan.id}/capture/${captureId}`);
    } catch (e) {
      setStage(null);
      setProcessError(e instanceof ImageValidationError ? e.message : `Processing failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!scan) return <ErrorBox title="Scan not found" message="This scan does not exist or you do not have access to it." />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Add a photo"
        subtitle={
          <>
            <Link className="underline" href={`/scan/${scan.id}`}>
              {scan.name}
            </Link>{" "}
            · photo {scan.captures.length + 1}. Photograph one hand per photo (thumbs can be a separate photo).
          </>
        }
      />

      {stage ? (
        <Card>
          <Spinner label={`${stage}…`} />
          <p className="mt-2 text-xs text-muted">Image processing runs on this device.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Capture guidance">
              <GuidanceIllustration />
              <div className="mt-4">
                <CaptureGuidance value={checklist} onChange={setChecklist} />
              </div>
            </Card>
            <Card title="Photo">
              <label className="block text-sm">
                <span className="font-medium">Which hand is in this photo?</span>
                <select value={handHint} onChange={(e) => setHandHint(e.target.value as Hand | "both" | "")} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2">
                  <option value="">Not specified</option>
                  <option value="left">Left hand</option>
                  <option value="right">Right hand</option>
                  <option value="both">Both hands</option>
                </select>
              </label>
              {mode === "supabase" && (
                <p className="mt-3 rounded bg-black/5 p-2 text-xs text-muted">
                  Photo upload to private cloud storage is <strong>{imageUploadConsent ? "on" : "off"}</strong>.{" "}
                  {imageUploadConsent ? "The photo will be stored privately with this scan." : "Only measurements will be saved; the photo stays on this device for this session."}{" "}
                  <Link href="/settings" className="underline">
                    Change
                  </Link>
                </p>
              )}
              {!allChecked && <p className="mt-3 text-sm text-warn">Tick every item in the checklist to continue.</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" disabled={!allChecked} onClick={() => setMethod("camera")}>
                  Use live camera
                </Button>
                <Button disabled={!allChecked} onClick={() => fileRef.current?.click()}>
                  Take or upload a photo
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="sr-only"
                  aria-label="Choose a photo"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void process(f, "upload");
                  }}
                />
              </div>
            </Card>
          </div>
          {method === "camera" && allChecked && (
            <Card title="Live camera">
              <CameraCapture onCapture={(b) => void process(b, "camera")} onFallback={() => fileRef.current?.click()} />
            </Card>
          )}
        </>
      )}
      {processError && <ErrorBox title="Could not use this photo" message={processError} />}
    </div>
  );
}
