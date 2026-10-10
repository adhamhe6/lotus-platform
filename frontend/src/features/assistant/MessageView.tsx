import { BookOpenText, ExternalLink, Info, ListChecks, Quote } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Message } from "@/api/types";
import { LotusMark } from "@/components/brand/Logo";
import { Provenance, interpretationKind } from "@/components/common/Provenance";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogDescription, DialogTitle, Sheet, SheetContent } from "@/components/ui/dialog";
import { fmtRelative, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blocksOf, evidenceOf, metaOf, type Block, type ComputedBlock, type EvidenceItem, type InterpretationBlock, type MixedBlock, type QualitativeBlock } from "./assistantApi";

const VALIDATION: Record<string, string> = { passed: "Numbers validated", passed_with_edits: "Numbers validated after edits", failed: "Numbers failed validation" };

export function UserBubble({ content, time }: { content: string; time?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        <p className="whitespace-pre-wrap break-words">{content}</p>
        {time && <p className="mt-1 text-[11px] opacity-75">{fmtRelative(time)}</p>}
      </div>
    </div>
  );
}

export function AssistantMessage({ message, projectId }: { message: Message; projectId: string }) {
  const blocks = blocksOf(message);
  const evidence = evidenceOf(message);
  const meta = metaOf(message);
  const [sheet, setSheet] = useState<{ open: boolean; focus?: string }>({ open: false });
  const openEvidence = (id?: string) => setSheet({ open: true, focus: id });
  const interp = blocks.find((b): b is InterpretationBlock => b.type === "interpretation");

  return (
    <div className="flex gap-3">
      <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground" aria-hidden><LotusMark className="size-4" /></span>
      <div className="min-w-0 flex-1 space-y-3" data-testid="assistant-message">
        {blocks.length === 0 && <p className="whitespace-pre-wrap text-sm">{message.content}</p>}
        {blocks.map((b, i) => <BlockView key={i} block={b} projectId={projectId} evidence={evidence} onEvidence={openEvidence} />)}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {evidence.length > 0 && <Button variant="secondary" size="xs" onClick={() => openEvidence()}><BookOpenText />Evidence ({evidence.length})</Button>}
          {interp && meta.prompt_version && (
            <span>
              {interp.origin === "llm" ? <>Model <span className="font-medium text-foreground/80">{interp.model ?? meta.model ?? "unknown"}</span></> : "Rule-based templates"} · prompt {meta.prompt_version}
            </span>
          )}
          <time dateTime={message.created_at}>{fmtRelative(message.created_at)}</time>
        </div>
      </div>
      <EvidenceSheet open={sheet.open} focus={sheet.focus} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} evidence={evidence} projectId={projectId} />
    </div>
  );
}

function BlockView({ block, projectId, evidence, onEvidence }: { block: Block; projectId: string; evidence: EvidenceItem[]; onEvidence: (id?: string) => void }) {
  const base = `/projects/${projectId}`;
  switch (block.type) {
    case "notice":
      return (
        <Alert variant="info" title="Lotus can’t answer that from the data">
          <p>{block.text}</p>
        </Alert>
      );
    case "computed":
      return <EvidenceCard block={block} badges={<Provenance kind="computed" />} evidence={evidence} onEvidence={onEvidence} link={block.analysis_run_id ? { to: `${base}/analysis/${block.analysis_run_id}`, label: "Open analysis" } : undefined} />;
    case "qualitative":
      return <EvidenceCard block={block} badges={<Provenance kind="qualitative" />} evidence={evidence} onEvidence={onEvidence} link={{ to: `${base}/qualitative`, label: "Explore themes" }} />;
    case "mixed":
      return <EvidenceCard block={block} badges={<><Provenance kind="computed" /><Provenance kind="qualitative" /></>} evidence={evidence} onEvidence={onEvidence} link={{ to: `${base}/mixed`, label: "Open mixed methods" }} />;
    case "interpretation":
      return <Interpretation block={block} onEvidence={onEvidence} />;
  }
}

function EvidenceCard({ block, badges, evidence, onEvidence, link }: { block: ComputedBlock | QualitativeBlock | MixedBlock; badges: ReactNode; evidence: EvidenceItem[]; onEvidence: (id?: string) => void; link?: { to: string; label: string } }) {
  const items = block.evidence_ids.map((id) => evidence.find((e) => e.id === id)).filter((e): e is EvidenceItem => !!e);
  return (
    <Card className="space-y-2.5 p-4">
      <div className="flex flex-wrap items-center gap-2">{badges}</div>
      <h3 className="text-[15px] font-semibold leading-snug">{block.title}</h3>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className={cn("rounded-md px-3 py-2 text-[13px]", e.kind === "caveat" ? "bg-warning-bg/60" : "bg-muted/60")}>
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => onEvidence(e.id)} className="mt-px shrink-0 rounded bg-card px-1.5 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-border hover:bg-accent" aria-label={`Show evidence ${e.id}`}>{e.id}</button>
                <div className="min-w-0"><p className="font-medium">{e.label}</p><p className="line-clamp-3 text-muted-foreground">{e.text}</p></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {link && <Link to={link.to} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">{link.label}<ExternalLink className="size-3" aria-hidden /></Link>}
    </Card>
  );
}

