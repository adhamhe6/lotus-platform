import { describe, expect, it } from "vitest";
import { columnsAfter, defaultDraft, fixForIssue, parseMapping, toPayload, validateDraft, type ColInfo, type OpDraft } from "./model";

const cols: ColInfo[] = [
  { name: "age", semantic_type: "numeric_continuous" }, { name: "region", semantic_type: "categorical" }, { name: "joined", semantic_type: "text" },
];
const d = (op: OpDraft["op"], patch: Partial<OpDraft> = {}) => defaultDraft(op, cols, patch);

describe("operation payloads match backend/app/datasets/transform.py", () => {
  it.each([
    [d("drop_duplicates"), { op: "drop_duplicates", keep: "first" }],
    [d("drop_duplicates", { columns: ["region"], keep: "last" }), { op: "drop_duplicates", keep: "last", subset: ["region"] }],
    [d("drop_missing", { columns: ["age"], how: "all" }), { op: "drop_missing", how: "all", columns: ["age"] }],
    [d("fill_missing", { column: "age", strategy: "mean" }), { op: "fill_missing", column: "age", strategy: "mean" }],
    [d("fill_missing", { column: "region", strategy: "constant", value: " Unknown " }), { op: "fill_missing", column: "region", strategy: "constant", value: "Unknown" }],
    [d("rename_column", { column: "age", newName: " age_years " }), { op: "rename_column", column: "age", new_name: "age_years" }],
    [d("cast_type", { column: "joined", to: "datetime", errors: "raise", dayfirst: true, format: "%d/%m/%Y" }), { op: "cast_type", column: "joined", to: "datetime", errors: "raise", dayfirst: true, format: "%d/%m/%Y" }],
    [d("cast_type", { column: "age", to: "integer" }), { op: "cast_type", column: "age", to: "integer", errors: "coerce" }],
    [d("filter_rows", { column: "age", operator: "gte", value: "18" }), { op: "filter_rows", column: "age", operator: "gte", value: "18" }],
    [d("filter_rows", { column: "age", operator: "between", value: "18", value2: "65" }), { op: "filter_rows", column: "age", operator: "between", value: ["18", "65"] }],
    [d("filter_rows", { column: "region", operator: "in", value: "East, West ,," }), { op: "filter_rows", column: "region", operator: "in", value: ["East", "West"] }],
    [d("filter_rows", { column: "age", operator: "is_null" }), { op: "filter_rows", column: "age", operator: "is_null" }],
    [d("normalize_categories", { column: "region", caseMode: "title", mapping: "N. America => North America\nUSA=>US" }), { op: "normalize_categories", column: "region", strip: true, collapse_whitespace: true, case: "title", mapping: { "N. America": "North America", USA: "US" } }],
    [d("normalize_categories", { column: "region" }), { op: "normalize_categories", column: "region", strip: true, collapse_whitespace: true, case: "none" }],
    [d("handle_outliers", { column: "age", method: "zscore", threshold: "3", action: "clip" }), { op: "handle_outliers", column: "age", method: "zscore", threshold: 3, action: "clip" }],
    [d("select_columns", { columns: ["age", "region"] }), { op: "select_columns", columns: ["age", "region"] }],
    [d("drop_columns", { columns: ["joined"] }), { op: "drop_columns", columns: ["joined"] }],
  ])("%j", (draft, expected) => {
    expect(toPayload(draft)).toEqual(expected);
    expect(validateDraft(draft)).toBeNull();
  });

  it("defaults adapt to the column type", () => {
    expect(d("fill_missing")).toMatchObject({ column: "age", strategy: "median" });
    expect(defaultDraft("fill_missing", [cols[1]])).toMatchObject({ column: "region", strategy: "mode" });
    expect(d("normalize_categories").column).toBe("region");
    expect(d("handle_outliers").column).toBe("age");
  });

  it("explains what is missing from an incomplete step", () => {
    expect(validateDraft(d("rename_column"))).toMatch(/new column name/i);
    expect(validateDraft(d("fill_missing", { strategy: "constant", value: "" }))).toMatch(/value to fill/i);
    expect(validateDraft(d("filter_rows", { operator: "between", value: "1" }))).toMatch(/both bounds/i);
    expect(validateDraft(d("filter_rows", { operator: "in", value: " , " }))).toMatch(/at least one value/i);
    expect(validateDraft(d("handle_outliers", { threshold: "0" }))).toMatch(/above 0/i);
    expect(validateDraft(d("select_columns"))).toMatch(/at least one column/i);
    expect(validateDraft(d("normalize_categories", { mapping: "oops" }))).toMatch(/old => new/);
  });

  it("parses replacement lines", () => {
    expect(parseMapping("a => b\n\n c=>d ")).toEqual({ a: "b", c: "d" });
    expect(parseMapping("=> b")).toBeNull();
  });
});

describe("builder helpers", () => {
  it("tracks the schema through renames, drops, selections and casts", () => {
    const after = columnsAfter(cols, [d("rename_column", { column: "age", newName: "age_years" }), d("cast_type", { column: "joined", to: "datetime" }), d("drop_columns", { columns: ["region"] })]);
    expect(after).toEqual([{ name: "age_years", semantic_type: "numeric_continuous" }, { name: "joined", semantic_type: "datetime" }]);
    expect(columnsAfter(cols, [d("select_columns", { columns: ["region"] })]).map((c) => c.name)).toEqual(["region"]);
  });

  it("pre-fills a fix for each fixable data-quality issue", () => {
    const issue = (code: string, column: string | null) => ({ severity: "warning", code, column, message: "" });
    expect(fixForIssue(issue("DUPLICATE_ROWS", null), cols)?.op).toBe("drop_duplicates");
    expect(fixForIssue(issue("SOME_MISSING", "age"), cols)).toMatchObject({ op: "fill_missing", column: "age", strategy: "median" });
    expect(fixForIssue(issue("HIGH_MISSING", "region"), cols)).toMatchObject({ op: "fill_missing", column: "region", strategy: "mode" });
    expect(fixForIssue(issue("OUTLIERS", "age"), cols)).toMatchObject({ op: "handle_outliers", column: "age" });
    expect(fixForIssue(issue("CONSTANT_COLUMN", "region"), cols)).toMatchObject({ op: "drop_columns", columns: ["region"] });
    expect(fixForIssue(issue("SOMETHING_ELSE", "age"), cols)).toBeNull();
    expect(fixForIssue(issue("OUTLIERS", "gone"), cols)).toBeNull();
  });
});
