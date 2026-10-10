import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j } from "@/test/utils";
import { ANALYSIS_GC, EXPLAIN_RULE, INSIGHTS, PID } from "./fixtures";
import { base, installBase, mountAnalysis } from "./testUtils";

const A = ANALYSIS_GC;
const url = `${base}/analysis/${A.id}`;
const withInterp = (interp: unknown) => ({ ...A, interpretation: interp });

function serve(analysis: unknown = A, insights: unknown[] = []) {
  server.use(
    http.get(`${API}/analyses/${A.id}`, () => j(analysis)),
    http.get(`${API}/projects/${PID}/insights`, ({ request }) => { expect(new URL(request.url).searchParams.get("analysis_run_id")).toBe(A.id); return j(insights); }),
  );
}

describe("AnalysisResultPage — completed result", () => {
  it("renders header, metrics, chart, tables, assumptions, warnings, decisions, methodology and reproducibility", async () => {
    installBase();
    serve(A, [INSIGHTS[2]]);
    const user = userEvent.setup();
    mountAnalysis(url);

    // header
    expect(await screen.findByRole("heading", { level: 1, name: A.title })).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Group comparison")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /customer feedback \(survey \+ comments\) · v2/i })).toHaveAttribute("href", expect.stringContaining(`${base}/data/`));
    expect(screen.getByText("n = 588 of 600 rows used")).toBeInTheDocument();
    expect(screen.getAllByText("14 ms").length).toBeGreaterThan(0);

    // metrics: primary emphasised, p-value via fmtP, notes as given, boolean as yes/no
    const primary = screen.getByTestId("primary-metric");
    expect(primary).toHaveTextContent("Welch F");
    expect(primary).toHaveTextContent("1.666");
    expect(screen.getByText("p-value").nextSibling).toHaveTextContent("0.191");
    expect(screen.getByText("negligible effect")).toBeInTheDocument();
    expect(screen.getByText("Significant at α = 0.05").nextSibling).toHaveTextContent("no");
    expect(screen.getAllByText(/computed/i).length).toBeGreaterThan(0);

    // warnings, charts, tables
    expect(screen.getByText(/12 of 600 rows \(2\.0%\) were excluded/)).toBeInTheDocument();
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: "satisfaction_score by channel" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Std. dev." }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("rowheader", { name: "Web" }).length).toBeGreaterThan(0);

    // assumptions with words, not only colour
    const assumptions = screen.getByRole("heading", { name: /assumptions & diagnostics/i }).closest("section")!;
    expect(within(assumptions).getAllByText("Met").length).toBe(4);
    expect(within(assumptions).getByText("Can’t be verified")).toBeInTheDocument();
    expect(within(assumptions).getByText(/Shapiro–Wilk p = 0\.339/)).toBeInTheDocument();

    // decisions
    expect(screen.getByRole("heading", { name: /what lotus decided/i })).toBeInTheDocument();
    expect(screen.getByText(/automatic test selection: normality is acceptable/i)).toBeInTheDocument();

    // methodology is collapsible
    const summary = screen.getByText("How this was computed");
    const method = screen.getByText(/compares a numeric outcome across the levels/i);
    expect(method).not.toBeVisible();
    await user.click(summary);
    expect(method).toBeVisible();

    // reproducibility
    const repro = screen.getByRole("heading", { name: /reproducibility/i }).closest("section")!;
    expect(within(repro).getByText(A.provenance.dataset_content_hash)).toBeInTheDocument();
    expect(within(repro).getByText("20260101")).toBeInTheDocument();
    expect(within(repro).getByText("1.0.0")).toBeInTheDocument();
    expect(within(repro).getByText(/same data and configuration always give the same result/i)).toBeInTheDocument();
    expect(within(repro).getByText(/scipy 1\.18\.1/)).toBeInTheDocument();
    expect(within(repro).getByLabelText("Configuration as JSON")).toHaveTextContent('"outcome": "satisfaction_score"');
    expect(within(repro).getByText(/by Demo Researcher/)).toBeInTheDocument();

    // derived insights
    const derived = screen.getByRole("heading", { name: /insights from this analysis/i }).closest("section")!;
    expect(await within(derived).findByText(INSIGHTS[2].title)).toBeInTheDocument();
    expect(within(derived).getByRole("link", { name: /all insights/i })).toHaveAttribute("href", `${base}/insights`);
  });

  it("explains that no insight was derived when none cleared the thresholds", async () => {
    installBase();
    serve();
    mountAnalysis(url);
    expect(await screen.findByText(/no insight was derived from this analysis/i)).toBeInTheDocument();
  });

  it("renames inline and toggles saved", async () => {
    installBase();
    serve();
    const bodies: unknown[] = [];
    server.use(http.patch(`${API}/analyses/${A.id}`, async ({ request }) => { const b = (await request.json()) as Record<string, unknown>; bodies.push(b); return j({ ...A, ...b }); }));
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click(await screen.findByRole("button", { name: "Edit title" }));
    const input = screen.getByLabelText("Analysis title");
    await user.clear(input);
    await user.type(input, "Channel effect on satisfaction");
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Channel effect on satisfaction" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save to my analyses/i }));
    await waitFor(() => expect(bodies).toEqual([{ title: "Channel effect on satisfaction" }, { saved: true }]));
    expect(await screen.findByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("deletes after confirmation and returns to the history", async () => {
    installBase();
    serve();
    let deleted = false;
    server.use(
      http.delete(`${API}/analyses/${A.id}`, () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
      http.get(`${API}/projects/${PID}/analyses`, () => j({ items: [], total: 0, page: 1, page_size: 10 })),
      http.get(`${API}/datasets/:id/suggestions`, () => j([])),
    );
    const user = userEvent.setup();
    mountAnalysis(url);
    await user.click(await screen.findByRole("button", { name: /delete this analysis/i }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`${base}/analysis`));
  });

  it("shows an error state with retry when the analysis can't be loaded", async () => {
    installBase();
    server.use(http.get(`${API}/analyses/${A.id}`, () => apiError(404, "NOT_FOUND", "Analysis not found.")));
    mountAnalysis(url);
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn’t exist or you don’t have access/i);
  });
});

describe("AnalysisResultPage — other states", () => {
  it("failed: shows the stored error with guidance and an Edit configuration link that pre-fills the builder", async () => {
    installBase();
    serve({ ...A, status: "FAILED", result: null, headline: null, error: { code: "ANALYSIS_FAILED", message: "Every group has fewer than two observations." } });
    mountAnalysis(url);
    expect(await screen.findByText("This analysis couldn’t be completed")).toBeInTheDocument();
    expect(screen.getByText(/every group has fewer than two observations/i)).toBeInTheDocument();
    expect(screen.getByText("ANALYSIS_FAILED")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /edit configuration/i });
    const u = new URL(link.getAttribute("href")!, "http://x");
    expect(u.pathname).toBe(`${base}/analysis/new`);
    expect(u.searchParams.get("type")).toBe("group_comparison");
    expect(u.searchParams.get("version")).toBe(A.dataset_version_id);
    expect(JSON.parse(u.searchParams.get("config")!)).toMatchObject({ outcome: "satisfaction_score", group: "channel" });
    expect(screen.queryByRole("button", { name: /explain/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("primary-metric")).not.toBeInTheDocument();
  });

  it("running: shows live state and swaps in the result when the job finishes", async () => {
    installBase();
    let n = 0;
    server.use(
      http.get(`${API}/analyses/${A.id}`, () => j(++n < 2 ? { ...A, status: "RUNNING", result: null, headline: null, duration_ms: null } : A)),
      http.get(`${API}/projects/${PID}/insights`, () => j([])),
    );
    mountAnalysis(url);
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText(/computing your analysis/i)).toBeInTheDocument();
    expect(await screen.findByTestId("primary-metric", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("tells people when they were redirected to an already-existing analysis", async () => {
    installBase();
    serve();
    mountAnalysis({ pathname: url, state: { reused: true } });
    expect(await screen.findByText(/this exact analysis already exists — opened the saved result/i)).toBeInTheDocument();
  });
});

describe("AnalysisResultPage — explain this result", () => {
  it("generates a rule-based explanation, labelled as such, with clickable evidence ids", async () => {
    installBase();
    serve();
    server.use(http.post(`${API}/analyses/${A.id}/explain`, () => j(EXPLAIN_RULE)));
    const user = userEvent.setup();
    mountAnalysis(url);
    await screen.findByTestId("primary-metric");
    expect(screen.getByText(/no explanation yet/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /explain this result/i })[0]);

    const card = await screen.findByRole("region", { name: "Interpretation" });
    expect(within(card).getByText("Rule-based summary")).toBeInTheDocument();
    expect(within(card).queryByText("AI interpretation")).not.toBeInTheDocument();
    expect(within(card).getByText(EXPLAIN_RULE.summary)).toBeInTheDocument();
    expect(within(card).getByText(/12 of 600 rows \(2\.0%\) were excluded/)).toBeInTheDocument(); // caveat
    // evidence ids open the drawer with the supporting computed facts
    await user.click(within(card).getAllByRole("button", { name: "Show evidence E2" })[0]);
    const drawer = await screen.findByRole("dialog");
    const item = within(drawer).getByText("E2").closest("li")!;
    expect(item).toHaveAttribute("data-selected");
    expect(item).toHaveTextContent("Web: mean 74.6, n = 234");
    expect(within(drawer).getAllByRole("listitem").length).toBe(EXPLAIN_RULE.evidence.length);
    expect(within(drawer).getAllByRole("link", { name: /open source analysis/i })[0]).toHaveAttribute("href", `${base}/analysis/${A.id}`);
  });

  it("shows an AI interpretation with model, prompt version and validation status", async () => {
    installBase();
    const ai = { ...EXPLAIN_RULE, meta: { ...EXPLAIN_RULE.meta, origin: "llm", provider: "anthropic", model: "claude-sonnet-5", validation: { status: "passed", problems: [] } } };
    serve(withInterp(ai));
    mountAnalysis(url);
    const card = await screen.findByRole("region", { name: "Interpretation" });
    expect(within(card).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(card).getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(within(card).getByText("Prompt lotus-narrate-1.2")).toBeInTheDocument();
    expect(within(card).getByText("Numbers validated")).toBeInTheDocument();
    expect(within(card).queryByRole("note")).not.toBeInTheDocument();
  });

  it("explains why a rule-based summary is shown when the AI output was rejected", async () => {
    installBase();
    const fb = { ...EXPLAIN_RULE, meta: { ...EXPLAIN_RULE.meta, fallback_reason: "The model's text failed numeric validation, so the rule-based summary is shown instead.", validation: { status: "failed", problems: ["0.45 is not in the evidence"] } } };
    serve(withInterp(fb));
    mountAnalysis(url);
    const card = await screen.findByRole("region", { name: "Interpretation" });
    expect(within(card).getByRole("note")).toHaveTextContent(/why this is a rule-based summary: the model's text failed numeric validation/i);
    expect(within(card).getByText("Rule-based summary")).toBeInTheDocument();
    expect(within(card).getByText("Validation failed")).toBeInTheDocument();
    expect(within(card).getByText("0.45 is not in the evidence")).toBeInTheDocument();
  });

  it("handles the AI rate limit (429) without losing the page", async () => {
    installBase();
    serve();
    let calls = 0;
    server.use(http.post(`${API}/analyses/${A.id}/explain`, () => (++calls === 1 ? apiError(429, "RATE_LIMITED", "You are sending AI requests too quickly. Please wait a moment.") : j(EXPLAIN_RULE))));
    const user = userEvent.setup();
    mountAnalysis(url);
    await screen.findByTestId("primary-metric");
    await user.click(screen.getAllByRole("button", { name: /explain this result/i })[0]);
    expect(await screen.findByText("Slow down a moment")).toBeInTheDocument();
    expect(screen.getByText(/sending AI requests too quickly/i)).toBeInTheDocument();
    expect(screen.getByTestId("primary-metric")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /explain this result/i })[0]);
    expect(await screen.findByRole("region", { name: "Interpretation" })).toBeInTheDocument();
    expect(screen.queryByText("Slow down a moment")).not.toBeInTheDocument();
  });

  it("viewers can read an existing explanation but not request one, rename, save or delete", async () => {
    installBase("VIEWER");
    serve(withInterp(EXPLAIN_RULE));
    mountAnalysis(url);
    expect(await screen.findByRole("region", { name: "Interpretation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /explain/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete this analysis/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save to my analyses/i })).toBeDisabled();
  });
});
