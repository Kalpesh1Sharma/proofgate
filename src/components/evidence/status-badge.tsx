import type { DisplayStatus } from "@/lib/evidence/types";

const STATUS_META: Record<
  DisplayStatus,
  { label: string; chip: string; dot: string }
> = {
  PASSED: {
    label: "Passed",
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    dot: "bg-emerald-400",
  },
  FAILED: {
    label: "Failed",
    chip: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    dot: "bg-rose-400",
  },
  "TIMED OUT": {
    label: "Timed out",
    chip: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    dot: "bg-amber-300",
  },
  "NOT RUN": {
    label: "Not run",
    chip: "border-line-strong bg-elevated text-muted",
    dot: "bg-faint",
  },
};

export function StatusBadge({
  status,
  className = "",
}: {
  status: DisplayStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`label-mono inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${meta.chip} ${className}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function statusLabel(status: DisplayStatus): string {
  return STATUS_META[status].label;
}

export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`label-mono inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/[0.08] px-2 py-0.5 text-sky-200 ${className}`}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-sky-300" />
      Demo data
    </span>
  );
}