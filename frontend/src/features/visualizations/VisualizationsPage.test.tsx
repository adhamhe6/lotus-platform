import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import type { Visualization } from "@/api/types";
import { dataset, installMocks, PID } from "@/features/data/testFixtures";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { buildRequest, missingInput, NEW_STATE, sanitize, type ChartState } from "./chartRequest";
import { VisualizationsPage } from "./VisualizationsPage";

const SPEC = {
  kind: "bar", title: "Count by region", x_label: "region", y_label: "Count", notes: [], description: "Bar chart of Count by region for 3 categories. Highest: West (300).",
  data: { categories: ["West", "East", "North"], series: [{ name: "Count", values: [300, 200, 100] }] },
};
const savedViz = (id: string, name: string): Visualization => ({ id, project_id: PID, dataset_version_id: "v2", name, request: { kind: "bar", x: "region", aggregation: "count", top_n: 15 }, spec: SPEC, created_at: "2026-05-03T10:00:00Z" }) as Visualization;

function setup(o: { role?: "OWNER" | "EDITOR" | "VIEWER"; saved?: Visualization[]; datasets?: ReturnType<typeof dataset>[] } = {}) {
  signIn();
  installMocks({ role: o.role, datasets: o.datasets });
  const previews: Record<string, unknown>[] = [];
  const saves: Record<string, unknown>[] = [];
  let saved = o.saved ?? [];
  server.use(
    http.post(`${API}/projects/${PID}/visualizations/preview`, async ({ request }) => { previews.push((await request.json()) as Record<string, unknown>); return j(SPEC); }),
    http.get(`${API}/projects/${PID}/visualizations`, () => j(saved)),
    http.post(`${API}/projects/${PID}/visualizations`, async ({ request }) => {
      const body = (await request.json()) as { name: string; request: Record<string, unknown> };
      saves.push(body);
      const v = { ...savedViz("new1", body.name), request: body.request };
      saved = [v, ...saved];
      return j(v, 201);
    }),
    http.delete(`${API}/visualizations/:id`, ({ params }) => { saved = saved.filter((s) => s.id !== params.id); return new Response(null, { status: 204 }); }),
  );
  return { previews, saves };
}
const mount = () => renderApp(<VisualizationsPage />, { route: `/projects/${PID}/visualizations`, path: "/projects/:projectId/visualizations", withProject: PID });
const last = (xs: Record<string, unknown>[]) => xs[xs.length - 1];

async function choose(user: UserEvent, trigger: HTMLElement, option: RegExp | string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}
const kind = (user: UserEvent, name: RegExp) => user.click(screen.getByRole("radio", { name }));
const ready = () => screen.findByRole("radiogroup");

describe("request model: only the fields a chart kind needs are sent", () => {
  const s = (p: Partial<ChartState>): ChartState => ({ ...NEW_STATE, ...p });
  it.each([
    [s({ kind: "histogram", x: "age", y: "ignored", group: "ignored" }), { kind: "histogram", x: "age" }],
    [s({ kind: "bar", x: "region" }), { kind: "bar", x: "region", aggregation: "count", top_n: 15 }],
    [s({ kind: "bar", x: "region", y: "age", aggregation: "mean", top_n: 8 }), { kind: "bar", x: "region", aggregation: "mean", y: "age", top_n: 8 }],
    [s({ kind: "box", y: "age" }), { kind: "box", y: "age" }],
    [s({ kind: "box", y: "age", x: "region" }), { kind: "box", y: "age", x: "region", top_n: 15 }],
    [s({ kind: "scatter", x: "age", y: "satisfaction", trendline: false }), { kind: "scatter", x: "age", y: "satisfaction", trendline: false }],
    [s({ kind: "line", x: "survey_date", aggregation: "count" }), { kind: "line", x: "survey_date", aggregation: "count", frequency: "M" }],
    [s({ kind: "line", x: "survey_date", y: "age", aggregation: "mean", frequency: "Q" }), { kind: "line", x: "survey_date", aggregation: "mean", y: "age", frequency: "Q" }],
    [s({ kind: "heatmap", columns: ["age", "satisfaction"] }), { kind: "heatmap", columns: ["age", "satisfaction"] }],
    [s({ kind: "stacked_bar", x: "region", group: "plan" }), { kind: "stacked_bar", x: "region", group: "plan", top_n: 15 }],
    [s({ kind: "donut", x: "region", aggregation: "mean" }), { kind: "donut", x: "region" }],
  ])("%#", (state, body) => expect(buildRequest(state)).toEqual(body));

  it("reports what is missing and drops selections that no longer fit", () => {
    expect(missingInput(s({ kind: "scatter", x: "age" }))).toMatch(/y axis/i);
    expect(missingInput(s({ kind: "heatmap", columns: ["age"] }))).toMatch(/at least two/i);
    expect(missingInput(s({ kind: "stacked_bar", x: "a", group: "a" }))).toMatch(/two different/i);
    expect(missingInput(s({ kind: "histogram", x: "age" }))).toBeNull();
    const cols = [{ name: "age", semantic_type: "numeric_continuous" }, { name: "region", semantic_type: "categorical" }];
    expect(sanitize(s({ kind: "histogram", x: "region" }), cols).x).toBeUndefined();     // categorical is not valid for a histogram
    expect(sanitize(s({ kind: "scatter", x: "age", y: "age", group: "region" }), cols)).toMatchObject({ x: "age", y: "age", group: undefined });
  });
});

