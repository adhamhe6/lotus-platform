import type { Column, Suggestion } from "@/api/types";

const NUMERIC = new Set(["numeric_continuous", "numeric_discrete"]);

/** Starter questions: the dataset's own suggested analyses first, then the canonical prompts adapted to its real columns. */
export function buildSuggestions(suggestions: Suggestion[], columns: Column[]): string[] {
  const numeric = columns.filter((c) => NUMERIC.has(c.semantic_type));
  const mentions = (name: string) => suggestions.filter((s) => s.title.includes(name)).length;
  const target = [...numeric].sort((a, b) => mentions(b.name) - mentions(a.name))[0];
  const hasText = columns.some((c) => c.semantic_type === "text");
  const out = [
    ...suggestions.slice(0, 3).map((s) => s.title),
    "What are the main trends in this dataset?",
    ...(target ? [`Which factors appear most strongly associated with ${target.name}?`] : []),
    ...(hasText ? ["What are the most common themes in the open-ended responses?"] : []),
    "Summarize the key findings",
    "What should I investigate next?",
  ];
  return [...new Set(out)];
}
