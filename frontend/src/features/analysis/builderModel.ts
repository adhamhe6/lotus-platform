/** Pure helpers behind the guided analysis builder (selection model, validation, deep-link presets, error routing). */
import type { AnalysisType, Column } from "@/api/types";
import { SEMANTIC_LABEL } from "@/lib/format";

export type Role = AnalysisType["roles"][number];
export type Param = AnalysisType["parameters"][number];
export interface Draft { type?: string; vars: Record<string, string[]>; params: Record<string, unknown>; title: string }
export const emptyDraft: Draft = { vars: {}, params: {}, title: "" };

export const STEP_LABELS = ["Dataset", "Analysis", "Variables", "Configuration", "Run"] as const;
export const STEP = { Dataset: 0, Analysis: 1, Variables: 2, Configuration: 3, Run: 4 } as const;

export const semanticLabel = (t: string) => SEMANTIC_LABEL[t] ?? t.replace(/_/g, " ");
export const accepts = (role: Role, col: Column) => role.accepts.includes(col.semantic_type);
export const minCount = (role: Role) => (role.required ? Math.max(1, role.min_count) : 0);

/** Why an analysis can't be run on this dataset (a required role has too few suitable columns), or null. */
export function unavailableReason(t: AnalysisType, cols: Column[]): string | null {
  for (const r of t.roles) {
    if (!r.required) continue;
    const n = cols.filter((c) => accepts(r, c)).length;
    if (n < minCount(r)) {
      const kinds = r.accepts.map(semanticLabel).join(" / ").toLowerCase();
      return `Needs ${minCount(r) > 1 ? `${minCount(r)} ` : "a "}${kinds} column${minCount(r) > 1 ? "s" : ""} — this dataset has ${n === 0 ? "none" : `only ${n}`}.`;
    }
  }
  return null;
}

export function defaultParams(t: AnalysisType): Record<string, unknown> {
  return Object.fromEntries(t.parameters.map((p) => [p.key, p.default ?? null]));
}

/** Spread a flat `vars=a,b,c` list over the roles in order; a multi-select role keeps what is left after later required single roles. */
export function spreadVars(t: AnalysisType, list: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let i = 0;
  t.roles.forEach((r, idx) => {
    const reserved = t.roles.slice(idx + 1).reduce((n, x) => n + minCount(x), 0);
    const take = r.multiple ? Math.max(0, list.length - i - reserved) : Math.min(1, list.length - i);
    out[r.key] = list.slice(i, i + take);
    i += take;
  });
  return out;
}

export interface Preset { type?: string; versionId?: string; draft: Draft; hasVars: boolean; hasConfig: boolean }

export function parsePreset(sp: URLSearchParams, types: AnalysisType[]): Preset {
  const type = sp.get("type") ?? undefined;
  const t = types.find((x) => x.type === type);
  const draft: Draft = { ...emptyDraft, type: t?.type, params: t ? defaultParams(t) : {} };
  let hasVars = false, hasConfig = false;
  if (t) {
    const vars = (sp.get("vars") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (vars.length) { draft.vars = spreadVars(t, vars); hasVars = true; }
    const raw = sp.get("config");
    if (raw) {
      try {
        const cfg = JSON.parse(raw) as Record<string, unknown>;
        for (const r of t.roles) if (cfg[r.key] != null) { draft.vars[r.key] = (Array.isArray(cfg[r.key]) ? (cfg[r.key] as unknown[]) : [cfg[r.key]]).map(String); hasVars = true; }
        for (const p of t.parameters) if (cfg[p.key] !== undefined) draft.params[p.key] = cfg[p.key];
        hasConfig = true;
      } catch { /* malformed preset: ignore, user can fill the form */ }
    }
  }
  return { type: t?.type, versionId: sp.get("version") ?? undefined, draft, hasVars, hasConfig };
}

/** Per-role problem text (null = fine). `cols` empty means "not loaded yet": only counts are checked. */
export function roleProblems(t: AnalysisType, draft: Draft, cols: Column[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const r of t.roles) {
    const sel = draft.vars[r.key] ?? [];
    const need = minCount(r);
    if (sel.length < need) out[r.key] = need > 1 ? `Choose at least ${need} variables.` : "Choose a variable.";
    else if (!r.multiple && sel.length > 1) out[r.key] = "Choose one variable only.";
    else {
      const bad = cols.length ? sel.find((n) => { const c = cols.find((x) => x.name === n); return !c || !accepts(r, c); }) : undefined;
      out[r.key] = bad ? `“${bad}” isn’t available as ${r.label.toLowerCase()} in this dataset version.` : null;
    }
  }
  return out;
}

export function paramProblem(p: Param, value: unknown): string | null {
  if (p.type !== "integer") return null;
  if (value === null || value === undefined || value === "") return "Enter a whole number.";
  const n = Number(value);
  if (!Number.isInteger(n)) return "Enter a whole number.";
  if (p.min != null && n < p.min) return `Must be at least ${p.min}.`;
  if (p.max != null && n > p.max) return `Must be at most ${p.max}.`;
  return null;
}

export const varsValid = (t: AnalysisType, d: Draft, cols: Column[]) => Object.values(roleProblems(t, d, cols)).every((x) => x === null);
export const paramsValid = (t: AnalysisType, d: Draft) => t.parameters.every((p) => paramProblem(p, d.params[p.key]) === null);

/** Request config: role keys → column name(s), then every parameter that has a value. */
export function buildConfig(t: AnalysisType, d: Draft): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const r of t.roles) {
    const sel = d.vars[r.key] ?? [];
    if (!sel.length) continue;
    cfg[r.key] = r.multiple ? sel : sel[0];
  }
  for (const p of t.parameters) {
    const v = d.params[p.key];
    if (v === null || v === undefined || v === "") continue;
    cfg[p.key] = p.type === "integer" ? Number(v) : v;
  }
  return cfg;
}

