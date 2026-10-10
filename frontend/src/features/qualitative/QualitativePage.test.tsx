import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { QualitativePage } from "./QualitativePage";

const PID = "p1", VID = "v1", DID = "d1";
const project = (role = "OWNER") => ({ id: PID, name: "Study", description: "", objective: "", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", role, counts: { datasets: 1, analyses: 0, insights: 0 } });
const version = { id: VID, dataset_id: DID, version_number: 1, created_at: "2026-01-01T00:00:00Z" };
const dataset = { id: DID, project_id: PID, name: "Feedback", description: "", status: "READY", latest_version: version };
const profile = { columns: [
  { name: "comment", semantic_type: "text", dtype: "string", position: 0, missing_count: 0, missing_pct: 0, unique_count: 500, profile: {} },
  { name: "region", semantic_type: "categorical", dtype: "string", position: 1, missing_count: 0, missing_pct: 0, unique_count: 5, profile: {} },
] };
const theme = (id: string, name: string, response_count: number, share_pct: number, extra: Record<string, unknown> = {}) => ({
  id, project_id: PID, run_id: "run1", dataset_version_id: VID, column_name: "comment", name, description: "", keywords: ["checkout", "refund"],
  summary: { text: `Computed profile of ${name}.`, origin: "deterministic", quotes: [] }, origin: "auto", position: 0, segment_count: response_count + 3, response_count, share_pct,
  examples: [{ segment_id: "s1", text: "Hidden charges at checkout.", row_index: 4, score: 0.5 }], created_at: "2026-01-01T00:00:00Z", ...extra,
});
const THEMES = [theme("t1", "Delivery", 120, 24.5), theme("t2", "Checkout", 225, 43.35), theme("t3", "Support", 60, 11.6)];
const RUN = { id: "run1", created_at: "2026-02-01T10:00:00Z", k: 3, silhouette: 0.2615, embedding_model: "tfidf-lsa-v1", unassigned: 7, params: {} };
const code = (id: string, name: string, accepted: number, suggested: number, keywords: string[] = ["late"]) => ({ id, project_id: PID, name, description: "", color: "#1d4ed8", category: "Ops", keywords, created_at: "2026-01-01T00:00:00Z", accepted_count: accepted, suggested_count: suggested });
const CODES = [code("c1", "Delivery", 150, 124, ["deliver*"]), code("c2", "Pricing", 78, 70)];
const ann = (id: string, code_id: string, status: string, source = "keyword", score: number | null = 0.75) => ({ id, segment_id: "g1", code_id, source, status, score });
const SEGS = [
  { id: "g1", row_index: 3, seg_index: 0, text: "Delivery took far too long.", themes: [{ id: "t1", name: "Delivery" }], annotations: [ann("a1", "c1", "suggested"), ann("a2", "c2", "accepted", "manual", null)] },
  { id: "g2", row_index: 4, seg_index: 0, text: "Great support team.", themes: [], annotations: [] },
];

interface Opts { noColumns?: boolean; role?: string; prepared?: boolean; themes?: unknown[]; codes?: unknown[]; sources?: unknown[]; segments?: unknown[]; reviewTotal?: number }
function setup(o: Opts = {}) {
  signIn();
  const calls: { method: string; path: string; query: Record<string, string>; body?: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const state = { prepared: o.prepared ?? true, themes: o.themes ?? THEMES, jobStatus: "RUNNING" };
  const rec = async (request: Request, path: string) => {
    const u = new URL(request.url);
    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (request.method !== "GET") { try { body = await request.json(); } catch { body = undefined; } }
    calls.push({ method: request.method, path, query: Object.fromEntries(u.searchParams), body });
  };
  const job = (type: string, status: string) => ({ id: `job-${type}`, project_id: PID, type, status, stage: status === "RUNNING" ? "Embedding responses" : "Done", progress: status === "RUNNING" ? 40 : 100, completed_stages: status === "RUNNING" ? 1 : 3, total_stages: 3, error: null, result: null, created_at: "2026-01-01T00:00:00Z" });
  server.use(
    http.get(`${API}/projects/${PID}`, () => j(project(o.role))),
    http.get(`${API}/projects/${PID}/datasets`, () => j([dataset])),
    http.get(`${API}/datasets/${DID}/versions`, () => j([version])),
    http.get(`${API}/datasets/${DID}/profile`, () => j({ columns: o.noColumns ? [] : profile.columns })),
    http.get(`${API}/projects/${PID}/qualitative/sources`, () => j(o.sources ?? [{ column: "comment", avg_words: 18, non_empty: 519, segments: state.prepared ? 795 : 0, theme_runs: 1 }])),
    http.get(`${API}/projects/${PID}/qualitative/themes`, async ({ request }) => { await rec(request, "themes"); return j({ themes: state.themes, runs: [RUN] }); }),
    http.get(`${API}/projects/${PID}/codes`, () => j(o.codes ?? CODES)),
    http.get(`${API}/projects/${PID}/qualitative/segments`, async ({ request }) => {
      await rec(request, "segments");
      const q = new URL(request.url).searchParams;
      if (q.get("page_size") === "1") return j({ items: [], total: o.reviewTotal ?? 300, page: 1, page_size: 1 });
      const items = o.segments ?? SEGS;
      return j({ items, total: items.length, page: 1, page_size: 30 });
    }),
    http.get(`${API}/jobs/:id`, ({ params }) => j(job(String(params.id).replace("job-", ""), state.jobStatus))),
    http.post(`${API}/projects/${PID}/qualitative/prepare`, async ({ request }) => { await rec(request, "prepare"); return j(job("prepare_text", "RUNNING"), 202); }),
    http.post(`${API}/projects/${PID}/qualitative/themes/detect`, async ({ request }) => { await rec(request, "detect"); return j(job("detect_themes", "RUNNING"), 202); }),
    http.post(`${API}/projects/${PID}/qualitative/suggest-codes`, async ({ request }) => { await rec(request, "suggest"); return j(job("suggest_codes", "COMPLETED"), 202); }),
  );
  const on = (method: "post" | "patch" | "delete", path: string, name: string, res: () => Response = () => new Response(null, { status: 204 })) =>
    server.use(http[method](`${API}${path}`, async ({ request }) => { await rec(request, name); return res(); }));
  const view = renderApp(<QualitativePage />, { route: `/projects/${PID}/qualitative`, path: "/projects/:projectId/qualitative", withProject: PID });
  const last = (path: string) => calls.filter((c) => c.path === path && !(path === "segments" && c.query.page_size === "1")).at(-1);
  return { ...view, calls, state, on, last, user: userEvent.setup() };
}

const pane = async (name: string) => (await screen.findByRole("heading", { name })).closest("section")!;

describe("source preparation", () => {
  it("explains what preparing does, queues the job and shows real progress, then reveals the workspace", async () => {
    const t = setup({ prepared: false });
    expect(await screen.findByText(/builds a semantic model/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Themes" })).not.toBeInTheDocument();
    await t.user.click(screen.getAllByRole("button", { name: /prepare text/i })[0]);
    await waitFor(() => expect(t.last("prepare")?.body).toEqual({ dataset_version_id: VID, column: "comment" }));
    expect(await screen.findByText("Embedding responses")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    t.state.prepared = true; t.state.jobStatus = "COMPLETED";
    expect(await screen.findByRole("heading", { name: "Themes" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/795/)).toBeInTheDocument();
  });

  it("offers only the CTA (no write action) to viewers", async () => {
    setup({ prepared: false, role: "VIEWER" });
    expect(await screen.findByText(/an editor needs to prepare/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /prepare text/i })).not.toBeInTheDocument();
  });

  it("shows a no-text-column state", async () => {
    setup({ sources: [], noColumns: true });
    expect(await screen.findByText(/no text column in this dataset version/i)).toBeInTheDocument();
  });
});

describe("theme detection", () => {
  it("validates the optional number of themes, sends it, and tracks progress", async () => {
    const t = setup();
    await t.user.click(await screen.findByRole("button", { name: /^detect themes$/i }));
    expect(screen.getByText(/starting point to review/i)).toBeInTheDocument();
    await t.user.type(screen.getByLabelText(/number of themes/i), "40");
    await t.user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /detect themes/i }));
    expect(await screen.findByText(/whole number from 2 to 15/i)).toBeInTheDocument();
    expect(t.last("detect")).toBeUndefined();
    await t.user.clear(screen.getByLabelText(/number of themes/i));
    await t.user.type(screen.getByLabelText(/number of themes/i), "5");
    await t.user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /detect themes/i }));
    await waitFor(() => expect(t.last("detect")?.body).toEqual({ dataset_version_id: VID, column: "comment", n_themes: 5 }));
    expect(await screen.findByText("Embedding responses")).toBeInTheDocument();
  });

  it("omits n_themes when left automatic", async () => {
    const t = setup();
    await t.user.click(await screen.findByRole("button", { name: /^detect themes$/i }));
    await t.user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /detect themes/i }));
    await waitFor(() => expect(t.last("detect")?.body).toEqual({ dataset_version_id: VID, column: "comment" }));
  });
});

