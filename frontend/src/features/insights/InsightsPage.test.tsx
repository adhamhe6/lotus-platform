import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ANALYSIS_GC, EXPLAIN_RULE, INSIGHTS, PID } from "@/features/analysis/fixtures";
import { base, installBase, mountAnalysis } from "@/features/analysis/testUtils";
import { server } from "@/test/server";
import { API, apiError, j } from "@/test/utils";

const [ASSOC, MIXED, GROUP] = INSIGHTS;
const url = `${base}/insights`;
const job = (status: string, extra: object = {}) => ({ id: "gen-1", project_id: PID, type: "generate_insights", status, stage: "Deriving insights", progress: 0.4, total_stages: 3, completed_stages: 1, params: {}, result_ref: null, error: null, attempts: 1, created_at: "2026-10-10T10:00:00Z", started_at: null, completed_at: null, ...extra });
const llmNarrative = { ...EXPLAIN_RULE, meta: { ...EXPLAIN_RULE.meta, origin: "llm", provider: "anthropic", model: "claude-sonnet-5", validation: { status: "passed", problems: [] } } };

describe("InsightsPage — feed", () => {
  it("shows evidence-first cards: qualification, computed statement, evidence strip, variables and source", async () => {
    installBase();
    server.use(http.get(`${API}/projects/${PID}/insights`, () => j(INSIGHTS)));
    mountAnalysis(url);
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(3);
    const card = cards[0];
    expect(within(card).getByRole("heading", { name: ASSOC.title })).toBeInTheDocument();
    expect(within(card).getByText("Association")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /strong evidence\. very unlikely to be chance/i })).toBeInTheDocument();
    expect(within(card).getByText(ASSOC.statement)).toBeInTheDocument();
    expect(within(card).getByText("Computed")).toBeInTheDocument(); // provenance: the statement is computed, not AI
    // evidence strip: label → value, p-values through fmtP
    const strip = within(card).getAllByRole("definition").map((d) => d.textContent);
    expect(strip).toEqual(["-0.514", "< 0.001", "571"]);
    expect(within(card).getByText("Holm-adjusted p")).toBeInTheDocument();
    expect(within(card).getByLabelText("Variables")).toHaveTextContent("satisfaction_scoredelivery_time");
    expect(within(card).getByRole("link", { name: /source: correlation matrix — 7 variables/i })).toHaveAttribute("href", `${base}/analysis/${ASSOC.analysis_run_id}`);
    expect(within(cards[1]).getByRole("link", { name: /source: mixed-methods run/i })).toHaveAttribute("href", `${base}/mixed`);
  });

  it("explains the qualification thresholds in a tooltip-accessible chip", async () => {
    installBase();
    server.use(http.get(`${API}/projects/${PID}/insights`, () => j([{ ...GROUP, qualification: "tentative" }])));
    const user = userEvent.setup();
    mountAnalysis(url);
    const chip = await screen.findByRole("button", { name: /tentative evidence/i });
    expect(chip).toHaveAccessibleName(/n ≥ 30, p < 0\.05/);
    await user.hover(chip);
    expect((await screen.findAllByText(/treat it as a lead to check/i)).length).toBeGreaterThan(0);
  });

  it("filters by kind and pinned state on the server", async () => {
    installBase();
    const seen: URLSearchParams[] = [];
    server.use(http.get(`${API}/projects/${PID}/insights`, ({ request }) => { seen.push(new URL(request.url).searchParams); return j(INSIGHTS); }));
    const user = userEvent.setup();
    mountAnalysis(url);
    await screen.findAllByRole("article");
    await user.click(screen.getByLabelText("Kind"));
    await user.click(await screen.findByRole("option", { name: "Group difference" }));
    await waitFor(() => expect(seen.at(-1)?.get("kind")).toBe("group_difference"));
    await user.click(screen.getByRole("switch", { name: /pinned only/i }));
    await waitFor(() => expect(seen.at(-1)?.get("pinned")).toBe("true"));
  });

  it("empty state explains the thresholds and why noise is not turned into insights", async () => {
    installBase();
    server.use(http.get(`${API}/projects/${PID}/insights`, () => j([])));
    mountAnalysis(url);
    expect(await screen.findByText("No insights generated yet. Run an analysis to uncover patterns.")).toBeInTheDocument();
    expect(screen.getByText(/at least 30 observations, p < 0\.05 and a minimum effect size/i)).toBeInTheDocument();
    expect(screen.getByText(/deliberately doesn’t turn noise into insights/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new analysis/i })).toHaveAttribute("href", `${base}/analysis/new`);
  });

  it("shows an error state with retry", async () => {
    installBase();
    let fail = true;
    server.use(http.get(`${API}/projects/${PID}/insights`, () => (fail ? apiError(503, "SERVICE_UNAVAILABLE", "The Lotus server is unavailable.") : j(INSIGHTS))));
    const user = userEvent.setup();
    mountAnalysis(url);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    fail = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findAllByRole("article")).toHaveLength(3);
  });
});

