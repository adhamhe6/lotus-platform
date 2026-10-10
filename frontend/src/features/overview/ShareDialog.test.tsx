import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import type { Member, Role } from "@/api/types";
import { server } from "@/test/server";
import { API, apiError, j, renderApp, signIn } from "@/test/utils";
import { ShareDialog } from "./ShareDialog";

const owner: Member = { user_id: "u1", email: "owner@example.com", full_name: "Olive Owner", role: "OWNER" };
const ed: Member = { user_id: "u2", email: "ed@example.com", full_name: "Edgar Editor", role: "EDITOR" };

function setup(role: Role = "OWNER", initial: Member[] = [owner, ed]) {
  signIn();
  let members = [...initial];
  const calls: { method: string; url: string; body?: unknown }[] = [];
  server.use(
    http.get(`${API}/projects/p1/members`, () => j(members)),
    http.post(`${API}/projects/p1/members`, async ({ request }) => {
      const b = (await request.json()) as { email: string; role: "EDITOR" | "VIEWER" };
      calls.push({ method: "POST", url: "members", body: b });
      if (b.email === "ghost@example.com") return apiError(404, "USER_NOT_FOUND", "No registered user has that e-mail address.");
      if (b.email === "ed@example.com") return apiError(409, "ALREADY_MEMBER", "That user is already a member of the project.");
      const m: Member = { user_id: "u9", email: b.email, full_name: "New Person", role: b.role };
      members = [...members, m];
      return j(m, 201);
    }),
    http.patch(`${API}/projects/p1/members/:id`, async ({ request, params }) => {
      const b = (await request.json()) as { role: "EDITOR" | "VIEWER" };
      calls.push({ method: "PATCH", url: String(params.id), body: b });
      members = members.map((m) => (m.user_id === params.id ? { ...m, role: b.role } : m));
      return new Response(null, { status: 204 });
    }),
    http.delete(`${API}/projects/p1/members/:id`, ({ params }) => {
      calls.push({ method: "DELETE", url: String(params.id) });
      members = members.filter((m) => m.user_id !== params.id);
      return new Response(null, { status: 204 });
    }),
  );
  renderApp(<ShareDialog projectId="p1" role={role} />);
  return calls;
}

describe("ShareDialog", () => {
  it("lists members; the owner row has no controls", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /share/i }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText("Olive Owner")).toBeInTheDocument();
    const ownerRow = within(dlg).getByText("Olive Owner").closest("li")!;
    expect(within(ownerRow).getByText("Owner")).toBeInTheDocument();
    expect(within(ownerRow).queryByRole("button")).not.toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Remove Edgar Editor" })).toBeInTheDocument();
  });

  it("adds a member by e-mail with a role, validating the e-mail first", async () => {
    const calls = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /share/i }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("E-mail address"), "nope");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    expect(await within(dlg).findByText(/enter a valid e-mail/i)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await user.clear(within(dlg).getByLabelText("E-mail address"));
    await user.type(within(dlg).getByLabelText("E-mail address"), "new@example.com");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls[0]).toMatchObject({ method: "POST", body: { email: "new@example.com", role: "VIEWER" } }));
    expect(await within(dlg).findByText("New Person")).toBeInTheDocument();
  });

  it("shows USER_NOT_FOUND and ALREADY_MEMBER inline", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /share/i }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("E-mail address"), "ghost@example.com");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    const alert = await within(dlg).findByRole("alert");
    expect(alert).toHaveTextContent("No registered user has that e-mail address.");
    await user.clear(within(dlg).getByLabelText("E-mail address"));
    await user.type(within(dlg).getByLabelText("E-mail address"), "ed@example.com");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(within(dlg).getByRole("alert")).toHaveTextContent("already a member"));
  });

  it("changes a role and removes a member after confirmation", async () => {
    const calls = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /share/i }));
    const dlg = await screen.findByRole("dialog");
    await user.click(await within(dlg).findByRole("combobox", { name: "Role for Edgar Editor" }));
    await user.click(await screen.findByRole("option", { name: /viewer/i }));
    await waitFor(() => expect(calls[0]).toMatchObject({ method: "PATCH", url: "u2", body: { role: "VIEWER" } }));
    await user.click(within(dlg).getByRole("button", { name: "Remove Edgar Editor" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("ed@example.com");
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "u2" }));
    await waitFor(() => expect(within(dlg).queryByText("Edgar Editor")).not.toBeInTheDocument());
  });

  it("is read-only for non-owners", async () => {
    setup("EDITOR");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /share/i }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText("Edgar Editor")).toBeInTheDocument();
    expect(within(dlg).queryByLabelText("E-mail address")).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(within(dlg).getByText(/only the project owner/i)).toBeInTheDocument();
  });
});
