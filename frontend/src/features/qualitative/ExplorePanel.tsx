import { Search } from "lucide-react";
import { useState } from "react";
import { ErrorState } from "@/components/common/blocks";
import { Provenance } from "@/components/common/Provenance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtNumber, fmtPct } from "@/lib/format";
import { useKeywordCount, useKeywords, useSemanticSearch } from "./api";

function SemanticSearch({ pid, versionId, column }: { pid: string; versionId: string; column: string }) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const res = useSemanticSearch(pid, versionId, column, q);
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }} role="search">
        <Field label="Describe what you are looking for" htmlFor="sem-q" className="min-w-[220px] flex-1" hint="Finds responses with similar meaning or wording, not only exact words.">
          <Input id="sem-q" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. parcel arrived late" minLength={2} />
        </Field>
        <Button type="submit" disabled={input.trim().length < 2}><Search />Search</Button>
      </form>
      {res.isFetching && <p className="text-sm text-muted-foreground" aria-live="polite">Searching…</p>}
      {res.isError && <ErrorState title="Search failed" error={res.error} />}
      {res.data && !res.isFetching && (
        res.data.results.length === 0 ? <p className="text-sm text-muted-foreground">No responses are similar enough to “{res.data.query}”. Try different words.</p> : (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Provenance kind="computed" label="Similarity is computed" />{res.data.embedding_model && <span>Model: {res.data.embedding_model}</span>}</div>
            <ol className="space-y-1.5" aria-label="Most similar responses">
              {res.data.results.map((r) => (
                <li key={r.segment_id} className="flex items-start gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                  <span className="tabular w-12 shrink-0 rounded bg-computed-bg px-1.5 py-0.5 text-center text-xs font-semibold text-computed" aria-label={`Similarity ${r.similarity}`}>{r.similarity}</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )
      )}
    </div>
  );
}

function Keywords({ pid, versionId, column }: { pid: string; versionId: string; column: string }) {
  const kw = useKeywords(pid, versionId, column, true);
  if (kw.isLoading) return <p className="text-sm text-muted-foreground">Counting terms…</p>;
  if (kw.isError) return <ErrorState title="Couldn’t load keywords" error={kw.error} onRetry={() => kw.refetch()} />;
  const terms = kw.data?.terms ?? [];
  if (!terms.length) return <p className="text-sm text-muted-foreground">No frequent terms found.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Most frequent terms across <span className="tabular">{fmtNumber(kw.data?.segments)}</span> responses (common words removed). <Provenance kind="computed" /></p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Most frequent terms</caption>
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-semibold">Term</th><th className="py-1 pr-3 text-right font-semibold">Responses</th><th className="py-1 text-right font-semibold">Share</th></tr></thead>
        <tbody>{terms.map((t) => <tr key={t.term} className="border-t"><td className="py-1 pr-3">{t.term}</td><td className="tabular py-1 pr-3 text-right">{fmtNumber(t.responses)}</td><td className="tabular py-1 text-right">{fmtPct(t.pct)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function KeywordCounter({ pid, versionId, column }: { pid: string; versionId: string; column: string }) {
  const [input, setInput] = useState("");
  const [terms, setTerms] = useState("");
  const res = useKeywordCount(pid, versionId, column, terms);
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setTerms(input.split(",").map((t) => t.trim()).filter(Boolean).join(",")); }}>
        <Field label="Terms to count" htmlFor="kw-terms" className="min-w-[220px] flex-1" hint="Comma-separated. Whole words only; end with * for any suffix, e.g. deliver* matches delivery and delivered.">
          <Input id="kw-terms" value={input} onChange={(e) => setInput(e.target.value)} placeholder="deliver*, refund, late" />
        </Field>
        <Button type="submit" disabled={!input.trim()}>Count</Button>
      </form>
      {res.isError && <ErrorState title="Couldn’t count terms" error={res.error} />}
      {res.data && (
        <table className="w-full text-sm"><caption className="sr-only">Keyword counts</caption>
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-semibold">Term</th><th className="py-1 pr-3 text-right font-semibold">Responses</th><th className="py-1 text-right font-semibold">Share</th></tr></thead>
          <tbody>{res.data.terms.map((t) => <tr key={t.term} className="border-t"><td className="py-1 pr-3 font-mono text-[13px]">{t.term}</td><td className="tabular py-1 pr-3 text-right">{fmtNumber(t.responses)}</td><td className="tabular py-1 text-right">{fmtPct(t.pct)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}

export function ExplorePanel({ pid, versionId, column }: { pid: string; versionId: string; column: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <Tabs defaultValue="search">
        <TabsList aria-label="Explore the text" className="h-auto w-full flex-wrap gap-x-4 gap-y-1">
          <TabsTrigger value="search">Semantic search</TabsTrigger>
          <TabsTrigger value="keywords">Frequent terms</TabsTrigger>
          <TabsTrigger value="count">Keyword counter</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="pt-3"><SemanticSearch pid={pid} versionId={versionId} column={column} /></TabsContent>
        <TabsContent value="keywords" className="pt-3"><Keywords pid={pid} versionId={versionId} column={column} /></TabsContent>
        <TabsContent value="count" className="pt-3"><KeywordCounter pid={pid} versionId={versionId} column={column} /></TabsContent>
      </Tabs>
    </div>
  );
}