function EvidenceRefs({ ids, onEvidence }: { ids: string[]; onEvidence: (id: string) => void }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => <button key={id} type="button" onClick={() => onEvidence(id)} aria-label={`Show evidence ${id}`} className="rounded bg-accent px-1.5 text-[11px] font-semibold leading-5 text-accent-foreground hover:bg-accent/70">{id}</button>)}
    </span>
  );
}

function Interpretation({ block, onEvidence }: { block: InterpretationBlock; onEvidence: (id?: string) => void }) {
  const ai = block.origin === "llm";
  const status = block.validation?.status;
  return (
    <Card className="space-y-3 border-l-4 p-4" style={{ borderLeftColor: ai ? "var(--ai)" : "var(--rule)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Provenance kind={interpretationKind(block.origin)} />
        {ai && block.model && <Badge variant="outline">{block.model}</Badge>}
        {status && VALIDATION[status] && <Badge variant={status === "failed" ? "destructive" : "success"}>{VALIDATION[status]}</Badge>}
      </div>
      {block.fallback_reason && (
        <Alert variant="info" title="Why this is rule-based text"><p>{block.fallback_reason}</p></Alert>
      )}
      {block.summary && <p className="text-sm leading-relaxed">{block.summary}</p>}
      {block.points.length > 0 && (
        <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-muted-foreground">
          {block.points.map((p, i) => <li key={i}>{p.text}{p.evidence.length > 0 && <EvidenceRefs ids={p.evidence} onEvidence={onEvidence} />}</li>)}
        </ul>
      )}
      {block.caveats.length > 0 && (
        <div><h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning"><Info className="size-3.5" aria-hidden />Caveats</h4><ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground/85">{block.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      {block.next_steps.length > 0 && (
        <div><h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ListChecks className="size-3.5" aria-hidden />Next steps</h4><ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground/85">{block.next_steps.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
    </Card>
  );
}

const KIND_BADGE: Record<string, ReactNode> = {
  computed: <Provenance kind="computed" />, qualitative: <Provenance kind="qualitative" />, mixed: <Provenance kind="computed" label="Mixed methods" />,
};

function sourceLink(src: Record<string, unknown>, base: string): { to: string; label: string } | null {
  switch (src.type) {
    case "analysis": return src.analysis_run_id ? { to: `${base}/analysis/${src.analysis_run_id}`, label: "Open analysis" } : null;
    case "theme": return { to: `${base}/qualitative`, label: "View theme" };
    case "mixed": return { to: `${base}/mixed`, label: "Open mixed-methods run" };
    case "dataset": return { to: `${base}/data`, label: "View dataset" };
    case "insight": return { to: `${base}/insights`, label: "View insight" };
    default: return null;
  }
}

function EvidenceSheet({ open, onOpenChange, evidence, focus, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; evidence: EvidenceItem[]; focus?: string; projectId: string }) {
  const base = `/projects/${projectId}`;
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView?.({ block: "center" }); }, [open, focus]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-lg">
        <div className="space-y-1 pr-6">
          <DialogTitle>Evidence</DialogTitle>
          <DialogDescription>Everything this answer rests on. Computed and qualitative items come straight from your data; notes explain limits of the analysis.</DialogDescription>
        </div>
        <ol className="space-y-3">
          {evidence.map((e) => {
            const link = sourceLink(e.source, base);
            const selected = e.id === focus;
            return (
              <li key={e.id} ref={selected ? ref : undefined} aria-current={selected || undefined} className={cn("space-y-1.5 rounded-lg border p-3", selected && "border-primary bg-accent/40")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-muted px-1.5 text-[11px] font-semibold leading-5">{e.id}</span>
                  {KIND_BADGE[e.kind] ?? <Badge variant="outline">{e.kind === "caveat" ? "Note" : titleCase(e.kind)}</Badge>}
                </div>
                <p className="text-sm font-semibold">{e.label}</p>
                <p className="flex gap-2 text-[13px] text-muted-foreground">{e.kind === "qualitative" && <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />}<span className="min-w-0 break-words">{e.text}</span></p>
                {link && <Link to={link.to} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">{link.label}<ExternalLink className="size-3" aria-hidden /></Link>}
              </li>
            );
          })}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
