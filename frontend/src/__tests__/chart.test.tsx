import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/api/types";
import { ChartView } from "@/components/charts/ChartView";

const box: ChartSpec = {
  kind: "box", title: "Satisfaction by region", x_label: "region", y_label: "satisfaction", notes: [], description: "Box plot of satisfaction for 2 groups of region.",
  data: { groups: [
    { name: "West", n: 148, q1: 62, median: 71, q3: 80, mean: 70.4, whisker_low: 40, whisker_high: 98, outliers: [12], n_outliers: 1 },
    { name: "North", n: 130, q1: 70, median: 78, q3: 85, mean: 77.2, whisker_low: 50, whisker_high: 100, outliers: [], n_outliers: 0 },
  ] },
};

describe("ChartView", () => {
  it("exposes a text alternative and a data table for every chart", async () => {
    render(<ChartView spec={box} />);
    expect(screen.getByRole("img", { name: /box plot of satisfaction/i })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /data/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();                  // median as computed by the API
  });

  it("renders heatmap cells with the computed values", () => {
    const heat: ChartSpec = { kind: "heatmap", title: "Correlations", description: "Heatmap", notes: [], data: { rows: ["a", "b"], cols: ["a", "b"], values: [[1, -0.52], [-0.52, 1]], domain: [-1, 1], diverging: true, value_label: "Pearson r" } };
    render(<ChartView spec={heat} />);
    expect(screen.getAllByText("-0.52").length).toBe(2);
  });
});
