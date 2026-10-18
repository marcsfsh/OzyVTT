import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const DOC = {
  info: { title: "VTT", description: "Send a commandId to make a write safe to repeat." },
  tags: [{ name: "Credentials", description: "Keys that let a tool reach this table." }],
  paths: {
    "/api/v1/system/health": {
      get: {
        operationId: "getHealth",
        description: "Says the server is up. It takes nothing.",
        responses: { "200": { description: "Up." } }
      }
    },
    "/api/v1/gm/integration-credentials": {
      get: {
        operationId: "listIntegrationCredentials",
        security: [{ gmAuth: [] }],
        responses: { "200": { description: "The credentials." } }
      },
      post: {
        operationId: "createIntegrationCredential",
        tags: ["Credentials"],
        summary: "Create a credential",
        security: [{ gmAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Create" },
              example: { name: "Stream overlay", scopes: ["game:read"] }
            }
          }
        },
        responses: { "201": { description: "Created." }, "400": { $ref: "#/components/responses/Error" } }
      }
    },
    "/api/v1/game/state": {
      get: {
        operationId: "getGameState",
        security: [{ bearerAuth: ["game:read"] }, { gmAuth: [] }, { playerAuth: [] }],
        responses: { "200": { description: "The state." } }
      }
    },
    "/api/v1/codex/pages/{pageId}": {
      delete: {
        operationId: "deleteCodexPage",
        security: [{ bearerAuth: ["codex:write"] }, { gmAuth: [] }],
        parameters: [
          {
            name: "pageId",
            in: "path",
            required: true,
            description: "The page to delete.",
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: { "204": { description: "Gone." } }
      }
    }
  },
  components: {
    schemas: {
      Create: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, scopes: { type: "array", items: { type: "string" } } }
      }
    }
  }
};

vi.mock("../lib/api", () => ({
  jsonRequest: async () => DOC,
  apiRequest: async () => ({ commands: [{ type: "token:move", scope: "scene:write", summary: "Moves a token." }] })
}));

import { ToastProvider } from "@vtt/ui";
import type { OpenApiDocument } from "./openapi-model";
import { ApiReference } from "./ApiReference";
import { NO_FILTERS, operationRows, tagsOf, visibleRows } from "./api-rows";

const rows = operationRows(DOC as unknown as OpenApiDocument);
const byKey = (key: string) => rows.find((row) => row.key === key)!;

describe("the reference's rows", () => {
  it("takes the tag and summary from the document, and falls back to the path's group and the description", () => {
    expect(byKey("createIntegrationCredential").tag).toBe("Credentials");
    expect(byKey("createIntegrationCredential").summary).toBe("Create a credential");
    expect(byKey("getHealth").tag).toBe("System & discovery");
    expect(byKey("getHealth").summary).toBe("Says the server is up.");
    // No summary and no description: the operation id in words.
    expect(byKey("listIntegrationCredentials").summary).toBe("List integration credentials");
  });

  it("lists the tags in the document's order, then the path groups, then Other", () => {
    expect(tagsOf(rows)).toEqual([
      "Credentials",
      "System & discovery",
      "Integration credentials (GM)",
      "Live game",
      "Codex (pages, atlas, journal & calendar)"
    ]);
    expect(byKey("createIntegrationCredential").tagNote).toBe("Keys that let a tool reach this table.");
    const byTag = visibleRows(rows, NO_FILTERS, [{ key: "tag", direction: "asc" }]).map((row) => row.tag);
    expect(byTag[0]).toBe("Credentials");
  });

  it("says who can call each operation, with the scopes an integration needs", () => {
    expect(byKey("getHealth").callers).toEqual(["anyone"]);
    expect(byKey("getGameState").callers).toEqual(["integration", "gm", "player"]);
    expect(byKey("getGameState").scopes).toEqual(["game:read"]);
  });

  it("narrows by every filter and sorts by several columns in order", () => {
    const keys = (filters: typeof NO_FILTERS) =>
      visibleRows(rows, filters, [{ key: "path", direction: "asc" }]).map((row) => row.key);
    expect(keys({ ...NO_FILTERS, methods: ["delete"] })).toEqual(["deleteCodexPage"]);
    expect(keys({ ...NO_FILTERS, callers: ["player"] })).toEqual(["getGameState"]);
    expect(keys({ ...NO_FILTERS, scopes: ["codex:write"] })).toEqual(["deleteCodexPage"]);
    expect(keys({ ...NO_FILTERS, tags: ["Credentials"] })).toEqual(["createIntegrationCredential"]);
    expect(keys({ ...NO_FILTERS, text: "health" })).toEqual(["getHealth"]);
    const sorted = visibleRows(rows, NO_FILTERS, [
      { key: "method", direction: "asc" },
      { key: "path", direction: "desc" }
    ]).map((row) => `${row.method} ${row.path}`);
    expect(sorted).toEqual([
      "get /api/v1/system/health",
      "get /api/v1/gm/integration-credentials",
      "get /api/v1/game/state",
      "post /api/v1/gm/integration-credentials",
      "delete /api/v1/codex/pages/{pageId}"
    ]);
  });
});

