import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useProject } from "@/api/hooks";
import type { Dataset } from "@/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { fmtPct, SEMANTIC_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canEditRole, type HistogramData, type IngestWarning, type TopValue } from "./model";

/** Project role → write permission. Unknown (still loading) counts as read-only so write controls never flash. */
export function useCanEdit(projectId: string) {
  const { data } = useProject(projectId);
  return { role: data?.role, canEdit: canEditRole(data?.role) };
}

export function StatusChip({ status }: { status: Dataset["status"] }) {
  if (status === "READY") return <Badge variant="success"><CheckCircle2 className="size-3" aria-hidden />Ready</Badge>;
  if (status === "FAILED") return <Badge variant="destructive"><XCircle className="size-3" aria-hidden />Failed</Badge>;
  return <Badge variant="primary"><Loader2 className="size-3 animate-spin" aria-hidden />Processing</Badge>;
}

export function TypeBadge({ type }: { type: string }) {
  return <Badge variant="outline">{SEMANTIC_LABEL[type] ?? type}</Badge>;
}

/** Notes recorded while reading the file (renamed columns, encoding fallback, mixed types…). */
export function IngestWarnings({ warnings, className }: { warnings: IngestWarning[]; className?: string }) {
  if (!warnings.length) return null;
  return (
    <Alert variant="warning" title={`Import notes (${warnings.length})`} className={className}>
      <ul className="list-disc space-y-0.5 pl-4">
        {warnings.map((w, i) => (
          <li key={`${w.code ?? "w"}-${i}`}>{w.message}{w.column && !w.message.includes(w.column) ? <span className="text-muted-foreground"> ({w.column})</span> : null}</li>
        ))}
      </ul>
    </Alert>
  );
}

export function QualityBadge({ count }: { count: number }) {
  return count > 0
    ? <Badge variant="warning"><AlertTriangle className="size-3" aria-hidden />{count} {count === 1 ? "warning" : "warnings"}</Badge>
    : <Badge variant="success"><CheckCircle2 className="size-3" aria-hidden />No warnings</Badge>;
}

/** Tiny distribution glyph: histogram bars for numeric columns, top-value bars for categories. Heights are display scaling only. */
export function MiniDistribution({ profile, className }: { profile: Record<string, unknown>; className?: string }) {
  const hist = profile.histogram as HistogramData | undefined;
  const top = profile.top_values as TopValue[] | undefined;
  const counts = hist?.counts?.length ? hist.counts : top?.length ? top.map((t) => t.count) : [];
  if (!counts.length) return <span className={cn("text-xs text-muted-foreground", className)} aria-hidden>—</span>;
  const max = Math.max(...counts, 1);
  return (
    <div className={cn("flex h-7 w-24 items-end gap-px", className)} aria-hidden>
      {counts.map((c, i) => <span key={i} className="min-w-px flex-1 rounded-t-[1px] bg-primary/70" style={{ height: `${Math.max(6, (c / max) * 100)}%` }} />)}
    </div>
  );
}

export function MissingBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn("h-full rounded-full", pct >= 20 ? "bg-warning" : "bg-primary/60")} style={{ width: `${pct > 0 ? Math.max(3, Math.min(100, pct)) : 0}%` }} /></div>
      <span className="tabular w-12 text-xs text-muted-foreground">{pct > 0 ? fmtPct(pct) : "none"}</span>
    </div>
  );
}
