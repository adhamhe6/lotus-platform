import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { MixedPage } from "./MixedPage";
import type { Comparison, MixedItem, MixedResult } from "./api";

const PID = "p1", VID = "v1", DID = "d1";
const col = (name: string, semantic_type: string, position: number) => ({ name, semantic_type, dtype: "x", position, missing_count: 0, missing_pct: 0, unique_count: 5, profile: {} });
const COLUMNS = [col("comment", "text", 0), col("region", "categorical", 1), col("age", "numeric_continuous", 2), col("delivery_time", "numeric_continuous", 3), col("satisfaction_score", "numeric_continuous", 4), col("customer_id", "identifier", 5)];
const version = { id: VID, dataset_id: DID, version_number: 1, created_at: "2026-01-01T00:00:00Z" };
const dataset = { id: DID, project_id: PID, name: "Feedback", description: "", status: "READY", latest_version: version };
const project = (role = "OWNER") => ({ id: PID, name: "Study", description: "", objective: "", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", role, counts: { datasets: 1, analyses: 0, insights: 0 } });

const cmp = (o: Partial<Comparison> = {}): Comparison => ({ n_with: 53, n_without: 456, mean_with: 72.3735849056604, mean_without: 75.66907894736843, median_with: 71.9, median_without: 75, test: "Welch t-test", p: 0.0258, p_adj: 0.8096, diff: -3.2954940417080394, ci: [-6.179340303517751, -0.41164777989832757], effect: -0.3323560014974923, effect_kind: "Hedges' g", significant: false, ...o });
const item = (o: Partial<MixedItem> = {}): MixedItem => ({
  id: "i1", name: "Delivery", kind: "theme", n_respondents: 141, prevalence_pct: 27.17, quotes: ["Late again, parcel sat in a depot.", "Late again, parcel sat in a depot."],
  outcome: cmp({ n_with: 141, n_without: 362, mean_with: 70.12, mean_without: 77.5, diff: -7.38, ci: [-10.1, -4.66], effect: -0.62, p_adj: 0.00031, significant: true }),
  comparisons: [{ ...cmp({ n_with: 141, n_without: 362, mean_with: 6.52, mean_without: 5.75, effect: 0.46, p_adj: 0.0002939, significant: true, diff: 0.77 }), column: "delivery_time" }, { ...cmp({ significant: false, p_adj: 1 }), column: "age" }],
  by_group: { column: "region", status: "tested", rates: { East: { n: 112, voiced: 30, pct: 26.79 }, West: { n: 133, voiced: 20, pct: 15.04 } }, chi2: 9.1, dof: 4, p: 0.03, p_adj: 0.2, cramers_v: 0.13, significant: false }, ...o,
});
const result = (o: Partial<MixedResult> = {}): MixedResult => ({
  overall: { respondents: 519, respondents_with_outcome: 509, outcome: "satisfaction_score", outcome_mean: 75.32593320235755, outcome_median: 74.9, tests_run: 35, items: 2 },
  items: [item(), item({ id: "i2", name: "Pricing", quotes: ["Too many hidden charges."], n_respondents: 70, prevalence_pct: 13.5, outcome: cmp({ significant: false, status: undefined }), by_group: null, comparisons: [] })],
  findings: [
    { id: "i1:outcome", kind: "outcome_difference", item: "Delivery", qualification: "strong", statement: "Respondents whose comments voice “Delivery” have lower satisfaction_score (70.12 vs 77.50). This is an association among respondents, not evidence of cause.", numbers: { mean_with: 70.12, mean_without: 77.5, diff: -7.38, g: -0.62, p_adj: 0.00031, n_with: 141, n_without: 362 } },
    { id: "i1:delivery_time", kind: "convergence", item: "Delivery", column: "delivery_time", qualification: "tentative", statement: "Convergent evidence: respondents voicing “Delivery” also record higher delivery_time.", numbers: { mean_with: 6.52, mean_without: 5.75, g: 0.46, p_adj: 0.0002939, n_with: 141, n_without: 362 } },
  ],
  warnings: ["10 of 519 respondents have no value for 'satisfaction_score' and are excluded from outcome comparisons."],
  thresholds: { alpha: 0.05, min_abs_g_outcome: 0.2, min_abs_g_convergence: 0.3, min_group_n: 8, correction: "Holm–Bonferroni across all tests in this run" },
  methodology: "Respondents who wrote a response form the analysis universe. Hard (single-label) themes understate secondary mentions.", ...o,
});
const evidence = [{ id: "E1", kind: "mixed", label: "Mixed-methods scope", text: "519 respondents with a written response.", source: {} }, { id: "E2", kind: "qualitative", label: "Representative response — Delivery", text: "“Late again.”", source: {} }];
const synth = (origin: "rule" | "llm", extra: Record<string, unknown> = {}) => ({
  summary: origin === "llm" ? "Delivery complaints coincide with lower satisfaction." : "Quantitative and qualitative evidence side by side.",
  points: [{ text: "Delivery is voiced by 141 respondents.", evidence: ["E1"] }, { text: "A representative response.", evidence: ["E2"] }], caveats: ["10 respondents lack an outcome."], next_steps: [],
  meta: { origin, provider: origin === "llm" ? "anthropic" : "deterministic", model: origin === "llm" ? "claude-test-1" : null, prompt_version: "v1", validation: { status: origin === "llm" ? "passed" : "skipped", problems: [] }, fallback_reason: null, generated_at: "2026-02-01T10:00:00Z", ...extra }, evidence,
});
const run = (id: string, o: Record<string, unknown> = {}) => ({ id, project_id: PID, dataset_version_id: VID, column_name: "comment", outcome_column: "satisfaction_score", group_column: null, config: { source: "themes" }, theme_snapshot: [], result: result(), synthesis: null, created_at: "2026-02-01T10:00:00Z", ...o });

interface Opts { runsError?: boolean; role?: string; runs?: unknown[]; themes?: unknown[]; codes?: unknown[] }
function setup(o: Opts = {}) {
  signIn();
  const calls: { method: string; path: string; body?: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const state = { runs: o.runs ?? [run("r1")], jobStatus: "RUNNING" };
  const rec = async (request: Request, path: string) => { let body: any; if (request.method !== "GET") { try { body = await request.json(); } catch { body = undefined; } } calls.push({ method: request.method, path, body }); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  server.use(
    http.get(`${API}/projects/${PID}`, () => j(project(o.role))),
    http.get(`${API}/projects/${PID}/datasets`, () => j([dataset])),
    http.get(`${API}/datasets/${DID}/versions`, () => j([version])),
    http.get(`${API}/datasets/${DID}/profile`, () => j({ columns: COLUMNS })),
    http.get(`${API}/projects/${PID}/mixed`, () => (o.runsError ? apiError(500, "BOOM", "Runs unavailable") : j(state.runs))),
    http.get(`${API}/projects/${PID}/qualitative/sources`, () => j([{ column: "comment", avg_words: 18, non_empty: 519, segments: 795, theme_runs: 1 }])),
    http.get(`${API}/projects/${PID}/qualitative/themes`, () => j({ themes: o.themes ?? [{ id: "t1" }], runs: [{ id: "run1", created_at: "2026-02-01T10:00:00Z", k: 6 }] })),
    http.get(`${API}/projects/${PID}/codes`, () => j(o.codes ?? [{ id: "c1", name: "Delivery", color: "#111111", accepted_count: 10, suggested_count: 0 }])),
    http.get(`${API}/jobs/:id`, () => j({ id: "job1", project_id: PID, type: "mixed_methods", status: state.jobStatus, stage: "Comparing outcome", progress: 50, completed_stages: 2, total_stages: 4, error: null, result: null, created_at: "2026-02-01T10:00:00Z" })),
    http.post(`${API}/projects/${PID}/mixed`, async ({ request }) => { await rec(request, "run"); return j({ id: "job1", project_id: PID, type: "mixed_methods", status: "RUNNING", stage: "Comparing outcome", progress: 50, completed_stages: 2, total_stages: 4, error: null, result: null, created_at: "2026-02-01T10:00:00Z" }, 202); }),
  );
  const view = renderApp(<MixedPage />, { route: `/projects/${PID}/mixed`, path: "/projects/:projectId/mixed", withProject: PID });
  return { ...view, calls, state, user: userEvent.setup(), last: (p: string) => calls.filter((c) => c.path === p).at(-1) };
}

describe("setup form", () => {
  it("offers only numeric outcomes, validates, and does not call the API when invalid", async () => {
    const t = setup({ runs: [] });
    expect(await screen.findByRole("form", { name: /mixed-methods analysis setup/i })).toBeInTheDocument();
    expect(screen.getByText(/each response sits in one theme/i)).toBeInTheDocument();
    expect(screen.getByText(/multi-label/i)).toBeInTheDocument();
    await t.user.click(await screen.findByRole("button", { name: /run mixed-methods analysis/i }));
    expect(await screen.findByText("Choose a numeric outcome.")).toBeInTheDocument();
    expect(t.last("run")).toBeUndefined();
    await t.user.click(screen.getByLabelText(/outcome \(numeric\)/i));
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.some((n) => n.startsWith("satisfaction_score"))).toBe(true);
    expect(names.some((n) => n.startsWith("delivery_time"))).toBe(true);
    expect(names.some((n) => n.startsWith("region"))).toBe(false);
    expect(names.some((n) => n.startsWith("comment"))).toBe(false);
    expect(names.some((n) => n.startsWith("customer_id"))).toBe(false);
  });

  it("submits the configured run, shows job progress and then the new run", async () => {
    const t = setup({ runs: [] });
    await t.user.click(await screen.findByLabelText(/outcome \(numeric\)/i));
    await t.user.click(screen.getByRole("option", { name: /satisfaction_score/ }));
    await t.user.click(screen.getByLabelText(/group by/i));
    await t.user.click(screen.getByRole("option", { name: "region" }));
    await t.user.click(screen.getByLabelText("Choose comparison variables myself"));
    await t.user.click(screen.getByRole("checkbox", { name: "delivery_time" }));
    await t.user.click(screen.getByRole("button", { name: /run mixed-methods analysis/i }));
    await waitFor(() => expect(t.last("run")?.body).toEqual({ dataset_version_id: VID, text_column: "comment", source: "themes", outcome: "satisfaction_score", group: "region", compare: ["delivery_time"] }));
    expect(await screen.findByText("Comparing outcome")).toBeInTheDocument();
    t.state.runs = [run("r1")]; t.state.jobStatus = "COMPLETED";
    expect(await screen.findByRole("table", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("sends the code source and omits optional fields when untouched", async () => {
    const t = setup({ runs: [] });
    await t.user.click(await screen.findByLabelText(/outcome \(numeric\)/i));
    await t.user.click(screen.getByRole("option", { name: /satisfaction_score/ }));
    await t.user.click(screen.getByRole("radio", { name: /codes/i }));
    await t.user.click(screen.getByRole("button", { name: /run mixed-methods analysis/i }));
    await waitFor(() => expect(t.last("run")?.body).toEqual({ dataset_version_id: VID, text_column: "comment", source: "codes", outcome: "satisfaction_score" }));
  });

  it("warns and blocks the run when there are no themes for the column", async () => {
    setup({ runs: [], themes: [] });
    expect(await screen.findByText("No themes for this column yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run mixed-methods analysis/i })).toBeDisabled();
  });
});

describe("results", () => {
  it("shows scope, the joint display with server values, and a chart built from them", async () => {
    setup();
    expect(await screen.findByText("519")).toBeInTheDocument();
    expect(screen.getByText("75.33")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText(/10 of 519 respondents have no value/)).toBeInTheDocument();
    const table = screen.getByRole("table");
    const row = within(table).getByRole("button", { name: /show details for delivery/i }).closest("tr")!;
    expect(row).toHaveTextContent("141");
    expect(row).toHaveTextContent("27.2%");
    expect(row).toHaveTextContent("70.12");
    expect(row).toHaveTextContent("77.5");
    expect(row).toHaveTextContent("-7.38");
    expect(row).toHaveTextContent("-10.1 to -4.66");
    expect(row).toHaveTextContent("-0.62");
    expect(row).toHaveTextContent("medium");
    expect(row).toHaveTextContent("< 0.001");
    expect(row).toHaveTextContent("Supported");
    const pricing = within(table).getByRole("button", { name: /show details for pricing/i }).closest("tr")!;
    expect(pricing).toHaveTextContent("Not significant");
    expect(pricing).toHaveTextContent("0.81");
    expect(screen.getByRole("figure")).toHaveAccessibleName(/mean satisfaction_score, with vs without each theme/i);
  });

  it("expands a row to quotes, convergence comparisons and by-group prevalence", async () => {
    const t = setup();
    await t.user.click(await screen.findByRole("button", { name: /show details for delivery/i }));
    const quote = within(screen.getAllByRole("table")[0]).getAllByText("Late again, parcel sat in a depot.");
    expect(quote).toHaveLength(1); // duplicates collapsed
    const conv = screen.getByRole("table", { name: /other measured variables/i });
    expect(within(conv).getByText("delivery_time")).toBeInTheDocument();
    expect(within(conv).getByText("6.52")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /share of respondents voicing this item, by region/i })).toHaveTextContent("26.8%");
    expect(screen.getByText(/Holm-adjusted p/)).toBeInTheDocument();
  });

  it("marks groups with too few respondents as insufficient", async () => {
    const t = setup({ runs: [run("r1", { result: result({ items: [item({ outcome: cmp({ status: "insufficient_n", p: null, p_adj: null, diff: null, ci: null, effect: null, mean_with: 3.5, n_with: 3, significant: undefined }) })], findings: [] }) })] });
    expect(await screen.findByText("Insufficient n")).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: /show details for delivery/i }));
  });

  it("layers each finding into quantitative and qualitative evidence with a qualification chip", async () => {
    setup();
    const card = (await screen.findAllByRole("article", { name: "Finding: Delivery" }))[0];
    const quant = within(card).getByRole("region", { name: "Quantitative evidence" });
    expect(quant).toHaveTextContent("not evidence of cause");
    expect(quant).toHaveTextContent("70.12");
    expect(within(card).getByRole("region", { name: "Qualitative evidence" })).toHaveTextContent("Late again, parcel sat in a depot.");
    expect(within(card).getByText("Strong")).toBeInTheDocument();
    const conv = screen.getAllByRole("article")[1];
    expect(within(conv).getByText("Tentative")).toBeInTheDocument();
    expect(within(conv).getByText(/Convergence · delivery_time/)).toBeInTheDocument();
  });

  it("explains that Lotus deliberately reports nothing weaker when no findings pass", async () => {
    setup({ runs: [run("r1", { result: result({ findings: [], warnings: ["No theme/code reached the evidence thresholds (Holm-adjusted p < 0.05 and |g| ≥ 0.2). Lotus does not report weaker patterns as findings."] }) })] });
    expect(await screen.findByText("No findings met the evidence thresholds")).toBeInTheDocument();
    expect(screen.getByText(/deliberately reports nothing weaker/i)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("offers thresholds and methodology on demand", async () => {
    const t = setup();
    const th = (await screen.findByText("Evidence thresholds")).closest("details")!;
    await t.user.click(screen.getByText("Evidence thresholds"));
    expect(th).toHaveTextContent("Holm–Bonferroni across all tests in this run");
    expect(th).toHaveTextContent("0.05");
    expect(screen.getByText(/single-label\) themes understate/)).toBeInTheDocument();
  });

  it("switches between runs", async () => {
    const t = setup({ runs: [run("r2", { result: result({ overall: { ...result().overall, respondents: 321 } }), outcome_column: "satisfaction_score", config: { source: "codes" } }), run("r1")] });
    expect(await screen.findByText("321")).toBeInTheDocument();
    await t.user.click(screen.getByLabelText("Analysis run"));
    await t.user.click(screen.getAllByRole("option")[1]);
    expect(await screen.findByText("519")).toBeInTheDocument();
    expect(screen.queryByText("321")).not.toBeInTheDocument();
  });

  it("deletes a run after confirmation", async () => {
    const t = setup();
    server.use(http.delete(`${API}/mixed/r1`, async ({ request }) => { t.calls.push({ method: request.method, path: "delete" }); t.state.runs = []; return new Response(null, { status: 204 }); }));
    await t.user.click(await screen.findByRole("button", { name: /delete run/i }));
    await t.user.click(screen.getByRole("button", { name: /^delete run$/i, hidden: false }));
    await waitFor(() => expect(t.last("delete")).toBeTruthy());
    expect(await screen.findByRole("form", { name: /mixed-methods analysis setup/i })).toBeInTheDocument();
  });

  it("shows an error state with retry when runs cannot be loaded", async () => {
    setup({ runsError: true });
    expect(await screen.findByText("Runs unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("synthesis", () => {
  it("generates a rule-based interpretation and labels it as such", async () => {
    const t = setup();
    server.use(http.post(`${API}/mixed/r1/synthesis`, async ({ request }) => { t.calls.push({ method: request.method, path: "synth" }); t.state.runs = [run("r1", { synthesis: synth("rule") })]; return j(run("r1", { synthesis: synth("rule") })); }));
    expect(await screen.findByText(/no interpretation has been generated/i)).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: /generate integrated interpretation/i }));
    expect(await screen.findByText("Rule-based summary")).toBeInTheDocument();
    expect(screen.queryByText("AI interpretation")).not.toBeInTheDocument();
    expect(screen.getByText("Delivery is voiced by 141 respondents.")).toBeInTheDocument();
    expect(screen.getByText("10 respondents lack an outcome.")).toBeInTheDocument();
    expect(t.last("synth")).toBeTruthy();
  });

  it("shows the AI badge with model and validation, and opens the evidence drawer from an evidence id", async () => {
    const t = setup({ runs: [run("r1", { synthesis: synth("llm") })] });
    expect(await screen.findByText("AI interpretation")).toBeInTheDocument();
    expect(screen.getByText("Model: claude-test-1")).toBeInTheDocument();
    expect(screen.getByText("Validation: passed")).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: "Show evidence E2" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Representative response — Delivery")).toBeInTheDocument();
    expect(within(drawer).getByText("Mixed-methods scope")).toBeInTheDocument();
  });

  it("explains why rule-based text replaced the AI interpretation", async () => {
    setup({ runs: [run("r1", { synthesis: synth("rule", { fallback_reason: "The model output failed number validation." }) })] });
    expect(await screen.findByText("Rule-based summary")).toBeInTheDocument();
    expect(screen.getByText(/failed number validation/)).toBeInTheDocument();
  });

  it("reports the rate limit without losing the page", async () => {
    const t = setup();
    server.use(http.post(`${API}/mixed/r1/synthesis`, () => apiError(429, "RATE_LIMITED", "Too many AI requests. Try again in 30 seconds.")));
    await t.user.click(await screen.findByRole("button", { name: /generate integrated interpretation/i }));
    expect(await screen.findByText(/too many ai requests/i)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("viewer role", () => {
  it("can read results but sees no write actions", async () => {
    setup({ role: "VIEWER", runs: [run("r1", { synthesis: synth("rule") })] });
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
    for (const n of [/new analysis/i, /delete run/i, /generate integrated/i, /regenerate/i, /run mixed-methods/i]) expect(screen.queryByRole("button", { name: n })).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
