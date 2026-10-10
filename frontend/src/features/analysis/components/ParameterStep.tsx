import type { AnalysisType, Column } from "@/api/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { OPTION_HELP, PARAM_HELP, paramProblem, visibleOptions, type Draft, type Param } from "../builderModel";

const AUTO = "__auto__";

/** Only the settings that belong to the chosen analysis (and, where the data allows it, only the options that make sense). */
export function ParameterStep({ type, draft, columns, onChange }: { type: AnalysisType; draft: Draft; columns: Column[]; onChange: (key: string, value: unknown) => void }) {
  if (!type.parameters.length) {
    return <div className="rounded-xl border border-dashed bg-card/60 p-6 text-sm text-muted-foreground">{type.label} has no additional settings. Everything it needs comes from the variables you chose — continue to review and run.</div>;
  }
  return (
    <div className="space-y-5">
      {type.parameters.map((p) => <ParamField key={p.key} type={type} p={p} draft={draft} columns={columns} onChange={onChange} />)}
    </div>
  );
}

function ParamField({ type, p, draft, columns, onChange }: { type: AnalysisType; p: Param; draft: Draft; columns: Column[]; onChange: (k: string, v: unknown) => void }) {
  const id = `p-${p.key}`;
  const value = draft.params[p.key];
  const help = p.help || PARAM_HELP[`${type.type}.${p.key}`];
  const problem = paramProblem(p, value);
  return (
    <div className="rounded-xl border bg-card p-5">
      {p.type === "boolean" ? (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1"><Label htmlFor={id} className="text-sm">{p.label}</Label>{help && <p id={`${id}-h`} className="text-[13px] text-muted-foreground">{help}</p>}</div>
          <Switch id={id} aria-describedby={help ? `${id}-h` : undefined} checked={value === true} onCheckedChange={(v) => onChange(p.key, v)} />
        </div>
      ) : p.type === "select" ? (
        <fieldset className="space-y-3">
          <legend className="font-display text-base font-semibold">{p.label}</legend>
          {help && <p className="-mt-1 text-[13px] text-muted-foreground">{help}</p>}
          <RadioGroup value={String(value ?? "")} onValueChange={(v) => onChange(p.key, v)} aria-label={p.label} className="gap-2">
            {visibleOptions(type, p, draft, columns).map((o) => {
              const oid = `${id}-${o.value}`;
              const oh = OPTION_HELP[`${type.type}.${p.key}.${o.value}`];
              return (
                <label key={o.value} htmlFor={oid} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40", String(value) === o.value && "border-primary bg-accent/40")}>
                  <RadioItem id={oid} value={o.value} className="mt-0.5" />
                  <span className="min-w-0"><span className="block text-sm font-medium">{o.label}</span>{oh && <span className="block text-[13px] text-muted-foreground">{oh}</span>}</span>
                </label>
              );
            })}
          </RadioGroup>
        </fieldset>
      ) : p.type === "integer" ? (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor={id} className="text-sm">{p.label}</Label>
          <Input id={id} type="number" inputMode="numeric" min={p.min} max={p.max} step={1} value={value === null || value === undefined ? "" : String(value)} aria-invalid={!!problem} aria-describedby={`${id}-h`}
            onChange={(e) => onChange(p.key, e.target.value === "" ? "" : Number(e.target.value))} />
          <p id={`${id}-h`} className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")} role={problem ? "alert" : undefined}>
            {problem ?? [help, p.min != null && p.max != null ? `Between ${p.min} and ${p.max}.` : null].filter(Boolean).join(" ")}
          </p>
        </div>
      ) : (
        <TextParam type={type} p={p} id={id} value={value} help={help} draft={draft} columns={columns} onChange={onChange} />
      )}
    </div>
  );
}

/** Free-text setting; offers the values found in the outcome column when the profile knows them. */
function TextParam({ type, p, id, value, help, draft, columns, onChange }: { type: AnalysisType; p: Param; id: string; value: unknown; help?: string; draft: Draft; columns: Column[]; onChange: (k: string, v: unknown) => void }) {
  const outcome = type.roles.find((r) => r.key === "outcome");
  const col = outcome ? columns.find((c) => c.name === draft.vars[outcome.key]?.[0]) : undefined;
  const top = (col?.profile as { top_values?: { value: unknown }[] } | undefined)?.top_values?.map((t) => String(t.value)) ?? [];
  return (
    <div className="max-w-sm space-y-1.5">
      <Label htmlFor={id} className="text-sm">{p.label}</Label>
      {top.length >= 2 && top.length <= 12 ? (
        <SimpleSelect id={id} value={value ? String(value) : AUTO} onValueChange={(v) => onChange(p.key, v === AUTO ? null : v)} options={[{ value: AUTO, label: "Automatic (default)" }, ...top.map((v) => ({ value: v, label: v }))]} />
      ) : (
        <Input id={id} value={value == null ? "" : String(value)} placeholder="Automatic" onChange={(e) => onChange(p.key, e.target.value)} />
      )}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
