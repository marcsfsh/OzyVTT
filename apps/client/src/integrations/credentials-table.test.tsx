import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IntegrationCredentialMetadata } from "@vtt/api-contract";

const apiRequest = vi.fn();
vi.mock("../lib/api", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import { ToastProvider } from "@vtt/ui";
import { CredentialsTable, stateOf } from "./CredentialsTable";
import { CredentialPage } from "./CredentialPage";

const OVERLAY: IntegrationCredentialMetadata = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Stream overlay",
  scopes: ["game:read", "combat:read"],
  gameId: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: null,
  lastUsedAt: "2026-10-02T10:00:00.000Z",
  revokedAt: null
};
const OLD_BOT = {
  ...OVERLAY,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Old bot",
  revokedAt: "2026-10-03T10:00:00.000Z"
};

/** The server: the list, a create, a rotate, a revoke and an audit, by path and method. */
function serve(list: IntegrationCredentialMetadata[]) {
  apiRequest.mockImplementation(async (path: string, request: { body?: unknown; method?: string } = {}) => {
    if (path.endsWith("/rotate")) return { credential: OVERLAY, token: "rotated-secret" };
    if (path.endsWith("/revoke")) return {};
    if (path.endsWith("/audit"))
      return { events: [{ id: 1, type: "created", occurredAt: "2026-10-01T10:00:00.000Z", detail: {} }] };
    if (request.body) return { credential: { ...OVERLAY, name: "Dice bot" }, token: "fresh-secret" };
    return { credentials: list };
  });
}

