# Frontend guide

React 19 · TypeScript (strict) · Vite · Tailwind CSS 4 (tokens in `src/index.css`) · Radix primitives (`src/components/ui`) · TanStack Query · React Hook Form + Zod · Recharts + custom SVG (`src/components/charts`) · Vitest + Testing Library + MSW.

## Layout

```
src/
  api/          client.ts (fetch, auth refresh, ApiError) · types.ts (aliases over generated schema.d.ts) · hooks.ts (shared queries + query keys `qk`)
  components/
    ui/         design-system primitives (Button, Card, Dialog/Sheet, Select, Tabs, Table, Alert, Badge, …)
    common/     PageHeader, EmptyState, ErrorState, StatTile, Section, Skeletons, Provenance, JobProgress
    charts/     ChartView (renders a server-computed ChartSpec), palette, scales
    layout/     ProjectLayout, Sidebar, Topbar, CommandPalette
    brand/      Logo / LotusMark
  features/<area>/   one folder per product area (pages + feature components + feature hooks + tests next to them)
  lib/          auth, theme, jobs (tracker), activeDataset (current dataset/version), format helpers
  test/         MSW server + render helpers
```

Regenerate API types after backend changes: `python -m app.scripts.export_openapi && npm run gen:api`.

## Rules every feature follows

1. **Never compute or invent analytical values in the UI.** Numbers, charts, counts, p-values come from the API. Format them with `lib/format.ts`; do not round-trip them through arithmetic.
2. **Provenance is always visible.** Use `<Provenance kind="computed|qualitative|ai|rule" />` next to content. AI/rule-based interpretation text must carry its badge (`interpretationKind(meta.origin)`), model name when `origin === "llm"`, and — when `meta.fallback_reason` is set — say why the rule-based text was shown.
3. **Long-running work = jobs.** Endpoints returning a `Job` (HTTP 202) are tracked with `useJobs().track(job, { title, invalidate: [...queryKeys], onSuccess })`; show real progress with `<JobProgress jobId />` / `<JobProgressView job />`. Inline backends return already-terminal jobs — `track` handles that.
4. **Every async surface has a loading skeleton, an empty state with a next action, and an error state** (`ErrorState` with retry). API errors are `ApiError` (`code`, `message`, `details`); show `errorMessage(e)`. 422 `INVALID_ANALYSIS_CONFIGURATION` messages are user-ready.
5. **Active dataset context**: `useActiveDataset()` gives `{ dataset, version, versions, columns }` for the project (selected in the top bar). Deep links may override via search params.
6. **Accessibility**: semantic landmarks/headings, labelled controls (`Field`), visible focus, keyboard operable (Radix), `aria-live` for status, charts get text alternatives automatically; don’t convey meaning by colour alone.
7. **Responsive**: usable at 360 px (stack columns, horizontal-scroll tables), comfortable at 1280 px; dense data views may prefer desktop.
8. **Style**: Tailwind utilities with the semantic tokens (`bg-card`, `text-muted-foreground`, `border`, `text-primary`, …). Headings use the display serif automatically (`font-display`). The only decorative shape is `.petal` (use sparingly on hero cards). Avoid generic admin-dashboard card grids: lead with the analysis.
9. **Tests**: colocate `*.test.tsx` (or `src/__tests__`). Use MSW (`server.use(http.get(`${API}/…`))`), `renderApp`, `signIn()` from `src/test/utils.tsx`. Test behaviour users see: loading → data, empty state, error state + retry, validation, success path, permission/failed-job paths.
10. Query keys come from `qk` in `api/hooks.ts` (add new ones there only if needed — prefer feature-local keys prefixed with the project id so `invalidate` on `["project", pid]` works).
