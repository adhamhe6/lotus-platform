import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Sparkles, Tags, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Code } from "@/api/types";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/common/blocks";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api, useCodes, useWorkspaceMutation, type CodeBody } from "./api";
import { ColorDot } from "./chips";

const SWATCHES = ["#1d4ed8", "#be123c", "#0f766e", "#b45309", "#7c3aed", "#475569"];
const schema = z.object({
  name: z.string().trim().min(1, "Give the code a name.").max(120, "Keep the name under 120 characters."),
  description: z.string().max(2000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour."),
  category: z.string().max(120),
  keywords: z.string(),
});
type FormValues = z.infer<typeof schema>;

export const parseKeywords = (s: string) => [...new Set(s.split(/[\n,]/).map((k) => k.trim()).filter(Boolean))];

export function CodeDialog({ pid, code, open, onOpenChange }: { pid: string; code?: Code; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", color: SWATCHES[2], category: "", keywords: "" } });
  useEffect(() => {
    if (open) reset(code ? { name: code.name, description: code.description, color: code.color, category: code.category, keywords: code.keywords.map(String).join("\n") } : { name: "", description: "", color: SWATCHES[2], category: "", keywords: "" });
  }, [open, code, reset]);
  const color = watch("color");
  const save = useWorkspaceMutation(pid, (b: CodeBody) => (code ? api.updateCode(code.id, b) : api.createCode(pid, b)), {
    onSuccess: () => { toast.success(code ? "Code updated" : "Code created"); onOpenChange(false); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{code ? "Edit code" : "New code"}</DialogTitle>
          <DialogDescription>A code is a label you apply to responses. Keywords let Lotus <em>suggest</em> where it may apply; you decide what is accepted.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit((v) => save.mutate({ ...v, name: v.name.trim(), keywords: parseKeywords(v.keywords) }))} noValidate>
          <Field label="Name" htmlFor="code-name" error={errors.name?.message}><Input id="code-name" aria-invalid={!!errors.name} {...register("name")} /></Field>
          <Field label="Description" htmlFor="code-desc" hint="What does a response need to say to receive this code?"><Textarea id="code-desc" rows={2} {...register("description")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="code-cat" hint="Optional grouping, e.g. “Service”."><Input id="code-cat" {...register("category")} /></Field>
            <Field label="Colour" htmlFor="code-color" error={errors.color?.message}>
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" aria-label={`Use colour ${c}`} aria-pressed={color === c} onClick={() => setValue("color", c, { shouldDirty: true })}
                    className={cn("size-6 rounded-full ring-offset-2 ring-offset-card", color === c && "ring-2 ring-foreground")} style={{ background: c }} />
                ))}
                <input id="code-color" type="color" className="size-7 cursor-pointer rounded border bg-card p-0.5" {...register("color")} />
              </div>
            </Field>
          </div>
          <Field label="Keywords" htmlFor="code-kw" hint="One per line or comma-separated. Matching is whole-word and case-insensitive: “deliver” does not match “delivery”. End a term with * for any suffix: “deliver*” matches deliver, delivery, delivered.">
            <Textarea id="code-kw" rows={4} placeholder={"deliver*\nparcel\nlate"} {...register("keywords")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{code ? "Save changes" : "Create code"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SuggestDialog({ open, onOpenChange, busy, onRun }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onRun: (o: { use_semantic: boolean; semantic_threshold: number }) => void }) {
  const [semantic, setSemantic] = useState(true);
  const [threshold, setThreshold] = useState(0.55);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggest codes</DialogTitle>
          <DialogDescription>Lotus scans every response for each code’s keywords and, optionally, for wording similar to responses you already coded. <strong>Nothing is applied automatically</strong>: every match appears as a dashed suggestion you accept or reject.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div><label htmlFor="sg-sem" className="text-sm font-medium">Also use semantic similarity</label><p className="text-xs text-muted-foreground">Finds responses that mean the same thing without sharing a keyword. Slower and less exact than keywords.</p></div>
            <Switch id="sg-sem" checked={semantic} onCheckedChange={setSemantic} />
          </div>
          <div className={cn("space-y-1.5", !semantic && "opacity-50")}>
            <div className="flex items-center justify-between"><label htmlFor="sg-th" className="text-sm font-medium">Similarity threshold</label><span className="tabular text-sm">{threshold.toFixed(2)}</span></div>
            <input id="sg-th" type="range" min={0.2} max={0.95} step={0.05} value={threshold} disabled={!semantic} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
            <p className="text-xs text-muted-foreground">Higher means fewer, closer matches. Lower surfaces more candidates to review.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={() => onRun({ use_semantic: semantic, semantic_threshold: threshold })}><Sparkles />Suggest codes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CodesPane({ pid, canWrite, activeCodeId, onFilter, onSuggest, suggesting }: {
  pid: string; canWrite: boolean; activeCodeId?: string; onFilter: (id?: string) => void;
  onSuggest?: (o: { use_semantic: boolean; semantic_threshold: number }) => Promise<void>; suggesting: boolean;
}) {
  const codes = useCodes(pid);
  const [editing, setEditing] = useState<Code | undefined>();
  const [dialog, setDialog] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [removing, setRemoving] = useState<Code | undefined>();
  const remove = useWorkspaceMutation(pid, (c: Code) => api.deleteCode(c.id), {
    onSuccess: (_r, c) => { toast.success(`Deleted “${c.name}”`); if (activeCodeId === c.id) onFilter(undefined); setRemoving(undefined); },
  });
  const list = codes.data ?? [];
  return (
    <section aria-labelledby="codes-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="codes-h" className="font-display text-lg font-semibold">Codes</h2>
        {canWrite && <Button size="xs" variant="secondary" onClick={() => { setEditing(undefined); setDialog(true); }}><Plus />New code</Button>}
      </div>
      {canWrite && list.length > 0 && onSuggest && (
        <Button size="sm" variant="accent" onClick={() => setSuggest(true)} loading={suggesting}><Sparkles />Suggest codes</Button>
      )}
      {codes.isLoading ? <SkeletonRows n={4} /> : codes.isError ? <ErrorState title="Couldn’t load the codebook" error={codes.error} onRetry={() => codes.refetch()} /> : list.length === 0 ? (
        <EmptyState compact icon={<Tags />} title="No codes yet" description="A codebook is your own set of labels. Create a code with a few keywords and Lotus will suggest matching responses for you to review."
          action={canWrite ? <Button onClick={() => { setEditing(undefined); setDialog(true); }}><Plus />Create the first code</Button> : undefined} />
      ) : (
        <ul className="space-y-1.5">
          {list.map((c) => {
            const active = activeCodeId === c.id;
            return (
              <li key={c.id} className={cn("group flex items-stretch rounded-lg border bg-card transition-colors", active && "border-primary ring-1 ring-primary")}>
                <button type="button" aria-pressed={active} onClick={() => onFilter(active ? undefined : c.id)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-l-lg px-3 py-2 text-left hover:bg-muted/50">
                  <ColorDot color={c.color} className="mt-1.5 size-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    {c.category && <span className="block truncate text-xs text-muted-foreground">{c.category}</span>}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      <span className="tabular font-medium text-foreground">{c.accepted_count}</span> accepted · <span className="tabular font-medium text-foreground">{c.suggested_count}</span> suggested
                    </span>
                  </span>
                </button>
                {canWrite && (
                  <div className="flex flex-col justify-center border-l px-0.5">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit code ${c.name}`} onClick={() => { setEditing(c); setDialog(true); }}><Pencil className="size-3.5" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete code ${c.name}`} onClick={() => setRemoving(c)}><Trash2 className="size-3.5" /></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 0 && <p className="text-xs text-muted-foreground">Select a code to list the responses it has been accepted on. Dashed suggestions count only after you accept them.</p>}
      <CodeDialog pid={pid} code={editing} open={dialog} onOpenChange={setDialog} />
      <SuggestDialog open={suggest} onOpenChange={setSuggest} busy={suggesting} onRun={async (o) => { await onSuggest?.(o); setSuggest(false); }} />
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(undefined)} title={`Delete “${removing?.name ?? ""}”?`}
        description="This removes the code and every accepted or suggested label that uses it. The responses themselves are not changed."
        confirmLabel="Delete code" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} />
    </section>
  );
}
