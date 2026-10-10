import { Bell, CheckCheck, ChevronRight, Command, Database, LogOut, Menu, Moon, Sun, Workflow } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNotifications, useProject, useUnreadCount, qk } from "@/api/hooks";
import { post } from "@/api/client";
import { JobProgressView } from "@/components/common/JobProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimpleSelect } from "@/components/ui/select";
import { useActiveDataset } from "@/lib/activeDataset";
import { useAuth } from "@/lib/auth";
import { fmtRelative } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { useTheme } from "@/lib/theme";

export function Topbar({ projectId, onMenu, onSearch }: { projectId: string; onMenu: () => void; onSearch: () => void }) {
  const { data: project } = useProject(projectId);
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu /></Button>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground sm:flex">
        <Link to="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="size-3.5" aria-hidden />
        <span className="truncate font-medium text-foreground">{project?.name ?? "…"}</span>
      </nav>
      <DatasetContext />
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={onSearch} className="hidden w-52 justify-start gap-2 text-muted-foreground sm:inline-flex" aria-label="Search or run a command">
          <Command className="size-3.5" aria-hidden /><span className="flex-1 text-left font-normal">Search…</span><kbd className="rounded border bg-muted px-1.5 text-[10px]">⌘K</kbd>
        </Button>
        <Button variant="ghost" size="icon" className="sm:hidden" onClick={onSearch} aria-label="Search"><Command /></Button>
        <JobsMenu />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </div>
  );
}

function DatasetContext() {
  const { datasets, dataset, version, versions, setDataset, setVersion } = useActiveDataset();
  const ready = datasets.filter((d) => d.status === "READY");
  if (!dataset) return <div className="ml-2 hidden items-center gap-2 text-xs text-muted-foreground md:flex"><Database className="size-3.5" aria-hidden />No dataset yet</div>;
  return (
    <div className="ml-1 flex min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2 py-1" aria-label="Active dataset">
      <Database className="ml-1 size-3.5 shrink-0 text-primary" aria-hidden />
      {ready.length > 1 ? (
        <SimpleSelect aria-label="Active dataset" value={dataset.id} onValueChange={setDataset} options={ready.map((d) => ({ value: d.id, label: d.name }))} className="h-7 max-w-44 border-0 bg-transparent px-1.5 text-[13px] font-medium shadow-none" />
      ) : <span className="max-w-44 truncate px-1.5 text-[13px] font-medium">{dataset.name}</span>}
      {versions.length > 0 && (
        <SimpleSelect aria-label="Dataset version" value={version?.id} onValueChange={setVersion} className="h-7 w-auto max-w-40 border-0 bg-muted px-2 text-xs shadow-none"
          options={versions.map((v) => ({ value: v.id, label: `v${v.version_number}${v.kind === "original" ? " · original" : ""}`, hint: v.kind === "transformed" ? v.label.slice(0, 28) : undefined }))} />
      )}
    </div>
  );
}

function JobsMenu() {
  const { tracked, running, dismiss } = useJobs();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Background jobs${running ? `, ${running} running` : ""}`} className="relative">
          <Workflow />{running > 0 && <span className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-primary" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="border-b px-4 py-3 text-sm font-semibold">Background jobs</div>
        {tracked.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing running. Long tasks (imports, theme detection, reports) appear here with their real progress.</p> : (
          <ul className="max-h-80 divide-y overflow-auto">
            {tracked.map(({ job, opts }) => (
              <li key={job.id} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between gap-2 text-sm font-medium"><span className="truncate">{opts.title ?? job.type.replace(/_/g, " ")}</span>
                  {(job.status === "COMPLETED" || job.status === "FAILED") && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => dismiss(job.id)}>Dismiss</button>}</div>
                <JobProgressView job={job} compact />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationsMenu() {
  const { data: items = [] } = useNotifications();
  const { data: unread } = useUnreadCount();
  const qc = useQueryClient();
  const nav = useNavigate();
  const readAll = useMutation({ mutationFn: () => post("/notifications/read-all"), onSuccess: () => { qc.invalidateQueries({ queryKey: qk.notifications }); qc.invalidateQueries({ queryKey: qk.unread }); } });
  const n = unread?.count ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${n ? `, ${n} unread` : ""}`} className="relative">
          <Bell />{n > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-lotus px-1 text-[10px] font-semibold leading-4 text-white">{n > 9 ? "9+" : n}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="flex items-center justify-between border-b px-4 py-3"><span className="text-sm font-semibold">Notifications</span>
          <Button size="xs" variant="ghost" disabled={n === 0} onClick={() => readAll.mutate()}><CheckCheck />Mark all read</Button></div>
        {items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">You’re all caught up.</p> : (
          <ul className="scroll-thin max-h-96 divide-y overflow-auto">
            {items.slice(0, 20).map((it) => (
              <li key={it.id}>
                <button className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/60" onClick={() => it.project_id && nav(`/projects/${it.project_id}`)}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${it.read_at ? "bg-transparent" : "bg-lotus"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">{it.title}{it.kind === "job_failed" && <Badge variant="destructive">failed</Badge>}</span>
                    {it.body && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{it.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{fmtRelative(it.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const initials = (user?.full_name ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="ml-1 flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-label="Account menu">{initials}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel><div className="font-medium text-foreground">{user?.full_name}</div><div>{user?.email}</div></DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav("/settings")}>Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={toggle}>{theme === "dark" ? <Sun /> : <Moon />}{theme === "dark" ? "Light theme" : "Dark theme"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => logout().then(() => nav("/login"))}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
