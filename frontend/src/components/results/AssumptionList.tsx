import { CheckCircle2, CircleHelp, MinusCircle, XCircle } from "lucide-react";
import type { Assumption } from "@/api/types";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { pLabel } from "./format";

const STATUS = {
  met: { label: "Met", Icon: CheckCircle2, cls: "text-success" },
  violated: { label: "Violated", Icon: XCircle, cls: "text-destructive" },
  unknown: { label: "Can’t be verified", Icon: CircleHelp, cls: "text-warning" },
  not_applicable: { label: "Not applicable", Icon: MinusCircle, cls: "text-muted-foreground" },
} as const;

/** Assumptions & diagnostics. Status is conveyed by icon *and* word, never colour alone. */
export function AssumptionList({ assumptions, className }: { assumptions: Assumption[]; className?: string }) {
  if (!assumptions.length) return <p className="text-sm text-muted-foreground">This analysis does not rely on testable assumptions.</p>;
  return (
    <ul className={cn("divide-y rounded-lg border bg-card", className)}>
      {assumptions.map((a, i) => {
        const s = STATUS[a.status] ?? STATUS.unknown;
        return (
          <li key={`${a.name}-${i}`} className="flex gap-3 px-4 py-3" data-status={a.status}>
            <s.Icon className={cn("mt-0.5 size-4 shrink-0", s.cls)} aria-hidden />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-sm font-medium">{a.name}</p>
                <span className={cn("text-xs font-semibold", s.cls)}>{s.label}</span>
              </div>
              <p className="text-[13px] text-muted-foreground">{a.detail}</p>
              {(a.test || a.statistic != null || a.p_value != null) && (
                <p className="tabular text-xs text-muted-foreground">
                  {[a.test, a.statistic != null && `statistic ${fmtNumber(a.statistic)}`, a.p_value != null && pLabel(a.p_value)].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
