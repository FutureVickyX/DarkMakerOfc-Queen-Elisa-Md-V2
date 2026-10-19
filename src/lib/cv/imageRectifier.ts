import type { PlanePoint } from "@/lib/core/types";
import { multiply, type Matrix3 } from "@/lib/geometry/homography";
import type { CV } from "./opencv";
import type { RasterImage } from "./raster";

export interface RectifiedImage {
  readonly image: RasterImage;
  /** Output pixels per millimetre. */
  readonly pxPerMm: number;
  /** Plane point (mm) at output pixel (0,0). */
  readonly originMm: PlanePoint;
  /** Output pixel -> plane mm. */
  readonly outputToPlane: Matrix3;
}

/**
 * Warps the original image into the calibrated card plane: each output pixel is
 * exactly 1/pxPerMm millimetres. Used for previews and plane-space analysis;
 * measurements are computed by mapping contours, not by measuring this raster.
 */
export function rectifyImage(
  cv: CV,
  image: RasterImage,
  planeToImage: Matrix3,
  region: { minX: number; minY: number; maxX: number; maxY: number },
  pxPerMm: number,
  maxOutputSide = 2400,
): RectifiedImage {
  let scale = pxPerMm;
  const wMm = region.maxX - region.minX;
  const hMm = region.maxY - region.minY;
  if (Math.max(wMm, hMm) * scale > maxOutputSide) scale = maxOutputSide / Math.max(wMm, hMm);
  const outW = Math.max(1, Math.round(wMm * scale));
  const outH = Math.max(1, Math.round(hMm * scale));

  // output px -> plane mm -> image px
  const outputToPlane: Matrix3 = [1 / scale, 0, region.minX, 0, 1 / scale, region.minY, 0, 0, 1];
  const outputToImage = multiply(planeToImage, outputToPlane);

  const src = cv.matFromImageData(image);
  const dst = new cv.Mat();
  const m = cv.matFromArray(3, 3, cv.CV_64F, Array.from(outputToImage));
  try {
    // WARP_INVERSE_MAP: m maps destination -> source.
    cv.warpPerspective(src, dst, m, new cv.Size(outW, outH), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(40, 40, 40, 255));
    const data = new Uint8ClampedArray(dst.data);
    return {
      image: { width: outW, height: outH, data },
      pxPerMm: scale,
      originMm: { x: region.minX, y: region.minY },
      outputToPlane,
    };
  } finally {
    src.delete();
    dst.delete();
    m.delete();
  }
}
