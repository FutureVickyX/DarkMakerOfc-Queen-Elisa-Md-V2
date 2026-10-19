import { z } from "zod";

/**
 * Server-side input schema for scan sync. Only RAW inputs are accepted:
 * marker corners, manual reference points, contours, axis choices, finger
 * assignments and review decisions. Calibration results, dimensions and
 * validity are recomputed on the server and any client values are ignored.
 */

const coord = z.number().min(-100_000).max(100_000);
const point = z.object({ x: coord, y: coord }).strip();
const issue = z.object({ code: z.string().max(64), severity: z.enum(["error", "warning", "info"]), message: z.string().max(500) }).strip();

const detectedMarker = z.object({ id: z.number().int().min(0).max(1000), corners: z.tuple([point, point, point, point]) }).strip();

const calibrationInput = z
  .object({
    method: z.enum(["card", "manual"]),
    /** Client status is used only to keep a client-side rejection (e.g. blur); never to upgrade. */
    status: z.enum(["valid", "manual", "rejected", "not_calibrated"]),
    layoutId: z.string().max(40).nullable(),
    detectedMarkers: z.array(detectedMarker).max(64),
    manualReference: z.object({ a: point, b: point, lengthMm: z.number().positive().max(1000) }).strip().nullable(),
    issues: z.array(issue).max(50),
  })
  .strip();

const quality = z
  .object({
    meanLuma: z.number().min(0).max(255),
    clippedFraction: z.number().min(0).max(1),
    laplacianVariance: z.number().min(0),
    markerEdgeWidthPx: z.number().min(0).nullable(),
    issues: z.array(issue).max(50),
  })
  .strip();

export const captureSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    captureMethod: z.enum(["camera", "upload"]),
    deviceInfo: z.object({ userAgent: z.string().max(400), platform: z.string().max(80).optional(), screen: z.string().max(40).optional() }).strip(),
    imageAssetId: z.string().max(300).nullable(),
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
    handHint: z.enum(["left", "right", "both"]).nullable(),
    calibration: calibrationInput.nullable(),
    quality: quality.nullable(),
  })
  .strip();

const slot = z.object({ hand: z.enum(["left", "right"]), finger: z.enum(["thumb", "index", "middle", "ring", "little"]) }).strip();

export const nailSchema = z
  .object({
    id: z.uuid(),
    captureId: z.uuid(),
    slot: slot.nullable(),
    contour: z.array(point).min(4).max(500),
    contourSource: z.enum(["model", "heuristic", "manual"]),
    manuallyEdited: z.boolean(),
    axis: z.object({ source: z.enum(["card", "manual", "pca"]), angleDeg: z.number().min(-180).max(180).optional() }).strip(),
    detection: z
      .object({
        segmenterId: z.string().max(64),
        segmenterVersion: z.string().max(32),
        status: z.enum(["detected", "uncertain", "failed"]),
        confidence: z.number().min(0).max(1).nullable(),
        diagnostics: z.record(z.string().max(40), z.number().nullable()),
        issues: z.array(issue).max(20),
      })
      .strip()
      .nullable(),
    reviewStatus: z.enum(["pending", "confirmed", "rejected"]),
    createdAt: z.iso.datetime(),
  })
  .strip();

export const scanPayloadSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    customerId: z.uuid().nullable(),
    notes: z.string().max(2000),
    createdAt: z.iso.datetime(),
    captures: z.array(captureSchema).max(20),
    nails: z.array(nailSchema).max(100),
  })
  .strip()
  .superRefine((scan, ctx) => {
    const captureIds = new Set(scan.captures.map((c) => c.id));
    scan.nails.forEach((n, i) => {
      if (!captureIds.has(n.captureId)) ctx.addIssue({ code: "custom", path: ["nails", i, "captureId"], message: "Unknown capture" });
    });
  });

export type ScanPayload = z.infer<typeof scanPayloadSchema>;
