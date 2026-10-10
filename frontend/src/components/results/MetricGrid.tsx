import type { Metric } from "@/api/types";
import { Provenance } from "@/components/common/Provenance";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtMetric } from "./format";

/** Primary metric(s) emphasised with their confidence interval; supporting metrics in a compact grid. All values are server-computed. */
export function MetricGrid({ metrics, className, showProvenance = true }: { metrics: Metric[]; className?: string; showProvenance?: boolean }) {
  if (!metrics.length) return null;
  const primary = metrics.filter((m) => m.primary);
  const rest = metrics.filter((m) => !m.primary);
  return (
    <div className={cn("space-y-3", className)}>
      {showProvenance && <div className="flex items-center gap-2"><Provenance kind="computed" /><span className="text-xs text-muted-foreground">Calculated from your data by the statistics engine.</span></div>}
      {primary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {primary.map((m) => (
            <div key={m.key} data-testid="primary-metric" className="petal border bg-card p-5 shadow-xs sm:col-span-2 lg:col-span-1">
              <dl>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.label}</dt>
                <dd className="tabular mt-1.5 font-display text-4xl font-semibold leading-none">{fmtMetric(m)}</dd>
                {m.ci && (
                  <dd className="tabular mt-2 text-sm text-muted-foreground">
                    Confidence interval <span className="font-medium text-foreground">[{fmtNumber(m.ci[0])}, {fmtNumber(m.ci[1])}]</span>
                  </dd>
                )}
                {m.note && <dd className="mt-2 inline-flex rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">{m.note}</dd>}
              </dl>
            </div>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <dl className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {rest.map((m) => (
            <div key={m.key} className="rounded-lg border bg-card px-3.5 py-3">
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="tabular mt-1 text-lg font-semibold leading-tight">{fmtMetric(m)}</dd>
              {m.ci && <dd className="tabular text-xs text-muted-foreground">Confidence interval [{fmtNumber(m.ci[0])}, {fmtNumber(m.ci[1])}]</dd>}
              {m.note && <dd className="mt-0.5 text-xs text-muted-foreground">{m.note}</dd>}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
