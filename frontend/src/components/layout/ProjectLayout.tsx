import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useProject } from "@/api/hooks";
import { ErrorState } from "@/components/common/blocks";
import { Sheet, SheetContent, DialogTitle } from "@/components/ui/dialog";
import { ActiveDatasetProvider } from "@/lib/activeDataset";
import { useProjectId } from "@/lib/useProjectId";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function ProjectLayout() {
  const projectId = useProjectId();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const project = useProject(projectId);
  return (
    <ActiveDatasetProvider projectId={projectId}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block"><Sidebar projectId={projectId} /></aside>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="left" width="max-w-72" className="gap-0 border-0 bg-sidebar p-0"><DialogTitle className="sr-only">Navigation</DialogTitle><Sidebar projectId={projectId} onNavigate={() => setMenu(false)} /></SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar projectId={projectId} onMenu={() => setMenu(true)} onSearch={() => setSearch(true)} />
          <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8 md:py-8">
            {project.isError ? <ErrorState error={project.error} onRetry={() => project.refetch()} /> : <Outlet />}
          </main>
        </div>
      </div>
      <CommandPalette projectId={projectId} open={search} onOpenChange={setSearch} />
    </ActiveDatasetProvider>
  );
}
