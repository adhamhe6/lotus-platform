import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { AssistantPage } from "./AssistantPage";

const proj = (role = "OWNER") => ({ id: "p1", name: "Customer Study", description: "", objective: "", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", role, counts: {} });
const col = (name: string, semantic_type: string) => ({ name, semantic_type, dtype: "x", position: 0, missing_count: 0, missing_pct: 0, unique_count: 3, profile: {} });
const NOW = new Date().toISOString();
const evidence = [
  { id: "E1", kind: "computed", label: "Correlations with satisfaction_score", text: "delivery_time: r = -0.514, Holm-adjusted p < 0.001, n = 571", source: { type: "analysis", analysis_run_id: "run1", title: "Correlation matrix", analysis_type: "correlation" } },
  { id: "E2", kind: "caveat", label: "Data note", text: "Correlations use pairwise-complete observations.", source: { type: "analysis", analysis_run_id: "run1" } },
  { id: "E3", kind: "qualitative", label: "Theme “Checkout”", text: "225 of 519 responses (43.4%) in column 'comment'.", source: { type: "theme", theme_id: "t1", column: "comment" } },
  { id: "E4", kind: "mixed", label: "Mixed finding", text: "Respondents mentioning delivery score lower.", source: { type: "mixed", mixed_run_id: "m1" } },
];
const interp = (over: object) => ({ type: "interpretation", origin: "rule", model: null, provider: "deterministic", summary: "Here is what the computed evidence shows.", points: [{ text: "Delivery time is the strongest correlate.", evidence: ["E1"] }], caveats: ["Correlation is not causation."], next_steps: ["Run a regression."], validation: { status: "skipped", problems: [] }, fallback_reason: null, ...over });
const msg = (id: string, role: string, content: string, extra: object = {}) => ({ id, role, content, blocks: [], evidence: [], meta: {}, created_at: NOW, ...extra });
const answer = (id: string, blocks: object[], meta: object = {}, ev = evidence) => msg(id, "assistant", "plain text of answer", { blocks, evidence: ev, meta: { prompt_version: "lotus-narrate-1.2", origin: "rule", model: null, ...meta } });

interface Setup { role?: string; conversations?: object[]; detail?: Record<string, object>; reply?: (content: string) => object[] | Response }
function setup(o: Setup = {}, route = "/projects/p1/assistant") {
  signIn();
  const created: unknown[] = [];
  const asked: { id: string; content: string }[] = [];
  let convs = [...(o.conversations ?? [])];
  const store: Record<string, object[]> = {};
  server.use(
    http.get(`${API}/projects/p1`, () => j(proj(o.role))),
    http.get(`${API}/projects/p1/datasets`, () => j([{ id: "d1", name: "Customer feedback", status: "READY", project_id: "p1" }])),
    http.get(`${API}/datasets/d1/versions`, () => j([{ id: "v1", dataset_id: "d1", version_number: 2, label: "cleaned", row_count: 600, column_count: 4 }])),
    http.get(`${API}/datasets/d1/profile`, () => j({ columns: [col("satisfaction_score", "numeric_continuous"), col("delivery_time", "numeric_continuous"), col("region", "categorical"), col("comment", "text")] })),
    http.get(`${API}/datasets/d1/suggestions`, () => j([{ title: "Analyze the correlation between delivery_time and satisfaction_score", analysis_type: "correlation", config: {}, reason: "", score: 0.5 }, { title: "Compare satisfaction_score across region", analysis_type: "group_comparison", config: {}, reason: "", score: 0.4 }])),
    http.get(`${API}/projects/p1/ai/conversations`, () => j(convs)),
    http.post(`${API}/projects/p1/ai/conversations`, async ({ request }) => {
      const b = await request.json(); created.push(b);
      const c = { id: "c-new", project_id: "p1", dataset_version_id: (b as { dataset_version_id?: string }).dataset_version_id ?? null, title: "New conversation", created_at: NOW };
      convs = [c, ...convs];
      return j(c, 201);
    }),
    http.get(`${API}/ai/conversations/:id`, ({ params }) => {
      const base = convs.find((c) => (c as { id: string }).id === params.id) ?? { id: params.id, project_id: "p1", dataset_version_id: "v1", title: "x", created_at: NOW };
      return j({ ...base, messages: o.detail?.[String(params.id)] ?? store[String(params.id)] ?? [] });
    }),
    http.post(`${API}/ai/conversations/:id/messages`, async ({ request, params }) => {
      const { content } = (await request.json()) as { content: string };
      asked.push({ id: String(params.id), content });
      const r = o.reply?.(content);
      if (r instanceof Response) return r;
      const out = [msg("u-" + asked.length, "user", content), ...(r ?? [answer("a-" + asked.length, [{ type: "computed", title: "Correlation matrix", evidence_ids: ["E1", "E2"], analysis_type: "correlation", analysis_run_id: "run1" }, interp({})])])];
      store[String(params.id)] = [...(store[String(params.id)] ?? []), ...out];
      return j(out, 201);
    }),
    http.delete(`${API}/ai/conversations/:id`, ({ params }) => { convs = convs.filter((c) => (c as { id: string }).id !== params.id); return new Response(null, { status: 204 }); }),
  );
  const r = renderApp(<AssistantPage />, { route, path: "/projects/:projectId/assistant", withProject: "p1" });
  return { ...r, created, asked, store };
}

describe("AssistantPage", () => {
  it("derives suggested questions from the dataset's real suggestions and columns, and shows the dataset context", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: /ask lotus about this dataset/i })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: /suggested questions/i });
    expect(within(list).getByText("Analyze the correlation between delivery_time and satisfaction_score")).toBeInTheDocument();
    expect(within(list).getByText("Compare satisfaction_score across region")).toBeInTheDocument();
    expect(within(list).getByText("Which factors appear most strongly associated with satisfaction_score?")).toBeInTheDocument();
    expect(within(list).getByText("What are the most common themes in the open-ended responses?")).toBeInTheDocument();
    for (const q of ["What are the main trends in this dataset?", "Summarize the key findings", "What should I investigate next?"]) expect(within(list).getByText(q)).toBeInTheDocument();
    const chip = screen.getByRole("link", { name: "Customer feedback" });
    expect(chip).toHaveAttribute("href", "/projects/p1/data/d1");
    expect(chip.parentElement).toHaveTextContent("v2");
  });

  it("clicking a suggestion creates a version-bound conversation, shows an optimistic bubble and honest progress, then the answer", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { created, asked, store } = setup();
    server.use(http.post(`${API}/ai/conversations/:id/messages`, async ({ request, params }) => {
      const { content } = (await request.json()) as { content: string };
      asked.push({ id: String(params.id), content });
      await gate;
      const out = [msg("u1", "user", content), answer("a1", [{ type: "computed", title: "Correlation matrix", evidence_ids: ["E1"], analysis_type: "correlation", analysis_run_id: "run1" }, interp({})])];
      store[String(params.id)] = out;
      return j(out, 201);
    }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Summarize the key findings" }));
    expect(await screen.findByText("Summarize the key findings")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/routing your question → computing the analysis → interpreting the evidence/i);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    release();
    expect(await screen.findByText("Delivery time is the strongest correlate.")).toBeInTheDocument();
    expect(created).toEqual([{ dataset_version_id: "v1" }]);
    expect(asked).toEqual([{ id: "c-new", content: "Summarize the key findings" }]);
    expect(screen.queryByText(/routing your question/i)).not.toBeInTheDocument();
    // computed block is labelled and links to the stored analysis
    expect(screen.getByRole("link", { name: /open analysis/i })).toHaveAttribute("href", "/projects/p1/analysis/run1");
    expect(screen.getAllByText("Computed").length).toBeGreaterThan(0);
    expect(screen.getByText("Rule-based summary")).toBeInTheDocument();
    expect(screen.getByText(/rule-based templates · prompt lotus-narrate-1\.2/i)).toBeInTheDocument();
  });

  it("renders every block type with provenance labels, AI model/validation, fallback reason and notices", async () => {
    const aiMsg = answer("a-ai", [
      { type: "computed", title: "Correlation matrix", evidence_ids: ["E1", "E2"], analysis_type: "correlation", analysis_run_id: "run1" },
      { type: "qualitative", title: "Themes in “comment”", evidence_ids: ["E3"] },
      { type: "mixed", title: "Mixed-methods evidence", evidence_ids: ["E4"], mixed_run_id: "m1" },
      interp({ origin: "llm", model: "claude-sonnet-x", provider: "anthropic", validation: { status: "passed", problems: [] } }),
    ], { origin: "llm", model: "claude-sonnet-x", prompt_version: "lotus-narrate-1.2" });
    const fallback = answer("a-fb", [interp({ fallback_reason: "The model’s numbers did not match the computed evidence, so rule-based text is shown." })]);
    const notice = msg("a-no", "assistant", "n", { blocks: [{ type: "notice", text: "I can only answer from this project's data, and I could not map that question to an analysis." }], meta: { origin: "none" } });
    setup({ conversations: [{ id: "c1", project_id: "p1", dataset_version_id: "v1", title: "Drivers", created_at: NOW }], detail: { c1: [msg("u1", "user", "q1"), aiMsg, msg("u2", "user", "q2"), fallback, msg("u3", "user", "weather on mars"), notice] } }, "/projects/p1/assistant?c=c1");
    const msgs = await screen.findAllByTestId("assistant-message");
    expect(msgs).toHaveLength(3);
    const [ai, fb, no] = msgs;
    // AI answer: all four provenance labels, model, validation, links
    expect(within(ai).getAllByText("Computed").length).toBeGreaterThanOrEqual(2);
    expect(within(ai).getAllByText("Qualitative").length).toBeGreaterThan(0);
    expect(within(ai).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(ai).getByText("Numbers validated")).toBeInTheDocument();
    expect(within(ai).getAllByText("claude-sonnet-x").length).toBeGreaterThan(0);
    expect(within(ai).getByText(/prompt lotus-narrate-1\.2/)).toBeInTheDocument();
    expect(within(ai).getByRole("link", { name: /open mixed methods/i })).toHaveAttribute("href", "/projects/p1/mixed");
    expect(within(ai).getByRole("link", { name: /explore themes/i })).toHaveAttribute("href", "/projects/p1/qualitative");
    expect(within(ai).getByText("Correlation is not causation.")).toBeInTheDocument();
    expect(within(ai).getByText("Run a regression.")).toBeInTheDocument();
    expect(within(ai).getByText("Correlations with satisfaction_score")).toBeInTheDocument();
    // rule + fallback explanation
    expect(within(fb).getByText("Rule-based summary")).toBeInTheDocument();
    expect(within(fb).getByText(/numbers did not match the computed evidence/i)).toBeInTheDocument();
    // notice is an informative callout, not an error
    expect(within(no).getByText(/can’t answer that from the data/i)).toBeInTheDocument();
    expect(within(no).getByText(/could not map that question/i)).toBeInTheDocument();
    expect(within(no).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the evidence drawer from the button and from an evidence id, with source links", async () => {
    const m = answer("a1", [{ type: "computed", title: "Correlation matrix", evidence_ids: ["E1"], analysis_type: "correlation", analysis_run_id: "run1" }, interp({})]);
    setup({ conversations: [{ id: "c1", project_id: "p1", dataset_version_id: "v1", title: "Drivers", created_at: NOW }], detail: { c1: [msg("u1", "user", "q"), m] } }, "/projects/p1/assistant?c=c1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /evidence \(4\)/i }));
    const dlg = await screen.findByRole("dialog", { name: /evidence/i });
    for (const id of ["E1", "E2", "E3", "E4"]) expect(within(dlg).getByText(id)).toBeInTheDocument();
    expect(within(dlg).getByText("Note")).toBeInTheDocument();
    expect(within(dlg).getByRole("link", { name: /open mixed-methods run/i })).toHaveAttribute("href", "/projects/p1/mixed");
    expect(within(dlg).getByRole("link", { name: /view theme/i })).toHaveAttribute("href", "/projects/p1/qualitative");
    expect(within(dlg).getAllByRole("link", { name: /open analysis/i })[0]).toHaveAttribute("href", "/projects/p1/analysis/run1");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // clickable evidence id inside the interpretation points
    await user.click(screen.getAllByRole("button", { name: "Show evidence E1" }).at(-1)!);
    const dlg2 = await screen.findByRole("dialog", { name: /evidence/i });
    expect(within(dlg2).getByText("E1").closest("li")).toHaveAttribute("aria-current", "true");
  });

  it("handles 429 RATE_LIMITED with a friendly message and lets the user retry", async () => {
    let n = 0;
    const { asked } = setup({ reply: () => (n++ === 0 ? apiError(429, "RATE_LIMITED", "Too many AI requests.") : [answer("a1", [interp({ summary: "Recovered answer." })])]) });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Your question"), "Summarize the key findings{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/slow down/i);
    expect(screen.getByText("Summarize the key findings")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Recovered answer.")).toBeInTheDocument();
    expect(asked.map((a) => a.content)).toEqual(["Summarize the key findings", "Summarize the key findings"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains NO_DATASET and generic failures", async () => {
    let first = true;
    setup({ reply: () => { if (first) { first = false; return apiError(404, "NO_DATASET", "Upload a dataset before asking questions about it."); } return apiError(500, "INTERNAL", "Something broke on our side."); } });
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Your question");
    await user.type(box, "first question{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/no dataset to ask about/i);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something broke on our side."));
  });

  it("auto-sends the ?q= question in a new conversation and clears the parameter", async () => {
    const { created, asked } = setup({}, "/projects/p1/assistant?q=What%20drives%20retention%3F");
    expect(await screen.findByText("Delivery time is the strongest correlate.")).toBeInTheDocument();
    expect(created).toHaveLength(1);
    expect(asked).toEqual([{ id: "c-new", content: "What drives retention?" }]);
    expect(screen.getByText("What drives retention?")).toBeInTheDocument();
  });

  it("is read-only for viewers: no composer, suggestions disabled, explanation shown", async () => {
    const { asked } = setup({ role: "VIEWER" }, "/projects/p1/assistant?q=hello%20there");
    expect(await screen.findByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Summarize the key findings" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^new$/i })).not.toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it("lists conversations and deletes one after confirmation", async () => {
    setup({ conversations: [{ id: "c1", project_id: "p1", dataset_version_id: "v1", title: "Drivers of satisfaction", created_at: NOW }, { id: "c2", project_id: "p1", dataset_version_id: "v1", title: "Themes overview", created_at: NOW }] });
    const user = userEvent.setup();
    const rail = await screen.findByRole("complementary", { name: "Conversations" });
    expect(await within(rail).findByText("Drivers of satisfaction")).toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: "Delete conversation Drivers of satisfaction" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(rail).queryByText("Drivers of satisfaction")).not.toBeInTheDocument());
    expect(within(rail).getByText("Themes overview")).toBeInTheDocument();
  });

  it("shows an empty state when the project has no dataset", async () => {
    signIn();
    server.use(
      http.get(`${API}/projects/p1`, () => j(proj())),
      http.get(`${API}/projects/p1/datasets`, () => j([])),
      http.get(`${API}/projects/p1/ai/conversations`, () => j([])),
    );
    renderApp(<AssistantPage />, { route: "/projects/p1/assistant", path: "/projects/:projectId/assistant", withProject: "p1" });
    expect(await screen.findByText(/upload a dataset to start asking/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to data/i })).toHaveAttribute("href", "/projects/p1/data");
  });
});
