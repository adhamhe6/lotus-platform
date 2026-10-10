import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { ReportsPage } from "./ReportsPage";

const proj = (role = "OWNER") => ({ id: "p1", name: "Customer Study", description: "", objective: "", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", role, counts: {} });
const report = (id: string, title: string, over: object = {}) => ({ id, project_id: "p1", title, objective: "", status: "DRAFT", generation: {}, created_at: "2026-02-01T10:00:00Z", updated_at: null, sections: [{ id: "s1", type: "text", title: "A", body: "" }, { id: "s2", type: "methodology", title: "Methodology" }], sources: { analysis_runs: ["a1", "a2"], insights: ["i1"], dataset_versions: ["v1"] }, ...over });
const job = (over: object = {}) => ({ id: "job1", project_id: "p1", type: "generate_report", status: "PENDING", stage: null, progress: 0, completed_stages: 0, total_stages: 4, error: null, result_ref: null, params: {}, attempts: 0, created_at: "2026-02-01T10:00:00Z", completed_at: null, ...over });
const Probe = () => <p data-testid="path">{useLocation().pathname}</p>;

function setup(opts: { role?: string; reports?: object[] } = {}) {
  signIn();
  let reports = opts.reports ?? [report("r1", "Findings report"), report("r2", "Second report", { status: "READY", sections: [], sources: {} })];
  server.use(
    http.get(`${API}/projects/p1`, () => j(proj(opts.role))),
    http.get(`${API}/projects/p1/reports`, () => j(reports)),
    http.get(`${API}/projects/p1/datasets`, () => j([{ id: "d1", name: "Customer feedback", status: "READY", project_id: "p1" }])),
    http.get(`${API}/datasets/d1/versions`, () => j([{ id: "v1", dataset_id: "d1", version_number: 1, label: "original" }, { id: "v2", dataset_id: "d1", version_number: 2, label: "cleaned" }])),
    http.delete(`${API}/reports/:id`, ({ params }) => { reports = reports.filter((r) => (r as { id: string }).id !== params.id); return new Response(null, { status: 204 }); }),
  );
  return renderApp(<><ReportsPage /><Probe /></>, { route: "/projects/p1/reports", path: "/projects/:projectId/*" });
}

describe("ReportsPage", () => {
  it("lists reports with status, section and source counts, and links to the builder", async () => {
    setup();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    const first = (await screen.findByRole("heading", { name: "Findings report" })).closest("li")!;
    expect(within(first).getByText("Draft")).toBeInTheDocument();
    expect(first).toHaveTextContent("2 sections");
    expect(first).toHaveTextContent("2 analyses · 1 insight");
    expect(first).toHaveTextContent("Created 01 Feb 2026");
    expect(within(first).getByRole("link", { name: "Findings report" })).toHaveAttribute("href", "/projects/p1/reports/r1");
    expect(within(first).getByRole("link", { name: "Open Findings report" })).toBeInTheDocument();
    const second = screen.getByRole("heading", { name: "Second report" }).closest("li")!;
    expect(within(second).getByText("Ready")).toBeInTheDocument();
    expect(second).toHaveTextContent("0 sections");
  });

  it("shows an empty state with next actions", async () => {
    setup({ reports: [] });
    expect(await screen.findByText("No reports yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /generate draft/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /new blank report/i }).length).toBeGreaterThan(0);
  });

  it("shows an error state and retries", async () => {
    signIn();
    let fail = true;
    server.use(
      http.get(`${API}/projects/p1`, () => j(proj())),
      http.get(`${API}/projects/p1/reports`, () => (fail ? apiError(500, "INTERNAL", "Reports are unavailable.") : j([report("r1", "Findings report")]))),
    );
    renderApp(<ReportsPage />, { route: "/projects/p1/reports", path: "/projects/:projectId/reports" });
    expect(await screen.findByText("Reports are unavailable.")).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Findings report")).toBeInTheDocument();
  });

  it("deletes a report only after confirmation", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete Findings report" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Findings report");
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Findings report")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete Findings report" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Findings report")).not.toBeInTheDocument());
    expect(screen.getByText("Second report")).toBeInTheDocument();
  });

  it("generates a draft: posts the options, tracks the job and opens the new report", async () => {
    let body: unknown = null;
    setup();
    server.use(
      http.post(`${API}/projects/p1/reports/generate`, async ({ request }) => { body = await request.json(); return j(job(), 202); }),
      http.get(`${API}/jobs/job1`, () => j(job({ status: "COMPLETED", stage: "Done", progress: 1, completed_stages: 4, result_ref: { type: "report", report_id: "new1" } }))),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /generate draft/i }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/only if every number in its text passes validation/i)).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText(/title/i), "Q3 findings");
    await user.click(within(dlg).getByRole("combobox", { name: /dataset version/i }));
    await user.click(await screen.findByRole("option", { name: /customer feedback · v2/i }));
    await user.click(within(dlg).getByRole("switch", { name: /include ai-assisted summary/i }));
    await user.click(within(dlg).getByRole("button", { name: /generate draft/i }));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/projects/p1/reports/new1"), { timeout: 4000 });
    expect(body).toEqual({ title: "Q3 findings", dataset_version_id: "v2", with_ai: true });
  });

  it("explains NOTHING_TO_REPORT when the generation job fails", async () => {
    setup();
    server.use(
      http.post(`${API}/projects/p1/reports/generate`, () => j(job({ status: "FAILED", error: { code: "NOTHING_TO_REPORT", message: "There are no completed analyses, themes or visualizations to report on yet. Run an analysis first." } }), 202)),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /generate draft/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /generate draft/i }));
    const alert = await screen.findByText("Nothing to report on yet");
    expect(alert.closest("[role=status]")).toHaveTextContent(/run an analysis first/i);
    expect(screen.getByRole("link", { name: /run an analysis/i })).toHaveAttribute("href", "/projects/p1/analysis/new");
    expect(screen.getByTestId("path")).toHaveTextContent("/projects/p1/reports");
  });

  it("explains NOTHING_TO_REPORT when the API rejects the request directly", async () => {
    setup();
    server.use(http.post(`${API}/projects/p1/reports/generate`, () => apiError(422, "NOTHING_TO_REPORT", "Nothing yet.")));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /generate draft/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /generate draft/i }));
    expect(await screen.findByText("Nothing to report on yet")).toBeInTheDocument();
  });

  it("shows other generation failures with the server's message", async () => {
    setup();
    server.use(http.post(`${API}/projects/p1/reports/generate`, () => j(job({ status: "FAILED", error: { code: "INTERNAL", message: "Renderer crashed." } }), 202)));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /generate draft/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /generate draft/i }));
    expect((await screen.findAllByText("Renderer crashed.")).length).toBeGreaterThan(0);
  });

  it("creates a blank report and opens it", async () => {
    let body: unknown = null;
    setup();
    server.use(http.post(`${API}/projects/p1/reports`, async ({ request }) => { body = await request.json(); return j(report("blank1", "Methods note", { sections: [], sources: {} }), 201); }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /new blank report/i }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("button", { name: /create report/i })).toBeDisabled();
    await user.type(within(dlg).getByLabelText("Title"), "Methods note");
    await user.click(within(dlg).getByRole("button", { name: /create report/i }));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/projects/p1/reports/blank1"));
    expect(body).toEqual({ title: "Methods note" });
  });

  it("hides write actions for viewers", async () => {
    setup({ role: "VIEWER" });
    await screen.findByText("Findings report");
    expect(screen.queryByRole("button", { name: /generate draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new blank report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Findings report" })).toBeInTheDocument();
  });
});
