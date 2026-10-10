import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, FolderPlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { useCreateProject, useDeleteProject, useProjects } from "@/api/hooks";
import type { Project } from "@/api/types";
import { Logo } from "@/components/brand/Logo";
import { EmptyState, ErrorState, PageHeader, SkeletonCards, errorMessage } from "@/components/common/blocks";
import { UserMenu } from "@/components/layout/Topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { fmtRelative } from "@/lib/format";

const schema = z.object({ name: z.string().trim().min(1, "Give the project a name").max(200), description: z.string().max(4000), objective: z.string().max(4000) });

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateProject();
  const nav = useNavigate();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", objective: "" } });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New project</DialogTitle><DialogDescription>A project is one research context: its datasets, analyses, themes, insights and reports live together.</DialogDescription></DialogHeader>
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => create.mutate(v, { onSuccess: (p) => { onOpenChange(false); reset(); nav(`/projects/${p.id}`); }, onError: (e) => toast.error(errorMessage(e)) }))}>
          <Field label="Name" htmlFor="p-name" error={errors.name?.message}><Input id="p-name" placeholder="e.g. Customer Satisfaction Study" aria-invalid={!!errors.name} {...register("name")} /></Field>
          <Field label="Research objective" htmlFor="p-obj" hint="Used as the opening of generated reports."><Textarea id="p-obj" rows={3} placeholder="What do you want to find out?" {...register("objective")} /></Field>
          <Field label="Description" htmlFor="p-desc"><Textarea id="p-desc" rows={2} {...register("description")} /></Field>
          <DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create project</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectCard({ p, onDelete }: { p: Project; onDelete: (p: Project) => void }) {
  const c = p.counts ?? {};
  return (
    <div className="group relative flex flex-col justify-between border bg-card p-5 shadow-xs transition-shadow hover:shadow-md petal">
      <div>
        <div className="mb-2 flex items-start justify-between gap-2">
          <Link to={`/projects/${p.id}`} className="font-display text-xl font-semibold leading-snug after:absolute after:inset-0 hover:text-primary">{p.name}</Link>
          <Badge variant={p.role === "OWNER" ? "primary" : "outline"}>{p.role?.toLowerCase()}</Badge>
        </div>
        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.objective || p.description || "No description yet."}</p>
      </div>
      <div className="mt-5 flex items-end justify-between">
        <dl className="flex gap-4 text-xs text-muted-foreground">
          {[["datasets", "Datasets"], ["analyses", "Analyses"], ["insights", "Insights"]].map(([k, l]) => (
            <div key={k}><dd className="tabular font-display text-lg font-semibold text-foreground">{c[k] ?? 0}</dd><dt>{l}</dt></div>
          ))}
        </dl>
        <div className="relative z-10 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{fmtRelative(p.updated_at)}</span>
          {p.role === "OWNER" && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.name}`} onClick={() => onDelete(p)}><Trash2 /></Button>}
          <ArrowUpRight className="size-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const { data, isLoading, error, refetch } = useProjects();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const del = useDeleteProject();
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b bg-sidebar px-6"><Logo /><UserMenu /></header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader eyebrow="Workspace" title="Your research projects" description="Open a project to import data, run analyses, code responses and write up evidence-backed findings."
          actions={<Button onClick={() => setCreating(true)}><Plus />New project</Button>} />
        {isLoading ? <SkeletonCards n={3} /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : data && data.length === 0 ? (
          <EmptyState icon={<FolderPlus />} title="No projects yet" description="Create your first project, then upload a dataset to begin analysis." action={<Button onClick={() => setCreating(true)}><Plus />Create a project</Button>} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{data?.map((p) => <ProjectCard key={p.id} p={p} onDelete={setToDelete} />)}</div>
        )}
      </main>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete this project?" loading={del.isPending} confirmLabel="Delete project"
        description={<>This permanently deletes <b>{toDelete?.name}</b> with all its datasets, analyses, themes, insights and reports. This cannot be undone.</>}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => { setToDelete(null); toast.success("Project deleted"); }, onError: (e) => toast.error(errorMessage(e)) })} />
    </div>
  );
}
