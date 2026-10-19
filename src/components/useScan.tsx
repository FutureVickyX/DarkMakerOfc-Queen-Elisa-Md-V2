"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Scan } from "@/lib/scan/model";
import { useRepository } from "./RepositoryProvider";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Loads a scan and provides optimistic updates persisted through the active
 * repository. In cloud mode the server returns a recomputed scan which replaces
 * local state, so server-side validation always wins.
 */
export function useScan(id: string) {
  const { repo } = useRepository();
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<Scan | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    setError(null);
    try {
      const s = await repo.getScan(id);
      latest.current = s;
      setScan(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repo, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async () => {
    if (!repo || !latest.current) return;
    const mySeq = ++seq.current;
    setSaveState("saving");
    try {
      const saved = await repo.saveScan(latest.current);
      if (mySeq === seq.current) {
        if (repo.mode === "supabase") {
          latest.current = saved;
          setScan(saved);
        }
        setSaveState("saved");
        setSaveError(null);
      }
    } catch (e) {
      if (mySeq === seq.current) {
        setSaveState("error");
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [repo]);

  /** Applies a change immediately and persists it (debounced unless `immediate`). */
  const update = useCallback(
    (fn: (s: Scan) => Scan, immediate = false): Promise<void> | void => {
      if (!latest.current) return;
      const next = fn(latest.current);
      latest.current = next;
      setScan(next);
      if (timer.current) clearTimeout(timer.current);
      if (immediate) return persist();
      timer.current = setTimeout(() => void persist(), repo?.mode === "supabase" ? 800 : 150);
    },
    [persist, repo],
  );

  // Flush pending saves when the page is hidden (tab switch / app suspended).
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void persist();
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      if (timer.current) {
        clearTimeout(timer.current);
        void persist();
      }
    };
  }, [persist]);

  return { scan, loading, error, reload: load, update, saveState, saveError };
}

export function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "saving") return <span className="text-xs text-muted" role="status">Saving…</span>;
  if (state === "saved") return <span className="text-xs text-ok" role="status">Saved</span>;
  if (state === "error") return <span className="text-xs text-bad" role="alert">Not saved: {error}</span>;
  return null;
}
