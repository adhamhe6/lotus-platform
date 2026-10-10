import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { ReportBuilderPage } from "./ReportBuilderPage";

const ids = { an: "11111111-aaaa", viz: "22222222-bbbb", ins1: "33333333-cccc", ins2: "44444444-dddd", mixed: "55555555-eeee", run: "66666666-ffff", ver: "v1" };
const proj = (role = "OWNER") => ({ id: "p1", name: "Customer Study", description: "", objective: "", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", role, counts: {} });
const sections = () => [
  { id: "s-text", type: "text", title: "Research objective", body: "Why is satisfaction low?" },
  { id: "s-find", type: "findings", title: "Key findings", ref: { insight_ids: [ids.ins1, ids.ins2] } },
  { id: "s-an", type: "analysis", title: "Satisfaction by region", ref: { analysis_run_id: ids.an, charts: true, tables: true } },
  { id: "s-viz", type: "visualization", title: "Plan mix", ref: { visualization_id: ids.viz } },
  { id: "s-th", type: "themes", title: "Qualitative themes — comment", ref: { column: "comment", run_id: ids.run, dataset_version_id: ids.ver } },
  { id: "s-mx", type: "mixed", title: "Mixed-methods integration", ref: { mixed_run_id: ids.mixed } },
  { id: "s-ds", type: "dataset", title: "Data", ref: { dataset_version_id: ids.ver } },
  { id: "s-ai", type: "ai_summary", title: "AI-assisted summary", body: "Satisfaction differs by region." },
  { id: "s-me", type: "methodology", title: "Methodology" },
];
const mkReport = (over: object = {}) => ({
  id: "r1", project_id: "p1", title: "Findings report", objective: "Understand satisfaction", status: "DRAFT", generation: {}, created_at: "2026-02-01T10:00:00Z", updated_at: "2026-02-02T10:00:00Z",
  sections: sections(),
  sources: { analysis_runs: [ids.an], insights: [ids.ins1, ids.ins2], dataset_versions: [ids.ver], mixed_runs: [ids.mixed], theme_runs: [ids.run], visualizations: [ids.viz] }, ...over,
});
type PutBody = { title: string; objective: string; status: string; sections: { id: string; type: string; title: string; body?: string; ref?: Record<string, unknown> }[] };

function setup(o: { role?: string; report?: object; putError?: boolean } = {}) {
  signIn();
  let current = mkReport(o.report);
  const puts: PutBody[] = [];
  const renders: string[] = [];
  server.use(
    http.get(`${API}/projects/p1`, () => j(proj(o.role))),
    http.get(`${API}/reports/r1`, () => j(current)),
    http.put(`${API}/reports/r1`, async ({ request }) => {
      const b = (await request.json()) as PutBody;
      puts.push(b);
      if (o.putError) return apiError(404, "INVALID_REPORT_REFERENCE", "A referenced analysis does not exist in this project.");
      current = { ...current, ...b, updated_at: "2026-02-03T10:00:00Z" } as typeof current;
      return j(current);
    }),
    http.get(`${API}/reports/r1/render`, ({ request }) => {
      const f = new URL(request.url).searchParams.get("format") ?? "html";
      renders.push(f);
      return new HttpResponse(f === "html" ? "<html><body><h1>Rendered report</h1></body></html>" : f === "markdown" ? "# Rendered report" : "{}", { headers: { "content-type": "text/plain" } });
    }),
    http.get(`${API}/projects/p1/analyses`, () => j({ items: [{ id: ids.an, title: "Satisfaction by region", analysis_type: "group_comparison", status: "COMPLETED", dataset_version_id: ids.ver, created_at: "2026-02-01T00:00:00Z" }, { id: "an-2", title: "Delivery vs satisfaction", analysis_type: "correlation", status: "COMPLETED", dataset_version_id: ids.ver, created_at: "2026-02-01T00:00:00Z" }], total: 2, page: 1, page_size: 100 })),
    http.get(`${API}/projects/p1/insights`, () => j([{ id: ids.ins1, title: "Delivery time lowers satisfaction", qualification: "strong" }, { id: ids.ins2, title: "Region differences", qualification: "moderate" }, { id: "ins-3", title: "Retention differs by plan", qualification: "tentative" }])),
    http.get(`${API}/projects/p1/visualizations`, () => j([{ id: ids.viz, name: "Plan mix" }, { id: "viz-2", name: "Satisfaction distribution" }])),
    http.get(`${API}/projects/p1/mixed`, () => j([{ id: ids.mixed, outcome_column: "satisfaction_score", column_name: "comment", created_at: "2026-02-01T00:00:00Z" }])),
    http.get(`${API}/projects/p1/qualitative/themes`, () => j({ themes: [], runs: [{ id: ids.run, created_at: "2026-02-01T00:00:00Z", k: 6, params: { column: "comment" } }] })),
    http.get(`${API}/projects/p1/datasets`, () => j([{ id: "d1", name: "Customer feedback", status: "READY", project_id: "p1" }])),
    http.get(`${API}/datasets/d1/versions`, () => j([{ id: ids.ver, dataset_id: "d1", version_number: 2, label: "cleaned" }])),
  );
  const r = renderApp(<ReportBuilderPage />, { route: "/projects/p1/reports/r1", path: "/projects/:projectId/reports/:reportId" });
  return { ...r, puts, renders };
}
const rows = () => within(screen.getByRole("list", { name: "Report sections" })).getAllByRole("listitem");
const titles = () => rows().map((li) => (within(li).getByLabelText(/^Title of section/) as HTMLInputElement).value);

afterEach(() => { vi.restoreAllMocks(); });

describe("ReportBuilderPage – build", () => {
  it("describes what every section embeds and labels its provenance", async () => {
    setup();
    await screen.findByDisplayValue("Findings report");
    await waitFor(() => expect(screen.getByText(/Group comparison analysis “Satisfaction by region”, with its tables and charts/)).toBeInTheDocument());
    const li = (title: string) => rows().find((r) => (within(r).getByLabelText(/^Title of section/) as HTMLInputElement).value === title)!;
    expect(within(li("Key findings")).getByText(/2 key findings: Delivery time lowers satisfaction; Region differences/)).toBeInTheDocument();
    expect(within(li("Satisfaction by region")).getByText("Computed")).toBeInTheDocument();
    expect(within(li("Qualitative themes — comment")).getByText("Qualitative")).toBeInTheDocument();
    expect(within(li("Qualitative themes — comment")).getByText(/Themes detected in the “comment” column \(Customer feedback v2\)/)).toBeInTheDocument();
    expect(within(li("AI-assisted summary")).getByText("AI-assisted")).toBeInTheDocument();
    expect(within(li("Mixed-methods integration")).getByText(/satisfaction_score compared across themes in “comment”/)).toBeInTheDocument();
    expect(within(li("Plan mix")).getByText("Saved chart “Plan mix”.")).toBeInTheDocument();
    expect(within(li("Methodology")).getByText("Composed by Lotus")).toBeInTheDocument();
    expect(within(li("Research objective")).getByText("Written by you")).toBeInTheDocument();
    expect(screen.getByLabelText("Objective")).toHaveValue("Understand satisfaction");
  });

  it("shows the traceability panel from report.sources with links", async () => {
    setup();
    const panel = await screen.findByRole("complementary", { name: "Report sources" });
    await waitFor(() => expect(within(panel).getByRole("link", { name: "Satisfaction by region" })).toHaveAttribute("href", `/projects/p1/analysis/${ids.an}`));
    expect(within(panel).getByRole("link", { name: "Customer feedback · v2" })).toHaveAttribute("href", "/projects/p1/data/d1");
    expect(within(panel).getByRole("link", { name: "Delivery time lowers satisfaction" })).toHaveAttribute("href", "/projects/p1/insights");
    expect(within(panel).getByRole("link", { name: /satisfaction_score × themes in “comment”/ })).toHaveAttribute("href", "/projects/p1/mixed");
    expect(within(panel).getByRole("link", { name: "Plan mix" })).toHaveAttribute("href", "/projects/p1/visualizations");
    expect(within(panel).getByRole("link", { name: /theme run/i })).toHaveAttribute("href", "/projects/p1/qualitative");
    expect(within(panel).getAllByText("Insights").length).toBeGreaterThan(0);
  });

  it("reorders with keyboard-operable buttons and saves only title/objective/sections/status", async () => {
    const { puts } = setup();
    const user = userEvent.setup();
    await screen.findByDisplayValue("Findings report");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(titles().slice(0, 3)).toEqual(["Research objective", "Key findings", "Satisfaction by region"]);
    expect(screen.getByRole("button", { name: "Move “Research objective” up" })).toBeDisabled();
    const down = screen.getByRole("button", { name: "Move “Research objective” down" });
    down.focus();
    await user.keyboard("{Enter}");
    expect(titles().slice(0, 3)).toEqual(["Key findings", "Research objective", "Satisfaction by region"]);
    expect(screen.getByText(/moved “research objective” to position 2 of 9/i)).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move “Satisfaction by region” up" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(Object.keys(puts[0]!).sort()).toEqual(["objective", "sections", "status", "title"]);
    expect(puts[0]!.sections.slice(0, 3).map((s) => s.id)).toEqual(["s-find", "s-an", "s-text"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled());
    expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
  });

  it("removes a section and edits a text section's title and body", async () => {
    const { puts } = setup();
    const user = userEvent.setup();
    await screen.findByDisplayValue("Findings report");
    await user.click(screen.getByRole("button", { name: "Remove “Plan mix”" }));
    expect(titles()).not.toContain("Plan mix");
    const title = screen.getByLabelText("Title of section 1");
    await user.clear(title); await user.type(title, "Aim");
    const body = screen.getByLabelText("Body of section 1");
    await user.clear(body); await user.type(body, "Find the drivers.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.sections).toHaveLength(8);
    expect(puts[0]!.sections[0]).toMatchObject({ id: "s-text", title: "Aim", body: "Find the drivers." });
    expect(puts[0]!.sections.some((s) => s.id === "s-viz")).toBe(false);
  });

  it("toggles status and edits title and objective", async () => {
    const { puts } = setup();
    const user = userEvent.setup();
    const title = await screen.findByLabelText("Report title");
    await user.click(screen.getByRole("radio", { name: "Ready" }));
    expect(screen.getByRole("radio", { name: "Ready" })).toHaveAttribute("aria-checked", "true");
    await user.clear(title); await user.type(title, "Final report");
    await user.type(screen.getByLabelText("Objective"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts[0]).toMatchObject({ title: "Final report", status: "READY", objective: "Understand satisfaction!" }));
  });

  it("blocks saving an empty title", async () => {
    setup();
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText("Report title"));
    expect(screen.getByRole("alert")).toHaveTextContent(/needs a title/i);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("adds sections with refs the server validates (analysis, findings, text, themes)", async () => {
    const { puts } = setup({ report: { sections: [], sources: {} } });
    const user = userEvent.setup();
    await screen.findByText("This report has no sections");
    const add = async (label: RegExp) => { await user.click(await screen.findByRole("button", { name: /add section/i })); await user.click(await screen.findByRole("menuitem", { name: label })); };

    await add(/^Text/);
    expect(titles()).toEqual(["Untitled section"]);

    await add(/^Analysis/);
    let dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("button", { name: "Add section" })).toBeDisabled();
    await user.click(await within(dlg).findByRole("combobox", { name: /^analysis$/i }));
    await user.click(await screen.findByRole("option", { name: /delivery vs satisfaction/i }));
    await user.click(within(dlg).getByRole("checkbox", { name: /include charts/i }));
    await user.click(within(dlg).getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await add(/^Key findings/);
    dlg = await screen.findByRole("dialog");
    await user.click(await within(dlg).findByRole("checkbox", { name: "Region differences" }));
    await user.click(within(dlg).getByRole("checkbox", { name: "Retention differs by plan" }));
    await user.click(within(dlg).getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await add(/^Themes/);
    dlg = await screen.findByRole("dialog");
    await user.click(await within(dlg).findByRole("combobox", { name: /dataset version/i }));
    await user.click(await screen.findByRole("option", { name: /customer feedback · v2/i }));
    await user.click(await within(dlg).findByRole("combobox", { name: /theme detection run/i }));
    await user.click(await screen.findByRole("option", { name: /column “comment”/i }));
    await user.click(within(dlg).getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const s = puts[0]!.sections;
    expect(s.map((x) => x.type)).toEqual(["text", "analysis", "findings", "themes"]);
    expect(s[0]).toMatchObject({ title: "Untitled section", body: "" });
    expect(s[1]).toMatchObject({ title: "Delivery vs satisfaction", ref: { analysis_run_id: "an-2", charts: false, tables: true } });
    expect(s[2]!.ref).toEqual({ insight_ids: [ids.ins2, "ins-3"] });
    expect(s[3]).toMatchObject({ ref: { column: "comment", run_id: ids.run, dataset_version_id: ids.ver } });
    s.forEach((x) => expect(x.id).toMatch(/^[0-9a-f]{12}$/));
  });

  it("explains an empty picker rather than offering nothing", async () => {
    setup({ report: { sections: [], sources: {} } });
    server.use(http.get(`${API}/projects/p1/visualizations`, () => j([])));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /add section/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Visualization/ }));
    expect(await screen.findByText(/no saved visualizations yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add section" })).toBeDisabled();
  });

  it("surfaces save errors and keeps the edits", async () => {
    setup({ putError: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Ready" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("A referenced analysis does not exist in this project.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ready" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("shows an error state with retry when the report can't be loaded", async () => {
    signIn();
    let fail = true;
    server.use(
      http.get(`${API}/projects/p1`, () => j(proj())),
      http.get(`${API}/reports/r1`, () => (fail ? apiError(500, "INTERNAL", "Report store unavailable.") : j(mkReport({ sections: [], sources: {} })))),
      http.get(`${API}/projects/p1/datasets`, () => j([])),
      http.get(`${API}/projects/p1/analyses`, () => j({ items: [] })),
      http.get(`${API}/projects/p1/insights`, () => j([])),
      http.get(`${API}/projects/p1/visualizations`, () => j([])),
      http.get(`${API}/projects/p1/mixed`, () => j([])),
    );
    renderApp(<ReportBuilderPage />, { route: "/projects/p1/reports/r1", path: "/projects/:projectId/reports/:reportId" });
    expect(await screen.findByText("Report store unavailable.")).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByDisplayValue("Findings report")).toBeInTheDocument();
  });

  it("is read-only for viewers but still offers preview", async () => {
    setup({ role: "VIEWER" });
    expect(await screen.findByRole("heading", { name: "Findings report" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Group comparison analysis/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByLabelText("Report title")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add section/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title of section/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /move /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });
});

describe("ReportBuilderPage – preview and export", () => {
  it("renders the server HTML in a sandboxed iframe without scripts", async () => {
    const { renders } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Preview" }));
    const frame = (await screen.findByTitle("Report preview")) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("Rendered report");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).toContain("allow-modals");
    expect(renders).toEqual(["html"]);
  });

  it("warns that the preview shows the saved version when there are unsaved edits", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Ready" }));
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(await screen.findByText(/last saved version/i)).toBeInTheDocument();
  });

  it("prints the preview frame and downloads HTML, Markdown and JSON", async () => {
    const { renders } = setup({ report: { title: "Q3 Findings: Final!" } });
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Preview" }));
    const frame = (await screen.findByTitle("Report preview")) as HTMLIFrameElement;
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, "print", { value: print, configurable: true });
    Object.defineProperty(frame.contentWindow!, "focus", { value: vi.fn(), configurable: true });
    await user.click(screen.getByRole("button", { name: /print \/ save as pdf/i }));
    expect(print).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Download HTML" }));
    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    await user.click(screen.getByRole("button", { name: "Download JSON" }));
    await waitFor(() => expect(names).toHaveLength(3));
    expect(names).toEqual(["q3-findings-final.html", "q3-findings-final.md", "q3-findings-final.json"]);
    expect(renders).toEqual(["html", "markdown", "json"]);
    expect(await created[1]!.text()).toBe("# Rendered report");
  });

  it("reports export failures", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Preview" }));
    await screen.findByTitle("Report preview");
    server.use(http.get(`${API}/reports/r1/render`, ({ request }) => (new URL(request.url).searchParams.get("format") === "markdown" ? apiError(500, "INTERNAL", "Markdown renderer failed.") : new HttpResponse("{}"))));
    await user.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(await screen.findByText("Markdown renderer failed.")).toBeInTheDocument();
  });

  it("shows an error state when the preview can't be rendered", async () => {
    setup();
    server.use(http.get(`${API}/reports/r1/render`, () => apiError(500, "INTERNAL", "Render failed.")));
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Preview" }));
    expect(await screen.findByText("Render failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