describe("InsightsPage — actions", () => {
  it("pins and unpins", async () => {
    installBase();
    let pinned = false;
    const calls: string[] = [];
    server.use(
      http.get(`${API}/projects/${PID}/insights`, () => j([{ ...ASSOC, pinned }])),
      http.post(`${API}/insights/${ASSOC.id}/pin`, ({ request }) => { calls.push(new URL(request.url).searchParams.get("pinned")!); pinned = calls.at(-1) === "true"; return j({ ...ASSOC, pinned }); }),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click(await screen.findByRole("button", { name: /^pin “/i }));
    expect(await screen.findByText("Pinned")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^unpin “/i }));
    await waitFor(() => expect(screen.queryByText("Pinned")).not.toBeInTheDocument());
    expect(calls).toEqual(["true", "false"]);
  });

  it("generates an AI interpretation shown apart from the computed statement, labelled with model and validation", async () => {
    installBase();
    let narrative: unknown = null;
    server.use(
      http.get(`${API}/projects/${PID}/insights`, () => j([{ ...ASSOC, narrative }])),
      http.post(`${API}/insights/${ASSOC.id}/narrative`, () => { narrative = llmNarrative; return j({ ...ASSOC, narrative }); }),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    const card = (await screen.findAllByRole("article"))[0];
    expect(within(card).queryByRole("region", { name: "Interpretation" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Generate AI interpretation" }));
    const block = await within(card).findByRole("region", { name: "Interpretation" });
    expect(within(block).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(block).getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(within(block).getByText("Numbers validated")).toBeInTheDocument();
    expect(within(card).getByText(/wording below is separate from the computed statement/i)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Regenerate interpretation" })).toBeInTheDocument();
    // the computed statement keeps its own provenance
    expect(within(card).getAllByText("Computed").length).toBeGreaterThan(0);
  });

  it("surfaces the AI rate limit as a message", async () => {
    installBase();
    server.use(
      http.get(`${API}/projects/${PID}/insights`, () => j([ASSOC])),
      http.post(`${API}/insights/${ASSOC.id}/narrative`, () => apiError(429, "RATE_LIMITED", "You are sending AI requests too quickly. Please wait a moment.")),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click(await screen.findByRole("button", { name: "Generate AI interpretation" }));
    expect(await screen.findByText(/sending AI requests too quickly/i)).toBeInTheDocument();
  });

  it("deletes an insight after confirmation", async () => {
    installBase();
    let items = [ASSOC, GROUP];
    server.use(
      http.get(`${API}/projects/${PID}/insights`, () => j(items)),
      http.delete(`${API}/insights/${ASSOC.id}`, () => { items = [GROUP]; return new HttpResponse(null, { status: 204 }); }),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click((await screen.findAllByRole("button", { name: /^delete “/i }))[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/the analysis behind it stays/i);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.queryByText(ASSOC.title)).not.toBeInTheDocument();
  });

  it("re-derives insights as a tracked job and refreshes the feed when it finishes", async () => {
    installBase();
    let gets = 0, body: unknown = null, polls = 0;
    server.use(
      http.get(`${API}/projects/${PID}/insights`, () => { gets++; return j(INSIGHTS); }),
      http.post(`${API}/projects/${PID}/insights/generate`, async ({ request }) => { body = await request.json(); return j(job("RUNNING"), 202); }),
      http.get(`${API}/jobs/gen-1`, () => j(++polls < 2 ? job("RUNNING", { stage: "Deriving insights" }) : job("COMPLETED", { progress: 1, completed_stages: 3 }))),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    await screen.findAllByRole("article");
    const before = gets;
    await user.click(screen.getByRole("button", { name: /re-derive insights/i }));
    expect(await screen.findByText(/deriving insights/i)).toBeInTheDocument();
    expect(body).toEqual({ with_narratives: false });
    await waitFor(() => expect(gets).toBeGreaterThan(before), { timeout: 4000 });
  });
});

describe("InsightsPage — why this insight?", () => {
  it("shows the chain insight → analysis → variables → dataset version → evidence with links", async () => {
    installBase();
    server.use(
      http.get(`${API}/projects/${PID}/insights`, () => j([ASSOC])),
      http.get(`${API}/analyses/${ASSOC.analysis_run_id}`, () => j({ ...ANALYSIS_GC, id: ASSOC.analysis_run_id, analysis_type: "correlation", title: "Correlation matrix — 7 variables", config: { method: "pearson", variables: ["satisfaction_score", "age"] } })),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click(await screen.findByRole("button", { name: /why this insight\?/i }));
    const drawer = await screen.findByRole("dialog", { name: /why this insight/i });
    const steps = within(drawer).getAllByRole("listitem").filter((li) => li.querySelector("h3"));
    expect(steps.map((s) => s.querySelector("h3")?.textContent)).toEqual(["Insight", "Supporting analysis", "Variables", "Dataset version", "Evidence values"]);
    expect(within(drawer).getByText(ASSOC.statement)).toBeInTheDocument();
    const analysis = await within(drawer).findByRole("link", { name: "Correlation matrix — 7 variables" });
    expect(analysis).toHaveAttribute("href", `${base}/analysis/${ASSOC.analysis_run_id}`);
    expect(within(drawer).getByText("Correlation")).toBeInTheDocument();
    expect(within(drawer).getByText("pearson")).toBeInTheDocument();
    expect(within(drawer).getByText("satisfaction_score, age")).toBeInTheDocument();
    expect(within(drawer).getByText(/customer feedback \(survey \+ comments\) · v2/i)).toBeInTheDocument();
    expect(within(drawer).getByText(ANALYSIS_GC.provenance.dataset_content_hash)).toBeInTheDocument();
    expect(within(drawer).getByText("-0.514")).toBeInTheDocument();
  });

  it("links a mixed-methods insight to the mixed-methods page", async () => {
    installBase();
    server.use(http.get(`${API}/projects/${PID}/insights`, () => j([MIXED])));
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click(await screen.findByRole("button", { name: /why this insight\?/i }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("link", { name: /open mixed methods/i })).toHaveAttribute("href", `${base}/mixed`);
  });
});

describe("InsightsPage — viewer", () => {
  it("hides every write action", async () => {
    installBase("VIEWER");
    server.use(http.get(`${API}/projects/${PID}/insights`, () => j(INSIGHTS)));
    mountAnalysis(url);
    await screen.findAllByRole("article");
    expect(screen.queryByRole("button", { name: /re-derive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^pin|^unpin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ai interpretation/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /why this insight/i })).toHaveLength(3);
  });
});
