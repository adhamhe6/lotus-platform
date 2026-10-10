import { zodResolver } from "@hookform/resolvers/zod";
import { Play } from "lucide-react";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import type { Column } from "@/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { SimpleSelect } from "@/components/ui/select";
import { Field, Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fmtDate } from "@/lib/format";
import { useCodes, useThemeRuns, type MixedBody, type TextSource } from "./api";

const NUMERIC = ["numeric_continuous", "numeric_discrete", "binary"];
const GROUPABLE = ["categorical", "boolean", "binary"];
const NONE = "__none";
const LATEST = "__latest";

const hintFor = (c: Column) => (c.semantic_type === "binary" ? "binary 0/1" : c.semantic_type === "numeric_discrete" ? "discrete" : "continuous");

export function ConfigForm({ pid, versionId, columns, sources, busy, onSubmit }: {
  pid: string; versionId: string; columns: Column[]; sources: TextSource[]; busy: boolean; onSubmit: (b: MixedBody) => void;
}) {
  const numeric = useMemo(() => columns.filter((c) => NUMERIC.includes(c.semantic_type)), [columns]);
  const groupable = useMemo(() => columns.filter((c) => GROUPABLE.includes(c.semantic_type)), [columns]);
  const schema = useMemo(() => z.object({
    text_column: z.string().min(1, "Choose the text column to integrate."),
    source: z.enum(["themes", "codes"]),
    theme_run_id: z.string(),
    outcome: z.string().min(1, "Choose a numeric outcome.").refine((v) => numeric.some((c) => c.name === v), "The outcome must be a numeric column."),
    group: z.string(),
    manual_compare: z.boolean(),
    compare: z.array(z.string()),
  }), [numeric]);
  type V = z.infer<typeof schema>;
  const prepared = sources.filter((s) => s.segments > 0);
  const { control, handleSubmit, watch, formState: { errors } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: { text_column: (prepared[0] ?? sources[0])?.column ?? "", source: "themes", theme_run_id: LATEST, outcome: "", group: NONE, manual_compare: false, compare: [] },
  });
  const [col, source, outcome, manual] = watch(["text_column", "source", "outcome", "manual_compare"]);
  const themes = useThemeRuns(pid, versionId, col || undefined);
  const codes = useCodes(pid);
  const runs = themes.data?.runs ?? [];
  const noItems = source === "themes" ? (!!col && themes.isSuccess && themes.data.themes.length === 0) : codes.isSuccess && !codes.data.some((c) => c.accepted_count > 0);

  const submit = handleSubmit((v) => {
    onSubmit({
      dataset_version_id: versionId, text_column: v.text_column, source: v.source, outcome: v.outcome,
      ...(v.group !== NONE ? { group: v.group } : {}),
      ...(v.manual_compare ? { compare: v.compare.filter((c) => c !== v.outcome) } : {}),
      ...(v.source === "themes" && v.theme_run_id !== LATEST ? { theme_run_id: v.theme_run_id } : {}),
    });
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate aria-label="Mixed-methods analysis setup">
      <div className="grid gap-4 md:grid-cols-2">
        <Controller control={control} name="text_column" render={({ field }) => (
          <Field label="Text column" htmlFor="mx-col" error={errors.text_column?.message} hint="The open-ended responses whose themes or codes are compared with the numbers.">
            <SimpleSelect id="mx-col" value={field.value || undefined} onValueChange={field.onChange} placeholder="Choose a column"
              options={sources.map((s) => ({ value: s.column, label: s.column, hint: s.segments > 0 ? "prepared" : "not prepared" }))} />
          </Field>
        )} />
        <Controller control={control} name="outcome" render={({ field }) => (
          <Field label="Outcome (numeric)" htmlFor="mx-outcome" error={errors.outcome?.message} hint="The measured result to compare, such as a satisfaction score. Only numeric columns are offered.">
            <SimpleSelect id="mx-outcome" value={field.value || undefined} onValueChange={field.onChange} placeholder="Choose a numeric column"
              options={numeric.map((c) => ({ value: c.name, label: c.name, hint: hintFor(c) }))} />
          </Field>
        )} />
      </div>

      <Controller control={control} name="source" render={({ field }) => (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Compare by</legend>
          <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 md:grid-cols-2">
            {([["themes", "Themes", "Each response sits in one theme (single-label). Simple to read, but a response that raises two topics counts under only one."], ["codes", "Codes", "Each response can carry several accepted codes (multi-label), so secondary topics are counted. Only codes you have accepted are used; suggestions are ignored."]] as const).map(([v, t, d]) => (
              <label key={v} htmlFor={`mx-src-${v}`} className="flex cursor-pointer gap-3 rounded-lg border bg-card p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40">
                <RadioItem id={`mx-src-${v}`} value={v} className="mt-0.5" />
                <span><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      )} />

      {source === "themes" && runs.length > 1 && (
        <Controller control={control} name="theme_run_id" render={({ field }) => (
          <Field label="Theme set" htmlFor="mx-run" className="max-w-sm" hint="Which detection run to use. Latest is the default.">
            <SimpleSelect id="mx-run" value={field.value} onValueChange={field.onChange}
              options={[{ value: LATEST, label: "Latest theme set" }, ...runs.map((r) => ({ value: r.id, label: fmtDate(r.created_at, true), hint: r.k != null ? `${r.k} themes` : undefined }))]} />
          </Field>
        )} />
      )}
      {noItems && (
        <Alert variant="warning" title={source === "themes" ? "No themes for this column yet" : "No accepted codes yet"}>
          {source === "themes" ? "Detect themes first, then come back." : "Accept some code suggestions or code responses by hand first."}{" "}
          <Link className="font-medium underline" to={`/projects/${pid}/qualitative`}>Open the qualitative workspace</Link>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Controller control={control} name="group" render={({ field }) => (
          <Field label="Group by (optional)" htmlFor="mx-group" hint="Adds whether each theme or code is voiced more in some groups, such as region.">
            <SimpleSelect id="mx-group" value={field.value} onValueChange={field.onChange} options={[{ value: NONE, label: "No grouping" }, ...groupable.map((c) => ({ value: c.name, label: c.name }))]} />
          </Field>
        )} />
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="mx-manual">Choose comparison variables myself</Label>
            <Controller control={control} name="manual_compare" render={({ field }) => <Switch id="mx-manual" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          <p className="text-xs text-muted-foreground">{manual ? "Each ticked numeric column is compared with and without every theme or code, to check whether the comments and the measures agree." : "Off: Lotus compares up to eight other numeric columns automatically."}</p>
        </div>
      </div>
      {manual && (
        <Controller control={control} name="compare" render={({ field }) => (
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Comparison variables (numeric)</legend>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {numeric.filter((c) => c.name !== outcome).map((c) => {
                const on = field.value.includes(c.name);
                return <label key={c.name} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"><Checkbox checked={on} onCheckedChange={(v) => field.onChange(v === true ? [...field.value, c.name] : field.value.filter((x) => x !== c.name))} />{c.name}</label>;
              })}
            </div>
            <p className="text-xs text-muted-foreground">Leave all unticked to run with the outcome only.</p>
          </fieldset>
        )} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={noItems}><Play />Run mixed-methods analysis</Button>
        <p className="text-xs text-muted-foreground">Compares respondents who voiced each theme or code with those who did not. Results describe association, not cause.</p>
      </div>
    </form>
  );
}
