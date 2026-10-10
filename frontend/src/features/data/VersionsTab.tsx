import { Check, GitCommitVertical } from "lucide-react";
import type { ReactNode } from "react";
import type { DatasetVersion } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OP_META, readLog, readQuality, type OpType } from "./model";

export function VersionsTab({ versions, currentId, onUse }: { versions: DatasetVersion[]; currentId?: string; onUse: (id: string) => void }) {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const ordered = [...versions].sort((a, b) => b.version_number - a.version_number);
  return (
    <ol className="relative space-y-4 border-l-2 border-border pl-6" aria-label="Version history">
      {ordered.map((v) => {
        const parent = v.parent_version_id ? byId.get(v.parent_version_id) : undefined;
        const q = readQuality(v);
        const pq = readQuality(parent);
        const log = readLog(v);
        const current = v.id === currentId;
        return (
          <li key={v.id} className={cn("relative rounded-lg border bg-card p-4 shadow-xs", current && "border-primary/60 ring-1 ring-primary/20")}>
            <span className={cn("absolute -left-[33px] top-4 flex size-4 items-center justify-center rounded-full border-2 bg-card", current ? "border-primary text-primary" : "border-border text-muted-foreground")} aria-hidden><GitCommitVertical className="size-3" /></span>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold">Version {v.version_number}</h3>
                  <Badge variant={v.kind === "original" ? "default" : "primary"}>{v.kind === "original" ? "Original upload" : "Transformed"}</Badge>
                  {current && <Badge variant="success"><Check className="size-3" aria-hidden />In use</Badge>}
                </div>
                {v.label && <p className="mt-0.5 text-sm">{v.label}</p>}
              </div>
              {!current && <Button size="sm" variant="secondary" onClick={() => onUse(v.id)} aria-label={`Use version ${v.version_number}`}>Use this version</Button>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
              <Meta k="Size" v={`${fmtNumber(v.row_count)} × ${fmtNumber(v.column_count)}`} />
              <Meta k="Created" v={fmtDate(v.created_at, true)} />
              <Meta k="Derived from" v={parent ? `Version ${parent.version_number}` : "— (source file)"} />
              <Meta k="Content hash" v={<code className="font-mono text-xs" title={v.content_hash}>{v.content_hash.slice(0, 10)}</code>} />
            </dl>

            {q && pq && (
              <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-[13px]" aria-label={`Quality compared with version ${parent?.version_number}`}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Compared with version {parent?.version_number}</p>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
                  <Diff label="Rows" from={fmtNumber(pq.rows)} to={fmtNumber(q.rows)} />
                  <Diff label="Missing cells" from={fmtNumber(pq.missing_cells)} to={fmtNumber(q.missing_cells)} />
                  <Diff label="Duplicate rows" from={fmtNumber(pq.duplicate_rows)} to={fmtNumber(q.duplicate_rows)} />
                </div>
              </div>
            )}

            {log.length > 0 && (
              <details className="group mt-3 text-[13px]">
                <summary className="cursor-pointer select-none font-medium text-primary">Transformation log ({log.length} {log.length === 1 ? "step" : "steps"})</summary>
                <ol className="mt-2 space-y-1.5">
                  {log.map((l, i) => (
                    <li key={i} className="flex gap-2 rounded-md bg-muted/50 px-3 py-1.5">
                      <span className="tabular text-muted-foreground">{i + 1}.</span>
                      <span className="min-w-0 flex-1"><span className="font-medium">{OP_META[l.op as OpType]?.label ?? l.op}</span><span className="block text-muted-foreground">{l.note}</span></span>
                      <span className="tabular shrink-0 text-xs text-muted-foreground">{fmtNumber(l.rows_before)} → {fmtNumber(l.rows_after)}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const Meta = ({ k, v }: { k: string; v: ReactNode }) => <div className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular truncate font-medium">{v}</dd></div>;
const Diff = ({ label, from, to }: { label: string; from: string; to: string }) => <div className="flex items-baseline justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="tabular font-medium">{from} → {to}</span></div>;
