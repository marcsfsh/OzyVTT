import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmActor, GmView } from "@vtt/domain";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (_event: string, _payload: unknown, ack: (error: null, reply: unknown) => void) => ack(null, { ok: false })
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});
const navigate = vi.fn();
vi.mock("../router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../router")>()),
  navigate: (...args: unknown[]) => navigate(...args)
}));

import { ToastProvider } from "@vtt/ui";
import { PartyStrip } from "./PartyStrip";

// The GM reaches a character's level page from the party strip: the sheet it opens offers it.

const LYRA = "10000000-0000-4000-8000-0000000000c1";
const SHEET = "20000000-0000-4000-8000-0000000000c1";
const state = {
  revision: 1,
  actors: [
    {
      id: LYRA,
      name: "Lyra",
      kind: "player-character",
      visibility: "public",
      hp: { current: 20, maximum: 20, temporary: 0 },
      effects: [],
      conditions: [],
      presence: null,
      ownerSessionId: null,
      definitionId: SHEET
    } as unknown as GmActor
  ],
  definitions: [
    {
      id: SHEET,
      definition: {
        name: "Lyra",
        abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
        proficiencyBonus: 2,
        actions: [],
        extensions: {},
        character: { classes: [{ id: "wizard", name: "Wizard", level: 3, hitDie: "d6" }] }
      }
    }
  ],
  rolls: [],
  combat: { active: false, initiative: [], pendingSaves: [] }
} as unknown as GmView;

describe("the party strip's sheet", () => {
  it("opens the level page for the GM", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyStrip role="gm" state={state} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: /^Lyra,.*Open sheet\.$/ }));
    await user.click(await screen.findByLabelText("Sheet menu for Lyra"));
    await user.click(screen.getByRole("menuitem", { name: "Level up to 4" }));
    expect(navigate).toHaveBeenCalledWith(`/characters/${LYRA}/level`);
    // The sheet closes behind it.
    expect(screen.queryByLabelText("Sheet menu for Lyra")).toBeNull();
  });
});
