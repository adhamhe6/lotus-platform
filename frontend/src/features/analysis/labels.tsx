import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { AnalysisType } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { pLabel } from "@/components/results/format";
import { fmtNumber, titleCase } from "@/lib/format";

export const typeLabel = (types: AnalysisType[] | undefined, type: string) => types?.find((t) => t.type === type)?.label ?? titleCase(type);

const STATUS = {
  COMPLETED: { label: "Completed", variant: "success", Icon: CheckCircle2 },
  FAILED: { label: "Failed", variant: "destructive", Icon: AlertCircle },
  RUNNING: { label: "Running", variant: "primary", Icon: Loader2 },
  PENDING: { label: "Queued", variant: "default", Icon: Clock },
} as const;

/** Status as icon + word (never colour alone). */
export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? { label: titleCase(status.toLowerCase()), variant: "default" as const, Icon: Clock };
  return <Badge variant={s.variant}><s.Icon className={`size-3 ${status === "RUNNING" ? "animate-spin" : ""}`} aria-hidden />{s.label}</Badge>;
}

export function headlineText(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const h = raw as unknown as AnalysisHeadline;
  return [`${h.label} ${fmtNumber(h.value)}`, h.p_value != null ? pLabel(h.p_value) : null, h.n != null ? `n = ${fmtNumber(h.n)}` : null].filter(Boolean).join(" · ");
}
export interface AnalysisHeadline { label: string; value: unknown; p_value?: number | null; n?: number | null }

/** Deep link into the builder. `vars` is a comma list that the builder spreads across the analysis' roles in order. */
export function builderLink(pid: string, o: { type?: string; version?: string; config?: Record<string, unknown> }): string {
  const q = new URLSearchParams();
  if (o.type) q.set("type", o.type);
  if (o.version) q.set("version", o.version);
  if (o.config && Object.keys(o.config).length) q.set("config", JSON.stringify(o.config));
  const s = q.toString();
  return `/projects/${pid}/analysis/new${s ? `?${s}` : ""}`;
}
