import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { AnalysisDetail } from "@/api/types";
import { fmtDuration } from "@/components/results/format";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtNumber } from "@/lib/format";

/** Everything needed to reproduce the number: exact data version, configuration, engine and seed. */
export function ReproPanel({ analysis, creator }: { analysis: AnalysisDetail; creator?: string }) {
  const p = analysis.provenance as Record<string, unknown>;
  const libs = (p.libraries ?? {}) as Record<string, string>;
  const config = JSON.stringify(analysis.config, null, 2);
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(config); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[11rem_1fr] sm:gap-4"><dt className="text-[13px] text-muted-foreground">{k}</dt><dd className="min-w-0 break-words text-sm">{v}</dd></div>
  );
  return (
    <div className="space-y-4">
      <dl className="divide-y rounded-lg border bg-card px-4">
        {row("Dataset version", <>{analysis.dataset_name ?? "—"}{analysis.version_number != null && ` · v${analysis.version_number}`}{analysis.version_label && <span className="text-muted-foreground"> — {analysis.version_label}</span>}</>)}
        {row("Dataset content hash", <code className="break-all font-mono text-xs">{String(p.dataset_content_hash ?? "—")}</code>)}
        {p.rows_in_version != null && row("Rows in version", <span className="tabular">{fmtNumber(p.rows_in_version)}</span>)}
        {row("Engine version", String(libs.engine ?? "—"))}
        {row("Libraries", Object.entries(libs).filter(([k]) => k !== "engine").map(([k, v]) => `${k} ${v}`).join(" · ") || "—")}
        {row("Random seed", <span className="tabular">{p.seed != null ? String(p.seed) : "—"}</span>)}
        {row("Deterministic", p.deterministic === true ? "Yes — the same data and configuration always give the same result" : p.deterministic === false ? "No" : "—")}
        {row("Compute time", <span className="tabular">{fmtDuration((p.compute_ms as number | undefined) ?? analysis.duration_ms)}</span>)}
        {row("Created", `${fmtDate(analysis.created_at, true)}${creator ? ` by ${creator}` : ""}`)}
      </dl>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Configuration</h3>
          <Button variant="ghost" size="xs" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
        </div>
        <pre className="scroll-thin overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label="Configuration as JSON">{config}</pre>
      </div>
    </div>
  );
}
