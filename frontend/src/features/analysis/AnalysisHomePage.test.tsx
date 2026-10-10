import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j } from "@/test/utils";
import { ANALYSIS_LIST, DID, PID, SUGGESTIONS, VID } from "./fixtures";
import { base, installBase, mountAnalysis } from "./testUtils";

const page = (items: unknown[], total = items.length, pageNo = 1) => ({ items, total, page: pageNo, page_size: 10 });

describe("AnalysisHomePage", () => {
  it("lists analyses with type, dataset version, status, headline, duration and open links", async () => {
    installBase();
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, () => j(page(ANALYSIS_LIST))),
      http.get(`${API}/datasets/${DID}/suggestions`, () => j([])),
    );
    mountAnalysis(`${base}/analysis`);
    const list = await screen.findByRole("list", { name: "Analyses" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const first = rows[0];
    expect(within(first).getByRole("link", { name: /^group comparison — satisfaction_score by channel$/i })).toHaveAttribute("href", `${base}/analysis/${ANALYSIS_LIST[0].id}`);
    expect(first).toHaveTextContent("Group comparison");
    expect(first).toHaveTextContent("Customer feedback (survey + comments) · v2");
    expect(first).toHaveTextContent("Completed");
    expect(first).toHaveTextContent("14 ms");
    expect(within(first).getByLabelText("Headline result")).toHaveTextContent("Welch F 1.666 · p = 0.191 · n = 588");
    // headline without a p-value omits it; the saved one is marked pressed
    expect(within(rows[1]).getByLabelText("Headline result")).toHaveTextContent("Variable pairs 21 · n = 537");
    expect(within(rows[2]).getByRole("button", { name: /remove .* from saved/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /new analysis/i })).toHaveAttribute("href", `${base}/analysis/new`);
  });

  it("shows the empty state, loading error with retry, and failed rows with their stored message", async () => {
    installBase();
    server.use(http.get(`${API}/datasets/${DID}/suggestions`, () => j([])));
    let fail = true;
    server.use(http.get(`${API}/projects/${PID}/analyses`, () => (fail ? apiError(503, "SERVICE_UNAVAILABLE", "The Lotus server is unavailable.") : j(page([])))));
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    fail = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("No analyses yet. Select a dataset and start exploring.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /new analysis/i }).length).toBeGreaterThan(0);
  });

  it("shows a failed analysis' stored error in the history", async () => {
    installBase();
    const failed = { ...ANALYSIS_LIST[0], id: "f1", status: "FAILED", headline: null, error: { code: "ANALYSIS_FAILED", message: "Every group has fewer than two observations." } };
    server.use(http.get(`${API}/projects/${PID}/analyses`, () => j(page([failed]))), http.get(`${API}/datasets/${DID}/suggestions`, () => j([])));
    mountAnalysis(`${base}/analysis`);
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/every group has fewer than two observations/i)).toBeInTheDocument();
  });

  it("sends type, status, version and saved filters to the API and can clear them", async () => {
    installBase();
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, ({ request }) => { seen.push(new URL(request.url).searchParams); return j(page(ANALYSIS_LIST)); }),
      http.get(`${API}/datasets/${DID}/suggestions`, () => j([])),
    );
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis`);
    await screen.findByRole("list", { name: "Analyses" });
    await user.click(screen.getByLabelText("Type"));
    await user.click(await screen.findByRole("option", { name: "Correlation" }));
    await waitFor(() => expect(seen.at(-1)?.get("analysis_type")).toBe("correlation"));
    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "Failed" }));
    await waitFor(() => expect(seen.at(-1)?.get("status")).toBe("FAILED"));
    await user.click(screen.getByLabelText("Dataset version"));
    await user.click(await screen.findByRole("option", { name: /v1$/ }));
    await waitFor(() => expect(seen.at(-1)?.get("dataset_version_id")).toBe("267e4994-f384-406f-8d05-a5c9513b80f1"));
    await user.click(screen.getByRole("switch", { name: /saved only/i }));
    await waitFor(() => expect(seen.at(-1)?.get("saved")).toBe("true"));
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => { const p = seen.at(-1)!; expect([p.get("analysis_type"), p.get("status"), p.get("saved"), p.get("dataset_version_id")]).toEqual([null, null, null, null]); });
  });

  it("filtered-empty is different from never-run", async () => {
    installBase();
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, ({ request }) => j(new URL(request.url).searchParams.get("saved") ? page([]) : page(ANALYSIS_LIST))),
      http.get(`${API}/datasets/${DID}/suggestions`, () => j([])),
    );
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis`);
    await screen.findByRole("list", { name: "Analyses" });
    await user.click(screen.getByRole("switch", { name: /saved only/i }));
    expect(await screen.findByText(/no analyses match these filters/i)).toBeInTheDocument();
  });

  it("paginates", async () => {
    installBase();
    const pages: string[] = [];
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, ({ request }) => { const p = new URL(request.url).searchParams.get("page") ?? "1"; pages.push(p); return j(page(ANALYSIS_LIST, 25, Number(p))); }),
      http.get(`${API}/datasets/${DID}/suggestions`, () => j([])),
    );
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis`);
    expect(await screen.findByText(/25 analyses · Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(pages).toContain("2");
  });

  it("toggles saved with PATCH and deletes after confirmation", async () => {
    installBase();
    let patched: unknown = null, deleted = "";
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, () => j(page(ANALYSIS_LIST))),
      http.get(`${API}/datasets/${DID}/suggestions`, () => j([])),
      http.patch(`${API}/analyses/${ANALYSIS_LIST[0].id}`, async ({ request }) => { patched = await request.json(); return j({ ...ANALYSIS_LIST[0], saved: true, provenance: {}, result: null }); }),
      http.delete(`${API}/analyses/${ANALYSIS_LIST[1].id}`, ({ params }) => { deleted = String(params.id ?? ANALYSIS_LIST[1].id); return new HttpResponse(null, { status: 204 }); }),
    );
    const user = userEvent.setup();
    mountAnalysis(`${base}/analysis`);
    await user.click(await screen.findByRole("button", { name: /save “group comparison — satisfaction_score by channel” to my analyses/i }));
    await waitFor(() => expect(patched).toEqual({ saved: true }));
    await user.click(screen.getByRole("button", { name: /delete “correlation matrix — 7 variables”/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/permanently removed/i);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).not.toBe(""));
    expect(await screen.findByText("Analysis deleted")).toBeInTheDocument();
  });

  it("offers one-click suggested analyses that open the builder pre-filled", async () => {
    installBase();
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, () => j(page(ANALYSIS_LIST))),
      http.get(`${API}/datasets/${DID}/suggestions`, ({ request }) => { expect(new URL(request.url).searchParams.get("version_id")).toBe(VID); return j(SUGGESTIONS); }),
    );
    mountAnalysis(`${base}/analysis`);
    expect(await screen.findByRole("heading", { name: /suggested for your data/i })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /analyze the correlation between delivery_time and satisfaction_score/i });
    const href = link.getAttribute("href")!;
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe(`${base}/analysis/new`);
    expect(url.searchParams.get("type")).toBe("correlation");
    expect(url.searchParams.get("version")).toBe(VID);
    expect(JSON.parse(url.searchParams.get("config")!)).toEqual({ variables: ["delivery_time", "satisfaction_score"], method: "pearson" });
    expect(link).toHaveTextContent(/set up this analysis/i);
  });

  it("viewers see the history but no write actions", async () => {
    installBase("VIEWER");
    server.use(
      http.get(`${API}/projects/${PID}/analyses`, () => j(page(ANALYSIS_LIST))),
      http.get(`${API}/datasets/${DID}/suggestions`, () => j(SUGGESTIONS)),
    );
    mountAnalysis(`${base}/analysis`);
    await screen.findByRole("list", { name: "Analyses" });
    expect(screen.queryByRole("link", { name: /new analysis/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /suggested for your data/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /to my analyses|from saved/i }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
