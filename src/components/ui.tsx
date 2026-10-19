"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ValidationIssue } from "@/lib/core/types";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variantClass: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black disabled:bg-muted",
  secondary: "bg-white text-ink border border-line hover:border-ink disabled:text-muted",
  danger: "bg-white text-bad border border-bad/40 hover:bg-bad hover:text-white",
  ghost: "text-ink hover:bg-black/5",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
    />
  );
}

export function ButtonLink({ href, variant = "secondary", children, className = "" }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${variantClass[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "ok" | "warn" | "bad" | "manual" | "neutral" | "info";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  bad: "bg-bad/10 text-bad border-bad/30",
  manual: "bg-manual/10 text-manual border-manual/30",
  neutral: "bg-black/5 text-muted border-line",
  info: "bg-accent/10 text-accent border-accent/30",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function IssueList({ issues, hideInfo = false }: { issues: readonly ValidationIssue[]; hideInfo?: boolean }) {
  const shown = hideInfo ? issues.filter((i) => i.severity !== "info") : issues;
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm" aria-label="Issues">
      {shown.map((i, idx) => (
        <li key={`${i.code}-${idx}`} className="flex gap-2">
          <span aria-hidden className={i.severity === "error" ? "text-bad" : i.severity === "warning" ? "text-warn" : "text-accent"}>
            {i.severity === "error" ? "✕" : i.severity === "warning" ? "!" : "i"}
          </span>
          <span>
            <span className="sr-only">{i.severity}: </span>
            {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ title = "Something went wrong", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-4 text-sm">
      <p className="font-semibold text-bad">{title}</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <Button className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
