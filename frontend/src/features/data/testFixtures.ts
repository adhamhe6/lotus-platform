/** Shared MSW fixtures for the data and visualization feature tests. Not imported by application code. */
import { http } from "msw";
import type { Dataset, DatasetVersion, Job, Profile, Project } from "@/api/types";
import { server } from "@/test/server";
import { API, j } from "@/test/utils";

export const PID = "p1";
export const DID = "d1";
const NOW = "2026-05-01T10:00:00Z";

export const project = (role: Project["role"] = "OWNER"): Project =>
  ({ id: PID, name: "Customer Study", description: "", objective: "", owner_id: "u1", created_at: NOW, updated_at: NOW, role, counts: { datasets: 1 } }) as Project;

const issues = [
  { severity: "warning", code: "DUPLICATE_ROWS", column: null, message: "8 fully duplicated row(s) (1.3%)." },
  { severity: "warning", code: "HIGH_MISSING", column: "comment", message: "'comment' is 27.0% missing." },
  { severity: "info", code: "SOME_MISSING", column: "age", message: "'age' has 12 missing value(s)." },
  { severity: "info", code: "OUTLIERS", column: "age", message: "'age' has 8 IQR outlier(s) (1.4%)." },
];
const quality = (rows: number, dup: number, missing: number) => ({
  rows, columns: 5, missing_cells: missing, missing_pct: 1.9, complete_rows: rows - 20, duplicate_rows: dup, type_counts: { numeric_continuous: 2, categorical: 1, datetime: 1, text: 1 },
  issues: dup ? issues : issues.slice(1),
});

export const V1: DatasetVersion = {
  id: "v1", dataset_id: DID, version_number: 1, parent_version_id: null, kind: "original", label: "", transformation: null, row_count: 608, column_count: 5,
  content_hash: "aaaaaaaaaaaa1111", ingest_warnings: [{ code: "DUPLICATE_COLUMN", message: "Duplicate column name 'region' was renamed to 'region_2'.", column: "region_2" }, { code: "ENCODING_FALLBACK", message: "The file is not valid UTF-8; it was decoded as Windows-1252." }],
  quality: quality(608, 8, 160), created_by: "u1", created_at: NOW,
};
export const V2: DatasetVersion = {
  id: "v2", dataset_id: DID, version_number: 2, parent_version_id: "v1", kind: "transformed", label: "Duplicates removed", row_count: 600, column_count: 5, content_hash: "bbbbbbbbbbbb2222",
  transformation: { operations: [{ op: "drop_duplicates" }], log: [{ op: "drop_duplicates", note: "removed 8 duplicate row(s)", params: {}, rows_before: 608, rows_after: 600, cells_or_rows_affected: 8 }] },
  ingest_warnings: [], quality: quality(600, 0, 147), created_by: "u1", created_at: "2026-05-02T10:00:00Z",
};

export const dataset = (over: Partial<Dataset> = {}): Dataset => ({
  id: DID, project_id: PID, name: "Customer feedback", description: "600 customers.", original_filename: "customer_feedback.csv", file_type: "csv", status: "READY", error: null,
  raw_size: 91594, created_at: NOW, latest_version: V2, version_count: 2, ...over,
});

export const profileFor = (versionId = "v2"): Profile => ({
  version: versionId === "v1" ? V1 : V2,
  columns: [
    { position: 0, name: "age", dtype: "float64", semantic_type: "numeric_continuous", missing_count: 12, missing_pct: 2, unique_count: 50,
      profile: { count: 588, mean: 41.2, median: 40, min: 18, max: 80, std: 12.5, q1: 32, q3: 50, skewness: 0.3, outlier_count: 8, outlier_bounds: [5, 77], histogram: { edges: [18, 30, 42, 54, 66, 80], counts: [100, 200, 150, 90, 48] } } },
    { position: 1, name: "region", dtype: "object", semantic_type: "categorical", missing_count: 0, missing_pct: 0, unique_count: 3,
      profile: { count: 600, category_count: 3, mode: "West", top_values: [{ value: "West", count: 300, pct: 50 }, { value: "East", count: 200, pct: 33.3 }, { value: "North", count: 100, pct: 16.7 }] } },
    { position: 2, name: "satisfaction", dtype: "float64", semantic_type: "numeric_continuous", missing_count: 0, missing_pct: 0, unique_count: 90,
      profile: { count: 600, mean: 70.5, median: 71, min: 10, max: 100, std: 15, q1: 60, q3: 82, skewness: -0.4, outlier_count: 3, outlier_bounds: [27, 115], histogram: { edges: [10, 40, 70, 100], counts: [20, 300, 280] } } },
    { position: 3, name: "survey_date", dtype: "datetime64[ns]", semantic_type: "datetime", missing_count: 0, missing_pct: 0, unique_count: 200,
      profile: { count: 600, min: "2025-01-01T00:00:00", max: "2025-12-31T00:00:00", span_days: 364, distinct_months: 12, distinct_days: 200 } },
    { position: 4, name: "comment", dtype: "object", semantic_type: "text", missing_count: 81, missing_pct: 13.5, unique_count: 500,
      profile: { count: 519, avg_chars: 90.2, avg_words: 16.1, max_chars: 240, empty_count: 0 } },
  ],
});