describe("VisualizationsPage", () => {
  it("shows only the controls each chart kind needs", async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await ready();
    expect(screen.getByLabelText("Variable")).toBeInTheDocument();
    expect(screen.queryByLabelText("Y axis")).not.toBeInTheDocument();
    await kind(user, /scatter/i);
    expect(screen.getByLabelText("X axis")).toBeInTheDocument();
    expect(screen.getByLabelText("Y axis")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /trend line/i })).toBeInTheDocument();
    await kind(user, /^line/i);
    expect(screen.getByLabelText("Date column")).toBeInTheDocument();
    expect(screen.getByLabelText("Group by period")).toBeInTheDocument();
    expect(screen.queryByLabelText("Measure")).not.toBeInTheDocument();                 // count needs no measure
    await choose(user, screen.getByLabelText("Show"), "Average");
    expect(screen.getByLabelText("Measure")).toBeInTheDocument();
    await kind(user, /heatmap/i);
    expect(screen.getByRole("checkbox", { name: "age" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "region" })).not.toBeInTheDocument();  // only numeric variables are offered
    await kind(user, /stacked/i);
    expect(screen.getByLabelText("Stack by")).toBeInTheDocument();
  });

  it("filters variable pickers by semantic type", async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByLabelText("Variable"));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["age", "satisfaction"]);                                      // no categories, dates or text
  });

  it("waits for a complete selection, then previews with a debounced POST that carries the version id", async () => {
    const { previews } = setup();
    const user = userEvent.setup();
    mount();
    await ready();
    expect(screen.getByText("Choose a variable to preview the chart.")).toBeInTheDocument();
    expect(previews).toHaveLength(0);
    await choose(user, screen.getByLabelText("Variable"), "age");
    expect(await screen.findByRole("img", { name: /bar chart of count by region/i })).toBeInTheDocument();
    expect(previews).toHaveLength(1);
    expect(previews[0]).toEqual({ kind: "histogram", x: "age", dataset_version_id: "v2" });
  });

  it("sends the right payload for scatter, heatmap and bar-with-measure", async () => {
    const { previews } = setup();
    const user = userEvent.setup();
    mount();
    await ready();

    await kind(user, /scatter/i);
    await choose(user, screen.getByLabelText("X axis"), "age");
    await choose(user, screen.getByLabelText("Y axis"), "satisfaction");
    await user.click(screen.getByRole("switch", { name: /trend line/i }));
    await waitFor(() => expect(last(previews)).toEqual({ kind: "scatter", x: "age", y: "satisfaction", trendline: false, dataset_version_id: "v2" }));

    await kind(user, /heatmap/i);
    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(last(previews)).toEqual({ kind: "heatmap", columns: ["age", "satisfaction"], dataset_version_id: "v2" }));

    await kind(user, /^bar/i);
    await choose(user, screen.getByLabelText("Category"), "region");
    await waitFor(() => expect(last(previews)).toEqual({ kind: "bar", x: "region", aggregation: "count", top_n: 15, dataset_version_id: "v2" }));
    await choose(user, screen.getByLabelText("Bar height"), "Average");
    await choose(user, screen.getByLabelText("Measure"), "satisfaction");
    await waitFor(() => expect(last(previews)).toEqual({ kind: "bar", x: "region", aggregation: "mean", y: "satisfaction", top_n: 15, dataset_version_id: "v2" }));
  });

  it("applies a recommended chart as a one-click preset, with its reason", async () => {
    const { previews } = setup();
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText("Compare the spread of age across region.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /age by region/i }));
    expect(screen.getByRole("radio", { name: /box plot/i })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(last(previews)).toEqual({ kind: "box", y: "age", x: "region", top_n: 15, dataset_version_id: "v2" }));
  });

  it("shows guard-rule messages inline as a helpful note, not an error", async () => {
    setup();
    server.use(http.post(`${API}/projects/${PID}/visualizations/preview`, () => apiError(422, "INVALID_ANALYSIS_CONFIGURATION", "A donut chart is only suitable for up to 6 parts of a whole; 'region' has 9. Use a bar chart instead.")));
    const user = userEvent.setup();
    mount();
    await ready();
    await kind(user, /donut/i);
    await choose(user, screen.getByLabelText("Category"), "region");
    expect(await screen.findByText(/A donut chart is only suitable for up to 6 parts/)).toBeInTheDocument();
    expect(screen.getByText("This chart needs a change")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save chart/i })).toBeDisabled();
  });

  it("shows a retryable error state for server failures", async () => {
    setup();
    let fail = true;
    server.use(http.post(`${API}/projects/${PID}/visualizations/preview`, () => (fail ? apiError(500, "INTERNAL", "The chart service is unavailable.") : j(SPEC))));
    const user = userEvent.setup();
    mount();
    await ready();
    await choose(user, screen.getByLabelText("Variable"), "age");
    expect(await screen.findByRole("alert")).toHaveTextContent("The chart service is unavailable.");
    fail = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("img", { name: /bar chart/i })).toBeInTheDocument();
  });

  it("saves a chart under a name and lists it in the gallery; deleting asks for confirmation", async () => {
    const { saves } = setup();
    const user = userEvent.setup();
    mount();
    await ready();
    expect(await screen.findByText("No saved charts yet")).toBeInTheDocument();
    await choose(user, screen.getByLabelText("Variable"), "age");
    await screen.findByRole("img", { name: /bar chart of count by region/i });
    const name = screen.getByLabelText("Name");
    await waitFor(() => expect(name).toHaveValue("Count by region"));                    // default from the chart title
    await user.clear(name);
    await user.type(name, "Age distribution");
    await waitFor(() => expect(screen.getByRole("button", { name: /save chart/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /save chart/i }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({ dataset_version_id: "v2", name: "Age distribution", request: { kind: "histogram", x: "age" } });
    const card = (await screen.findByRole("heading", { name: "Age distribution" })).closest("li")!;
    expect(card).toHaveTextContent("Histogram");

    await user.click(within(card).getByRole("button", { name: "Delete Age distribution" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete chart" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Age distribution" })).not.toBeInTheDocument());
    expect(await screen.findByText("No saved charts yet")).toBeInTheDocument();
  });

  it("can load a saved chart back into the builder", async () => {
    setup({ saved: [savedViz("s1", "Regions")] });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /open in builder/i }));
    expect(screen.getByRole("radio", { name: /^bar/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Category")).toHaveTextContent("region");
  });

  it("hides saving and deleting from viewers but still shows the gallery", async () => {
    setup({ role: "VIEWER", saved: [savedViz("s1", "Regions")] });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /scatter/i }));
    expect(await screen.findByRole("heading", { name: "Regions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save chart/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument();
  });

  it("explains how to get started when the project has no usable dataset", async () => {
    setup({ datasets: [] });
    mount();
    expect(await screen.findByText("No dataset to chart yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload a dataset" })).toHaveAttribute("href", `/projects/${PID}/data?upload=1`);
  });

  it("shows an error state with retry when saved charts cannot be loaded", async () => {
    setup();
    let fail = true;
    server.use(http.get(`${API}/projects/${PID}/visualizations`, () => (fail ? apiError(500, "INTERNAL", "Gallery unavailable.") : j([savedViz("s1", "Regions")]))));
    mount();
    expect(await screen.findByText("Gallery unavailable.")).toBeInTheDocument();
    fail = false;
    const buttons = screen.getAllByRole("button", { name: /try again/i });
    await userEvent.setup().click(buttons[buttons.length - 1]);
    expect(await screen.findByRole("heading", { name: "Regions" })).toBeInTheDocument();
  });
});
