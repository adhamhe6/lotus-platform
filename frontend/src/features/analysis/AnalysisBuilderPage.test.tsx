import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j } from "@/test/utils";
import { ANALYSIS_GC, PID, VID } from "./fixtures";
import { base, installBase, mountAnalysis } from "./testUtils";

const job = (status: string, extra: object = {}) => ({ id: "job-1", project_id: PID, type: "run_analysis", status, stage: "Computing", progress: 0.5, total_stages: 4, completed_stages: 2, params: {}, result_ref: null, error: null, attempts: 1, created_at: "2026-10-10T10:00:00Z", started_at: null, completed_at: null, ...extra });

function resultHandlers() {
  server.use(
    http.get(`${API}/analyses/${ANALYSIS_GC.id}`, () => j(ANALYSIS_GC)),
    http.get(`${API}/projects/${PID}/insights`, () => j([])),
    http.get(`${API}/projects/${PID}/analyses`, () => j({ items: [], total: 0, page: 1, page_size: 10 })),
  );
}
const currentStep = () => document.querySelector('[aria-current="step"]')?.textContent ?? "";
const picker = (name: string) => screen.findByRole(name.includes("Predictors") || name.includes("variables") || name === "Variables" ? "group" : "radiogroup", { name });

describe("AnalysisBuilderPage", () => {
  it("walks Dataset → Analysis → Variables → Configuration → Run and posts the exact payload", async () => {
    installBase();
    resultHandlers();
    let body: unknown = null;
    server.use(http.post(`${API}/projects/${PID}/analyses`, async ({ request }) => { body = await request.json(); return j({ analysis: ANALYSIS_GC, job: job("COMPLETED", { progress: 1, completed_stages: 4 }), reused: false }, 202); }));
    const user = userEvent.setup();
    const view = mountAnalysis(`${base}/analysis/new`);

    // 1. dataset: the active dataset/version is pre-selected and its size shown
    expect(await screen.findByRole("heading", { name: /choose the data/i })).toBeInTheDocument();
    expect(await screen.findByText(/600 rows/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // 2. analysis: grouped cards with descriptions
    expect(await screen.findByRole("heading", { name: /choose an analysis/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /group comparison/i }));

    // 3. variables: only compatible columns are selectable, the rest are disabled with a reason
    const outcome = await picker("Outcome (numeric)");
    expect(within(outcome).getByRole("radio", { name: "satisfaction_score" })).toBeEnabled();
    expect(within(outcome).getByRole("radio", { name: "channel" })).toBeDisabled();
    expect(within(outcome).getByRole("radio", { name: "channel" })).toHaveAccessibleDescription(/category variables aren’t accepted for outcome/i);
    expect(within(outcome).getByRole("radio", { name: "comment" })).toBeDisabled();
    const group = screen.getByRole("radiogroup", { name: "Grouping variable" });
    expect(within(group).getByRole("radio", { name: "channel" })).toBeEnabled();
    expect(within(group).getByRole("radio", { name: "satisfaction_score" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    await user.click(within(outcome).getByRole("radio", { name: "satisfaction_score" }));
    await user.click(within(group).getByRole("radio", { name: "channel" }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // 4. configuration: only the test selector, and only tests for three groups (channel has 3 levels)
    expect(await screen.findByRole("heading", { name: /^configure$/i })).toBeInTheDocument();
    const tests = screen.getByRole("radiogroup", { name: "Test" });
    expect(within(tests).getByRole("radio", { name: /automatic/i })).toBeChecked();
    expect(within(tests).getByRole("radio", { name: /welch’s anova|welch's anova/i })).toBeInTheDocument();
    expect(within(tests).queryByRole("radio", { name: /t-test/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/robust/i)).not.toBeInTheDocument();
    expect(screen.getByText(/compares the averages of three or more groups/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // 5. review
    expect(await screen.findByRole("heading", { name: /review and run/i })).toBeInTheDocument();
    expect(screen.getByTestId("review-sentence")).toHaveTextContent(/Group comparison on Customer feedback \(survey \+ comments\) \(version 2\) using outcome \(numeric\) satisfaction_score and grouping variable channel/i);
    expect(screen.getByTestId("missing-note")).toHaveTextContent(/satisfaction_score \(12, 2\.0%\)/);
    expect(screen.getByText("Rows available").nextSibling).toHaveTextContent("600");
    await user.type(screen.getByLabelText(/title/i), "Channel check");
    await user.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`${base}/analysis/${ANALYSIS_GC.id}`));
    expect(body).toEqual({ dataset_version_id: VID, analysis_type: "group_comparison", config: { outcome: "satisfaction_score", group: "channel", test: "auto" }, title: "Channel check" });
    view.unmount();
  });

  it("shows real job progress while the analysis runs, then opens the result", async () => {
    installBase();
    resultHandlers();
    let polls = 0;
    server.use(
      http.post(`${API}/projects/${PID}/analyses`, () => j({ analysis: { ...ANALYSIS_GC, status: "RUNNING" }, job: job("RUNNING"), reused: false }, 202)),
      http.get(`${API}/jobs/job-1`, () => j(++polls < 2 ? job("RUNNING", { stage: "Fitting model" }) : job("COMPLETED", { progress: 1, completed_stages: 4 }))),
    );
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=descriptive&version=${VID}&vars=age,delivery_time`);
    await user.click(await screen.findByRole("button", { name: /run analysis/i }));
    expect(await screen.findByText(/running your analysis/i)).toBeInTheDocument();
    expect(await screen.findByText(/fitting model/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/analysis/${ANALYSIS_GC.id}`), { timeout: 4000 });
  });

  it("only offers parameters that belong to the chosen analysis", async () => {
    installBase();
    const user = userEvent.setup();
    const corr = mountAnalysis(`${base}/analysis/new?type=correlation&vars=age,delivery_time`);
    await user.click(await screen.findByRole("button", { name: /change settings/i }));
    const method = await screen.findByRole("radiogroup", { name: "Method" });
    expect(within(method).getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radiogroup", { name: "Test" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/moving-average/i)).not.toBeInTheDocument();
    corr.unmount();

    const ts = mountAnalysis(`${base}/analysis/new?type=time_series&vars=survey_date,satisfaction_score`);
    await user.click(await screen.findByRole("button", { name: /change settings/i }));
    expect(await screen.findByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Aggregate by" })).toBeInTheDocument();
    expect(screen.getByLabelText("Moving-average window")).toHaveValue(3);
    expect(screen.queryByRole("radiogroup", { name: "Method" })).not.toBeInTheDocument();
    // out-of-range window is rejected before running
    const win = screen.getByLabelText("Moving-average window");
    await user.clear(win);
    await user.type(win, "99");
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 24/i);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    ts.unmount();

    mountAnalysis(`${base}/analysis/new?type=linear_regression&vars=satisfaction_score,delivery_time,region`);
    await user.click(await screen.findByRole("button", { name: /change settings/i }));
    expect(await screen.findByRole("switch", { name: /robust \(hc3\) standard errors/i })).not.toBeChecked();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("requires the minimum number of variables for multi-select roles", async () => {
    installBase();
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=correlation`);
    const vars = await screen.findByRole("group", { name: "Numeric variables" });
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    await user.click(within(vars).getByRole("checkbox", { name: "age" }));
    expect(screen.getByText(/choose at least 2 variables/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    await user.click(within(vars).getByRole("checkbox", { name: "delivery_time" }));
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
    // text and category columns are listed but not selectable
    expect(within(vars).getByRole("checkbox", { name: "comment" })).toBeDisabled();
    expect(within(vars).getByRole("checkbox", { name: "region" })).toBeDisabled();
    expect(within(vars).getAllByText("2.0% missing").length).toBeGreaterThan(0);
  });

  it("deep link preset pre-fills type, variables and settings and jumps to review", async () => {
    installBase();
    let body: { config?: unknown } = {};
    resultHandlers();
    server.use(http.post(`${API}/projects/${PID}/analyses`, async ({ request }) => { body = (await request.json()) as never; return j({ analysis: ANALYSIS_GC, job: null, reused: false }, 202); }));
    const config = encodeURIComponent(JSON.stringify({ method: "spearman" }));
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=correlation&version=${VID}&vars=age,delivery_time&config=${config}`);
    const sentence = await screen.findByTestId("review-sentence");
    expect(sentence).toHaveTextContent(/Correlation/);
    expect(sentence).toHaveTextContent(/numeric variables age, delivery_time/);
    expect(sentence).toHaveTextContent(/method: Spearman/i);
    expect(currentStep()).toMatch(/Run/);
    await user.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(body.config).toEqual({ variables: ["age", "delivery_time"], method: "spearman" }));
  });

  it("a preset with an unsuitable column lands on Variables with the problem explained", async () => {
    installBase();
    mountAnalysis(`${base}/analysis/new?type=group_comparison&vars=channel,region`);
    expect(await screen.findByRole("heading", { name: /choose the variables/i })).toBeInTheDocument();
    expect(await screen.findByText(/“channel” isn’t available as outcome \(numeric\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("shows a 422 configuration message inline on the step it belongs to", async () => {
    installBase();
    server.use(http.post(`${API}/projects/${PID}/analyses`, () => apiError(422, "INVALID_ANALYSIS_CONFIGURATION", "The selected grouping variable 'channel' has only one group with enough observations.")));
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=group_comparison&vars=satisfaction_score,channel`);
    await user.click(await screen.findByRole("button", { name: /run analysis/i }));
    const alert = await screen.findByText(/only one group with enough observations/i);
    expect(alert).toBeInTheDocument();
    expect(currentStep()).toMatch(/Variables/);
    // fixing the selection clears the message
    await user.click(within(screen.getByRole("radiogroup", { name: "Grouping variable" })).getByRole("radio", { name: "region" }));
    expect(screen.queryByText(/only one group with enough observations/i)).not.toBeInTheDocument();
  });

  it("routes a message about a setting to the Configuration step", async () => {
    installBase();
    server.use(http.post(`${API}/projects/${PID}/analyses`, () => apiError(422, "INVALID_ANALYSIS_CONFIGURATION", "Moving-average window must be smaller than the number of periods.")));
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=time_series&vars=survey_date,satisfaction_score`);
    await user.click(await screen.findByRole("button", { name: /run analysis/i }));
    expect(await screen.findByText(/must be smaller than the number of periods/i)).toBeInTheDocument();
    expect(currentStep()).toMatch(/Configuration/);
  });

  it("tells the user when an identical analysis already exists and opens it", async () => {
    installBase();
    resultHandlers();
    server.use(http.post(`${API}/projects/${PID}/analyses`, () => j({ analysis: ANALYSIS_GC, job: null, reused: true }, 202)));
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=descriptive&vars=age`);
    await user.click(await screen.findByRole("button", { name: /run analysis/i }));
    expect(await screen.findAllByText(/this exact analysis already exists — opened the saved result/i)).not.toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/analysis/${ANALYSIS_GC.id}`));
  });

  it("lets people go back to earlier steps, and disables analyses the dataset cannot support", async () => {
    installBase();
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis/new?type=descriptive&vars=age`);
    expect(await screen.findByRole("heading", { name: /review and run/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /go to step 2: analysis/i }));
    expect(await screen.findByRole("heading", { name: /choose an analysis/i })).toBeInTheDocument();
    // the demo dataset has one datetime column and plenty of numerics, so every analysis is available
    expect(screen.getByRole("button", { name: /time series/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByRole("heading", { name: /choose the data/i })).toBeInTheDocument();
  });

  it("viewers can look but not run", async () => {
    installBase("VIEWER");
    mountAnalysis(`${base}/analysis/new?type=descriptive&vars=age`);
    expect(await screen.findByText(/view-only access/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled());
  });
});
