import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { DataPage } from "./DataPage";
import { dataset, installMocks, job, PID, V1 } from "./testFixtures";

const route = `/projects/${PID}/data`;
const mount = (r = route) => renderApp(<DataPage />, { route: r, path: "/projects/:projectId/data", withProject: PID });
const csv = (name = "survey.csv", body = "a,b\n1,2\n") => new File([body], name, { type: "text/csv" });

describe("DataPage", () => {
  it("lists datasets with rows × columns, missing %, versions, warnings and status", async () => {
    signIn(); installMocks();
    mount();
    const row = (await screen.findByRole("link", { name: "Customer feedback" })).closest("tr")!;
    expect(row).toHaveTextContent("customer_feedback.csv");
    expect(within(row).getByText("600 × 5")).toBeInTheDocument();
    expect(within(row).getByText("1.9%")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();            // versions
    expect(within(row).getByText("Ready")).toBeInTheDocument();
    expect(within(row).getByText("1 warning")).toBeInTheDocument();      // HIGH_MISSING on comment
    expect(screen.getByRole("link", { name: "Customer feedback" })).toHaveAttribute("href", `/projects/${PID}/data/d1`);
  });

  it("shows the friendly empty state with an upload action", async () => {
    signIn(); installMocks({ datasets: [] });
    mount();
    expect(await screen.findByText("No datasets yet")).toBeInTheDocument();
    expect(screen.getByText("Upload your first dataset to begin analysis.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /upload dataset/i }).length).toBeGreaterThan(0);
  });

  it("shows an error state and retries", async () => {
    signIn(); installMocks();
    let fail = true;
    server.use(http.get(`${API}/projects/${PID}/datasets`, () => (fail ? apiError(500, "INTERNAL", "Database is down.") : j([dataset()]))));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Database is down.");
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("link", { name: "Customer feedback" })).toBeInTheDocument();
  });

  it("surfaces ingest warnings recorded for the latest version", async () => {
    signIn(); installMocks({ datasets: [dataset({ latest_version: { ...V1, id: "v2", version_number: 2 } })] });
    mount();
    expect(await screen.findByText(/Duplicate column name 'region' was renamed to 'region_2'/)).toBeInTheDocument();
    expect(screen.getByText(/decoded as Windows-1252/)).toBeInTheDocument();
    expect(screen.getByText(/Import notes \(2\)/)).toBeInTheDocument();
  });

  it("shows processing and failed datasets, with the stored error and a delete action", async () => {
    signIn();
    installMocks({ datasets: [
      dataset({ id: "d2", name: "Still reading", status: "PROCESSING", latest_version: null, version_count: 0 }),
      dataset({ id: "d3", name: "Broken upload", status: "FAILED", latest_version: null, version_count: 0, error: { code: "INVALID_ENCODING", message: "The file encoding could not be determined." } }),
    ] });
    let deleted = "";
    server.use(http.delete(`${API}/datasets/d3`, () => { deleted = "d3"; return new Response(null, { status: 204 }); }));
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText("Processing", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/inferring column types/i)).toBeInTheDocument();
    expect(screen.getByText("The file encoding could not be determined.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Broken upload" })).not.toBeInTheDocument();     // not openable
    await user.click(screen.getByRole("button", { name: "Delete Broken upload" }));
    await user.click(await screen.findByRole("button", { name: "Delete dataset" }));
    await waitFor(() => expect(deleted).toBe("d3"));
  });

  it("confirms before deleting a dataset", async () => {
    signIn(); installMocks();
    let deleted = false;
    server.use(http.delete(`${API}/datasets/d1`, () => { deleted = true; return new Response(null, { status: 204 }); }));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Delete Customer feedback" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(deleted).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Delete dataset" }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("hides upload and delete controls from viewers", async () => {
    signIn(); installMocks({ role: "VIEWER" });
    mount(`${route}?upload=1`);
    await screen.findByRole("link", { name: "Customer feedback" });
    expect(screen.queryByRole("button", { name: /upload dataset/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("upload", () => {
  it("opens from ?upload=1", async () => {
    signIn(); installMocks();
    mount(`${route}?upload=1`);
    expect(await screen.findByRole("dialog", { name: /upload a dataset/i })).toBeInTheDocument();
  });

  it("uploads a file as multipart, tracks the job and shows real stage progress", async () => {
    signIn(); installMocks();
    let seen: { contentType: string | null; name?: string; content?: string; description?: string } | null = null;
    server.use(
      http.post(`${API}/projects/${PID}/datasets`, async ({ request }) => {
        const fd = await request.formData();
        const f = fd.get("file");
        seen = { contentType: request.headers.get("content-type"), name: String(fd.get("name")), description: String(fd.get("description")), content: await (f as Blob).text() };
        return j({ dataset: dataset({ id: "d9", name: String(fd.get("name")), status: "PROCESSING", latest_version: null, version_count: 0 }), job: job() }, 202);
      }),
      http.get(`${API}/jobs/j1`, () => j(job())),
    );
    const user = userEvent.setup();
    mount(`${route}?upload=1`);
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Dataset file"), csv("Q3 survey.csv"));
    expect(within(dialog).getByText("Q3 survey.csv")).toBeInTheDocument();             // file name + size shown
    expect(within(dialog).getByLabelText("Dataset name")).toHaveValue("Q3 survey");     // default from file name
    await user.type(within(dialog).getByLabelText(/description/i), "Quarterly pulse");
    await user.click(within(dialog).getByRole("button", { name: "Upload dataset" }));

    expect(await within(dialog).findByText("Parsing rows and columns")).toBeInTheDocument();
    expect(within(dialog).getByText("2/5")).toBeInTheDocument();                         // real completed / total stages
    expect(seen).toMatchObject({ name: "Q3 survey", description: "Quarterly pulse" });
    expect(seen!.contentType).toMatch(/^multipart\/form-data/);
    expect(seen!.content).toBe("a,b\n1,2\n");                                       // the file itself is the `file` part
  });

  it("offers to open the dataset once the job completes", async () => {
    signIn(); installMocks();
    server.use(
      http.post(`${API}/projects/${PID}/datasets`, () => j({ dataset: dataset({ id: "d9", name: "Done", status: "PROCESSING", latest_version: null }), job: job({ status: "COMPLETED", stage: null, progress: 1, completed_stages: 5, result_ref: { version_id: "v1" } }) }, 202)),
    );
    const user = userEvent.setup();
    mount(`${route}?upload=1`);
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Dataset file"), csv());
    await user.click(within(dialog).getByRole("button", { name: "Upload dataset" }));
    expect(await within(dialog).findByText("Dataset ready")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open dataset" })).toHaveAttribute("href", `/projects/${PID}/data/d9`);
  });

  it("shows the server's rejection message clearly", async () => {
    signIn(); installMocks();
    server.use(http.post(`${API}/projects/${PID}/datasets`, () => apiError(415, "UNSUPPORTED_FILE", "The file content does not match a CSV, TSV or XLSX file.")));
    const user = userEvent.setup();
    mount(`${route}?upload=1`);
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Dataset file"), csv("fake.csv", "%PDF-1.4"));
    await user.click(within(dialog).getByRole("button", { name: "Upload dataset" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("This file type isn’t supported");
    expect(alert).toHaveTextContent("The file content does not match a CSV, TSV or XLSX file.");
    expect(within(dialog).getByRole("button", { name: "Upload dataset" })).toBeEnabled();    // can retry with another file
  });

  it.each([
    [413, "PAYLOAD_TOO_LARGE", "The file exceeds the 50 MB upload limit.", "The file is too large"],
    [422, "EMPTY_FILE", "The uploaded file is empty.", "The file is empty"],
  ])("explains %s %s", async (status, code, message, title) => {
    signIn(); installMocks();
    server.use(http.post(`${API}/projects/${PID}/datasets`, () => apiError(status, code, message)));
    const user = userEvent.setup();
    mount(`${route}?upload=1`);
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Dataset file"), csv());
    await user.click(within(dialog).getByRole("button", { name: "Upload dataset" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(message);
  });

  it("pre-checks the extension and the size limit before uploading", async () => {
    signIn(); installMocks();
    let posted = false;
    server.use(http.post(`${API}/projects/${PID}/datasets`, () => { posted = true; return j({}, 500); }));
    const user = userEvent.setup({ applyAccept: false });
    mount(`${route}?upload=1`);
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Dataset file");

    await user.upload(input, new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/notes\.pdf.*isn’t a supported file type/);
    expect(within(dialog).getByRole("button", { name: "Upload dataset" })).toBeDisabled();

    const big = new File(["x"], "huge.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 62 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/huge\.csv.*62\.0 MB.*50 MB limit/);
    expect(within(dialog).getByRole("button", { name: "Upload dataset" })).toBeDisabled();
    expect(posted).toBe(false);
  });
});
