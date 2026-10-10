import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, FileText, Printer } from "lucide-react";
import { useRef, useState } from "react";
import { ErrorState, errorMessage } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchRender, reportKey, type Report } from "./reportsApi";

const EXT = { html: "html", markdown: "md", json: "json" } as const;
const MIME = { html: "text/html", markdown: "text/markdown", json: "application/json" } as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";

/** Server-rendered preview in a sandboxed frame (no scripts) plus export actions. The server composes all prose. */
export function PreviewTab({ report, pid, dirty }: { report: Report; pid: string; dirty: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: [...reportKey(pid, report.id), "render", "html", report.updated_at], queryFn: () => fetchRender(report.id, "html") });

  const download = async (format: keyof typeof EXT) => {
    setBusy(format); setExportError(null);
    try {
      const text = format === "html" && q.data ? q.data : await fetchRender(report.id, format);
      const url = URL.createObjectURL(new Blob([text], { type: `${MIME[format]};charset=utf-8` }));
      const a = document.createElement("a");
      a.href = url; a.download = `${slug(report.title)}.${EXT[format]}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setExportError(errorMessage(e)); } finally { setBusy(null); }
  };
  const print = () => { const w = frame.current?.contentWindow; w?.focus(); w?.print(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Export report">
        <Button variant="secondary" size="sm" onClick={print} disabled={!q.data}><Printer />Print / Save as PDF</Button>
        <Button variant="secondary" size="sm" loading={busy === "html"} onClick={() => void download("html")}><Download />Download HTML</Button>
        <Button variant="secondary" size="sm" loading={busy === "markdown"} onClick={() => void download("markdown")}><FileText />Download Markdown</Button>
        <Button variant="secondary" size="sm" loading={busy === "json"} onClick={() => void download("json")}><FileJson />Download JSON</Button>
      </div>
      {dirty && <Alert variant="warning">The preview and exports show the last saved version. Save your changes to include them.</Alert>}
      {exportError && <Alert variant="error" title="Export failed">{exportError}</Alert>}
      {q.isLoading ? <div aria-busy aria-label="Rendering preview" className="space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-[60vh] w-full" /></div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn’t render the preview" />
          : <iframe ref={frame} title="Report preview" srcDoc={q.data} sandbox="allow-same-origin allow-modals" className="h-[75vh] w-full rounded-lg border bg-white" />}
    </div>
  );
}
