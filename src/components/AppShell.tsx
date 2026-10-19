"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useRepository } from "./RepositoryProvider";
import { Badge, ButtonLink, Spinner } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/scan/new", label: "New scan" },
  { href: "/history", label: "History" },
  { href: "/customers", label: "Customers" },
  { href: "/settings", label: "Settings" },
];

/** Routes usable without signing in (instructions, printable card, validation tool). */
const PUBLIC_ROUTES = ["/login", "/card", "/settings", "/validation"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { mode, ready, session, signOut } = useRepository();
  const needsAuth = mode === "supabase" && !PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <rect x="2" y="2" width="20" height="20" rx="4" fill="#111418" />
              <path d="M8 17V9.5a4 4 0 0 1 8 0V17" stroke="#fff" strokeWidth="2" fill="none" />
              <path d="M6 19h12" stroke="#fff" strokeWidth="1.5" />
            </svg>
            NailMeasure
          </Link>
          <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded px-2.5 py-1.5 text-sm ${active ? "bg-ink text-white" : "text-muted hover:bg-black/5 hover:text-ink"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {mode === "local" ? (
              <Badge tone="neutral" title="Data is stored only in this browser (IndexedDB). Supabase is not configured.">Local mode · this device only</Badge>
            ) : session ? (
              <>
                <Badge tone="info" title={session.user.email ?? ""}>Cloud · {session.user.email}</Badge>
                <button className="text-muted underline" onClick={() => signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <Badge tone="warn">Cloud · signed out</Badge>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-5 sm:py-8">
        {!ready ? (
          <Spinner />
        ) : needsAuth && !session ? (
          <div className="mx-auto max-w-md rounded-lg border border-line bg-panel p-6 text-center">
            <p className="font-medium">Sign in to access your scans</p>
            <p className="mt-1 text-sm text-muted">Cloud persistence is enabled for this deployment.</p>
            <ButtonLink href="/login" variant="primary" className="mt-4">
              Sign in
            </ButtonLink>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
