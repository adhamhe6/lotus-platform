import { fmtNumber, fmtP } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Ev { label?: string; value?: unknown; unit?: string | null; table?: string | null }
const P_LABEL = /(^|\W)p(\W|$)|p[-\s]?(adj|value)|adjusted p/i;

export function evidenceValue(e: Ev): string {
  const isP = P_LABEL.test(e.label ?? "") && typeof e.value === "number";
  const v = isP ? fmtP(e.value) : fmtNumber(e.value);
  return e.unit && v !== "—" ? (e.unit === "%" ? `${v}%` : `${v} ${e.unit}`) : v;
}

/** The computed numbers behind an insight as label: value pairs. */
export function EvidenceStrip({ evidence, stacked }: { evidence: unknown[]; stacked?: boolean }) {
  const items = evidence as Ev[];
  if (!items.length) return <p className="text-xs text-muted-foreground">No evidence values stored.</p>;
  return (
    <dl className={cn(stacked ? "grid gap-1.5 sm:grid-cols-2" : "flex flex-wrap gap-x-5 gap-y-2")}>
      {items.map((e, i) => (
        <div key={i} className={cn(stacked && "rounded-md border bg-muted/40 px-2.5 py-1.5")}>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{e.label ?? "value"}</dt>
          <dd className="tabular text-sm font-semibold">{evidenceValue(e)}</dd>
        </div>
      ))}
    </dl>
  );
}
