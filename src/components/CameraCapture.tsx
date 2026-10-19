"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorBox } from "./ui";

type CameraState = "idle" | "starting" | "live" | "error" | "unsupported";

interface ImageCaptureLike {
  takePhoto(settings?: Record<string, unknown>): Promise<Blob>;
}

/**
 * Live rear-camera capture via MediaDevices.getUserMedia. Uses ImageCapture.takePhoto
 * (full sensor resolution) where available, otherwise grabs a video frame.
 * The stream is stopped when the tab is hidden and must be restarted by the user.
 */
export function CameraCapture({ onCapture, onFallback }: { onCapture: (blob: Blob) => void; onFallback: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    if (!window.isSecureContext) {
      setState("error");
      setError("The camera requires a secure (HTTPS) connection.");
      return;
    }
    setState("starting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        setState("error");
        setError("The camera was interrupted. Restart it to continue.");
      });
      const s = track?.getSettings();
      if (s?.width && s?.height) setResolution(`${s.width}×${s.height}`);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState("live");
    } catch (e) {
      stop();
      const name = e instanceof DOMException ? e.name : "";
      setState("error");
      setError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser settings, or upload a photo instead."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No suitable camera was found on this device."
            : name === "NotReadableError"
              ? "The camera is in use by another app."
              : `Could not start the camera${e instanceof Error ? `: ${e.message}` : ""}.`,
      );
    }
  }, [stop]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && streamRef.current) {
        stop();
        setState("idle");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [stop]);

  const capture = async () => {
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) return;
    setBusy(true);
    try {
      let blob: Blob | null = null;
      const track = stream.getVideoTracks()[0];
      const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
      if (IC && track) {
        try {
          blob = await new IC(track).takePhoto();
        } catch {
          blob = null;
        }
      }
      if (!blob) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.95));
      }
      if (!blob) throw new Error("Could not capture a frame.");
      stop();
      setState("idle");
      onCapture(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === "unsupported") {
    return (
      <ErrorBox title="Live camera not supported" message="This browser does not support in-page camera capture. Use the photo option below, which opens your device camera app." />
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "3 / 4", maxHeight: "70vh" }}>
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" aria-label="Camera preview" />
        {state === "live" && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 133" preserveAspectRatio="none" aria-hidden>
            <rect x="8" y="72" width="40" height="26" fill="none" stroke="#fff" strokeDasharray="2 2" strokeWidth="0.5" />
            <text x="28" y="104" fill="#fff" fontSize="3.2" textAnchor="middle">
              card here, arrow → fingertips
            </text>
          </svg>
        )}
        {state !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
            {state === "starting" ? "Starting camera…" : "Camera is off"}
          </div>
        )}
      </div>
      {error && <ErrorBox title="Camera problem" message={error} />}
      <div className="flex flex-wrap items-center gap-2">
        {state === "live" ? (
          <Button variant="primary" onClick={capture} disabled={busy}>
            {busy ? "Capturing…" : "Take photo"}
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={state === "starting"}>
            {state === "error" ? "Retry camera" : "Start camera"}
          </Button>
        )}
        <Button onClick={onFallback}>Use device camera app / upload instead</Button>
        {resolution && <span className="text-xs text-muted">Stream {resolution}</span>}
      </div>
      <p className="text-xs text-muted">
        Tip: the device camera app usually captures at higher resolution than the in-page preview stream.
      </p>
    </div>
  );
}
