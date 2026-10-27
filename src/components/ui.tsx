import type { ReactNode } from "react";

import type { Severity } from "@/lib/engine/types";

export const SEVERITY_META: Record<
  Severity,
  { label: string; dot: string; chip: string; text: string }
> = {
  high: {
    label: "High",
    dot: "bg-rose-400",
    chip: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    text: "text-rose-200",
  },
  medium: {
    label: "Medium",
    dot: "bg-amber-300",
    chip: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    text: "text-amber-200",
  },
  low: {
    label: "Low",
    dot: "bg-sky-300",
    chip: "border-sky-300/25 bg-sky-300/10 text-sky-200",
    text: "text-sky-200",
  },
};

export function HeuristicBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`label-mono inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-300/40 bg-amber-300/[0.06] px-2 py-0.5 text-amber-200/90 ${className}`}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-amber-300" />
      Heuristic
    </span>
  );
}

export function SeverityBadge({
  severity,
  className = "",
}: {
  severity: Severity;
  className?: string;
}) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className={`label-mono inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${meta.chip} ${className}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-elevated/70 px-3 py-2.5">
      <div className="label-mono">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-faint">{hint}</div> : null}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="label-mono mb-2">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-elevated text-faint">
        {icon}
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warning" | "info" | "success" | "danger";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-line bg-elevated/60 text-muted",
    warning: "border-amber-300/25 bg-amber-300/[0.05] text-amber-100/90",
    info: "border-sky-300/20 bg-sky-300/[0.05] text-sky-100/90",
    success: "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100/90",
    danger: "border-rose-400/30 bg-rose-500/[0.07] text-rose-100/90",
  } as const;

  return (
    <div className={`rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${tones[tone]}`}>
      {title ? <div className="mb-1 font-semibold tracking-tight">{title}</div> : null}
      {children}
    </div>
  );
}