export const SUGGESTIONS = [
  { title: "Analyze the correlation between age and satisfaction", analysis_type: "correlation", config: { variables: ["age", "satisfaction"], method: "pearson" }, reason: "Preliminary scan: |r| ≈ 0.51 between these variables on the data as loaded.", score: 0.5 },
  { title: "Find recurring themes in 'comment'", analysis_type: "qualitative_themes", config: { column: "comment" }, reason: "'comment' contains free text.", score: 0.3 },
];

export const CHART_SUGGESTIONS = [
  { kind: "histogram", x: "age", reason: "See the distribution of age." },
  { kind: "box", x: "region", y: "age", reason: "Compare the spread of age across region." },
];

export const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", project_id: PID, type: "ingest_dataset", status: "RUNNING", stage: "Parsing rows and columns", progress: 0.4, total_stages: 5, completed_stages: 2,
  params: {}, result_ref: null, error: null, attempts: 1, created_at: NOW, started_at: NOW, completed_at: null, ...over,
}) as Job;

export const previewRows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ age: i === 1 ? null : 20 + offset + i, region: i % 2 ? "East" : "West", satisfaction: 60.5 + i, survey_date: "2025-06-12T00:00:00", comment: i === 0 ? "A very long free-text comment that should be truncated in the table cell but remain available on hover." : null }));

export interface Calls { preview: URL[]; post: { url: string; body: Record<string, unknown> }[] }

/** Registers handlers for every endpoint these pages call. Individual tests override with `server.use(...)` afterwards. */
export function installMocks(o: { role?: Project["role"]; datasets?: Dataset[]; versions?: DatasetVersion[]; total?: number } = {}): Calls {
  const calls: Calls = { preview: [], post: [] };
  const datasets = o.datasets ?? [dataset()];
  const versions = o.versions ?? [V1, V2];
  server.use(
    http.get(`${API}/projects/${PID}`, () => j(project(o.role))),
    http.get(`${API}/projects/${PID}/datasets`, () => j(datasets)),
    http.get(`${API}/datasets/:id`, ({ params }) => { const d = datasets.find((x) => x.id === params.id); return d ? j(d) : j({ error: { code: "NOT_FOUND", message: "Dataset not found." } }, 404); }),
    http.get(`${API}/datasets/:id/versions`, () => j(versions)),
    http.get(`${API}/datasets/:id/profile`, ({ request }) => j(profileFor(new URL(request.url).searchParams.get("version_id") ?? "v2"))),
    http.get(`${API}/datasets/:id/suggestions`, () => j(SUGGESTIONS)),
    http.get(`${API}/datasets/:id/chart-suggestions`, () => j(CHART_SUGGESTIONS)),
    http.get(`${API}/datasets/:id/preview`, ({ request }) => {
      const url = new URL(request.url);
      calls.preview.push(url);
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("page_size") ?? 50);
      const total = o.total ?? 120;
      const n = Math.max(0, Math.min(size, total - (page - 1) * size));
      const cols = (url.searchParams.get("columns")?.split(",") ?? profileFor().columns.map((c) => c.name));
      const all = profileFor().columns;
      return j({ version_id: "v2", columns: all.filter((c) => cols.includes(c.name)).map((c) => ({ name: c.name, semantic_type: c.semantic_type })), rows: previewRows(n, (page - 1) * size), total, page, page_size: size, row_offset: (page - 1) * size });
    }),
  );
  return calls;
}
