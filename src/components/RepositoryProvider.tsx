"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LocalScanRepository } from "@/lib/persistence/localRepository";
import type { ScanRepository, StorageMode } from "@/lib/persistence/scanRepository";
import { SupabaseScanRepository } from "@/lib/persistence/supabaseRepository";
import { getBrowserSupabase } from "@/lib/supabase/browserClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const CONSENT_KEY = "nailmeasure.cloudImageConsent";

interface RepositoryContextValue {
  mode: StorageMode;
  /** Null while initialising or when signed out in cloud mode. */
  repo: ScanRepository | null;
  ready: boolean;
  session: Session | null;
  imageUploadConsent: boolean;
  setImageUploadConsent: (v: boolean) => void;
  signOut: () => Promise<void>;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

function readConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const mode: StorageMode = isSupabaseConfigured() ? "supabase" : "local";
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    if (mode === "local") {
      setReady(true);
      return;
    }
    const client = getBrowserSupabase()!;
    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [mode]);

  const repo = useMemo<ScanRepository | null>(() => {
    if (!ready) return null;
    if (mode === "local") return new LocalScanRepository();
    const client = getBrowserSupabase();
    return client && session ? new SupabaseScanRepository(client, consent) : null;
  }, [ready, mode, session, consent]);

  const setImageUploadConsent = useCallback((v: boolean) => {
    setConsent(v);
    try {
      window.localStorage.setItem(CONSENT_KEY, v ? "yes" : "no");
    } catch {
      /* storage unavailable: consent lasts for this session only */
    }
  }, []);

  const signOut = useCallback(async () => {
    await getBrowserSupabase()?.auth.signOut();
  }, []);

  return (
    <RepositoryContext.Provider value={{ mode, repo, ready, session, imageUploadConsent: consent, setImageUploadConsent, signOut }}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): RepositoryContextValue {
  const ctx = useContext(RepositoryContext);
  if (!ctx) throw new Error("useRepository must be used inside RepositoryProvider");
  return ctx;
}
