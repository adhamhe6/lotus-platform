import { ChevronsUpDown, FolderKanban, Settings } from "lucide-react";
import { NavLink, Link } from "react-router-dom";
import { useProject } from "@/api/hooks";
import { Logo } from "@/components/brand/Logo";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, PROJECT_NAV } from "./nav";

export function Sidebar({ projectId, onNavigate }: { projectId: string; onNavigate?: () => void }) {
  const { data: project, isLoading } = useProject(projectId);
  const groups = (["workspace", "analyse", "communicate"] as const).map((g) => ({ g, items: PROJECT_NAV.filter((n) => n.group === g) }));
  const counts = project?.counts ?? {};
  const badge: Record<string, number | undefined> = { data: counts.datasets, analysis: counts.analyses, qualitative: counts.themes, insights: counts.insights, reports: counts.reports };
  return (
    <nav aria-label="Project navigation" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pb-4 pt-5"><Link to="/projects" onClick={onNavigate} aria-label="Lotus Platform home"><Logo /></Link></div>
      <Link to="/projects" onClick={onNavigate} className="mx-3 mb-4 flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.08]">
        <FolderKanban className="size-4 shrink-0 text-lotus" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[10.500px] font-medium uppercase tracking-wider text-sidebar-muted">Project</div>
          {isLoading ? <Skeleton className="mt-1 h-4 w-28 bg-white/10" /> : <div className="truncate text-sm font-medium text-white">{project?.name}</div>}
        </div>
        <ChevronsUpDown className="size-3.5 text-sidebar-muted" aria-hidden />
      </Link>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map(({ g, items }) => (
          <div key={g}>
            <div className="px-2.5 pb-1.5 text-[10.500px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">{GROUP_LABEL[g]}</div>
            <ul className="space-y-0.5">
              {items.map(({ to, label, icon: Icon, end }) => (
                <li key={label}>
                  <NavLink to={`/projects/${projectId}${to ? `/${to}` : ""}`} end={end} onClick={onNavigate}
                    className={({ isActive }) => cn("group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors", isActive ? "bg-sidebar-active font-medium text-white shadow-[inset_2px_0_0_var(--lotus)]" : "hover:bg-white/[0.06] hover:text-white")}>
                    <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {badge[to] ? <span className="tabular rounded-full bg-white/10 px-1.5 text-[11px] text-sidebar-foreground">{badge[to]}</span> : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => cn("flex items-center gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-white/[0.06] hover:text-white", isActive && "bg-sidebar-active text-white")}>
          <Settings className="size-4" aria-hidden />Settings
        </NavLink>
      </div>
    </nav>
  );
}