/** Group-comparison tests only make sense for the right number of groups: hide the others once we know it. */
const TWO_GROUP_TESTS = new Set(["welch_t", "mann_whitney"]);
const MANY_GROUP_TESTS = new Set(["anova", "kruskal"]);
export function visibleOptions(t: AnalysisType, p: Param, d: Draft, cols: Column[]) {
  const options = p.options ?? [];
  if (t.type !== "group_comparison" || p.key !== "test") return options;
  const g = cols.find((c) => c.name === d.vars.group?.[0]);
  if (!g || !g.unique_count) return options;
  return options.filter((o) => (g.unique_count === 2 ? !MANY_GROUP_TESTS.has(o.value) : !TWO_GROUP_TESTS.has(o.value)));
}

/** Plain-language help for options the API only labels (UI copy, not analytical output). */
export const OPTION_HELP: Record<string, string> = {
  "group_comparison.test.auto": "Lotus checks group sizes and normality, picks the appropriate test and records why in the result.",
  "group_comparison.test.welch_t": "Compares the averages of two groups without assuming they have equal spread.",
  "group_comparison.test.mann_whitney": "Rank-based comparison of two groups. Suited to skewed or ordinal outcomes.",
  "group_comparison.test.anova": "Compares the averages of three or more groups without assuming equal spread.",
  "group_comparison.test.kruskal": "Rank-based comparison of three or more groups. Suited to skewed or ordinal outcomes.",
  "correlation.method.pearson": "Measures how closely two variables follow a straight line.",
  "correlation.method.spearman": "Measures whether variables rise and fall together, even if not in a straight line. Less affected by outliers.",
  "time_series.frequency.auto": "Lotus chooses the period from how far apart your dates are.",
};
export const PARAM_HELP: Record<string, string> = {
  "linear_regression.robust_se": "Keeps the confidence intervals trustworthy when the spread of the errors is uneven (HC3 standard errors).",
  "time_series.window": "How many periods are averaged to draw the smoothed trend line.",
  "time_series.aggregation": "How values that fall in the same period are combined.",
  "time_series.frequency": "The size of the time bucket each point represents.",
  "frequency.top_n": "The largest number of categories listed individually.",
  "logistic_regression.positive_class": "The outcome value that counts as the event being predicted.",
};

/** Which step should show a server-side configuration error? Variables if it names a role/column, Configuration if it names a setting. */
export function stepForError(message: string, t: AnalysisType | undefined, d: Draft): number {
  if (!t) return STEP.Run;
  const m = message.toLowerCase();
  const chosen = Object.values(d.vars).flat();
  if (t.roles.some((r) => m.includes(r.label.toLowerCase())) || chosen.some((c) => m.includes(`'${c.toLowerCase()}'`) || m.includes(`“${c.toLowerCase()}”`) || m.includes(`"${c.toLowerCase()}"`))) return STEP.Variables;
  if (t.parameters.some((p) => m.includes(p.label.toLowerCase()) || new RegExp(`\\b${p.key.replace(/_/g, "[ _]")}\\b`).test(m))) return STEP.Configuration;
  return STEP.Run;
}