describe("themes pane", () => {
  it("lists themes sorted by response count with the API’s computed counts and run statistics", async () => {
    setup();
    const list = (await screen.findByRole("heading", { name: "Themes" })).closest("section")!;
    const names = await within(list).findAllByRole("button", { expanded: false });
    expect(names.map((b) => b.textContent)).toEqual([expect.stringContaining("Checkout"), expect.stringContaining("Delivery"), expect.stringContaining("Support")]);
    expect(names[0]).toHaveTextContent("225 responses");
    expect(names[0]).toHaveTextContent("43.4% of respondents".replace("43.4", "43.4"));
    expect(screen.getByText(/suggestions to review/i)).toBeInTheDocument();
    expect(screen.getByText(/only under the first/i)).toBeInTheDocument();
    expect(screen.getByText("0.26")).toBeInTheDocument(); // silhouette
    expect(screen.getByText("tfidf-lsa-v1")).toBeInTheDocument();
    expect(screen.getByText(/unassigned/)).toBeInTheDocument();
  });

  it("shows rule-based provenance for deterministic summaries and AI for generated ones, and summarizes on request", async () => {
    const ai = theme("t9", "Pricing", 10, 2, { summary: { text: "Customers feel charges are hidden.", origin: "llm", model: "claude-x", quotes: [] } });
    const t = setup({ themes: [THEMES[1], ai] });
    t.on("post", "/themes/t2/summarize", "summarize", () => j({ text: "x", origin: "deterministic" }));
    await t.user.click(await within(await pane("Themes")).findByRole("button", { name: /^Checkout/ }));
    expect(await screen.findByText("Computed profile of Checkout.")).toBeInTheDocument();
    expect(screen.getByText("Rule-based summary")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText(/Hidden charges at checkout/)).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: /summarize again/i }));
    await waitFor(() => expect(t.last("summarize")).toBeTruthy());
    await t.user.click(await within(await pane("Themes")).findByRole("button", { name: /^Pricing/ }));
    expect(await screen.findByText("AI interpretation")).toBeInTheDocument();
    expect(screen.getByText("claude-x")).toBeInTheDocument();
  });

  it("renames, merges, creates and deletes themes via the API", async () => {
    const t = setup();
    t.on("patch", "/themes/t2", "rename", () => j(THEMES[1]));
    t.on("post", `/projects/${PID}/qualitative/themes/merge`, "merge", () => j(THEMES[0]));
    t.on("post", `/projects/${PID}/qualitative/themes`, "create", () => j(THEMES[0], 201));
    t.on("delete", "/themes/t3", "delete");
    // rename
    await t.user.click(await within(await pane("Themes")).findByRole("button", { name: /^Checkout/ }));
    await t.user.click(screen.getByRole("button", { name: /^rename$/i }));
    const name = screen.getByLabelText("Theme name");
    await t.user.clear(name); await t.user.type(name, "Payment friction");
    await t.user.click(screen.getByRole("button", { name: /save name/i }));
    await waitFor(() => expect(t.last("rename")?.body).toEqual({ name: "Payment friction" }));
    // merge
    await t.user.click(screen.getByLabelText(/select theme Delivery for merging/i));
    await t.user.click(screen.getByLabelText(/select theme Support for merging/i));
    await t.user.click(screen.getByRole("button", { name: /merge 2 selected themes/i }));
    await t.user.type(screen.getByLabelText(/merged theme name/i), "Ops");
    await t.user.click(screen.getByRole("button", { name: /^merge themes$/i }));
    await waitFor(() => expect(t.last("merge")?.body).toEqual({ theme_ids: ["t1", "t3"], name: "Ops" }));
    // manual theme
    await t.user.click(screen.getByRole("button", { name: /new theme/i }));
    await t.user.click(screen.getByRole("button", { name: /create theme/i }));
    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    await t.user.type(screen.getByLabelText("Theme name"), "Packaging");
    await t.user.type(screen.getByLabelText(/description/i), "Damaged boxes");
    await t.user.click(screen.getByRole("button", { name: /create theme/i }));
    await waitFor(() => expect(t.last("create")?.body).toEqual({ dataset_version_id: VID, column: "comment", name: "Packaging", description: "Damaged boxes" }));
    // delete
    const sup = await within(await pane("Themes")).findByRole("button", { name: /^Support/ });
    await t.user.click(sup);
    const card = sup.closest("li")!;
    await t.user.click(within(card).getByRole("button", { name: /^delete$/i }));
    expect(screen.getByText(/responses stay exactly as they are/i)).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: /delete theme/i }));
    await waitFor(() => expect(t.last("delete")).toBeTruthy());
  });

  it("filters responses by a theme and moves a response out of it", async () => {
    const t = setup();
    t.on("delete", "/themes/t2/segments/s1", "move-out");
    await t.user.click(await within(await pane("Themes")).findByRole("button", { name: /^Checkout/ }));
    await t.user.click(screen.getByRole("button", { name: /show responses/i }));
    await waitFor(() => expect(t.last("segments")?.query.theme_id).toBe("t2"));
    await t.user.click(screen.getByRole("button", { name: /Remove this response from Checkout/ }));
    await waitFor(() => expect(t.last("move-out")).toBeTruthy());
  });

  it("shows the no-themes empty state with a next action", async () => {
    setup({ themes: [] });
    expect(await screen.findByText("No themes yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /detect themes/i }).length).toBeGreaterThan(0);
  });
});

