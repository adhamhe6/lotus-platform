import { describe, expect, it } from "vitest";
import type { AnalysisType, Column } from "@/api/types";
import { buildConfig, parsePreset, roleProblems, spreadVars, stepForError, STEP, unavailableReason, visibleOptions, defaultParams, emptyDraft } from "./builderModel";
import { PROFILE, TYPES } from "./fixtures";

const types = TYPES as AnalysisType[];
const cols = PROFILE.columns as Column[];
const t = (name: string) => types.find((x) => x.type === name)!;

describe("builder model", () => {
  it("spreads a flat vars list over roles, leaving room for later required roles", () => {
    expect(spreadVars(t("group_comparison"), ["a", "b"])).toEqual({ outcome: ["a"], group: ["b"] });
    expect(spreadVars(t("linear_regression"), ["y", "x1", "x2"])).toEqual({ outcome: ["y"], predictors: ["x1", "x2"] });
    expect(spreadVars(t("correlation"), ["a", "b", "c"])).toEqual({ variables: ["a", "b", "c"] });
  });

  it("parses presets: unknown types are ignored, config overrides, bad JSON is tolerated", () => {
    expect(parsePreset(new URLSearchParams("type=nope"), types).type).toBeUndefined();
    const p = parsePreset(new URLSearchParams({ type: "frequency", version: "v1", config: JSON.stringify({ column: "region", top_n: 5 }) }), types);
    expect(p).toMatchObject({ type: "frequency", versionId: "v1", hasVars: true, hasConfig: true });
    expect(p.draft.vars).toEqual({ column: ["region"] });
    expect(p.draft.params).toEqual({ top_n: 5 });
    expect(parsePreset(new URLSearchParams("type=frequency&config={bad"), types).hasConfig).toBe(false);
  });

  it("builds the request config from roles (single → string, multiple → array) and filled parameters", () => {
    const d = { ...emptyDraft, type: "correlation", vars: { variables: ["a", "b"] }, params: defaultParams(t("correlation")) };
    expect(buildConfig(t("correlation"), d)).toEqual({ variables: ["a", "b"], method: "pearson" });
    const lr = { ...emptyDraft, vars: { outcome: ["y"], predictors: ["x"] }, params: { positive_class: "", robust_se: true } };
    expect(buildConfig(t("linear_regression"), lr)).toEqual({ outcome: "y", predictors: ["x"], robust_se: true });
    expect(buildConfig(t("logistic_regression"), { ...lr, params: { positive_class: null } })).toEqual({ outcome: "y", predictors: ["x"] });
  });

  it("validates roles against the column semantic types", () => {
    const d = { ...emptyDraft, vars: { outcome: ["channel"], group: ["region"] } };
    const p = roleProblems(t("group_comparison"), d, cols);
    expect(p.outcome).toMatch(/“channel” isn’t available as outcome/);
    expect(p.group).toBeNull();
    expect(roleProblems(t("correlation"), { ...emptyDraft, vars: { variables: ["age"] } }, cols).variables).toMatch(/at least 2/);
  });

  it("explains when a dataset can't support an analysis", () => {
    expect(unavailableReason(t("time_series"), cols)).toBeNull();
    expect(unavailableReason(t("time_series"), cols.filter((c) => c.semantic_type !== "datetime"))).toMatch(/needs a date\/time column — this dataset has none/i);
  });

  it("hides group-comparison tests that don't fit the number of groups", () => {
    const gc = t("group_comparison");
    const p = gc.parameters[0];
    const d = { ...emptyDraft, vars: { outcome: ["age"], group: ["retained"] } };
    expect(visibleOptions(gc, p, d, cols).map((o) => o.value)).toEqual(["auto", "welch_t", "mann_whitney"]);
    expect(visibleOptions(gc, p, { ...d, vars: { group: ["channel"] } }, cols).map((o) => o.value)).toEqual(["auto", "anova", "kruskal"]);
    expect(visibleOptions(gc, p, emptyDraft, cols)).toHaveLength(5);
  });

  it("routes server messages to the step they concern", () => {
    const gc = t("group_comparison");
    const d = { ...emptyDraft, vars: { outcome: ["satisfaction_score"], group: ["channel"] } };
    expect(stepForError("The selected outcome (numeric) 'x' must be numeric.", gc, d)).toBe(STEP.Variables);
    expect(stepForError("Column 'channel' has one level.", gc, d)).toBe(STEP.Variables);
    expect(stepForError("Unknown test requested.", gc, d)).toBe(STEP.Configuration);
    expect(stepForError("Something else went wrong.", gc, d)).toBe(STEP.Run);
  });
});
