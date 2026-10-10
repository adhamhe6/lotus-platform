import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/api/types";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { OverviewPage } from "./OverviewPage";
import type { Overview } from "./overviewApi";

const project = (role = "OWNER") => ({ id: "p1", name: "Customer Study", description: "", objective: "Why is satisfaction low?", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", role, counts: {} });
const chart: ChartSpec = { kind: "bar", title: "Plan mix by region", description: "Bar chart of plan mix by region.", notes: [], x_label: "region", y_label: "share", data: { categories: ["West", "East"], series: [{ name: "Basic", values: [50, 40] }] } };
const overview: Overview = {
  project: { id: "p1", name: "Customer Study", description: "", objective: "Why is satisfaction low?", created_at: "2026-01-01T00:00:00Z" },
  counts: { datasets: 1, analyses: 13, insights: 15, themes: 6, reports: 2, mixed: 1, codes: 0 },
  datasets: [{ id: "d1", name: "Customer feedback", status: "READY", error: null, latest_version_id: "v1", version_count: 2, rows: 600, columns: 13, missing_pct: 1.8846, duplicate_rows: 0, warnings: 3, created_at: "2026-01-01T00:00:00Z" }],
  recent_analyses: [{ id: "a1", title: "Group comparison — satisfaction by channel", analysis_type: "group_comparison", status: "COMPLETED", created_at: "2026-01-01T00:00:00Z", headline: { label: "Welch F", value: 1.6661447 } }],
  key_insights: [{ id: "i1", title: "satisfaction × delivery_time", statement: "satisfaction_score and delivery_time are strongly negatively correlated.", qualification: "strong", kind: "association", pinned: false, evidence: [{ label: "r", value: -0.514094, table: "pairs" }, { label: "Holm-adjusted p", value: 1.6e-38 }, { label: "n", value: 571 }] }],
  themes: [{ id: "t1", name: "Checkout / Order", column_name: "comment", response_count: 225, share_pct: 43.35 }],
  reports: [{ id: "r1", title: "Findings report", status: "DRAFT", created_at: "2026-01-01T00:00:00Z" }],
  visualizations: [{ id: "viz1", name: "Plan mix", spec: chart }],
  jobs: [{ id: "j1", type: "generate_report", status: "RUNNING", stage: "Collecting analyses", progress: 0.3, created_at: new Date().toISOString() }],
  activity: [{ kind: "report", title: "Findings report", id: "r1", at: new Date().toISOString() }],
  role: "OWNER", cached: false,
};
const empty: Overview = { ...overview, counts: { datasets: 0, analyses: 0, insights: 0, themes: 0, reports: 0, mixed: 0, codes: 0 }, datasets: [], recent_analyses: [], key_insights: [], themes: [], reports: [], visualizations: [], jobs: [], activity: [] };

function setup(ov: Overview | "error" = overview, role = "OWNER") {
  signIn();
  server.use(
    http.get(`${API}/projects/p1`, () => j(project(role))),
    http.get(`${API}/projects/p1/overview`, () => (ov === "error" ? apiError(500, "INTERNAL", "The overview could not be built.") : j(ov))),
    http.get(`${API}/projects/p1/members`, () => j([])),
  );
  return renderApp(<OverviewPage />, { route: "/projects/p1", path: "/projects/:projectId" });
}

describe("OverviewPage", () => {
  it("shows a loading skeleton, then the populated workspace with API numbers", async () => {
    setup();
    expect(screen.getByLabelText("Loading overview")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Customer Study" })).toBeInTheDocument();
    const totals = await screen.findByRole("list", { name: /project totals/i });
    expect(within(totals).getByText("13")).toBeInTheDocument();
    expect(within(totals).getByText("15")).toBeInTheDocument();
    // key insight with evidence strip and provenance
    const insight = screen.getByRole("heading", { name: "satisfaction × delivery_time" }).closest("li")!;
    expect(within(insight).getByText("Computed")).toBeInTheDocument();
    expect(within(insight).getByText("-0.514")).toBeInTheDocument();
    expect(within(insight).getByText("< 0.001")).toBeInTheDocument();
    expect(within(insight).getByText(/strong evidence/i)).toBeInTheDocument();
    // dataset health
    const ds = screen.getByRole("link", { name: /customer feedback/i });
    expect(ds).toHaveAttribute("href", "/projects/p1/data/d1");
    expect(ds).toHaveTextContent("600 rows × 13 columns");
    expect(ds).toHaveTextContent("1.9%");
    // recent analysis + headline metric as given
    const an = screen.getByRole("link", { name: /group comparison/i });
    expect(an).toHaveAttribute("href", "/projects/p1/analysis/a1");
    expect(an).toHaveTextContent("Welch F");
    expect(an).toHaveTextContent("1.666");
    // themes, viz, reports, jobs, activity
    expect(screen.getByText("Checkout / Order")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /checkout \/ order: 43\.4% of responses/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /bar chart of plan mix/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /findings report/i }).length).toBeGreaterThan(0);
    expect(screen.getByText("Collecting analyses")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
  });

  it("shows onboarding with real links when the project has no datasets", async () => {
    setup(empty);
    expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to data/i })).toHaveAttribute("href", "/projects/p1/data");
    expect(screen.getByRole("link", { name: /open analyses/i })).toHaveAttribute("href", "/projects/p1/analysis");
    expect(screen.getByRole("link", { name: /ask lotus/i })).toHaveAttribute("href", "/projects/p1/assistant");
    expect(screen.getByRole("link", { name: /^reports$/i })).toHaveAttribute("href", "/projects/p1/reports");
    expect(screen.queryByRole("heading", { name: /dataset health/i })).not.toBeInTheDocument();
  });

  it("gives each empty section a next action", async () => {
    setup({ ...empty, datasets: overview.datasets, counts: { ...empty.counts, datasets: 1 } });
    expect(await screen.findByText("No insights yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run an analysis/i })).toHaveAttribute("href", "/projects/p1/analysis/new");
    expect(screen.getByText("No themes yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /detect themes/i })).toBeInTheDocument();
    expect(screen.getByText("No saved visualizations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /generate a draft/i })).toBeInTheDocument();
  });

  it("shows an error state and recovers on retry", async () => {
    let fail = true;
    signIn();
    server.use(
      http.get(`${API}/projects/p1`, () => j(project())),
      http.get(`${API}/projects/p1/overview`, () => (fail ? apiError(500, "INTERNAL", "The overview could not be built.") : j(overview))),
      http.get(`${API}/projects/p1/members`, () => j([])),
    );
    renderApp(<OverviewPage />, { route: "/projects/p1", path: "/projects/:projectId" });
    expect(await screen.findByText("The overview could not be built.")).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("list", { name: /project totals/i })).toBeInTheDocument();
  });

  it("edits the research objective inline and PATCHes only the objective", async () => {
    let body: unknown = null;
    setup();
    server.use(http.patch(`${API}/projects/p1`, async ({ request }) => { body = await request.json(); return j({ ...project(), objective: "What drives retention?" }); }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /edit objective/i }));
    const box = screen.getByLabelText("Research objective");
    expect(box).toHaveValue("Why is satisfaction low?");
    await user.clear(box);
    await user.type(box, "What drives retention?");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).toEqual({ objective: "What drives retention?" }));
    await waitFor(() => expect(screen.queryByLabelText("Research objective")).not.toBeInTheDocument());
  });

  it("hides write actions for viewers and shows their role", async () => {
    setup(overview, "VIEWER");
    expect(await screen.findByRole("heading", { name: "Customer Study" })).toBeInTheDocument();
    await screen.findByRole("list", { name: /project totals/i });
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit objective/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^ask lotus$/i)).not.toBeInTheDocument();
  });

  it("the Ask Lotus shortcut navigates to the assistant with ?q=", async () => {
    setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Ask Lotus"), "What drives retention?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument();
  });
});