function renderTable(creating = false) {
  const onCreatingChange = vi.fn();
  render(
    <ToastProvider>
      <CredentialsTable gmToken="gm" creating={creating} onCreatingChange={onCreatingChange} />
    </ToastProvider>
  );
  return onCreatingChange;
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe("the integration credentials", () => {
  it("are a table of name, scopes, state, last use and expiry, with the row's actions", async () => {
    serve([OVERLAY, OLD_BOT]);
    renderTable();
    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent)
    ).toEqual(["Name", "Scopes", "State", "Last used", "Expires", "Actions"]);
    const [, overlay, oldBot] = within(table).getAllByRole("row");
    expect(overlay).toHaveTextContent("Stream overlay");
    expect(overlay).toHaveTextContent("game:read");
    expect(overlay).toHaveTextContent("Active");
    expect(within(overlay).getByRole("button", { name: "Rotate" })).toBeEnabled();
    // A revoked credential keeps its page, with its history, and nothing else.
    expect(oldBot).toHaveTextContent("Revoked");
    expect(within(oldBot).getByRole("button", { name: "Rotate" })).toBeDisabled();
    expect(within(oldBot).getByRole("button", { name: "Revoke" })).toBeDisabled();
    expect(within(oldBot).getByRole("button", { name: "Old bot" })).toBeEnabled();
    expect(within(oldBot).queryByRole("button", { name: "History" })).toBeNull();
  });

  it("names what to do when there are none", async () => {
    serve([]);
    renderTable();
    expect(await screen.findByText(/^No credentials yet\./)).toBeInTheDocument();
  });

  it("creates one with a name and at least one scope, and shows its secret once", async () => {
    serve([]);
    const user = userEvent.setup();
    const onCreatingChange = renderTable(true);
    const dialog = await screen.findByRole("dialog", { name: "New credential" });
    const create = within(dialog).getByRole("button", { name: "Create credential" });
    expect(create).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "Dice bot");
    expect(create).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: "roll:create" }));
    await user.click(create);
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/v1/gm/integration-credentials",
      expect.objectContaining({ body: { name: "Dice bot", scopes: ["roll:create"], expiresAt: null } })
    );
    expect(onCreatingChange).toHaveBeenCalledWith(false);
    const secret = await screen.findByRole("dialog", { name: "Secret for Dice bot" });
    expect(secret).toHaveTextContent("fresh-secret");
    expect(secret).toHaveTextContent("This is the only time the secret is shown.");
    await user.click(within(secret).getByRole("button", { name: "I saved it elsewhere" }));
    expect(screen.queryByRole("dialog", { name: "Secret for Dice bot" })).toBeNull();
  });

  it("rotates after asking, and shows the new secret", async () => {
    serve([OVERLAY]);
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: "Rotate" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Rotate Stream overlay?" })).getByRole("button", { name: "Rotate" })
    );
    expect(await screen.findByRole("dialog", { name: "New secret for Stream overlay" })).toHaveTextContent(
      "rotated-secret"
    );
  });

  it("revokes after asking, and opens a credential's page from its name", async () => {
    serve([OVERLAY]);
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Revoke Stream overlay?" })).getByRole("button", { name: "Revoke" })
    );
    expect(apiRequest).toHaveBeenCalledWith(
      `/api/v1/gm/integration-credentials/${OVERLAY.id}/revoke`,
      expect.objectContaining({ method: "POST" })
    );
    await user.click(screen.getByRole("button", { name: "Stream overlay" }));
    expect(window.location.pathname).toBe(`/settings/access/credentials/${OVERLAY.id}`);
  });

  it("calls a credential past its expiry Expired", () => {
    expect(stateOf({ ...OVERLAY, expiresAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-02-01"))).toBe("expired");
    expect(stateOf(OVERLAY)).toBe("active");
    expect(stateOf(OLD_BOT)).toBe("revoked");
  });
});

describe("a credential's page", () => {
  const EVENTS = [
    { id: 1, type: "created", occurredAt: "2026-10-01T10:00:00.000Z", detail: { scopes: ["game:read"] } },
    { id: 2, type: "used", occurredAt: "2026-10-02T10:00:00.000Z", detail: { requiredScope: "game:read" } },
    { id: 3, type: "verification_failed", occurredAt: "2026-10-02T11:00:00.000Z", detail: { reason: "secret" } },
    { id: 4, type: "rotated", occurredAt: "2026-10-02T12:00:00.000Z", detail: { expires: false } }
  ];
  const renderPage = (id = OVERLAY.id) => {
    const onBack = vi.fn();
    render(
      <ToastProvider>
        <CredentialPage gmToken="gm" credentialId={id} onBack={onBack} />
      </ToastProvider>
    );
    return onBack;
  };

  it("reads the audit into its history, a refusal in amber, with Access as its crumb", async () => {
    serve([OVERLAY, OLD_BOT]);
    const list = apiRequest.getMockImplementation()!;
    apiRequest.mockImplementation(async (path: string, request?: unknown) =>
      path.endsWith("/audit") ? { events: EVENTS } : list(path, request)
    );
    const user = userEvent.setup();
    const onBack = renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Stream overlay" })).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith(`/api/v1/gm/integration-credentials/${OVERLAY.id}/audit`, {
      token: "gm"
    });
    const history = within(await screen.findByRole("list", { name: "History" }));
    const rows = history.getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual([
      "Created",
      "Used",
      "Refused a wrong secret",
      "Rotated"
    ]);
    expect(rows[2]).toHaveClass("is-refused");
    expect(rows[1]).toHaveTextContent("For game:read");
    expect(screen.getByRole("heading", { level: 3, name: /^History/ })).toHaveTextContent("History · 4");
    await user.click(screen.getByRole("button", { name: "Back to Access" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("rotates after asking and shows the new secret once, which the history never holds", async () => {
    serve([OVERLAY]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Rotate" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Rotate Stream overlay?" })).getByRole("button", { name: "Rotate" })
    );
    const secret = await screen.findByRole("dialog", { name: "New secret for Stream overlay" });
    expect(secret).toHaveTextContent("rotated-secret");
    expect(within(screen.getByRole("list", { name: "History" })).queryByText(/rotated-secret/)).toBeNull();
  });

  it("keeps Rotate and Revoke off for a revoked credential", async () => {
    serve([OVERLAY, OLD_BOT]);
    renderPage(OLD_BOT.id);
    expect(await screen.findByRole("button", { name: "Rotate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeDisabled();
  });
});