describe("codebook", () => {
  it("lists codes with accepted/suggested counts from the API", async () => {
    setup();
    const row = await within(await pane("Codes")).findByRole("button", { name: /^Delivery/ });
    expect(row).toHaveTextContent("150 accepted");
    expect(row).toHaveTextContent("124 suggested");
  });

  it("creates a code, explaining whole-word matching and wildcards", async () => {
    const t = setup();
    t.on("post", `/projects/${PID}/codes`, "create-code", () => j(CODES[0], 201));
    await t.user.click(await screen.findByRole("button", { name: /new code/i }));
    expect(screen.getByText(/matches deliver, delivery, delivered/)).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: /create code/i }));
    expect(await screen.findByText("Give the code a name.")).toBeInTheDocument();
    await t.user.type(screen.getByLabelText("Name"), "Packaging");
    await t.user.type(screen.getByLabelText("Keywords"), "box, damaged*{enter}crushed");
    await t.user.click(screen.getByRole("button", { name: /create code/i }));
    await waitFor(() => expect(t.last("create-code")?.body).toMatchObject({ name: "Packaging", keywords: ["box", "damaged*", "crushed"], color: "#0f766e" }));
  });

  it("edits and deletes with confirmation", async () => {
    const t = setup();
    t.on("patch", "/codes/c1", "edit-code", () => j(CODES[0]));
    t.on("delete", "/codes/c2", "delete-code");
    await t.user.click(await screen.findByRole("button", { name: "Edit code Delivery" }));
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Delivery");
    expect(screen.getByLabelText("Keywords")).toHaveValue("deliver*");
    await t.user.clear(name); await t.user.type(name, "Shipping");
    await t.user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(t.last("edit-code")?.body).toMatchObject({ name: "Shipping", keywords: ["deliver*"] }));
    await t.user.click(screen.getByRole("button", { name: "Delete code Pricing" }));
    await t.user.click(screen.getByRole("button", { name: /delete code$/i }));
    await waitFor(() => expect(t.last("delete-code")).toBeTruthy());
  });

  it("filters responses by clicking a code", async () => {
    const t = setup();
    await t.user.click(await within(await pane("Codes")).findByRole("button", { name: /^Pricing/ }));
    await waitFor(() => expect(t.last("segments")?.query.code_id).toBe("c2"));
  });

  it("shows the no-codes empty state", async () => {
    setup({ codes: [] });
    expect(await screen.findByText("No codes yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create the first code/i })).toBeInTheDocument();
  });

  it("sends suggestion options and never applies anything automatically", async () => {
    const t = setup();
    await t.user.click(await screen.findByRole("button", { name: /^suggest codes$/i }));
    expect(screen.getByText(/nothing is applied automatically/i)).toBeInTheDocument();
    await t.user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /suggest codes/i }));
    await waitFor(() => expect(t.last("suggest")?.body).toEqual({ dataset_version_id: VID, column: "comment", use_semantic: true, semantic_threshold: 0.55 }));
    // after the job the queue of suggestions is shown
    await waitFor(() => expect(t.last("segments")?.query.review).toBe("true"));
  });
});

