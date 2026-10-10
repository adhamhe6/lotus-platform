import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Filter, GitMerge, Layers, Pencil, Plus, Sparkles, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Theme } from "@/api/types";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/common/blocks";
import { Provenance, interpretationKind } from "@/components/common/Provenance";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { fmtNumber, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api, useWorkspaceMutation, type ThemeSummary, type ThemesResponse } from "./api";

function NameDialog({ open, onOpenChange, title, description, label, initial = "", confirm, optional, busy, onSubmit, withDescription }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; label: string; initial?: string; confirm: string; optional?: boolean; busy: boolean; withDescription?: boolean;
  onSubmit: (name: string, description: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string>();
  const submit = () => {
    if (!optional && !name.trim()) { setErr("Enter a name."); return; }
    setErr(undefined); onSubmit(name.trim(), desc.trim());
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setName(initial); setDesc(""); setErr(undefined); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field label={label} htmlFor="theme-name-field" error={err}><Input id="theme-name-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} aria-invalid={!!err} /></Field>
          {withDescription && <Field label="Description (optional)" htmlFor="theme-desc-field"><Textarea id="theme-desc-field" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>}
          <DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={busy}>{confirm}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SummaryBlock({ theme, canWrite, pid }: { theme: Theme; canWrite: boolean; pid: string }) {
  const s = (theme.summary ?? null) as ThemeSummary | null;
  const summarize = useWorkspaceMutation(pid, () => api.summarize(theme.id), { onSuccess: () => toast.success("Summary updated") });
  const kind = interpretationKind(s?.origin);
  const ai = kind === "ai";
  return (
    <div className="space-y-1.5 rounded-md border border-dashed bg-muted/40 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">Summary</span>
        {s?.text ? <Provenance kind={kind} /> : null}
        {ai && s?.model && <Badge variant="outline">{s.model}</Badge>}
      </div>
      {s?.text ? <p className="text-sm leading-relaxed">{s.text}</p> : <p className="text-sm text-muted-foreground">No summary yet.</p>}
      {s?.fallback_reason && <p className="text-xs text-muted-foreground">Rule-based text shown because: {s.fallback_reason}</p>}
      {canWrite && <Button size="xs" variant="secondary" loading={summarize.isPending} onClick={() => summarize.mutate()}><Sparkles />{s?.text ? "Summarize again" : "Summarize"}</Button>}
    </div>
  );
}

function ThemeCard({ pid, theme, canWrite, selected, onSelect, active, onFilter }: {
  pid: string; theme: Theme; canWrite: boolean; selected: boolean; onSelect: (v: boolean) => void; active: boolean; onFilter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rename, setRename] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState(theme.description);
  const [del, setDel] = useState(false);
  const update = useWorkspaceMutation(pid, (b: { name?: string; description?: string }) => api.updateTheme(theme.id, b));
  const remove = useWorkspaceMutation(pid, () => api.deleteTheme(theme.id), { onSuccess: () => { toast.success(`Deleted theme “${theme.name}”`); setDel(false); } });
  const moveOut = useWorkspaceMutation(pid, (segmentId: string) => api.removeFromTheme(theme.id, segmentId));
  const share = Math.max(0, Math.min(100, theme.share_pct));
  const keywords = theme.keywords.map(String);
  const examples = theme.examples as unknown as { segment_id: string; text: string }[];
  return (
    <li className={cn("rounded-lg border bg-card", active && "border-primary ring-1 ring-primary")}>
      <div className="flex items-start gap-2 p-3">
        {canWrite && <Checkbox className="mt-1" checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select theme ${theme.name} for merging`} />}
        <div className="min-w-0 flex-1">
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-1 text-left">
            {open ? <ChevronDown className="mt-1 size-4 shrink-0" aria-hidden /> : <ChevronRight className="mt-1 size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug">{theme.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                <span className="tabular font-medium text-foreground">{fmtNumber(theme.response_count)}</span> responses · <span className="tabular font-medium text-foreground">{fmtPct(theme.share_pct)}</span> of respondents
              </span>
            </span>
            {theme.origin === "manual" && <Badge variant="outline">Manual</Badge>}
          </button>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation"><div className="h-full rounded-full bg-computed" style={{ width: `${share}%` }} /></div>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t p-3">
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant={active ? "default" : "secondary"} aria-pressed={active} onClick={onFilter}><Filter />{active ? "Showing responses" : "Show responses"}</Button>
            {canWrite && <Button size="xs" variant="secondary" onClick={() => setRename(true)}><Pencil />Rename</Button>}
            {canWrite && <Button size="xs" variant="secondary" onClick={() => setDel(true)}><Trash2 />Delete</Button>}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">Description {canWrite && !editDesc && <Button size="xs" variant="ghost" onClick={() => { setDesc(theme.description); setEditDesc(true); }}>Edit</Button>}</div>
            {editDesc ? (
              <div className="space-y-1.5">
                <Textarea aria-label={`Description of ${theme.name}`} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
                <div className="flex gap-1.5"><Button size="xs" loading={update.isPending} onClick={() => update.mutate({ description: desc }, { onSuccess: () => setEditDesc(false) })}>Save description</Button><Button size="xs" variant="ghost" onClick={() => setEditDesc(false)}>Cancel</Button></div>
              </div>
            ) : <p className="text-sm text-muted-foreground">{theme.description || "No description."}</p>}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Distinguishing terms <Provenance kind="computed" label="Computed" className="ml-1" /></div>
            {keywords.length ? <div className="flex flex-wrap gap-1">{keywords.map((k) => <Badge key={k} variant="computed">{k}</Badge>)}</div> : <p className="text-sm text-muted-foreground">None (manual themes have no computed terms).</p>}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">Representative responses <Provenance kind="qualitative" label="Verbatim" /></div>
            {examples.length ? (
              <ul className="space-y-1.5">
                {examples.map((e) => (
                  <li key={e.segment_id} className="flex items-start gap-2 border-l-2 border-qual/60 pl-2.5 text-sm">
                    <q className="flex-1">{e.text}</q>
                    {canWrite && <Button size="icon-sm" variant="ghost" aria-label={`Remove this response from ${theme.name}`} loading={moveOut.isPending} onClick={() => moveOut.mutate(e.segment_id)}><UserMinus className="size-3.5" /></Button>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No example responses.</p>}
          </div>
          <SummaryBlock theme={theme} canWrite={canWrite} pid={pid} />
        </div>
      )}
      <NameDialog open={rename} onOpenChange={setRename} title="Rename theme" description="The name is yours to choose; the responses and counts do not change." label="Theme name" initial={theme.name} confirm="Save name" busy={update.isPending}
        onSubmit={(name) => update.mutate({ name }, { onSuccess: () => setRename(false) })} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={`Delete “${theme.name}”?`} description="Only the theme is removed. The responses stay exactly as they are and can be grouped again." confirmLabel="Delete theme" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </li>
  );
}

export function ThemesPane({ pid, versionId, column, canWrite, query, activeThemeId, onFilter, onDetect, detecting }: {
  pid: string; versionId: string; column: string; canWrite: boolean; query: UseQueryResult<ThemesResponse>;
  activeThemeId?: string; onFilter: (id?: string) => void; onDetect: () => void; detecting: boolean;
}) {
  const themes = query.data?.themes ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [merge, setMerge] = useState(false);
  const [create, setCreate] = useState(false);
  const mergeM = useWorkspaceMutation(pid, (b: { theme_ids: string[]; name?: string }) => api.mergeThemes(pid, b), { onSuccess: () => { toast.success("Themes merged"); setMerge(false); setPicked([]); } });
  const createM = useWorkspaceMutation(pid, (b: { name: string; description: string }) => api.createTheme(pid, { dataset_version_id: versionId, column, ...b }), { onSuccess: () => { toast.success("Theme created"); setCreate(false); } });
  const sorted = [...themes].sort((a, b) => b.response_count - a.response_count);
  return (
    <section aria-labelledby="themes-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="themes-h" className="font-display text-lg font-semibold">Themes</h2>
        {canWrite && <Button size="xs" variant="secondary" onClick={() => setCreate(true)}><Plus />New theme</Button>}
      </div>
      <p className="rounded-md bg-qual-bg px-2.5 py-2 text-xs leading-relaxed text-qual">
        Themes are <strong>suggestions to review</strong>, not findings. Each response is placed in its single closest group, so a response that raises a second topic is counted only under the first. Rename, merge or move responses until the themes mean what you mean.
      </p>
      {canWrite && picked.length >= 2 && (
        <Button size="sm" onClick={() => setMerge(true)}><GitMerge />Merge {picked.length} selected themes</Button>
      )}
      {query.isLoading ? <SkeletonRows n={4} /> : query.isError ? <ErrorState title="Couldn’t load themes" error={query.error} onRetry={() => query.refetch()} /> : sorted.length === 0 ? (
        <EmptyState compact icon={<Layers />} title="No themes yet" description="Detect themes to group similar responses automatically, or create your own and place responses by hand."
          action={canWrite ? <div className="flex flex-wrap justify-center gap-2"><Button onClick={onDetect} loading={detecting}><Sparkles />Detect themes</Button><Button variant="secondary" onClick={() => setCreate(true)}><Plus />New theme</Button></div> : undefined} />
      ) : (
        <ul className="space-y-2">
          {sorted.map((t) => (
            <ThemeCard key={t.id} pid={pid} theme={t} canWrite={canWrite} selected={picked.includes(t.id)} onSelect={(v) => setPicked((p) => (v ? [...p, t.id] : p.filter((x) => x !== t.id)))}
              active={activeThemeId === t.id} onFilter={() => onFilter(activeThemeId === t.id ? undefined : t.id)} />
          ))}
        </ul>
      )}
      <NameDialog open={merge} onOpenChange={setMerge} title="Merge themes" description="The selected themes become one; their responses are combined. Leave the name empty to keep the first theme’s name." label="Merged theme name (optional)" optional confirm="Merge themes" busy={mergeM.isPending}
        onSubmit={(name) => mergeM.mutate({ theme_ids: picked, ...(name ? { name } : {}) })} />
      <NameDialog open={create} onOpenChange={setCreate} title="New theme" description="Create an empty theme, then place responses into it from the Responses pane." label="Theme name" confirm="Create theme" busy={createM.isPending} withDescription
        onSubmit={(name, description) => createM.mutate({ name, description })} />
    </section>
  );
}
