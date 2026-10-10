import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { del, get } from "@/api/client";
import { qk, useProfile, useVersions } from "@/api/hooks";
import type { Dataset } from "@/api/types";
import { EmptyState, ErrorState, errorMessage, PageHeader, SkeletonRows } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveDataset } from "@/lib/activeDataset";
import { fmtBytes, fmtNumber } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { ColumnsTab } from "./ColumnsTab";
import { datasetError, versionName, type OpDraft } from "./model";
import { OverviewTab } from "./OverviewTab";
import { PrepareTab } from "./PrepareTab";
import { PreviewTab } from "./PreviewTab";
import { StatusChip, useCanEdit } from "./shared";
import { VersionsTab } from "./VersionsTab";

const TABS = ["overview", "columns", "preview", "prepare", "versions"] as const;
type Tab = (typeof TABS)[number];

export function DatasetPage() {
  const pid = useProjectId();
  const { datasetId = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const active = useActiveDataset();
  const { canEdit } = useCanEdit(pid);
  const [params, setParams] = useSearchParams();
  const [ops, setOps] = useState<OpDraft[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: dataset, isLoading, error, refetch } = useQuery({
    queryKey: ["dataset", datasetId, "detail"], queryFn: () => get<Dataset>(`/datasets/${datasetId}`), enabled: !!datasetId,
    refetchInterval: (q) => (q.state.data?.status === "PROCESSING" ? 1500 : false),
  });
  const { data: versions = [] } = useVersions(dataset?.status === "READY" ? datasetId : undefined);

  // Make this dataset the project's active one, so the top bar and other areas follow what you are looking at.
  const ready = dataset?.status === "READY";
  useEffect(() => { if (ready && active.dataset?.id !== datasetId) active.setDataset(datasetId); }, [ready, datasetId, active]);

  const activeHere = active.dataset?.id === datasetId;
  const version = (activeHere ? versions.find((v) => v.id === active.version?.id) : undefined) ?? versions[versions.length - 1];
  const { data: profile, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useProfile(ready ? datasetId : undefined, version?.id);

  const remove = useMutation({
    mutationFn: () => del(`/datasets/${datasetId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.datasets(pid) });
      qc.invalidateQueries({ queryKey: ["project", pid] });
      toast.success(`“${dataset?.name}” deleted`);
      nav(`/projects/${pid}/data`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const tabParam = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const setTab = (t: string) => { const next = new URLSearchParams(params); if (t === "overview") next.delete("tab"); else next.set("tab", t); setParams(next, { replace: true }); };
  const queueFix = (op: OpDraft) => { setOps((o) => [...o, op]); setTab("prepare"); };

  const back = <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3"><Link to={`/projects/${pid}/data`}><ArrowLeft />All datasets</Link></Button>;

  if (isLoading) return <div aria-busy aria-label="Loading">{back}<Skeleton className="mb-6 h-9 w-72" /><SkeletonRows n={5} /></div>;
  if (error || !dataset) return <div>{back}<ErrorState error={error ?? new Error("Dataset not found")} onRetry={() => refetch()} title="Couldn’t load this dataset" /></div>;

  const deleteButton = canEdit ? <Button variant="secondary" onClick={() => setConfirmDelete(true)}><Trash2 />Delete</Button> : null;
  const confirm = (
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this dataset?" loading={remove.isPending} confirmLabel="Delete dataset"
      description={<>“{dataset.name}” and all of its versions, plus the analyses, charts and themes derived from it, will be permanently removed. This cannot be undone.</>} onConfirm={() => remove.mutate()} />
  );

  if (dataset.status !== "READY") {
    return (
      <div>
        {back}
        <PageHeader title={dataset.name} description={`${dataset.original_filename} · ${fmtBytes(dataset.raw_size)}`} actions={<><StatusChip status={dataset.status} />{deleteButton}</>} />
        {dataset.status === "FAILED"
          ? <Alert variant="error" title="This file couldn’t be processed">{datasetError(dataset)}</Alert>
          : <Alert variant="info" title="Still processing">Reading the file, inferring column types and profiling the data. This page updates automatically.</Alert>}
        {confirm}
      </div>
    );
  }

  const fileLine = `${dataset.original_filename} · ${fmtBytes(dataset.raw_size)} · ${dataset.file_type.toUpperCase()}`;
  const analysisHref = version ? `/projects/${pid}/analysis/new?version=${encodeURIComponent(version.id)}` : `/projects/${pid}/analysis/new`;

  return (
    <div>
      {back}
      <PageHeader
        title={dataset.name}
        description={<>{fileLine}{version && <> · <span className="tabular">{fmtNumber(version.row_count)} rows × {fmtNumber(version.column_count)} columns</span></>}{dataset.description && <span className="mt-1 block">{dataset.description}</span>}</>}
        actions={<>
          {versions.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              Version
              <SimpleSelect aria-label="Dataset version" className="h-9 w-64 max-w-[60vw]" value={version?.id} onValueChange={(id) => { active.setVersion(id); setOps([]); }} options={[...versions].reverse().map((v) => ({ value: v.id, label: versionName(v) }))} />
            </label>
          )}
          {deleteButton}
          <Button asChild disabled={!version}><Link to={analysisHref}>Start analysis<ArrowRight /></Link></Button>
        </>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="scroll-thin -mx-1 overflow-x-auto px-1">
          <TabsList aria-label="Dataset sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="columns">Columns{profile && <Badge className="ml-0.5">{profile.columns.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="prepare">Prepare{ops.length > 0 && <Badge variant="primary" className="ml-0.5">{ops.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="versions">Versions{versions.length > 0 && <Badge className="ml-0.5">{versions.length}</Badge>}</TabsTrigger>
          </TabsList>
        </div>

        {!version || (profileLoading && !profile) ? (
          <div className="mt-5"><SkeletonRows n={6} /></div>
        ) : profileError || !profile ? (
          <div className="mt-5"><ErrorState error={profileError ?? new Error("No profile")} onRetry={() => refetchProfile()} title="Couldn’t load the data profile" /></div>
        ) : (<>
          <TabsContent value="overview"><OverviewTab pid={pid} dataset={dataset} version={version} profile={profile} canEdit={canEdit} onFix={queueFix} onPrepare={() => setTab("prepare")} /></TabsContent>
          <TabsContent value="columns"><ColumnsTab pid={pid} profile={profile} /></TabsContent>
          <TabsContent value="preview"><PreviewTab datasetId={datasetId} profile={profile} /></TabsContent>
          <TabsContent value="prepare">
            {canEdit
              ? <PrepareTab dataset={dataset} version={version} profile={profile} ops={ops} setOps={setOps} onCreated={() => setTab("versions")} />
              : <EmptyState compact title="Preparing data needs editor access" description="You can explore this dataset, but only project editors and owners can create cleaned versions." />}
          </TabsContent>
          <TabsContent value="versions"><VersionsTab versions={versions} currentId={version.id} onUse={(id) => { active.setVersion(id); setOps([]); }} /></TabsContent>
        </>)}
      </Tabs>
      {confirm}
    </div>
  );
}
