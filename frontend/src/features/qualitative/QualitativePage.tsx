import { Database, Sparkles, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProject } from "@/api/hooks";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveDataset } from "@/lib/activeDataset";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { api, qualKey, useCodes, useSources, useThemes, useWorkspaceMutation, type SegmentFilters } from "./api";
import { CodesPane } from "./CodesPane";
import { ExplorePanel } from "./ExplorePanel";
import { JobStrip, useFeatureJobs } from "./JobStrip";
import { ResponsesPane } from "./ResponsesPane";
import { SourceBar, type ColumnOption } from "./SourceBar";
import { ThemesPane } from "./ThemesPane";
import { qk } from "@/api/hooks";

type PaneId = "codes" | "responses" | "themes";
const EMPTY_FILTERS: SegmentFilters = { page: 1 };

export function QualitativePage() {
  const pid = useProjectId();
  const project = useProject(pid);
  const canWrite = !!project.data && project.data.role !== "VIEWER";
  const { dataset, version, columns, loading } = useActiveDataset();
  const sources = useSources(pid, version?.id);
  const codes = useCodes(pid);
  const jobs = useFeatureJobs();
  const [picked, setPicked] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [filters, setFilters] = useState<SegmentFilters>(EMPTY_FILTERS);
  const [pane, setPane] = useState<PaneId>("responses");
  const [exploring, setExploring] = useState(false);

  const options = useMemo<ColumnOption[]>(() => {
    const detected = (sources.data ?? []).map((s) => ({ column: s.column, source: s, detected: true }));
    const have = new Set(detected.map((d) => d.column));
    const others = columns.filter((c) => !have.has(c.name) && ["categorical", "identifier", "text"].includes(c.semantic_type)).map((c) => ({ column: c.name, source: undefined, detected: false }));
    return [...detected, ...others];
  }, [sources.data, columns]);
  const defaultColumn = (options.find((o) => (o.source?.segments ?? 0) > 0) ?? options[0])?.column;
  const column = picked && options.some((o) => o.column === picked) ? picked : defaultColumn;
  const source = options.find((o) => o.column === column)?.source;
  const prepared = (source?.segments ?? 0) > 0;

  const themes = useThemes(pid, version?.id, prepared ? column : undefined, runId);
  const runs = themes.data?.runs ?? [];
  const themeList = themes.data?.themes ?? [];
  const codeList = codes.data ?? [];

  useEffect(() => { setFilters(EMPTY_FILTERS); setRunId(undefined); }, [column, version?.id]);
  const patch = useCallback((f: Partial<SegmentFilters>) => setFilters((p) => ({ ...p, page: 1, ...f })), []);

  const prepare = useWorkspaceMutation(pid, () => api.prepare(pid, { dataset_version_id: version!.id, column: column! }), {
    onSuccess: (job) => jobs.start(job, "Preparing text", [qualKey(pid)]),
  });
  const detect = useWorkspaceMutation(pid, (n?: number) => api.detect(pid, { dataset_version_id: version!.id, column: column!, ...(n ? { n_themes: n } : {}) }), {
    onSuccess: (job) => jobs.start(job, "Detecting themes", [qualKey(pid)], () => { setRunId(undefined); setPane("themes"); }),
  });
  const suggest = useWorkspaceMutation(pid, (o: { use_semantic: boolean; semantic_threshold: number }) => api.suggest(pid, { dataset_version_id: version!.id, column: column!, ...o }), {
    onSuccess: (job) => jobs.start(job, "Suggesting codes", [qualKey(pid), qk.codes(pid)], () => patch({ review: true })),
  });

  const header = <PageHeader eyebrow="Qualitative" title="Open-ended responses" description="Read what people said in their own words, group it into themes, and code it. Automatic themes and codes are suggestions; you decide what stands." />;

  if (loading || project.isLoading) return <>{header}<SkeletonRows n={5} /></>;
  if (!dataset || !version) {
    return <>{header}<EmptyState icon={<Database />} title="No dataset to read yet" description="Upload a dataset with a free-text column (survey comments, interview notes, tickets) to start coding it."
      action={<Button asChild><Link to={`/projects/${pid}/data`}>Go to Data</Link></Button>} /></>;
  }
  if (sources.isError) return <>{header}<ErrorState title="Couldn’t load the text columns" error={sources.error} onRetry={() => sources.refetch()} /></>;
  if (sources.isLoading) return <>{header}<SkeletonRows n={5} /></>;
  if (options.length === 0) {
    return <>{header}<EmptyState icon={<Type />} title="No text column in this dataset version" description="Qualitative work needs a column of written responses. None of this version’s columns looks like free text. Check the column types on the Data page, or switch dataset version."
      action={<Button asChild variant="secondary"><Link to={`/projects/${pid}/data`}>Review columns</Link></Button>} /></>;
  }

  const pc = (id: PaneId) => cn(pane === id ? "block" : "hidden", "min-w-0 lg:block");

  return (
    <div className="space-y-4">
      {header}
      {!canWrite && project.data && <Alert variant="info">You have view-only access. You can read, search and filter responses; coding, theme editing and detection are available to editors.</Alert>}
      <SourceBar options={options} column={column} onColumn={(c) => { setPicked(c); }} prepared={prepared} source={source} canWrite={canWrite}
        runs={runs} runId={runId} onRun={(id) => { setRunId(id); patch({ themeId: undefined }); }}
        onPrepare={() => prepare.mutate()} preparing={prepare.isPending}
        onDetect={async (n) => { await detect.mutateAsync(n); }} detecting={detect.isPending}
        exploring={exploring} onExplore={() => setExploring((v) => !v)} />
      <JobStrip started={jobs.started} onDismiss={jobs.dismiss} />

      {!prepared ? (
        <EmptyState icon={<Sparkles />} title={`Prepare “${column}” for analysis`}
          description={<>Preparing splits each response into sentence-sized segments and builds a semantic model of the wording, so Lotus can find similar responses, group them into themes and suggest codes. It reads your column only; your data is not changed.</>}
          action={canWrite ? <Button onClick={() => prepare.mutate()} loading={prepare.isPending}><Sparkles />Prepare text</Button> : <p className="text-sm text-muted-foreground">An editor needs to prepare this column first.</p>} />
      ) : (
        <>
          {exploring && column && <ExplorePanel pid={pid} versionId={version.id} column={column} />}
          <Tabs value={pane} onValueChange={(v) => setPane(v as PaneId)} className="lg:hidden">
            <TabsList aria-label="Workspace panes" className="w-full justify-around gap-2">
              <TabsTrigger value="codes">Codes</TabsTrigger><TabsTrigger value="responses">Responses</TabsTrigger><TabsTrigger value="themes">Themes</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid items-start gap-5 lg:grid-cols-[250px_minmax(0,1fr)_300px] xl:grid-cols-[270px_minmax(0,1fr)_330px]">
            <div className={pc("codes")}>
              <CodesPane pid={pid} canWrite={canWrite} activeCodeId={filters.codeId} onFilter={(id) => { patch({ codeId: id }); setPane("responses"); }}
                suggesting={suggest.isPending} onSuggest={async (o) => { await suggest.mutateAsync(o); }} />
            </div>
            <div className={pc("responses")}>
              {column && <ResponsesPane pid={pid} versionId={version.id} column={column} canWrite={canWrite} codes={codeList} themes={themeList} filters={filters} onChange={patch} />}
            </div>
            <div className={pc("themes")}>
              {column && <ThemesPane pid={pid} versionId={version.id} column={column} canWrite={canWrite} query={themes} activeThemeId={filters.themeId}
                onFilter={(id) => { patch({ themeId: id, unthemed: false }); setPane("responses"); }} onDetect={() => detect.mutate(undefined)} detecting={detect.isPending} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
