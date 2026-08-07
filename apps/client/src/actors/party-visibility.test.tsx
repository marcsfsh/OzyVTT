import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { GmActor, GmView, PartyVisibility, PlayerActor, PlayerView } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import { PartyStrip } from "./PartyStrip";

/**
 * **The party-visibility tier, at the party surface (rulings 5/8/19).**
 *
 * The tier is enforced in `projectPlayerView` and it was enforced correctly — this is not a test of
 * the projection, which `apps/server/test/party-visibility.test.ts` already holds. It is a test of
 * the thing that had no test at all: whether the CLIENT renders the shape the server handed it.
 *
 * The defect this was written against, measured on 2026-08-07: `main.tsx` mounted `PartyStrip` on
 * `!combat.active && playerHasClaimed` with no reference to the tier, and `PartyStrip` rendered
 * `hpLabel(actor.hp)` in a visible span *and* in each row's `aria-label`. At `off` — the tier whose
 * own help string promises "tokens on the map and nothing else — no party list" — a player got the
 * whole party with everyone's exact HP on it. The projection was not breached; the setting was
 * simply undone by the renderer.
 *
 * **`off` SUBTRACTS FIELDS FROM THE SURFACE, NEVER ENTRIES FROM THE STATE**, and the fixtures below
 * are built that way on purpose: every ally is present in `state.actors` at every tier, carrying
 * exact HP, because `combat.initiative` names them and `combat.tokens` carries their token and
 * `EncounterMap` bails on an actor it cannot find. So a test that "proved" the tier by handing the
 * client an empty actors array would be testing a state the server never sends. What the tier
 * governs is what the party SURFACE does with entries that are all there.
 *
 * The HP sweep is therefore the load-bearing assertion: it scans rendered text AND every `aria-label`
 * and `title` on the tree, because the first version of this leak was invisible to a text-only check
 * (`PartyStrip` put the same HP string in both places, and an accessible name is read aloud).
 */

/** Exact HP strings, chosen to be unmistakable in a substring sweep — no other number renders "83". */
const HP = { mine: "41/44", ally: "37/83", other: "12/95", unclaimed: "26/26" } as const;

const playerActor = (over: Partial<PlayerActor> & Pick<PlayerActor, "id" | "name">): PlayerActor => ({
  kind: "player-character",
  visibility: "public",
  hp: { kind: "exact", current: 37, maximum: 83, temporary: 0 },
  effects: [],
  conditions: [],
  claimStatus: "claimed",
  presence: "online",
  size: "medium",
  sizeCells: 1,
  ...over
} as unknown as PlayerActor);

const gmActor = (over: Partial<GmActor> & Pick<GmActor, "id" | "name">): GmActor => ({
  kind: "player-character",
  visibility: "public",
  hp: { current: 37, maximum: 83, temporary: 0 },
  effects: [],
  conditions: [],
  presence: "online",
  size: "medium",
  sizeCells: 1,
  ownerSessionId: "session-1",
  ...over
} as unknown as GmActor);

/** A table of four: the player's own character, two other people's, and one nobody has claimed. */
function playerView(partyVisibility: PartyVisibility): PlayerView {
  return {
    revision: 7,
    partyVisibility,
    actors: [
      playerActor({ id: "mine", name: "Mira Thorne", claimStatus: "mine", hp: { kind: "exact", current: 41, maximum: 44, temporary: 0 } }),
      // `classLine` is the field the `name-and-class` tier exists to carry: the server derives it
      // because a player projection has no `definitions` list to read a class off.
      playerActor({ id: "ally", name: "Borin Stoneguard", classLine: "Fighter 7" }),
      playerActor({ id: "other", name: "Lyra Emberwise", classLine: "Wizard 5", hp: { kind: "exact", current: 12, maximum: 95, temporary: 0 } }),
      // Unclaimed characters sit outside the tier entirely on the wire (the claim screen reads the
      // same list) — but they are still on the PARTY surface, so `off` takes them with it.
      playerActor({ id: "free", name: "Sable Vex", claimStatus: "available", presence: null, hp: { kind: "exact", current: 26, maximum: 26, temporary: 0 } })
    ]
  } as unknown as PlayerView;
}

function gmView(): GmView {
  return {
    revision: 7,
    partyVisibility: "off",
    actors: [
      gmActor({ id: "mine", name: "Mira Thorne", hp: { current: 41, maximum: 44, temporary: 0 } }),
      gmActor({ id: "ally", name: "Borin Stoneguard" }),
      gmActor({ id: "other", name: "Lyra Emberwise", hp: { current: 12, maximum: 95, temporary: 0 } }),
      gmActor({ id: "free", name: "Sable Vex", ownerSessionId: null, hp: { current: 26, maximum: 26, temporary: 0 } })
    ]
  } as unknown as GmView;
}

