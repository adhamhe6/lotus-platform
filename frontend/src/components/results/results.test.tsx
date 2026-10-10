import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Assumption, Interpretation, Metric, ResultTable as ResultTableData } from "@/api/types";
import { renderApp } from "@/test/utils";
import { AssumptionList, InterpretationCard, MetricGrid, ResultTable } from ".";
import { fmtDuration, fmtMetric, isPValueMetric, pLabel } from "./format";

const metrics: Metric[] = [
  { key: "r", label: "Pearson r", value: -0.514094, ci: [-0.5714, -0.4496], note: "strong negative", primary: true },
  { key: "p_value", label: "p-value", value: 1.6e-38 },
  { key: "n", label: "Observations (n)", value: 571 },
  { key: "mode_pct", label: "Share of most frequent", value: 42.5, unit: "%" },
  { key: "df", label: "df (between, within)", value: "2, 326.1" },
  { key: "significant", label: "Significant at α = 0.05", value: true },
  { key: "missing", label: "Missing", value: null },
];

describe("MetricGrid", () => {
  it("emphasises the primary metric with its interval and formats p-values, units, strings and booleans", () => {
    renderApp(<MetricGrid metrics={metrics} />);
    const primary = screen.getByTestId("primary-metric");
    expect(primary).toHaveTextContent("Pearson r");
    expect(primary).toHaveTextContent("-0.514");
    expect(primary).toHaveTextContent("Confidence interval [-0.571, -0.45]");
    expect(primary).toHaveTextContent("strong negative");
    expect(screen.getByText("p-value").nextSibling).toHaveTextContent("< 0.001");
    expect(screen.getByText("Observations (n)").nextSibling).toHaveTextContent("571");
    expect(screen.getByText("Share of most frequent").nextSibling).toHaveTextContent("42.5%");
    expect(screen.getByText("df (between, within)").nextSibling).toHaveTextContent("2, 326.1");
    expect(screen.getByText("Significant at α = 0.05").nextSibling).toHaveTextContent("yes");
    expect(screen.getByText("Missing").nextSibling).toHaveTextContent("—");
    expect(screen.getByText("Computed")).toBeInTheDocument();
  });

  it("renders nothing for an empty list", () => {
    const { container } = renderApp(<MetricGrid metrics={[]} />);
    expect(container.querySelector("dl")).toBeNull();
  });
});

describe("format helpers", () => {
  it("recognises p-value metrics and formats them", () => {
    expect(isPValueMetric({ key: "p_value", label: "x" })).toBe(true);
    expect(isPValueMetric({ key: "adj_p", label: "x" })).toBe(true);
    expect(isPValueMetric({ key: "stat", label: "p-value (Holm)" })).toBe(true);
    expect(isPValueMetric({ key: "n", label: "Sample" })).toBe(false);
    expect(fmtMetric({ key: "p_value", label: "p", value: 0.0421 })).toBe("0.042");
    expect(pLabel(0.191)).toBe("p = 0.191");
    expect(pLabel(0.0002)).toBe("p < 0.001");
    expect(pLabel(null)).toBe("—");
    expect(fmtDuration(14)).toBe("14 ms");
    expect(fmtDuration(2350)).toBe("2.4 s");
    expect(fmtDuration(null)).toBe("—");
  });
});

const table: ResultTableData = {
  name: "pairs", title: "Pairwise comparisons", note: "Holm-adjusted for multiple tests.",
  columns: [{ key: "pair", label: "Pair", kind: "text" }, { key: "n", label: "n", kind: "integer" }, { key: "mean", label: "Mean", kind: "number" }, { key: "share", label: "Share", kind: "percent" }, { key: "p", label: "p (adj.)", kind: "p_value" }],
  rows: [{ pair: "Web vs Store", n: 1234, mean: 74.5585, share: 12.345, p: 0.239 }, { pair: "Web vs Mobile", n: 5, mean: null, share: null, p: 0.00001 }],
};

