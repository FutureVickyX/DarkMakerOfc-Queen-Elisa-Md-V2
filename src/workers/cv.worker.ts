/// <reference lib="webworker" />
/**
 * Computer-vision worker: decodes images, detects calibration markers, runs
 * quality checks and segmentation off the main thread. OpenCV.js is loaded
 * from /vendor/opencv.js (copied at install time) on first use.
 */
import { getCardSpec } from "@/lib/calibration/cardSpec";
import { analyzeCapture } from "@/lib/cv/captureAnalysis";
import { decodeImage } from "@/lib/cv/imageLoader";
import { resolveCvModule, type CV } from "@/lib/cv/opencv";
import type { RasterImage } from "@/lib/cv/raster";
import { createGrabCutSegmenter } from "@/lib/segmentation/grabCutSegmenter";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope & { cv?: CV };

let cvPromise: Promise<CV> | null = null;
const images = new Map<string, RasterImage>();

function loadCv(): Promise<CV> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const url = "/vendor/opencv.js";
      if (typeof (self as unknown as { importScripts?: unknown }).importScripts === "function") {
        try {
          self.importScripts(url);
        } catch {
          await evalScript(url);
        }
      } else {
        await evalScript(url);
      }
      return resolveCvModule(self.cv);
    })();
    cvPromise.catch(() => {
      cvPromise = null;
    });
  }
  return cvPromise;
}

async function evalScript(url: string) {
  // Module workers cannot importScripts; evaluate the UMD bundle in global scope instead.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load OpenCV.js (${res.status}). Run npm install to copy it to public/vendor.`);
  const code = await res.text();
  (0, eval)(code);
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    switch (req.type) {
      case "warmup": {
        await loadCv();
        post({ id: req.id, type: "ready" });
        return;
      }
      case "load": {
        post({ id: req.id, type: "progress", stage: "Decoding image" });
        const decoded = req.raster
          ? { raster: req.raster, originalWidth: req.raster.width, originalHeight: req.raster.height, scale: 1 }
          : await decodeImage(req.blob!);
        images.clear(); // keep memory bounded: one working image at a time
        images.set(req.imageKey, decoded.raster);
        post({ id: req.id, type: "loaded", width: decoded.raster.width, height: decoded.raster.height, scale: decoded.scale, originalWidth: decoded.originalWidth, originalHeight: decoded.originalHeight });
        return;
      }
      case "analyze": {
        const img = images.get(req.imageKey);
        if (!img) throw new Error("Image is not loaded in the worker");
        post({ id: req.id, type: "progress", stage: "Loading computer-vision runtime" });
        const cv = await loadCv();
        post({ id: req.id, type: "progress", stage: "Detecting calibration markers" });
        const analysis = analyzeCapture(cv, img, getCardSpec(req.layoutId));
        post({ id: req.id, type: "analysis", analysis });
        return;
      }
      case "segment": {
        const img = images.get(req.imageKey);
        if (!img) throw new Error("Image is not loaded in the worker");
        const cv = await loadCv();
        const segmenter = createGrabCutSegmenter(cv);
        const detection = await segmenter.segmentAtSeed!({ image: img, imageToPlane: req.imageToPlane, planeToImage: req.planeToImage }, req.seed);
        post({ id: req.id, type: "segmentation", detection });
        return;
      }
      case "release": {
        images.delete(req.imageKey);
        post({ id: req.id, type: "released" });
        return;
      }
    }
  } catch (e) {
    post({ id: req.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
