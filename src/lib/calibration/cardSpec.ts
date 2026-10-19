import type { PlanePoint } from "@/lib/core/types";

/**
 * Physical calibration card definition.
 *
 * NM-CARD-1 is a credit-card sized (85.6 x 54.0 mm) card carrying four ArUco
 * markers from the standard DICT_4X4_50 dictionary (IDs 0-3), one near each
 * corner. Every marker corner has a known position in millimetres, giving 16
 * point correspondences for the homography and a meaningful residual.
 *
 * Card frame: origin at the card's top-left corner, x to the right, y down.
 * The printed arrow points toward the top edge (-y); users are asked to place
 * the card so the arrow points the same way as their fingertips.
 */

export type ArucoDictionary = "DICT_4X4_50";

export interface MarkerPlacement {
  readonly id: number;
  /** Top-left corner of the marker's outer black border, in card mm. */
  readonly originMm: PlanePoint;
}

export interface CalibrationCardSpec {
  readonly layoutId: string;
  readonly version: number;
  readonly name: string;
  readonly dictionary: ArucoDictionary;
  readonly cardWidthMm: number;
  readonly cardHeightMm: number;
  /** Side length of each marker including its black border. */
  readonly markerSizeMm: number;
  readonly markers: readonly MarkerPlacement[];
  /** Unit vector in card mm pointing toward the fingertips (distal direction). */
  readonly distalDirection: PlanePoint;
  /** Length of the printed verification bar, measured with a ruler after printing. */
  readonly verificationBarMm: number;
  /** Maximum allowed deviation of the printed verification bar. */
  readonly printToleranceMm: number;
}

export const NM_CARD_1: CalibrationCardSpec = {
  layoutId: "NM-CARD-1",
  version: 1,
  name: "NailMeasure calibration card v1",
  dictionary: "DICT_4X4_50",
  cardWidthMm: 85.6,
  cardHeightMm: 54,
  markerSizeMm: 15,
  markers: [
    { id: 0, originMm: { x: 4, y: 4 } },
    { id: 1, originMm: { x: 66.6, y: 4 } },
    { id: 2, originMm: { x: 66.6, y: 35 } },
    { id: 3, originMm: { x: 4, y: 35 } },
  ],
  distalDirection: { x: 0, y: -1 },
  verificationBarMm: 50,
  printToleranceMm: 0.3,
};

export const CARD_SPECS: Readonly<Record<string, CalibrationCardSpec>> = {
  [NM_CARD_1.layoutId]: NM_CARD_1,
};

export const DEFAULT_CARD = NM_CARD_1;

export function getCardSpec(layoutId: string): CalibrationCardSpec {
  const spec = CARD_SPECS[layoutId];
  if (!spec) throw new Error(`Unknown calibration card layout: ${layoutId}`);
  return spec;
}

/**
 * Known corner positions for a marker, in the order OpenCV's ArUco detector
 * reports them: top-left, top-right, bottom-right, bottom-left (in the marker's
 * own upright orientation, which matches the card frame when printed upright).
 */
export function markerCornersMm(spec: CalibrationCardSpec, id: number): readonly PlanePoint[] {
  const placement = spec.markers.find((m) => m.id === id);
  if (!placement) throw new Error(`Marker ${id} is not part of ${spec.layoutId}`);
  const { x, y } = placement.originMm;
  const s = spec.markerSizeMm;
  return [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
}

/**
 * ArUco DICT_4X4_50 bit patterns for IDs 0-3 including the one-cell black border
 * (6x6 cells, row-major, 1 = white). Verified against OpenCV's generateImageMarker
 * in the test suite so the printable card cannot silently drift from the detector.
 */
export const DICT_4X4_50_PATTERNS: Readonly<Record<number, readonly string[]>> = {
  0: ["000000", "010110", "001010", "000110", "000100", "000000"],
  1: ["000000", "000000", "011110", "010010", "010100", "000000"],
  2: ["000000", "000110", "000110", "000100", "011010", "000000"],
  3: ["000000", "010010", "010010", "001000", "001100", "000000"],
};
