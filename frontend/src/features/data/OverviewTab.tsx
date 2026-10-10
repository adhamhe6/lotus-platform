import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Info, Wrench, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { get } from "@/api/client";
import { qk } from "@/api/hooks";
import type { Dataset, DatasetVersion, Profile, Suggestion } from "@/api/types";
import { ErrorState, Section, SkeletonRows, StatTile } from "@/components/common/blocks";
import { Provenance } from "@/components/common/Provenance";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { fmtNumber, fmtPct, SEMANTIC_LABEL, titleCase } from "@/lib/format";
import { FIX_LABEL, fixForIssue, readQuality, readWarnings, toColInfo, type OpDraft, type QualityIssue } from "./model";
import { IngestWarnings } from "./shared";

const SEVERITIES: { key: string; label: string; Icon: typeof Info; cls: string }[] = [
  { key: "error", label: "Errors", Icon: XCircle, cls: "text-destructive" },
  { key: "warning", label: "Warnings", Icon: AlertTriangle, cls: "text-warning" },
  { key: "info", label: "Notes", Icon: Info, cls: "text-muted-foreground" },
];

export function suggestionHref(pid: string, versionId: string, s: Suggestion): string | null {
  if (s.analysis_type === "data_cleaning") return null;
  if (s.analysis_type === "qualitative_themes") {
    const col = typeof s.config.column === "string" ? `&column=${encodeURIComponent(s.config.column)}` : "";
    return `/projects/${pid}/qualitative?version=${encodeURIComponent(versionId)}${col}`;
  }
  return `/projects/${pid}/analysis/new?type=${encodeURIComponent(s.analysis_type)}&version=${encodeURIComponent(versionId)}&config=${encodeURIComponent(JSON.stringify(s.config))}`;
}

export function OverviewTab({ pid, dataset, version, profile, canEdit, onFix, onPrepare }: {
  pid: string; dataset: Dataset; version: DatasetVersion; profile: Profile; canEdit: boolean; onFix: (op: OpDraft) => void; onPrepare: () => void;
}) {
  const q = readQuality(profile.version);
  const warnings = readWarnings(profile.version);
  const cols = toColInfo(profile.columns);
  if (!q) return <Alert variant="info" title="No quality summary">This version has no stored quality summary.</Alert>;
  const dupHint = q.rows ? `${fmtNumber(q.duplicate_rows)} fully repeated` : undefined;

  const grouped = SEVERITIES.map((s) => ({ ...s, items: q.issues.filter((i) => i.severity === s.key) })).filter((g) => g.items.length);
  const types = Object.entries(q.type_counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <IngestWarnings warnings={warnings} />
      <Section title="Data quality" description={`Measured on ${dataset.name}, version ${version.version_number}.`} actions={<Provenance kind="computed" />}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Rows" value={fmtNumber(q.rows)} />
          <StatTile label="Columns" value={fmtNumber(q.columns)} />
          <StatTile label="Missing cells" value={fmtPct(q.missing_pct)} hint={`${fmtNumber(q.missing_cells)} cells`} tone={q.missing_pct >= 5 ? "warn" : "default"} />
          <StatTile label="Complete rows" value={fmtNumber(q.complete_rows)} hint="no missing value" />
          <StatTile label="Duplicate rows" value={fmtNumber(q.duplicate_rows)} hint={dupHint} tone={q.duplicate_rows > 0 ? "warn" : "good"} />
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1" aria-label="Column types">
          <span className="text-xs text-muted-foreground">Column types</span>
          {types.map(([t, n]) => <Badge key={t} variant="outline">{SEMANTIC_LABEL[t] ?? titleCase(t)} · {fmtNumber(n)}</Badge>)}
        </div>
      </Section>

      <Section title="Issues found" description="Detected from the data itself. Fixes open in the Prepare tab for you to review before anything changes.">
        {!grouped.length ? (
          <Alert variant="success" title="No data-quality issues detected">Nothing needs attention in this version.</Alert>
        ) : (
          <div className="space-y-4">
            {grouped.map((g) => (
              <Card key={g.key}>
                <h3 className={`flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold ${g.cls}`}><g.Icon className="size-4" aria-hidden />{g.label} ({g.items.length})</h3>
                <ul className="divide-y">
                  {g.items.map((i, idx) => <IssueRow key={`${i.code}-${i.column}-${idx}`} issue={i} canFix={canEdit && !!fixForIssue(i, cols)} onFix={() => { const op = fixForIssue(i, cols); if (op) onFix(op); }} />)}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Suggestions pid={pid} dataset={dataset} version={version} onPrepare={onPrepare} />
    </div>
  );
}

function IssueRow({ issue, canFix, onFix }: { issue: QualityIssue; canFix: boolean; onFix: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm">
      <span className="min-w-0 flex-1">{issue.message}</span>
      {issue.column && <Badge variant="outline" className="font-mono">{issue.column}</Badge>}
      {canFix && <Button size="xs" variant="secondary" onClick={onFix} aria-label={`Fix this: ${FIX_LABEL[issue.code] ?? "Prepare"}${issue.column ? ` (${issue.column})` : ""}`}><Wrench />Fix this</Button>}
    </li>
  );
}

function Suggestions({ pid, dataset, version, onPrepare }: { pid: string; dataset: Dataset; version: DatasetVersion; onPrepare: () => void }) {
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.suggestions(dataset.id, version.id),
    queryFn: () => get<Suggestion[]>(`/datasets/${dataset.id}/suggestions`, { version_id: version.id }),
    staleTime: 60_000,
  });
  let body: ReactNode;
  if (isLoading) body = <SkeletonRows n={3} />;
  else if (error) body = <ErrorState error={error} onRetry={() => refetch()} title="Couldn’t load suggestions" className="py-8" />;
  else if (!data?.length) body = <Alert variant="info" title="No suggestions yet">The preliminary scan didn’t find a clearly useful analysis for these columns. You can still start one yourself.</Alert>;
  else body = (
    <ul className="grid gap-3 lg:grid-cols-2">
      {data.map((s, i) => {
        const href = suggestionHref(pid, version.id, s);
        return (
          <li key={`${s.analysis_type}-${i}`} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold leading-snug">{s.title}</h3>
              <Tooltip content="Found by a quick scan of the data as loaded. Run the analysis to get the tested result, assumptions and caveats."><Badge variant="outline" className="shrink-0">Preliminary scan</Badge></Tooltip>
            </div>
            <p className="flex-1 text-[13px] text-muted-foreground">{s.reason}</p>
            <div><Button size="sm" variant="secondary" onClick={() => (href ? nav(href) : onPrepare())} aria-label={`Run ${s.title}`}>{href ? "Run…" : "Open Prepare"}<ArrowRight /></Button></div>
          </li>
        );
      })}
    </ul>
  );
  return (
    <Section title="Suggested analyses" description="Starting points based on your column types and a preliminary scan. Nothing runs until you choose it.">
      {body}
    </Section>
  );
}
