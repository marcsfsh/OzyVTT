import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GAME_COMMANDS } from "@vtt/api-contract";

/** A document with one live-game command's own route, and a catalog that names that command and one other. */
const START = GAME_COMMANDS["encounter.start"];
const DOC = {
  info: { title: "VTT" },
  paths: {
    [START.path]: {
      [START.method]: {
        operationId: "startEncounter",
        tags: ["Live game"],
        summary: "Start an encounter",
        security: [{ gmAuth: [] }],
        responses: { "200": { description: "Started." } }
      }
    },
    "/api/v1/game/state": {
      get: {
        operationId: "getGameState",
        tags: ["Game"],
        summary: "Read the state",
        security: [{ gmAuth: [] }],
        responses: { "200": { description: "The state." } }
      }
    }
  }
};

vi.mock("../lib/api", () => ({
  jsonRequest: async () => DOC,
  apiRequest: async () => ({
    commands: [
      { type: "encounter.start", scope: "combat:write", summary: "Starts an encounter." },
      { type: "not.a.route", scope: "game:write", summary: "Has no route." }
    ]
  })
}));

import { ToastProvider } from "@vtt/ui";
import { ApiReference } from "./ApiReference";
import { commandsByOperation, operationRows } from "./api-rows";
import type { OpenApiDocument } from "./openapi-model";

const renderReference = () =>
  render(
    <ToastProvider>
      <ApiReference gmToken="gm" openKey={null} onOpen={vi.fn()} onClose={vi.fn()} />
    </ToastProvider>
  );

describe("each row names its command", () => {
  it("matches an operation to the catalog's command by the command's route", () => {
    const rows = operationRows(DOC as unknown as OpenApiDocument);
    const commands = commandsByOperation(rows, [{ type: "encounter.start" }, { type: "not.a.route" }], GAME_COMMANDS);
    expect([...commands.entries()]).toEqual([["startEncounter", "encounter.start"]]);
  });

  it("says As a command with its type, or No command", async () => {
    renderReference();
    const live = within(await screen.findByRole("region", { name: "Live game" }));
    expect(live.getByRole("button", { name: /Start an encounter/ })).toHaveTextContent("As a command encounter.start");
    const game = within(screen.getByRole("region", { name: "Game" }));
    expect(game.getByRole("button", { name: /Read the state/ })).toHaveTextContent("No command");
  });

  it("finds an operation by its command's type", async () => {
    const user = userEvent.setup();
    renderReference();
    await user.type(await screen.findByRole("searchbox", { name: "Find an operation" }), "encounter.start");
    expect(screen.getByText("1 of 2 operations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start an encounter/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Read the state/ })).toBeNull();
  });
});
