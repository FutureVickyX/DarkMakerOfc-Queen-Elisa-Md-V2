/**
 * Core domain types shared by the calibration, segmentation, measurement,
 * persistence and presentation layers.
 *
 * Coordinate spaces are kept distinct at the type level:
 *  - ImagePoint: pixel coordinates in the ORIGINAL decoded image (x right, y down,
 *    pixel-centre convention: pixel (0,0) spans [-0.5, 0.5]).
 *  - PlanePoint: millimetres in the calibration-card plane (x right, y down,
 *    origin at the card's top-left corner). Only produced by a calibration.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Length in millimetres in the calibrated plane. */
export type Millimetres = Brand<number, "mm">;
/** Area in square millimetres in the calibrated plane. */
export type SquareMillimetres = Brand<number, "mm2">;
/** Length in image pixels. */
export type Pixels = Brand<number, "px">;

export const mm = (value: number) => value as Millimetres;
export const mm2 = (value: number) => value as SquareMillimetres;
export const px = (value: number) => value as Pixels;

export interface ImagePoint {
  readonly x: number;
  readonly y: number;
  readonly __space?: "image";
}

export interface PlanePoint {
  readonly x: number;
  readonly y: number;
  readonly __space?: "plane";
}

export const imagePoint = (x: number, y: number): ImagePoint => ({ x, y });
export const planePoint = (x: number, y: number): PlanePoint => ({ x, y });

export type Hand = "left" | "right";
export type Finger = "thumb" | "index" | "middle" | "ring" | "little";

export const HANDS: readonly Hand[] = ["left", "right"];
export const FINGERS: readonly Finger[] = ["thumb", "index", "middle", "ring", "little"];

export interface FingerSlot {
  readonly hand: Hand;
  readonly finger: Finger;
}

export const ALL_SLOTS: readonly FingerSlot[] = HANDS.flatMap((hand) =>
  FINGERS.map((finger) => ({ hand, finger })),
);

export const slotKey = (slot: FingerSlot) => `${slot.hand}-${slot.finger}`;

export const slotLabel = (slot: FingerSlot) =>
  `${slot.hand === "left" ? "Left" : "Right"} ${slot.finger === "little" ? "little finger" : slot.finger === "thumb" ? "thumb" : `${slot.finger} finger`}`;

/** Calibration outcome. `manual` means a user-supplied reference length (no perspective correction). */
export type CalibrationStatus = "valid" | "manual" | "rejected" | "not_calibrated";

/** How a nail boundary was produced. */
export type ContourSource = "model" | "heuristic" | "manual";

export type ReviewStatus = "pending" | "confirmed" | "rejected";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
}

export type CaptureMethod = "camera" | "upload";