/** Rendered text plus every accessible name and tooltip on the tree — the two places HP was leaking. */
function surfaceText(container: HTMLElement): string {
  const parts = [container.textContent ?? ""];
  for (const node of container.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
    parts.push(node.getAttribute("aria-label") ?? "", node.getAttribute("title") ?? "");
  }
  return parts.join(" | ");
}

const TIERS: readonly PartyVisibility[] = ["off", "name-and-class", "full-sheet", "sheet-and-resources"];

describe("party visibility — the player's party strip", () => {
  it("renders NO party surface at `off`", () => {
    const { container } = render(<PartyStrip role="player" state={playerView("off")} />);
    expect(container.querySelector(".party-strip"), "`off` is: no identity card, no sheet to open, no party list").toBeNull();
    expect(container.textContent).toBe("");
  });

  it("leaks no other character's HP anywhere at `off` — not in text, not in an aria-label", () => {
    const { container } = render(<PartyStrip role="player" state={playerView("off")} />);
    const swept = surfaceText(container);
    for (const [who, hp] of Object.entries(HP)) {
      expect(swept, `${who}'s HP (${hp}) reached the DOM at \`off\``).not.toContain(hp);
    }
    // And no ally's NAME either: at `off` the surface does not exist, so nothing on it does.
    expect(swept).not.toContain("Borin Stoneguard");
  });

  it("at `name-and-class` shows who is in the party and what they play, and no exact HP", () => {
    const { container } = render(<PartyStrip role="player" state={playerView("name-and-class")} />);
    expect(container.querySelector(".party-strip")).not.toBeNull();
    const swept = surfaceText(container);

    // Who: every character on the table, including the unclaimed one.
    for (const name of ["Mira Thorne", "Borin Stoneguard", "Lyra Emberwise", "Sable Vex"]) expect(swept).toContain(name);
    // What they play: the tier's own field, rendered rather than inferred.
    expect(swept).toContain("Fighter 7");
    expect(swept).toContain("Wizard 5");

    // And NOT a number off somebody else's sheet. Your own is always yours (the projection's `mine`
    // column is not negotiable), so it is the one exact HP allowed here.
    expect(swept).toContain(HP.mine);
    for (const hp of [HP.ally, HP.other, HP.unclaimed]) expect(swept, `${hp} is another character's exact HP`).not.toContain(hp);
    expect(container.querySelectorAll(".party-strip-hp")).toHaveLength(1);
  });

  for (const tier of ["full-sheet", "sheet-and-resources"] as const) {
    it(`at \`${tier}\` the strip carries exact HP — the tier that opens the sheet that holds it`, () => {
      const { container } = render(<PartyStrip role="player" state={playerView(tier)} />);
      const swept = surfaceText(container);
      for (const hp of Object.values(HP)) expect(swept).toContain(hp);
      expect(container.querySelectorAll(".party-strip-hp")).toHaveLength(4);
    });
  }

  it("opens only the player's own entry, at every tier", () => {
    // Stricter than the tier allows, deliberately: `CharacterSheet` is the OWNER's sheet and renders
    // damage/heal controls the server refuses on someone else's character. The read-only twin lives
    // on the My character tab.
    for (const tier of TIERS) {
      const { container, unmount } = render(<PartyStrip role="player" state={playerView(tier)} />);
      const buttons = [...container.querySelectorAll("button.party-strip-entry")];
      expect(buttons.map((b) => b.getAttribute("aria-label")).join(), `tier ${tier}`).toMatch(tier === "off" ? /^$/ : /Mira Thorne/);
      expect(buttons, `tier ${tier}: only the player's own entry is a button`).toHaveLength(tier === "off" ? 0 : 1);
      unmount();
    }
  });
});

describe("party visibility — the GM's own strip is never gated", () => {
  it("shows every character and every exact HP, whatever the tier says", () => {
    // The tier governs what a PLAYER sees of ANOTHER player's character. A GM reading their own
    // table is not a party of one; `gmView()` deliberately carries `partyVisibility: "off"`.
    const { container } = render(<PartyStrip role="gm" state={gmView()} />);
    expect(container.querySelector(".party-strip")).not.toBeNull();
    const swept = surfaceText(container);
    for (const hp of Object.values(HP)) expect(swept).toContain(hp);
    expect(container.querySelectorAll(".party-strip-hp")).toHaveLength(4);
    expect(container.querySelectorAll("button.party-strip-entry")).toHaveLength(4);
  });

  it("still offers the empty state's way out", () => {
    const onOpenRoster = vi.fn();
    const { container } = render(<PartyStrip role="gm" state={{ revision: 1, actors: [] } as unknown as GmView} onOpenRoster={onOpenRoster} />);
    expect(container.querySelector(".party-strip-empty")).not.toBeNull();
  });
});