describe("ResultTable", () => {
  it("formats cells by column kind, keeps the note and is labelled", () => {
    renderApp(<ResultTable table={table} />);
    const t = screen.getByRole("table", { name: "Pairwise comparisons" });
    const row1 = within(t).getByRole("rowheader", { name: "Web vs Store" }).closest("tr")!;
    expect(within(row1).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1,234", "74.56", "12.3%", "0.239"]);
    const row2 = within(t).getByRole("rowheader", { name: "Web vs Mobile" }).closest("tr")!;
    expect(within(row2).getAllByRole("cell").map((c) => c.textContent)).toEqual(["5", "—", "—", "< 0.001"]);
    expect(screen.getByText("Holm-adjusted for multiple tests.")).toBeInTheDocument();
  });

  it("says so when a table has no rows", () => {
    renderApp(<ResultTable table={{ ...table, rows: [], note: null }} />);
    expect(screen.getByText("This table has no rows.")).toBeInTheDocument();
  });
});

describe("AssumptionList", () => {
  it("shows each status with an icon and a word, plus test statistics", () => {
    const items: Assumption[] = [
      { name: "Normality", status: "met", detail: "No evidence against normality.", test: "Shapiro–Wilk", statistic: 0.993, p_value: 0.339 },
      { name: "Equal variance", status: "violated", detail: "Variances differ.", p_value: 0.0004 },
      { name: "Independence", status: "unknown", detail: "Cannot be verified." },
      { name: "Linearity", status: "not_applicable", detail: "Not relevant." },
    ];
    renderApp(<AssumptionList assumptions={items} />);
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("data-status"))).toEqual(["met", "violated", "unknown", "not_applicable"]);
    for (const w of ["Met", "Violated", "Can’t be verified", "Not applicable"]) expect(screen.getByText(w)).toBeInTheDocument();
    expect(screen.getByText("Shapiro–Wilk · statistic 0.993 · p = 0.339")).toBeInTheDocument();
    expect(screen.getByText("p < 0.001")).toBeInTheDocument();
  });

  it("handles analyses without assumptions", () => {
    renderApp(<AssumptionList assumptions={[]} />);
    expect(screen.getByText(/does not rely on testable assumptions/i)).toBeInTheDocument();
  });
});

const interp: Interpretation = {
  summary: "Satisfaction falls as delivery time rises.",
  points: [{ text: "r = -0.51 on 571 customers.", evidence: ["E1", "E9"] }],
  caveats: ["Association is not causation."], next_steps: ["Compare regions."],
  meta: { origin: "llm", provider: "anthropic", model: "claude-x", prompt_version: "p-1", validation: { status: "passed_with_edits", problems: [] }, fallback_reason: null, generated_at: "2026-10-10T10:00:00Z" },
  evidence: [{ id: "E1", kind: "computed", label: "Correlation", text: "r = -0.514 (n = 571)", source: { analysis_run_id: "a1" } }, { id: "E2", kind: "computed", label: "Other", text: "unused", source: {} }],
};

describe("InterpretationCard", () => {
  it("labels AI text, links evidence, and opens a drawer on the clicked id (unknown ids are inert)", async () => {
    const user = userEvent.setup();
    renderApp(<InterpretationCard interpretation={interp} projectId="p1" />);
    const card = screen.getByRole("region", { name: "Interpretation" });
    expect(within(card).getByText("AI interpretation")).toBeInTheDocument();
    expect(within(card).getByText("claude-x")).toBeInTheDocument();
    expect(within(card).getByText("Validated with edits")).toBeInTheDocument();
    expect(within(card).getByText("Association is not causation.")).toBeInTheDocument();
    expect(within(card).getByText("Compare regions.")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Show evidence E9" })).not.toBeInTheDocument();
    expect(within(card).getByText("E9")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Show evidence E1" }));
    const drawer = await screen.findByRole("dialog", { name: "Evidence" });
    expect(within(drawer).getByText("r = -0.514 (n = 571)")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: /open source analysis/i })).toHaveAttribute("href", "/projects/p1/analysis/a1");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rule-based text names no model and explains a fallback", () => {
    renderApp(<InterpretationCard interpretation={{ ...interp, meta: { ...interp.meta, origin: "rule", provider: "deterministic", model: null, validation: { status: "skipped", problems: [] }, fallback_reason: "The AI provider could not be reached; showing the rule-based summary." } }} />);
    expect(screen.getByText("Rule-based summary")).toBeInTheDocument();
    expect(screen.queryByText("AI interpretation")).not.toBeInTheDocument();
    expect(screen.queryByText("claude-x")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/could not be reached/i);
    expect(screen.getByText("Template text")).toBeInTheDocument();
  });
});