// The chosen example language is remembered on the device; each test starts from the first.
beforeEach(() => {
  localStorage.clear();
});

function renderReference(openKey: string | null = null) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <ApiReference gmToken="gm" openKey={openKey} onOpen={onOpen} onClose={onClose} />
    </ToastProvider>
  );
  return { onOpen, onClose };
}

describe("the reference's table", () => {
  it("lists the operations with their columns and opens one", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderReference();
    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent)
    ).toEqual(["Method", "Path", "Summary", "Tag", "Who can call"]);
    expect(screen.getByText("5 of 5 operations")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "/api/v1/game/state" }));
    expect(onOpen).toHaveBeenCalledWith("getGameState");
  });

  it("narrows by the Tag dropdown, every tag ticked at first", async () => {
    const user = userEvent.setup();
    renderReference();
    await user.click(await screen.findByRole("button", { name: /^Tags: all 5/ }));
    await user.click(screen.getByRole("checkbox", { name: "System & discovery" }));
    expect(screen.getByRole("button", { name: /^Tags: 4 of 5/ })).toBeInTheDocument();
    expect(screen.getByText("4 of 5 operations")).toBeInTheDocument();
  });

  it("filters in a flyout that closes out of the way and leaves chips", async () => {
    const user = userEvent.setup();
    renderReference();
    await user.click(await screen.findByRole("button", { name: "Filters" }));
    const flyout = screen.getByRole("complementary", { name: "Filters" });
    await user.click(within(flyout).getByRole("group", { name: "Method" }).querySelector("button:last-child")!);
    await user.click(within(flyout).getByRole("button", { name: "Close filters" }));
    expect(screen.queryByRole("complementary", { name: "Filters" })).toBeNull();
    expect(screen.getByText("1 of 5 operations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters · 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Method: DELETE" }));
    expect(screen.getByText("5 of 5 operations")).toBeInTheDocument();
  });

  it("sorts with the multi-column dialog the Codex search uses", async () => {
    const user = userEvent.setup();
    renderReference();
    await user.click(await screen.findByRole("button", { name: "Sort: Tag, then Path" }));
    const dialog = screen.getByRole("dialog", { name: "Sort" });
    expect(within(dialog).getByRole("combobox", { name: "Sort by: column" })).toHaveValue("tag");
    expect(within(dialog).getByRole("combobox", { name: "Then by: column" })).toHaveValue("path");
  });

  it("shows the command catalog as a second table", async () => {
    const user = userEvent.setup();
    renderReference();
    await user.click(await screen.findByRole("button", { name: "Commands" }));
    expect(screen.getByRole("table")).toHaveTextContent("token:move");
    expect(screen.getByRole("table")).toHaveTextContent("scene:write");
  });
});

describe("an operation", () => {
  it("reads as one document beside its metadata", async () => {
    const user = userEvent.setup();
    const { onClose } = renderReference("createIntegrationCredential");
    expect(await screen.findByRole("heading", { name: "Create a credential", level: 2 })).toBeInTheDocument();
    const meta = screen.getByRole("complementary", { name: "About this operation" });
    expect(within(meta).getByText("Operation id").nextElementSibling).toHaveTextContent("createIntegrationCredential");
    expect(within(meta).getByText("Who can call").nextElementSibling).toHaveTextContent("GM session");
    expect(within(meta).getByText("Tag").nextElementSibling).toHaveTextContent(
      "Credentials" + "Keys that let a tool reach this table."
    );
    expect(within(meta).getByText("Path").nextElementSibling).toHaveTextContent("/api/v1/gm/integration-credentials");
    // The request's body fields, the responses and an example in the chosen language.
    expect(screen.getByRole("table", { name: "Body fields" })).toHaveTextContent("scopes");
    expect(screen.getByText("201")).toBeInTheDocument();
    // The server's own example body, which says more than one built from the schema.
    expect(document.querySelector(".api-code")).toHaveTextContent("curl -X POST");
    expect(document.querySelector(".api-code")).toHaveTextContent("Stream overlay");
    await user.click(screen.getByRole("button", { name: "Python" }));
    expect(document.querySelector(".api-code")).toHaveTextContent("import requests");
    await user.click(screen.getByRole("button", { name: "All operations" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("names each parameter's place, type and notes, and builds an example when the document has none", async () => {
    renderReference("deleteCodexPage");
    const parameters = await screen.findByRole("table", { name: "Parameters" });
    expect(within(parameters).getAllByRole("row")[1]).toHaveTextContent(
      "pageIdpathstring (uuid)YesThe page to delete."
    );
    expect(document.querySelector(".api-code")).toHaveTextContent("curl -X DELETE");
  });

  it("says when the address names no operation", async () => {
    renderReference("noSuchThing");
    expect(await screen.findByText("This server has no operation called noSuchThing.")).toBeInTheDocument();
  });
});
