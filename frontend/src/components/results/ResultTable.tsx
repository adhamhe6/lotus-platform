import type { ResultTable as ResultTableData, TableColumn } from "@/api/types";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtNumber, fmtP, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

function cell(kind: TableColumn["kind"], v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (kind) {
    case "p_value": return fmtP(v);
    case "percent": return fmtPct(v);
    case "integer": case "number": return fmtNumber(v);
    default: return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

/** Renders an engine table: column kinds decide the number format; wide tables scroll horizontally, long ones vertically. */
export function ResultTable({ table, className, maxHeightClass = "max-h-96" }: { table: ResultTableData; className?: string; maxHeightClass?: string }) {
  return (
    <section className={cn("min-w-0 space-y-2", className)} aria-label={table.title}>
      <h3 className="text-sm font-semibold">{table.title}</h3>
      <div className={cn("overflow-auto rounded-lg border bg-card scroll-thin", maxHeightClass)}>
        <Table>
          <caption className="sr-only">{table.title}</caption>
          <THead>
            <TR className="hover:bg-transparent">
              {table.columns.map((c) => <TH key={c.key} scope="col" className={cn(c.kind !== "text" && "text-right")}>{c.label ?? c.key}</TH>)}
            </TR>
          </THead>
          <TBody>
            {table.rows.length === 0 && <TR><TD colSpan={table.columns.length} className="py-6 text-center text-muted-foreground">This table has no rows.</TD></TR>}
            {table.rows.map((r, i) => (
              <TR key={i}>
                {table.columns.map((c, ci) => {
                  const text = cell(c.kind, r[c.key]);
                  return ci === 0 && c.kind === "text"
                    ? <TH key={c.key} scope="row" className="h-auto whitespace-nowrap px-3 py-2 text-[13px] font-medium text-foreground">{text}</TH>
                    : <TD key={c.key} className={cn(c.kind !== "text" && "tabular whitespace-nowrap text-right")}>{text}</TD>;
                })}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {table.note && <p className="text-xs text-muted-foreground">{table.note}</p>}
    </section>
  );
}
