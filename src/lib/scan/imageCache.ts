"use client";

/**
 * In-memory cache of capture images for the current tab, so a capture can be
 * reviewed immediately even when photos are not persisted (cloud mode without
 * upload consent). Bounded to a few entries to limit memory.
 */
const cache = new Map<string, Blob>();
const MAX_ENTRIES = 4;

export function cacheImage(captureId: string, blob: Blob) {
  cache.delete(captureId);
  cache.set(captureId, blob);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

export function getCachedImage(captureId: string): Blob | null {
  return cache.get(captureId) ?? null;
}

export function forgetImage(captureId: string) {
  cache.delete(captureId);
}
