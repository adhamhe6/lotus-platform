import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { routes } from "@/App";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { server } from "@/test/server";
import { API, USER, apiError, j, newClient, signIn, signedOut } from "@/test/utils";
import { Providers } from "@/providers";
import { render } from "@testing-library/react";

function renderRoutes(initial: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initial] });
  render(<Providers client={newClient()}><RouterProvider router={router} /></Providers>);
  return router;
}

const project = { id: "p1", name: "Customer Study", description: "", objective: "Why is satisfaction low?", owner_id: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", role: "OWNER", counts: { datasets: 1, analyses: 3, insights: 2 } };

describe("authentication", () => {
  it("redirects anonymous visitors to sign in", async () => {
    signedOut();
    const r = renderRoutes("/projects");
    await waitFor(() => expect(r.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
  });

  it("validates the form, shows server errors, and signs in", async () => {
    signedOut();
    let attempts = 0;
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        attempts++;
        const b = (await request.json()) as { password: string };
        return b.password === "Correct-horse-9" ? j({ access_token: "tok", token_type: "bearer", expires_in: 1800, user: USER }) : apiError(401, "INVALID_CREDENTIALS", "Incorrect e-mail or password.");
      }),
      http.get(`${API}/projects`, () => j([project])),
    );
    const user = userEvent.setup();
    const r = renderRoutes("/login");
    await user.click(await screen.findByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/enter a valid e-mail/i)).toBeInTheDocument();
    expect(attempts).toBe(0);
    await user.type(screen.getByLabelText(/e-mail/i), "ana@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect e-mail or password.");
    await user.clear(screen.getByLabelText(/password/i));
    await user.type(screen.getByLabelText(/password/i), "Correct-horse-9");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(r.state.location.pathname).toBe("/projects"));
    expect(await screen.findByText("Customer Study")).toBeInTheDocument();
  });

  it("registration enforces the password policy before calling the API", async () => {
    signedOut();
    const user = userEvent.setup();
    renderRoutes("/register");
    await user.type(await screen.findByLabelText(/full name/i), "Ana");
    await user.type(screen.getByLabelText(/e-mail/i), "ana@example.com");
    await user.type(screen.getByLabelText(/password/i), "alllowercase1");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText(/mix upper- and lower-case/i)).toBeInTheDocument();
  });
});

describe("projects", () => {
  it("shows an empty state, creates a project and opens it", async () => {
    signIn();
    let created: unknown = null;
    server.use(
      http.get(`${API}/projects`, () => j([])),
      http.post(`${API}/projects`, async ({ request }) => { created = await request.json(); return j({ ...project, name: (created as { name: string }).name }, 201); }),
      http.get(`${API}/projects/p1`, () => j(project)),
      http.get(`${API}/projects/p1/datasets`, () => j([])),
    );
    const user = userEvent.setup();
    const r = renderRoutes("/projects");
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /new project|create a project/i })[0]);
    await user.click(screen.getByRole("button", { name: /^create project$/i }));
    expect(await screen.findByText(/give the project a name/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^name$/i), "Customer Study");
    await user.type(screen.getByLabelText(/research objective/i), "Why is satisfaction low?");
    await user.click(screen.getByRole("button", { name: /^create project$/i }));
    await waitFor(() => expect(r.state.location.pathname).toBe("/projects/p1"));
    expect(created).toMatchObject({ name: "Customer Study", objective: "Why is satisfaction low?" });
  });

  it("surfaces server failures with a retry", async () => {
    signIn();
    server.use(http.get(`${API}/projects`, () => apiError(503, "SERVICE_UNAVAILABLE", "The Lotus server is unavailable.")));
    renderRoutes("/projects");
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("refreshes an expired access token once and retries the request", async () => {
    signIn();
    let calls = 0;
    server.use(http.get(`${API}/projects`, ({ request }) => { calls++; return request.headers.get("authorization") === "Bearer test-token" && calls > 1 ? j([project]) : apiError(401, "TOKEN_EXPIRED", "expired"); }));
    renderRoutes("/projects");
    expect(await screen.findByText("Customer Study")).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
