"use client";

import type { ImagePoint } from "@/lib/core/types";
import type { Matrix3 } from "@/lib/geometry/homography";
import type { NailDetection } from "@/lib/segmentation/nailSegmenter";
import type { WorkerRequest, WorkerResponse } from "@/workers/protocol";
import type { CaptureAnalysis } from "./captureAnalysis";
import { decodeImage } from "./imageLoader";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (stage: string) => void };

/**
 * Main-thread facade for the CV worker. All heavy image work happens in the
 * worker; if the worker crashes (e.g. tab suspended, out of memory) it is
 * recreated on the next call and the image must be reloaded.
 */
class CvClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private loadedKey: string | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === "undefined") throw new Error("Web Workers are not supported in this browser.");
    const worker = new Worker(new URL("../../workers/cv.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") {
        p.onProgress?.(msg.stage);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || "Image-processing worker failed");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      worker.terminate();
      this.worker = null;
      this.loadedKey = null;
    };
    this.worker = worker;
    return worker;
  }

  private call(req: DistributiveOmit<WorkerRequest, "id">, onProgress?: (s: string) => void, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  warmup() {
    return this.call({ type: "warmup" }).then(() => undefined);
  }

  /** Loads (decodes) an image into the worker. Falls back to main-thread decoding without OffscreenCanvas. */
  async load(imageKey: string, blob: Blob, onProgress?: (s: string) => void) {
    let res: WorkerResponse;
    const workerCanDecode = typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
    if (workerCanDecode) {
      res = await this.call({ type: "load", imageKey, blob }, onProgress);
    } else {
      onProgress?.("Decoding image");
      const decoded = await decodeImage(blob);
      res = await this.call({ type: "load", imageKey, raster: decoded.raster }, onProgress, [decoded.raster.data.buffer]);
    }
    if (res.type !== "loaded") throw new Error("Unexpected worker response");
    this.loadedKey = imageKey;
    return res;
  }

  isLoaded(imageKey: string) {
    return this.loadedKey === imageKey && this.worker !== null;
  }

  async analyze(imageKey: string, layoutId: string, onProgress?: (s: string) => void): Promise<CaptureAnalysis> {
    const res = await this.call({ type: "analyze", imageKey, layoutId }, onProgress);
    if (res.type !== "analysis") throw new Error("Unexpected worker response");
    return res.analysis;
  }

  async segment(imageKey: string, seed: ImagePoint, imageToPlane: Matrix3 | null, planeToImage: Matrix3 | null): Promise<NailDetection> {
    const res = await this.call({ type: "segment", imageKey, seed, imageToPlane, planeToImage });
    if (res.type !== "segmentation") throw new Error("Unexpected worker response");
    return res.detection;
  }
}

let instance: CvClient | null = null;
export function getCvClient(): CvClient {
  if (!instance) instance = new CvClient();
  return instance;
}
