import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, UploadCloud, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/api/client";
import { qk, useJobQuery } from "@/api/hooks";
import type { Dataset, Job } from "@/api/types";
import { JobProgressView } from "@/components/common/JobProgress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { fmtBytes } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { cn } from "@/lib/utils";

/** Mirrors the server's default limit; the server stays authoritative. */
export const MAX_UPLOAD_MB = 50;
export const ACCEPTED_EXTENSIONS = ["csv", "tsv", "xlsx"];
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export function precheckFile(file: File): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (!ACCEPTED_EXTENSIONS.includes(ext)) return `“${file.name}” isn’t a supported file type. Upload a CSV, TSV or XLSX file.`;
  if (file.size > MAX_BYTES) return `“${file.name}” is ${fmtBytes(file.size)}, which is over the ${MAX_UPLOAD_MB} MB limit.`;
  return null;
}

const ERROR_TITLE: Record<string, string> = {
  UNSUPPORTED_FILE: "This file type isn’t supported",
  PAYLOAD_TOO_LARGE: "The file is too large",
  EMPTY_FILE: "The file is empty",
  EMPTY_DATASET: "The file has no data",
  INVALID_ENCODING: "The file encoding couldn’t be read",
};
export function uploadErrorTitle(e: unknown): string {
  return e instanceof ApiError ? ERROR_TITLE[e.code] ?? "The upload didn’t go through" : "The upload didn’t go through";
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

interface Submitted { dataset: Dataset; job: Job }

export function UploadDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { track } = useJobs();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const reset = () => { setFile(null); setFileError(null); setName(""); setNameTouched(false); setDescription(""); setSubmitted(null); upload.reset(); };

  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append("file", f, f.name);
      form.append("name", name.trim() || stem(f.name));
      form.append("description", description.trim());
      return api<{ dataset: Dataset; job: Job }>(`/projects/${projectId}/datasets`, { method: "POST", form });
    },
    onSuccess: ({ dataset, job }) => {
      qc.invalidateQueries({ queryKey: qk.datasets(projectId) });
      track(job, { title: `Importing “${dataset.name}”`, invalidate: [qk.datasets(projectId), ["dataset", dataset.id], ["project", projectId]] });
      setSubmitted({ dataset, job });
    },
  });

  const choose = (f: File | undefined | null) => {
    if (!f) return;
    upload.reset();
    const problem = precheckFile(f);
    setFileError(problem);
    setFile(problem ? null : f);
    if (!problem && !nameTouched) setName(stem(f.name));
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]); };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setTimeout(reset, 200); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a dataset</DialogTitle>
          <DialogDescription>CSV, TSV or Excel (.xlsx) up to {MAX_UPLOAD_MB} MB. Your original file is kept untouched; every cleaning step creates a new version.</DialogDescription>
        </DialogHeader>

        {submitted ? <SubmittedView projectId={projectId} s={submitted} onAnother={reset} /> : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(file); }} noValidate>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
              className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors", dragging ? "border-primary bg-accent/50" : "border-input bg-muted/30")}
            >
              {file ? (
                <div className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2 text-left">
                  <FileSpreadsheet className="size-5 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={file.name}>{file.name}</p><p className="tabular text-xs text-muted-foreground">{fmtBytes(file.size)}</p></div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove file" onClick={() => { setFile(null); if (input.current) input.current.value = ""; }}><X /></Button>
                </div>
              ) : (
                <>
                  <UploadCloud className="size-7 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">Drag a file here, or</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>Choose a file</Button>
                  <p className="text-xs text-muted-foreground">.csv, .tsv or .xlsx</p>
                </>
              )}
              <input ref={input} type="file" accept=".csv,.tsv,.xlsx" className="sr-only" aria-label="Dataset file" tabIndex={-1} onChange={(e) => choose(e.target.files?.[0])} />
            </div>
            {fileError && <Alert variant="error" title="That file can’t be uploaded">{fileError}</Alert>}

            <Field label="Dataset name" htmlFor="ds-name"><Input id="ds-name" value={name} maxLength={200} placeholder="e.g. Customer survey Q3" onChange={(e) => { setName(e.target.value); setNameTouched(true); }} /></Field>
            <Field label="Description (optional)" htmlFor="ds-desc"><Textarea id="ds-desc" value={description} maxLength={4000} placeholder="Where the data came from and what it contains" onChange={(e) => setDescription(e.target.value)} /></Field>

            {upload.isError && <Alert variant="error" title={uploadErrorTitle(upload.error)}>{upload.error.message}</Alert>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!file} loading={upload.isPending}>Upload dataset</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubmittedView({ projectId, s, onAnother }: { projectId: string; s: Submitted; onAnother: () => void }) {
  const { data } = useJobQuery(s.job.id);
  const job = data ?? s.job;
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="mb-2 text-sm font-medium">{s.dataset.name}</p>
        <JobProgressView job={job} />
      </div>
      {job.status === "COMPLETED" && <Alert variant="success" title="Dataset ready">Types were inferred and the data profiled. Check the dataset for import notes.</Alert>}
      {job.status === "FAILED" && <Alert variant="error" title="We couldn’t process this file">{(job.error?.message as string | undefined) ?? "The file could not be read."}</Alert>}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onAnother}>Upload another</Button>
        {job.status === "COMPLETED" && <Button asChild><Link to={`/projects/${projectId}/data/${s.dataset.id}`}>Open dataset</Link></Button>}
      </DialogFooter>
    </div>
  );
}
