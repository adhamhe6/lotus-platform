import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { DatasetPage } from "./DatasetPage";
import { dataset, installMocks, job, PID, V1, V2 } from "./testFixtures";

function Probe() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}
const mount = (route = `/projects/${PID}/data/d1`) =>
  renderApp(<Routes><Route path="/projects/:projectId/data/:datasetId" element={<DatasetPage />} /><Route path="*" element={<Probe />} /></Routes>, { route, path: "*", withProject: PID });

const tab = (name: RegExp) => screen.getByRole("tab", { name });
async function choose(user: UserEvent, trigger: HTMLElement, option: RegExp | string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}
const ready = async () => { await screen.findByRole("heading", { name: "Customer feedback" }); await screen.findByText("Data quality"); };

describe("DatasetPage header and states", () => {
  it("shows name, file, size, version selector and a Start analysis action", async () => {
    signIn(); installMocks();
    mount();
    await ready();
    expect(screen.getByText(/customer_feedback\.csv · 89\.4 KB · CSV/)).toBeInTheDocument();
    expect(screen.getByText("600 rows × 5 columns")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Dataset version" })).toHaveTextContent("v2 · Duplicates removed");
    expect(screen.getByRole("link", { name: /start analysis/i })).toHaveAttribute("href", `/projects/${PID}/analysis/new?version=v2`);
  });

  it("explains datasets that are still processing or failed", async () => {
    signIn(); installMocks({ datasets: [dataset({ status: "PROCESSING", latest_version: null })] });
    const { unmount } = mount();
    expect(await screen.findByText("Still processing")).toBeInTheDocument();
    unmount();
    installMocks({ datasets: [dataset({ status: "FAILED", latest_version: null, error: { code: "INVALID_ENCODING", message: "The file encoding could not be determined." } })] });
    mount();
    expect(await screen.findByText("This file couldn’t be processed")).toBeInTheDocument();
    expect(screen.getByText("The file encoding could not be determined.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows an error state with retry when the profile fails to load", async () => {
    signIn(); installMocks();
    let fail = true;
    server.use(http.get(`${API}/datasets/d1/profile`, () => (fail ? apiError(500, "INTERNAL", "Profile store unavailable.") : j({ version: V2, columns: [] }))));
    mount();
    expect(await screen.findByText("Profile store unavailable.")).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.queryByText("Profile store unavailable.")).not.toBeInTheDocument());
  });

  it("shows not-available for an unknown dataset", async () => {
    signIn(); installMocks();
    mount(`/projects/${PID}/data/nope`);
    expect(await screen.findByText("Not available")).toBeInTheDocument();
  });
});

describe("Overview", () => {
  it("summarises data quality and groups issues by severity with the column named", async () => {
    signIn(); installMocks();
    mount();
    await ready();
    const tiles = screen.getByText("Data quality").closest("section")!;
    const tile = (label: string) => within(tiles).getByText(label).parentElement!.nextElementSibling;
    expect(tile("Rows")).toHaveTextContent("600");
    expect(tile("Missing cells")).toHaveTextContent("1.9%");
    expect(tile("Duplicate rows")).toHaveTextContent("0");
    expect(within(tiles).getByText(/Numeric · 2/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Warnings \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Notes \(2\)/ })).toBeInTheDocument();
    expect(screen.getByText("'comment' is 27.0% missing.")).toBeInTheDocument();
    expect(screen.getAllByText("comment").length).toBeGreaterThan(0);                  // column named on the issue
  });

  it("offers suggested analyses labelled as a preliminary scan and deep-links into the builder", async () => {
    signIn(); installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    expect(await screen.findByText("Analyze the correlation between age and satisfaction")).toBeInTheDocument();
    expect(screen.getAllByText("Preliminary scan").length).toBe(2);
    await user.click(screen.getByRole("button", { name: /run analyze the correlation/i }));
    const loc = (await screen.findByTestId("loc")).textContent!;
    const url = new URL(loc, "http://x");
    expect(url.pathname).toBe(`/projects/${PID}/analysis/new`);
    expect(url.searchParams.get("type")).toBe("correlation");
    expect(url.searchParams.get("version")).toBe("v2");
    expect(JSON.parse(url.searchParams.get("config")!)).toEqual({ variables: ["age", "satisfaction"], method: "pearson" });
  });

  it("sends qualitative suggestions to the qualitative workspace", async () => {
    signIn(); installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(await screen.findByRole("button", { name: /run find recurring themes/i }));
    expect((await screen.findByTestId("loc")).textContent).toMatch(new RegExp(`^/projects/${PID}/qualitative\\?version=v2&column=comment$`));
  });

  it("shows import notes and turns “Fix this” into a pre-filled step in Prepare", async () => {
    signIn(); installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(tab(/^versions/i));
    await user.click(await screen.findByRole("button", { name: "Use version 1" }));
    await user.click(tab(/^overview/i));
    expect(await screen.findByText(/Duplicate column name 'region' was renamed/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /fix this: remove duplicates/i }));
    expect(tab(/^prepare/i)).toHaveAttribute("data-state", "active");
    const step = await screen.findByRole("group", { name: "Step 1: Remove duplicate rows" });
    expect(step).toBeInTheDocument();
  });

  it("hides write shortcuts from viewers", async () => {
    signIn(); installMocks({ role: "VIEWER" });
    const user = userEvent.setup();
    mount();
    await ready();
    await screen.findByText("'comment' is 27.0% missing.");
    expect(screen.queryByRole("button", { name: /fix this/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument();
    await user.click(tab(/^prepare/i));
    expect(await screen.findByText("Preparing data needs editor access")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview effect/i })).not.toBeInTheDocument();
  });
});

describe("Columns", () => {
  it("searches, shows every computed statistic, and deep-links the selection into the analysis builder", async () => {
    signIn(); installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(tab(/^columns/i));
    expect(await screen.findByRole("button", { name: "Inspect age" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search columns"), "reg");
    expect(screen.queryByRole("button", { name: "Inspect age" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect region" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search columns"));

    await user.click(screen.getByRole("button", { name: "Inspect age" }));
    const detail = screen.getByRole("region", { name: "Details for age" });
    for (const [label, value] of [["Mean", "41.2"], ["Median", "40"], ["Std. deviation", "12.5"], ["Minimum", "18"], ["Maximum", "80"], ["Lower quartile (Q1)", "32"], ["Upper quartile (Q3)", "50"], ["Skewness", "0.3"], ["Outliers (IQR rule)", "8"], ["Outlier bounds", "5 to 77"], ["Missing", "12 (2.0%)"]]) {
      expect(within(detail).getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(within(detail).getByRole("img", { name: /histogram with 5 bins/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inspect region" }));   // categorical: category stats and top values
    expect(within(screen.getByRole("region", { name: "Details for region" })).getByText("Categories").nextElementSibling).toHaveTextContent("3");
    expect(within(screen.getByLabelText("Most frequent values")).getByText("West")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select age" }));
    await user.click(screen.getByRole("checkbox", { name: "Select satisfaction" }));
    await user.click(screen.getByRole("button", { name: "Start analysis with 2 selected" }));
    expect((await screen.findByTestId("loc")).textContent).toBe(`/projects/${PID}/analysis/new?vars=age,satisfaction&version=v2`);
  });
});

describe("Preview", () => {
  it("is server-paginated and sends page, page size, sort, filters and columns", async () => {
    signIn();
    const calls = installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(tab(/^preview/i));
    expect(await screen.findByText("Showing 1–50 of 120 rows")).toBeInTheDocument();
    const last = () => calls.preview[calls.preview.length - 1].searchParams;
    expect(last().get("version_id")).toBe("v2");
    expect(last().get("page")).toBe("1");
    expect(last().get("page_size")).toBe("50");
    expect(last().has("sort")).toBe(false);
    expect(last().has("filters")).toBe(false);

    // presentation: missing values muted, numbers right-aligned, long text truncated with a title tooltip
    expect(screen.getAllByLabelText("missing").length).toBeGreaterThan(0);
    const longCell = screen.getByTitle(/A very long free-text comment/);
    expect(longCell).toHaveClass("truncate");
    expect(screen.getAllByText("20")[0].closest("td")).toHaveClass("text-right");

    // pagination
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Showing 51–100 of 120 rows")).toBeInTheDocument();
    expect(last().get("page")).toBe("2");
    await user.click(screen.getByRole("button", { name: "Last page" }));
    expect(await screen.findByText("Showing 101–120 of 120 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    // sorting cycles asc → desc → off and resets to page 1
    await user.click(screen.getByRole("button", { name: "Sort by age" }));
    await waitFor(() => expect(last().get("sort")).toBe("age"));
    expect(last().get("order")).toBe("asc");
    expect(last().get("page")).toBe("1");
    expect(screen.getByRole("columnheader", { name: /age/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: "Sort by age" }));
    await waitFor(() => expect(last().get("order")).toBe("desc"));
    await user.click(screen.getByRole("button", { name: "Sort by age" }));
    await waitFor(() => expect(last().has("sort")).toBe(false));

    // page size
    await choose(user, screen.getByRole("combobox", { name: "Rows per page" }), "25");
    await waitFor(() => expect(last().get("page_size")).toBe("25"));
    expect(await screen.findByText("Showing 1–25 of 120 rows")).toBeInTheDocument();
  });

  it("builds filters (column, operator, value) as a JSON list and lets you remove them", async () => {
    signIn();
    const calls = installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(tab(/^preview/i));
    await screen.findByText(/Showing 1–50/);
    await user.click(screen.getByRole("button", { name: /^filters/i }));
    await choose(user, await screen.findByRole("combobox", { name: "Condition 1 operator" }), "greater than");
    await user.type(screen.getByLabelText("Condition 1 value"), "30");
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await choose(user, screen.getByRole("combobox", { name: "Condition 2 column" }), /^region/);
    await choose(user, screen.getByRole("combobox", { name: "Condition 2 operator" }), "is one of");
    await user.type(screen.getByLabelText("Condition 2 value"), "East, West");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(calls.preview[calls.preview.length - 1].searchParams.has("filters")).toBe(true));
    const sp = calls.preview[calls.preview.length - 1].searchParams;
    expect(JSON.parse(sp.get("filters")!)).toEqual([
      { column: "age", operator: "gt", value: "30" },
      { column: "region", operator: "in", value: ["East", "West"] },
    ]);
    expect(sp.get("page")).toBe("1");
    await user.click(await screen.findByRole("button", { name: "Remove filter on age" }));
    await waitFor(() => expect(JSON.parse(calls.preview[calls.preview.length - 1].searchParams.get("filters")!)).toHaveLength(1));
  });

  it("restricts to the visible columns", async () => {
    signIn();
    const calls = installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(tab(/^preview/i));
    await screen.findByText(/Showing 1–50/);
    await user.click(screen.getByRole("button", { name: /^columns\s*5\/5/i }));
    await user.click(await screen.findByRole("checkbox", { name: "comment" }));
    await waitFor(() => expect(calls.preview[calls.preview.length - 1].searchParams.get("columns")).toBe("age,region,satisfaction,survey_date"));
    expect(screen.queryByRole("columnheader", { name: /comment/ })).not.toBeInTheDocument();
  });

  it("shows the server's message when a filter is rejected", async () => {
    signIn(); installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    server.use(http.get(`${API}/datasets/d1/preview`, ({ request }) => (new URL(request.url).searchParams.has("filters") ? apiError(422, "INVALID_FILTER", "Value 'abc' is not valid for column 'age'.") : j({ version_id: "v2", columns: [], rows: [], total: 0, page: 1, page_size: 50, row_offset: 0 }))));
    await user.click(tab(/^preview/i));
    await user.click(await screen.findByRole("button", { name: /^filters/i }));
    await user.type(await screen.findByLabelText("Condition 1 value"), "abc");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("Value 'abc' is not valid for column 'age'.")).toBeInTheDocument();
  });
});

describe("Prepare", () => {
  async function addStep(user: UserEvent, name: RegExp) {
    await choose(user, screen.getByRole("combobox", { name: "Add a step" }), name);
  }
  const DRY = { log: [
    { op: "drop_duplicates", note: "removed 8 duplicate row(s)", params: {}, rows_before: 600, rows_after: 592, cells_or_rows_affected: 8 },
    { op: "fill_missing", note: "filled 12 missing value(s) in 'age'", params: {}, rows_before: 592, rows_after: 592, cells_or_rows_affected: 12 },
  ], rows_before: 600, rows_after: 592, columns_after: [{ name: "age", semantic_type: "numeric_continuous" }, { name: "region", semantic_type: "categorical" }], sample: [{ age: 41, region: "West" }, { age: null, region: "East" }] };

  it("builds the operations payload, previews the effect with a dry run, and explains non-destructiveness", async () => {
    signIn(); installMocks();
    const bodies: Record<string, unknown>[] = [];
    server.use(http.post(`${API}/datasets/d1/versions`, async ({ request }) => { bodies.push((await request.json()) as Record<string, unknown>); return j(DRY, 202); }));
    const user = userEvent.setup();
    mount(`/projects/${PID}/data/d1?tab=prepare`);
    expect(await screen.findByText("Preparing data never changes the original")).toBeInTheDocument();

    await addStep(user, /remove duplicate rows/i);
    await addStep(user, /fill missing values/i);
    const fill = screen.getByRole("group", { name: "Step 2: Fill missing values" });
    await choose(user, within(fill).getByRole("combobox", { name: "Fill with" }), "A fixed value");
    await user.type(within(fill).getByLabelText("Value"), "0");
    await addStep(user, /remove columns/i);
    const drop = screen.getByRole("group", { name: "Step 3: Remove columns" });
    expect(screen.getByRole("button", { name: "Preview effect" })).toBeDisabled();      // step 3 is incomplete
    expect(within(drop).getByText("Choose at least one column to remove.")).toBeInTheDocument();
    await user.click(within(drop).getByRole("button", { name: /columns to remove/i }));
    await user.click(await screen.findByRole("checkbox", { name: "comment" }));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Preview effect" }));
    const result = await screen.findByLabelText("Preview of the effect");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({
      parent_version_id: "v2", label: "", dry_run: true,
      operations: [{ op: "drop_duplicates", keep: "first" }, { op: "fill_missing", column: "age", strategy: "constant", value: "0" }, { op: "drop_columns", columns: ["comment"] }],
    });
    expect(within(result).getByText("Rows before").nextElementSibling).toHaveTextContent("600");
    expect(within(result).getByText("Rows after").nextElementSibling).toHaveTextContent("592");
    expect(within(result).getByText("removed 8 duplicate row(s)")).toBeInTheDocument();
    expect(within(result).getByText("filled 12 missing value(s) in 'age'")).toBeInTheDocument();
    expect(within(result).getByText("600 → 592 rows")).toBeInTheDocument();
    expect(within(result).getByText("East")).toBeInTheDocument();                       // sample table

    // editing a step marks the preview as stale
    await user.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(screen.queryByLabelText("Preview of the effect")).not.toBeInTheDocument();
  });

  it("adapts controls to the operation and the column type, and shows server errors from the dry run", async () => {
    signIn(); installMocks();
    server.use(http.post(`${API}/datasets/d1/versions`, () => apiError(422, "INVALID_TRANSFORMATION", "'region' is not numeric; use mode or constant.")));
    const user = userEvent.setup();
    mount(`/projects/${PID}/data/d1?tab=prepare`);
    await screen.findByText("Preparing data never changes the original");
    await addStep(user, /fill missing values/i);
    const step = screen.getByRole("group", { name: /Step 1/ });
    await user.click(within(step).getByRole("combobox", { name: "Column" }));
    expect(screen.getByRole("option", { name: /^region/ })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /^region/ }));
    await user.click(within(step).getByRole("combobox", { name: "Fill with" }));
    expect(screen.queryByRole("option", { name: "Mean" })).not.toBeInTheDocument();      // non-numeric: no mean/median
    expect(screen.getByRole("option", { name: "Most common value" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await addStep(user, /change a column/i);
    const cast = screen.getByRole("group", { name: /Step 2/ });
    expect(within(cast).queryByLabelText(/day comes first/i)).not.toBeInTheDocument();
    await choose(user, within(cast).getByRole("combobox", { name: "Convert to" }), "Date/time");
    expect(within(cast).getByLabelText(/day comes first/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview effect" }));
    expect(await screen.findByText("'region' is not numeric; use mode or constant.")).toBeInTheDocument();
  });

  it("creates a new version as a tracked job and switches to it", async () => {
    signIn(); installMocks();
    const V3 = { ...V2, id: "v3", version_number: 3, parent_version_id: "v2", label: "Tidy regions", content_hash: "cccccccccccc3333" };
    let versions = [V1, V2];
    const posted: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API}/datasets/d1/versions`, () => j(versions)),
      http.post(`${API}/datasets/d1/versions`, async ({ request }) => {
        posted.push((await request.json()) as Record<string, unknown>);
        versions = [V1, V2, V3];
        return j(job({ id: "j2", type: "apply_transform", status: "COMPLETED", stage: null, progress: 1, total_stages: 3, completed_stages: 3, result_ref: { type: "dataset", dataset_id: "d1", version_id: "v3" } }), 202);
      }),
    );
    const user = userEvent.setup();
    mount(`/projects/${PID}/data/d1?tab=prepare`);
    await screen.findByText("Preparing data never changes the original");
    await addStep(user, /tidy category labels/i);
    const step = screen.getByRole("group", { name: /Step 1/ });
    await choose(user, within(step).getByRole("combobox", { name: "Letter case" }), "Title Case");
    await user.type(screen.getByLabelText("Version label"), "Tidy regions");
    await user.click(screen.getByRole("button", { name: "Create new version" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ parent_version_id: "v2", label: "Tidy regions", dry_run: false, operations: [{ op: "normalize_categories", column: "region", strip: true, collapse_whitespace: true, case: "title" }] });
    // lands on the Versions tab with the new version in use
    expect(await screen.findByRole("heading", { name: "Version 3" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Dataset version" })).toHaveTextContent("v3 · Tidy regions"));
    expect(tab(/^versions/i)).toHaveAttribute("data-state", "active");
  });
});

describe("Versions", () => {
  it("shows lineage, content hash, transformation log and a quality diff versus the parent, and switches version", async () => {
    signIn(); installMocks();
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(tab(/^versions/i));
    const list = await screen.findByRole("list", { name: "Version history" });
    const v2 = within(list).getByRole("heading", { name: "Version 2" }).closest("li")!;
    expect(v2).toHaveTextContent("Duplicates removed");
    expect(v2).toHaveTextContent("Derived fromVersion 1");
    expect(v2).toHaveTextContent("bbbbbbbbbb");
    expect(within(v2).getByText("In use")).toBeInTheDocument();
    const diff = within(v2).getByLabelText("Quality compared with version 1");
    expect(diff).toHaveTextContent("Rows608 → 600");
    expect(diff).toHaveTextContent("Missing cells160 → 147");
    expect(within(v2).getByText("removed 8 duplicate row(s)")).toBeInTheDocument();
    expect(within(v2).getByText("Transformation log (1 step)")).toBeInTheDocument();
    const v1 = within(list).getByRole("heading", { name: "Version 1" }).closest("li")!;
    expect(v1).toHaveTextContent("Original upload");
    expect(within(v1).queryByLabelText(/quality compared/i)).not.toBeInTheDocument();

    await user.click(within(v1).getByRole("button", { name: "Use version 1" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Dataset version" })).toHaveTextContent("v1 · Original upload"));
    const after = await screen.findByRole("list", { name: "Version history" });
    expect(within(within(after).getByRole("heading", { name: "Version 1" }).closest("li")!).getByText("In use")).toBeInTheDocument();
    expect(within(after).getByRole("button", { name: "Use version 2" })).toBeInTheDocument();
  });
});
