import type { RasterImage } from "./raster";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 640;
/** Longest side of the analysis image; larger photos are downscaled once on decode. */
export const MAX_ANALYSIS_SIDE = 4096;

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

/** Checks type and size before decoding (decoding then proves the file is a real image). */
export function validateImageFile(file: { type: string; size: number; name?: string }): void {
  const type = file.type.toLowerCase();
  const byExt = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name ?? "");
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type) && !(type === "" && byExt)) {
    throw new ImageValidationError("Unsupported file type. Use a JPEG, PNG, WebP or HEIC photo.");
  }
  if (file.size <= 0) throw new ImageValidationError("The file is empty.");
  if (file.size > MAX_IMAGE_BYTES) throw new ImageValidationError(`The file is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
}

export interface DecodedImage {
  readonly raster: RasterImage;
  /** Dimensions of the original encoded image (after EXIF orientation). */
  readonly originalWidth: number;
  readonly originalHeight: number;
  /** analysis px / original px (1 when not downscaled). */
  readonly scale: number;
}

/**
 * Decodes a Blob into an RGBA raster, applying EXIF orientation. Works in
 * workers (OffscreenCanvas) and on the main thread (HTMLCanvasElement).
 */
export async function decodeImage(blob: Blob, maxSide = MAX_ANALYSIS_SIDE): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new ImageValidationError("This file could not be decoded as an image in this browser (HEIC is only supported by Safari).");
  }
  const ow = bitmap.width;
  const oh = bitmap.height;
  if (Math.min(ow, oh) < MIN_IMAGE_SIDE) {
    bitmap.close();
    throw new ImageValidationError(`Image is too small (${ow}x${oh}). At least ${MIN_IMAGE_SIDE}px on the short side is required.`);
  }
  const scale = Math.min(1, maxSide / Math.max(ow, oh));
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) {
    bitmap.close();
    throw new ImageValidationError("Canvas is not available to decode the image.");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h);
  return { raster: { width: w, height: h, data: data.data }, originalWidth: ow, originalHeight: oh, scale };
}
