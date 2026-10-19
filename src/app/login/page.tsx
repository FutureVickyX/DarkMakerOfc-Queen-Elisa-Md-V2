"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRepository } from "@/components/RepositoryProvider";
import { Button, Card, ErrorBox, PageHeader } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browserClient";

export default function LoginPage() {
  const { mode, session } = useRepository();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (mode === "local") {
    return (
      <div className="max-w-md">
        <PageHeader title="Sign in" />
        <Card>
          <p className="text-sm">Supabase is not configured, so the app runs in local mode without accounts. Your data stays in this browser.</p>
        </Card>
      </div>
    );
  }

  if (session) {
    return (
      <div className="max-w-md">
        <PageHeader title="Signed in" />
        <Card>
          <p className="text-sm">You are signed in as {session.user.email}.</p>
          <Button className="mt-3" variant="primary" onClick={() => router.push("/")}>
            Go to dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = getBrowserSupabase();
    if (!client) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err, data } = isSignUp
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
    else if (isSignUp && !data.session) setInfo("Check your email to confirm your account, then sign in.");
    else router.push("/");
  };

  return (
    <div className="max-w-md">
      <PageHeader title={isSignUp ? "Create account" : "Sign in"} />
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium">Email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2"
            />
          </label>
          {error && <ErrorBox message={error} />}
          {info && <p className="text-sm text-ok" role="status">{info}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </Button>
            <button type="button" className="text-sm underline" onClick={() => setIsSignUp(!isSignUp)}>
              {isSignUp ? "I already have an account" : "Create an account"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