describe("responses pane", () => {
  it("shows accepted codes solid and suggestions as visibly unaccepted, and reviews them", async () => {
    const t = setup();
    t.on("post", `/projects/${PID}/qualitative/annotations/review`, "review", () => j({ updated: 1 }));
    expect(await screen.findByText("Delivery took far too long.")).toBeInTheDocument();
    expect(screen.getByText("suggested")).toBeInTheDocument();
    expect(screen.getByText(/until accepted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove code Pricing" })).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: "Accept code Delivery" }));
    await waitFor(() => expect(t.last("review")?.body).toEqual({ annotation_ids: ["a1"], status: "accepted" }));
    await t.user.click(screen.getByRole("button", { name: "Reject code Delivery" }));
    await waitFor(() => expect(t.last("review")?.body).toEqual({ annotation_ids: ["a1"], status: "rejected" }));
  });

  it("accepts all visible suggestions after confirmation", async () => {
    const t = setup();
    t.on("post", `/projects/${PID}/qualitative/annotations/review`, "review", () => j({ updated: 1 }));
    await t.user.click(await screen.findByRole("button", { name: /accept all visible \(1\)/i }));
    await t.user.click(screen.getByRole("button", { name: /^accept all$/i }));
    await waitFor(() => expect(t.last("review")?.body).toEqual({ annotation_ids: ["a1"], status: "accepted" }));
  });

  it("adds and removes a code", async () => {
    const t = setup();
    t.on("post", "/segments/g2/annotations", "annotate", () => j(ann("a9", "c1", "accepted", "manual", null), 201));
    t.on("delete", "/segments/g1/annotations/c2", "unannotate");
    await screen.findByText("Great support team.");
    await t.user.click(screen.getAllByRole("button", { name: /add code to this response/i })[1]);
    await t.user.click(await screen.findByRole("menuitem", { name: /Delivery/ }));
    await waitFor(() => expect(t.last("annotate")?.body).toEqual({ code_id: "c1" }));
    await t.user.click(screen.getByRole("button", { name: "Remove code Pricing" }));
    await waitFor(() => expect(t.last("unannotate")).toBeTruthy());
  });

  it("places a response into a theme", async () => {
    const t = setup();
    t.on("post", "/themes/t3/segments", "to-theme");
    await screen.findByText("Great support team.");
    await t.user.click(screen.getAllByRole("button", { name: /move this response into a theme/i })[1]);
    await t.user.click(await screen.findByRole("menuitem", { name: "Support" }));
    await waitFor(() => expect(t.last("to-theme")?.body).toEqual({ segment_id: "g2" }));
  });

  it("translates filters into query parameters", async () => {
    const t = setup({ reviewTotal: 42 });
    await screen.findByText("Delivery took far too long.");
    expect(t.last("segments")?.query).toMatchObject({ dataset_version_id: VID, column: "comment", page: "1", page_size: "30" });
    expect(await screen.findByLabelText("42 responses need review")).toBeInTheDocument();
    await t.user.type(screen.getByLabelText("Search response text"), "late");
    await waitFor(() => expect(t.last("segments")?.query.q).toBe("late"));
    await t.user.click(screen.getByRole("checkbox", { name: /not in any theme/i }));
    await waitFor(() => expect(t.last("segments")?.query.unthemed).toBe("true"));
    await t.user.click(screen.getByRole("button", { name: /needs review/i }));
    await waitFor(() => expect(t.last("segments")?.query.review).toBe("true"));
    await t.user.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(t.last("segments")?.query.review).toBeUndefined());
  });

  it("shows a filtered empty state", async () => {
    const t = setup({ segments: [] });
    expect(await screen.findByText("No responses in this column")).toBeInTheDocument();
    await t.user.type(screen.getByLabelText("Search response text"), "zzz");
    expect(await screen.findByText("No responses match these filters")).toBeInTheDocument();
  });

  it("shows an error state with retry", async () => {
    signIn();
    const t = setup();
    server.use(http.get(`${API}/projects/${PID}/qualitative/segments`, () => apiError(500, "BOOM", "Segments exploded")));
    await t.user.click(await screen.findByRole("button", { name: /needs review/i }));
    expect(await screen.findByText("Segments exploded")).toBeInTheDocument();
  });
});

describe("search and keywords", () => {
  it("returns the most similar responses with similarity scores", async () => {
    const t = setup();
    server.use(http.get(`${API}/projects/${PID}/qualitative/search`, ({ request }) => {
      const u = new URL(request.url);
      t.calls.push({ method: "GET", path: "search", query: Object.fromEntries(u.searchParams) });
      return j({ query: u.searchParams.get("q"), embedding_model: "tfidf-lsa-v1", results: [{ segment_id: "x", row_index: 1, text: "To be fair, late delivery again.", similarity: 0.9944 }] });
    }));
    await t.user.click(await screen.findByRole("button", { name: /search & keywords/i }));
    await t.user.type(screen.getByLabelText(/describe what you are looking for/i), "late delivery");
    await t.user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("To be fair, late delivery again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Similarity 0.9944")).toHaveTextContent("0.9944");
    expect(t.last("search")?.query).toMatchObject({ q: "late delivery", column: "comment", dataset_version_id: VID });
  });

  it("lists frequent terms and counts keywords with wildcards", async () => {
    const t = setup();
    server.use(
      http.get(`${API}/projects/${PID}/qualitative/keywords`, () => j({ segments: 795, terms: [{ term: "delivery", responses: 109, occurrences: 109, pct: 13.71 }] })),
      http.get(`${API}/projects/${PID}/qualitative/keyword-count`, ({ request }) => { t.calls.push({ method: "GET", path: "kc", query: Object.fromEntries(new URL(request.url).searchParams) }); return j({ segments: 795, terms: [{ term: "deliver*", responses: 123, pct: 15.47 }] }); }),
    );
    await t.user.click(await screen.findByRole("button", { name: /search & keywords/i }));
    await t.user.click(screen.getByRole("tab", { name: /frequent terms/i }));
    expect(await screen.findByText("109")).toBeInTheDocument();
    expect(screen.getByText("13.7%")).toBeInTheDocument();
    await t.user.click(screen.getByRole("tab", { name: /keyword counter/i }));
    await t.user.type(screen.getByLabelText(/terms to count/i), "deliver*, refund");
    await t.user.click(screen.getByRole("button", { name: "Count" }));
    expect(await screen.findByText("123")).toBeInTheDocument();
    expect(t.last("kc")?.query.terms).toBe("deliver*,refund");
  });
});

describe("viewer role", () => {
  it("hides every write action but still allows reading and filtering", async () => {
    setup({ role: "VIEWER" });
    expect(await screen.findByText("Delivery took far too long.")).toBeInTheDocument();
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
    for (const n of [/new code/i, /new theme/i, /detect themes/i, /suggest codes/i, /accept all visible/i, /add code/i, /^accept code/i, /^reject code/i, /prepare text/i]) {
      expect(screen.queryByRole("button", { name: n })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/for merging/i)).not.toBeInTheDocument();
    expect(screen.getByText("suggested")).toBeInTheDocument();
    expect(screen.getByLabelText("Search response text")).toBeEnabled();
  });
});
