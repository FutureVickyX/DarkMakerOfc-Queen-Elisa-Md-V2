/** Minimal ImageData-compatible raster used across the CV pipeline (RGBA, 8-bit). */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function createRaster(width: number, height: number, fill: [number, number, number] = [255, 255, 255]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** ITU-R BT.601 luma, returned as a Float32Array of length width*height. */
export function toGray(img: RasterImage): Float32Array {
  const out = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = 0.299 * d[j]! + 0.587 * d[j + 1]! + 0.114 * d[j + 2]!;
  }
  return out;
}

/** Box-filter downscale by an integer factor (used for cheap quality analysis). */
export function downscaleGray(gray: Float32Array, width: number, height: number, factor: number) {
  if (factor <= 1) return { gray, width, height };
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Float32Array(w * h);
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * width + x * factor;
        for (let dx = 0; dx < factor; dx++) s += gray[row + dx]!;
      }
      out[y * w + x] = s / area;
    }
  }
  return { gray: out, width: w, height: h };
}
