import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerActor, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import { MyCharacter } from "./MyCharacter";
import { PartyMemberBand } from "./PartyMemberBand";

/**
 * A party member reads only what the projection sends another player at the GM's tier (characters rule 9). The
 * projection itself is tested on the server; here the dialog shows what arrived, and never asks for more.
 */

const SCORES = { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 13 };

const member = (over: Partial<PlayerActor> = {}): PlayerActor =>
  ({
    id: "borin",
    name: "Borin Stoneguard",
    kind: "player-character",
    visibility: "public",
    hp: { kind: "exact", current: 52, maximum: 67, temporary: 0 },
    armorClass: 17,
    speedFeet: 30,
    classLine: "Fighter 7",
    effects: [],
    conditions: [],
    claimStatus: "claimed",
    presence: "online",
    size: "medium",
    sizeCells: 1,
    ...over
  }) as unknown as PlayerActor;

const withSheet = (over: Partial<PlayerActor> = {}) =>
  member({
    definition: {
      abilityScores: SCORES,
      skills: [{ id: "athletics" }],
      notes: "Owes the guild a favour",
      character: { classes: [{ id: "fighter", name: "Fighter", level: 7 }], race: { id: "dwarf", name: "Dwarf" } }
    } as never,
    ...over
  });

const RESOURCES = {
  hitDice: { entries: [{ die: "d10", remaining: 5, maximum: 7 }] },
  spellSlots: [{ level: 1, remaining: 2, maximum: 3 }]
} as unknown as Partial<PlayerActor>;

function band(actor: PlayerActor, resources: boolean) {
  render(<PartyMemberBand actor={actor} resources={resources} onClose={() => {}} />);
  return screen.getByRole("dialog", { name: "Borin Stoneguard's sheet" });
}

describe("a party member as a band", () => {
  it("shows the class line, the plate and conditions as tags, and no abilities without a sheet", () => {
    const dialog = band(member({ conditions: [{ id: "poisoned" }] as never }), false);
    expect(within(dialog).getByText("Fighter 7")).toBeInTheDocument();
    expect(within(dialog).getByText("17")).toBeInTheDocument();
    expect(within(dialog).getByText("poisoned")).toBeInTheDocument();
    expect(within(dialog).queryByRole("list", { name: "Abilities" })).toBeNull();
    expect(dialog.textContent).not.toMatch(/Hit Point Dice|Spell slots/);
  });

  it("at the full sheet shows the six abilities, modifier over score, and still no resources", () => {
    const dialog = band(withSheet(RESOURCES), false);
    const abilities = within(dialog).getByRole("list", { name: "Abilities" });
    expect(
      within(abilities)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(["STR+316", "DEX+112", "CON+214", "INT-18", "WIS+010", "CHA+113"]);
    // Resources arrive only with the resources tier; the flag is the tier, whatever fields came.
    expect(dialog.textContent).not.toMatch(/Hit Point Dice|Spell slots/);
  });

  it("with resources adds Hit Point Dice and spell slots on one line", () => {
    const dialog = band(withSheet(RESOURCES), true);
    expect(dialog.textContent).toContain("Hit Point Dice 5/7 d10");
    expect(dialog.textContent).toContain("Spell slots L1 × 2");
  });

  it("never shows skills or notes, even when the sheet carries them", () => {
    const dialog = band(withSheet(RESOURCES), true);
    expect(dialog.textContent).not.toMatch(/athletics|Owes the guild/i);
  });
});

describe("Sheet with nothing claimed", () => {
  const view = (playerBuilder: "open" | "closed") =>
    ({
      revision: 3,
      partyVisibility: "name-and-class",
      builderPolicy: { playerBuilder, playerRandom: playerBuilder, maxLevel: 20 },
      combat: { active: false },
      actors: [member({ claimStatus: "available", presence: null })]
    }) as unknown as PlayerView;

  const mount = (state: PlayerView, onGoToTable = vi.fn()) =>
    render(
      <ToastProvider>
        <MyCharacter
          state={state}
          token="t"
          onCreateCharacter={() => {}}
          onLevel={() => {}}
          onGoToTable={onGoToTable}
        />
      </ToastProvider>
    );

  it("says no one is played yet and points at the claim page, with the builder's doors under it", async () => {
    const onGoToTable = vi.fn();
    mount(view("open"), onGoToTable);
    expect(screen.getByText("You aren't playing anyone yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pick a character" }));
    expect(onGoToTable).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create a character" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll a random one" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The party" })).toBeInTheDocument();
  });

  it("leaves the builder's doors out while the GM keeps the builder", () => {
    mount(view("closed"));
    expect(screen.getByRole("button", { name: "Pick a character" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create a character" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Roll a random one" })).toBeNull();
  });
});
