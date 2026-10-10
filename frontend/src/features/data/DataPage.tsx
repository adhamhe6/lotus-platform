import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { del } from "@/api/client";
import { qk, useDatasets } from "@/api/hooks";
import type { Dataset } from "@/api/types";
import { EmptyState, ErrorState, errorMessage, PageHeader, SkeletonRows } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtBytes, fmtDate, fmtNumber, fmtPct } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { datasetError, readQuality, readWarnings, warningCount } from "./model";
import { IngestWarnings, QualityBadge, StatusChip, useCanEdit } from "./shared";
import { UploadDialog } from "./UploadDialog";

export function DataPage() {
  const pid = useProjectId();
  const qc = useQueryClient();
  const { data: datasets, isLoading, error, refetch } = useDatasets(pid);
  const { canEdit } = useCanEdit(pid);
  const [params, setParams] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(params.get("upload") === "1");
  const [toDelete, setToDelete] = useState<Dataset | null>(null);

  useEffect(() => { if (params.get("upload") === "1") setUploadOpen(true); }, [params]);
  const setOpen = (o: boolean) => {
    setUploadOpen(o);
    if (!o && params.has("upload")) { const next = new URLSearchParams(params); next.delete("upload"); setParams(next, { replace: true }); }
  };

  const remove = useMutation({
    mutationFn: (d: Dataset) => del(`/datasets/${d.id}`),
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: qk.datasets(pid) });
      qc.invalidateQueries({ queryKey: ["project", pid] });
      toast.success(`“${d.name}” deleted`);
      setToDelete(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const uploadButton = canEdit ? <Button onClick={() => setOpen(true)}><Plus />Upload dataset</Button> : null;

  return (
    <div>
      <PageHeader title="Data" eyebrow="Workspace" description="Every dataset in this project, with its latest version, quality warnings and lineage. Original files are never modified." actions={uploadButton} />

      {isLoading ? <SkeletonRows n={4} /> : error ? <ErrorState error={error} onRetry={() => refetch()} title="Couldn’t load datasets" /> : !datasets?.length ? (
        <EmptyState
          icon={<Database />} title="No datasets yet" description="Upload your first dataset to begin analysis."
          action={canEdit ? <Button onClick={() => setOpen(true)}><Plus />Upload dataset</Button> : <p className="text-sm text-muted-foreground">Ask a project editor to upload data.</p>}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Dataset</TH><TH>Type</TH><TH className="text-right">Rows × columns</TH><TH className="text-right">Missing</TH><TH className="text-right">Versions</TH><TH>Quality</TH><TH>Status</TH><TH>Created</TH>
                {canEdit && <TH><span className="sr-only">Actions</span></TH>}
              </TR>
            </THead>
            <TBody>
              {datasets.map((d) => <DatasetRow key={d.id} d={d} pid={pid} canEdit={canEdit} onDelete={() => setToDelete(d)} />)}
            </TBody>
          </Table>
        </Card>
      )}

      {canEdit && <UploadDialog projectId={pid} open={uploadOpen} onOpenChange={setOpen} />}
      <ConfirmDialog
        open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }} title="Delete this dataset?" loading={remove.isPending}
        description={<>“{toDelete?.name}” and all of its versions, plus the analyses, charts and themes derived from it, will be permanently removed. This cannot be undone.</>}
        confirmLabel="Delete dataset" onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </div>
  );
}

function DatasetRow({ d, pid, canEdit, onDelete }: { d: Dataset; pid: string; canEdit: boolean; onDelete: () => void }) {
  const v = d.latest_version;
  const q = readQuality(v);
  const warnings = readWarnings(v);
  const failed = d.status === "FAILED";
  const cols = canEdit ? 9 : 8;
  return (
    <Fragment>
      <TR>
        <TD className="min-w-56 max-w-80">
          {failed || d.status === "PROCESSING"
            ? <span className="font-medium">{d.name}</span>
            : <Link to={`/projects/${pid}/data/${d.id}`} className="font-medium text-primary hover:underline">{d.name}</Link>}
          <p className="truncate text-xs text-muted-foreground" title={d.original_filename}>{d.original_filename} · {fmtBytes(d.raw_size)}</p>
        </TD>
        <TD><Badge variant="outline" className="uppercase">{d.file_type}</Badge></TD>
        <TD className="tabular whitespace-nowrap text-right">{v ? `${fmtNumber(v.row_count)} × ${fmtNumber(v.column_count)}` : "—"}</TD>
        <TD className="tabular text-right">{q ? fmtPct(q.missing_pct) : "—"}</TD>
        <TD className="tabular text-right">{d.version_count ? fmtNumber(d.version_count) : "—"}</TD>
        <TD>{d.status === "READY" ? <QualityBadge count={warningCount(d)} /> : <span className="text-muted-foreground">—</span>}</TD>
        <TD><StatusChip status={d.status} /></TD>
        <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(d.created_at)}</TD>
        {canEdit && (
          <TD className="text-right">
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.name}`} onClick={onDelete}><Trash2 /></Button>
          </TD>
        )}
      </TR>
      {failed && (
        <TR className="hover:bg-transparent"><TD colSpan={cols} className="pb-3 pt-0">
          <Alert variant="error" title="This file couldn’t be processed" action={canEdit ? <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 />Delete</Button> : undefined}>{datasetError(d)}</Alert>
        </TD></TR>
      )}
      {d.status === "PROCESSING" && (
        <TR className="hover:bg-transparent"><TD colSpan={cols} className="pb-3 pt-0"><Alert variant="info" title="Processing">Reading the file, inferring column types and profiling the data. This page updates automatically.</Alert></TD></TR>
      )}
      {warnings.length > 0 && (
        <TR className="hover:bg-transparent"><TD colSpan={cols} className="pb-3 pt-0"><IngestWarnings warnings={warnings} /></TD></TR>
      )}
    </Fragment>
  );
}
