import type { AnalysisType, Column } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { accepts, minCount, roleProblems, semanticLabel, type Draft } from "../builderModel";

/** One picker per analysis role. Every column is listed; unsuitable ones are disabled with the reason, never silently hidden. */
export function VariableStep({ type, columns, draft, onChange }: { type: AnalysisType; columns: Column[]; draft: Draft; onChange: (roleKey: string, names: string[]) => void }) {
  const problems = roleProblems(type, draft, columns);
  const usedElsewhere = (roleKey: string, name: string) => type.roles.find((r) => r.key !== roleKey && (draft.vars[r.key] ?? []).includes(name));
  return (
    <div className="space-y-5">
      {type.roles.map((role) => {
        const sel = draft.vars[role.key] ?? [];
        const need = minCount(role);
        const hid = `role-${role.key}`;
        const toggle = (name: string, on: boolean) => onChange(role.key, on ? (role.multiple ? [...sel, name] : [name]) : sel.filter((n) => n !== name));
        const err = problems[role.key];
        const invalid = !!err && sel.length > 0 && sel.length >= need;
        return (
          <fieldset key={role.key} className="rounded-xl border bg-card p-5" aria-describedby={`${hid}-hint`}>
            <legend className="-ml-1 px-1 font-display text-base font-semibold">{role.label}{role.required && <span className="ml-1 text-destructive" aria-label="required">*</span>}</legend>
            <p id={`${hid}-hint`} className="mb-3 text-[13px] text-muted-foreground">
              {role.help && <>{role.help} </>}
              {role.multiple ? (need > 1 ? `Choose at least ${need}.` : "Choose one or more.") : "Choose one."} Accepts {role.accepts.map(semanticLabel).join(", ").toLowerCase()} variables.
            </p>
            <div className="scroll-thin max-h-72 overflow-y-auto rounded-lg border">
              {role.multiple ? (
                <ul className="divide-y" role="group" aria-label={role.label}>
                  {columns.map((c) => <li key={c.name}><Row role={role} col={c} other={usedElsewhere(role.key, c.name)} selected={sel.includes(c.name)} multiple onToggle={(on) => toggle(c.name, on)} /></li>)}
                </ul>
              ) : (
                <RadioGroup value={sel[0] ?? ""} onValueChange={(v) => toggle(v, true)} aria-label={role.label} className="gap-0 divide-y">
                  {columns.map((c) => <Row key={c.name} role={role} col={c} other={usedElsewhere(role.key, c.name)} selected={sel[0] === c.name} onToggle={() => undefined} />)}
                </RadioGroup>
              )}
            </div>
            <p className={cn("mt-2 text-xs", invalid ? "text-destructive" : "text-muted-foreground")} role={invalid ? "alert" : undefined}>
              {err ?? `${sel.length} selected: ${sel.join(", ")}`}
            </p>
          </fieldset>
        );
      })}
    </div>
  );
}

function Row({ role, col, other, selected, multiple, onToggle }: { role: AnalysisType["roles"][number]; col: Column; other?: AnalysisType["roles"][number]; selected: boolean; multiple?: boolean; onToggle: (on: boolean) => void }) {
  const ok = accepts(role, col);
  const blocked = !ok || (!!other && !selected);
  const id = `v-${role.key}-${col.name}`;
  const why = !ok ? `Not usable here: ${semanticLabel(col.semantic_type).toLowerCase()} variables aren’t accepted for ${role.label.toLowerCase()}.` : other && !selected ? `Already used as ${other.label.toLowerCase()}.` : null;
  const common = { id, disabled: blocked, "aria-label": col.name, "aria-describedby": why ? `${id}-why` : undefined } as const;
  return (
    <div className={cn("flex items-start gap-3 px-3 py-2.5", blocked && "bg-muted/40", selected && "bg-accent/40")}>
      <div className="mt-0.5">{multiple ? <Checkbox {...common} checked={selected} onCheckedChange={(v) => onToggle(v === true)} /> : <RadioItem {...common} value={col.name} />}</div>
      <label htmlFor={id} className={cn("min-w-0 flex-1", blocked ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all text-sm font-medium">{col.name}</span>
          <Badge variant={ok ? "outline" : "default"}>{semanticLabel(col.semantic_type)}</Badge>
          <span className="tabular text-xs text-muted-foreground">{col.missing_count > 0 ? `${fmtPct(col.missing_pct)} missing` : "no missing values"}</span>
        </span>
        {why && <span id={`${id}-why`} className="mt-0.5 block text-xs">{why}</span>}
      </label>
    </div>
  );
}
