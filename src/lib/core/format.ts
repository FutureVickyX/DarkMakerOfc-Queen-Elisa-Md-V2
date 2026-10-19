/**
 * Display formatting. Internal values keep full floating-point precision; the
 * UI and reports round only at presentation time. One decimal place is the
 * default because sub-0.1 mm digits are not supported by validated accuracy.
 */
export const DISPLAY_DECIMALS = 1;

export function formatMm(value: number | null | undefined, decimals = DISPLAY_DECIMALS): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)} mm`;
}

export function formatMm2(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)} mm²`;
}

export function formatNumber(value: number | null | undefined, decimals = DISPLAY_DECIMALS): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(decimals);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
