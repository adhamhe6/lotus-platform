import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, FileText, FlaskConical, Lightbulb, MessagesSquare, Search, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get } from "@/api/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PROJECT_NAV } from "./nav";

type Hits = Record<string, { id: string; title: string; project_id: string; subtitle?: string }[]>;

/** ⌘K: jump anywhere in the project, start common actions, or search everything you can access. */
export function CommandPalette({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const { data: hits } = useQuery({ queryKey: ["search", projectId, debounced], queryFn: () => get<Hits>("/search", { q: debounced, project_id: projectId }), enabled: open && debounced.length >= 2 });
  const go = (to: string) => { onOpenChange(false); nav(to); };
  const base = `/projects/${projectId}`;
  const icon = { datasets: Upload, analyses: BarChart3, insights: Lightbulb, themes: MessagesSquare, codes: MessagesSquare, reports: FileText, projects: FlaskConical } as const;
  const dest = (kind: string, h: { id: string }) => (kind === "datasets" ? `${base}/data/${h.id}` : kind === "analyses" ? `${base}/analysis/${h.id}` : kind === "insights" ? `${base}/insights` : kind === "reports" ? `${base}/reports/${h.id}` : `${base}/qualitative`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onOpenChange(!open); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[20%] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search the project or jump to a page</DialogDescription>
        <Command shouldFilter={debounced.length < 2} label="Command palette" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <div className="flex items-center gap-2 border-b px-3"><Search className="size-4 text-muted-foreground" aria-hidden />
            <Command.Input value={q} onValueChange={setQ} placeholder="Search datasets, analyses, insights, themes… or jump to a page" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></div>
          <Command.List className="scroll-thin max-h-80 overflow-auto p-1.5">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">No matches.</Command.Empty>
            <Command.Group heading="Go to">
              {PROJECT_NAV.map((n) => (
                <Command.Item key={n.label} value={`go ${n.label}`} onSelect={() => go(`${base}${n.to ? `/${n.to}` : ""}`)} className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"><n.icon className="size-4 text-muted-foreground" aria-hidden />{n.label}</Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item value="new analysis" onSelect={() => go(`${base}/analysis/new`)} className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"><BarChart3 className="size-4 text-muted-foreground" aria-hidden />New analysis</Command.Item>
              <Command.Item value="upload dataset" onSelect={() => go(`${base}/data?upload=1`)} className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"><Upload className="size-4 text-muted-foreground" aria-hidden />Upload a dataset</Command.Item>
            </Command.Group>
            {hits && Object.entries(hits).map(([kind, rows]) => (
              <Command.Group key={kind} heading={kind[0].toUpperCase() + kind.slice(1)}>
                {rows.map((h) => { const Icon = icon[kind as keyof typeof icon] ?? Search; return (
                  <Command.Item key={h.id} value={`${kind} ${h.title} ${h.id}`} onSelect={() => go(dest(kind, h))} className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm aria-selected:bg-accent">
                    <Icon className="size-4 text-muted-foreground" aria-hidden /><span className="truncate">{h.title}</span>{h.subtitle && <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                  </Command.Item>); })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
