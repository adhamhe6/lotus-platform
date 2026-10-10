import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Provenance } from "@/components/common/Provenance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { describeSection, kindLabel, provenanceOf, type Lookups } from "./sections";
import type { Section } from "./reportsApi";

/** Ordered section list: keyboard-accessible reordering, inline title/body editing and removal. */
export function SectionsEditor({ sections, onChange, lookups, readOnly }: { sections: Section[]; onChange: (s: Section[]) => void; lookups: Lookups; readOnly: boolean }) {
  const [announce, setAnnounce] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusKey) return;
    document.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
    setFocusKey(null);
  }, [focusKey, sections]);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
    const s = sections[i]!;
    setAnnounce(`Moved “${s.title || kindLabel(s.type)}” to position ${j + 1} of ${sections.length}.`);
    setFocusKey(`${s.id}-${d === -1 ? (j === 0 ? "down" : "up") : (j === sections.length - 1 ? "up" : "down")}`);
  };
  const patch = (i: number, p: Partial<Section>) => onChange(sections.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const remove = (i: number) => {
    const s = sections[i]!;
    onChange(sections.filter((_, k) => k !== i));
    setAnnounce(`Removed “${s.title || kindLabel(s.type)}”.`);
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <ol className="space-y-3" aria-label="Report sections">
        {sections.map((s, i) => {
          const prov = provenanceOf(s.type);
          const name = s.title || kindLabel(s.type);
          return (
            <li key={s.id} className="rounded-lg border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-start gap-3">
                <span className="tabular mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden>{i + 1}</span>
                <div className="min-w-0 flex-1 basis-60 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{kindLabel(s.type)}</Badge>
                    {Array.isArray(prov) ? prov.map((p) => <Provenance key={p.kind} kind={p.kind} label={p.label} />) : <Badge variant="outline">{prov === "author" ? "Written by you" : "Composed by Lotus"}</Badge>}
                  </div>
                  {readOnly ? <h3 className="text-[15px] font-semibold">{s.title}</h3> : (
                    <Input aria-label={`Title of section ${i + 1}`} value={s.title} maxLength={300} onChange={(e) => patch(i, { title: e.target.value })} className="font-medium" />
                  )}
                  <p className="text-[13px] text-muted-foreground">{describeSection(s, lookups)}</p>
                  {s.type === "text" && (readOnly ? <p className="whitespace-pre-wrap text-sm">{s.body}</p> : (
                    <Textarea aria-label={`Body of section ${i + 1}`} value={s.body ?? ""} maxLength={20000} rows={5} onChange={(e) => patch(i, { body: e.target.value })} />
                  ))}
                  {s.type === "ai_summary" && s.body && <p className="whitespace-pre-wrap rounded-md bg-ai-bg/50 px-3 py-2 text-sm">{s.body}</p>}
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Actions for ${name}`}>
                    <Button variant="ghost" size="icon-sm" data-focus-key={`${s.id}-up`} aria-label={`Move “${name}” up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button variant="ghost" size="icon-sm" data-focus-key={`${s.id}-down`} aria-label={`Move “${name}” down`} disabled={i === sections.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove “${name}”`} onClick={() => remove(i)}><Trash2 /></Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
