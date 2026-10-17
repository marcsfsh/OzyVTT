import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { GmActor, GmView, PartyVisibility, PlayerActor, PlayerView } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import { PartyStrip } from "./PartyStrip";

/**
 * The client renders the party-visibility tier it is given (the projection itself is tested in
 * apps/server/test/party-visibility.test.ts). As on the wire, every ally stays in `state.actors` at
 * every tier; the tier governs only what the party surface shows. HP is swept from text and from
 * every aria-label and title, since an accessible name leaks too.
 */

/** Exact HP strings, chosen to be unmistakable in a substring sweep: no other number renders "83". */
const HP = { mine: "41/44", ally: "37/83", other: "12/95", unclaimed: "26/26" } as const;

const playerActor = (over: Partial<PlayerActor> & Pick<PlayerActor, "id" | "name">): PlayerActor =>
  ({
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
  }) as unknown as PlayerActor;

const gmActor = (over: Partial<GmActor> & Pick<GmActor, "id" | "name">): GmActor =>
  ({
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
  }) as unknown as GmActor;

/** A table of four: the player's own character, two other people's, and one nobody has claimed. */
function playerView(partyVisibility: PartyVisibility): PlayerView {
  return {
    revision: 7,
    partyVisibility,
    actors: [
      playerActor({
        id: "mine",
        name: "Mira Thorne",
        claimStatus: "mine",
        hp: { kind: "exact", current: 41, maximum: 44, temporary: 0 }
      }),
      // `classLine` is the field the `name-and-class` tier carries.
      playerActor({ id: "ally", name: "Borin Stoneguard", classLine: "Fighter 7" }),
      playerActor({
        id: "other",
        name: "Lyra Emberwise",
        classLine: "Wizard 5",
        hp: { kind: "exact", current: 12, maximum: 95, temporary: 0 }
      }),
      // Unclaimed characters still appear on the party surface, so `off` hides them too.
      playerActor({
        id: "free",
        name: "Sable Vex",
        claimStatus: "available",
        presence: null,
        hp: { kind: "exact", current: 26, maximum: 26, temporary: 0 }
      })
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

/** Rendered text plus every accessible name and tooltip on the tree: the two places HP was leaking. */
function surfaceText(container: HTMLElement): string {
  const parts = [container.textContent ?? ""];
  for (const node of container.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
    parts.push(node.getAttribute("aria-label") ?? "", node.getAttribute("title") ?? "");
  }
  return parts.join(" | ");
}

const TIERS: readonly PartyVisibility[] = ["off", "name-and-class", "full-sheet", "sheet-and-resources"];

describe("party visibility: the player's party strip", () => {
  it("renders NO party surface at `off`", () => {
    const { container } = render(<PartyStrip role="player" state={playerView("off")} />);
    expect(
      container.querySelector(".party-strip"),
      "`off` is: no identity card, no sheet to open, no party list"
    ).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("leaks no other character's HP anywhere at `off`, in text or in an aria-label", () => {
    const { container } = render(<PartyStrip role="player" state={playerView("off")} />);
    const swept = surfaceText(container);
    for (const [who, hp] of Object.entries(HP)) {
      expect(swept, `${who}'s HP (${hp}) reached the DOM at \`off\``).not.toContain(hp);
    }
    // At `off` the surface does not exist, so not even names render.
    expect(swept).not.toContain("Borin Stoneguard");
  });

  it("at `name-and-class` shows who is in the party and what they play, and no exact HP", () => {
    const { container } = render(<PartyStrip role="player" state={playerView("name-and-class")} />);
    expect(container.querySelector(".party-strip")).not.toBeNull();
    const swept = surfaceText(container);

    // Who: every character on the table, including the unclaimed one.
    for (const name of ["Mira Thorne", "Borin Stoneguard", "Lyra Emberwise", "Sable Vex"])
      expect(swept).toContain(name);
    // What they play: the tier's own field, rendered as it stands.
    expect(swept).toContain("Fighter 7");
    expect(swept).toContain("Wizard 5");

    // Only your own exact HP may show at this tier.
    expect(swept).toContain(HP.mine);
    for (const hp of [HP.ally, HP.other, HP.unclaimed])
      expect(swept, `${hp} is another character's exact HP`).not.toContain(hp);
    expect(container.querySelectorAll(".party-strip-hp")).toHaveLength(1);
  });

  for (const tier of ["full-sheet", "sheet-and-resources"] as const) {
    it(`at \`${tier}\` the strip carries exact HP, the tier that opens the sheet that holds it`, () => {
      const { container } = render(<PartyStrip role="player" state={playerView(tier)} />);
      const swept = surfaceText(container);
      for (const hp of Object.values(HP)) expect(swept).toContain(hp);
      expect(container.querySelectorAll(".party-strip-hp")).toHaveLength(4);
    });
  }

  it("opens only the player's own entry, at every tier", () => {
    // A player opens only their own sheet: `CharacterSheet` has owner-only damage/heal controls.
    for (const tier of TIERS) {
      const { container, unmount } = render(<PartyStrip role="player" state={playerView(tier)} />);
      const buttons = [...container.querySelectorAll("button.party-strip-entry")];
      expect(buttons.map((b) => b.getAttribute("aria-label")).join(), `tier ${tier}`).toMatch(
        tier === "off" ? /^$/ : /Mira Thorne/
      );
      expect(buttons, `tier ${tier}: only the player's own entry is a button`).toHaveLength(tier === "off" ? 0 : 1);
      unmount();
    }
  });
});

describe("party visibility: the GM's own strip is never gated", () => {
  it("shows every character and every exact HP, whatever the tier says", () => {
    // The tier gates players only; `gmView()` carries `partyVisibility: "off"`.
    const { container } = render(<PartyStrip role="gm" state={gmView()} />);
    expect(container.querySelector(".party-strip")).not.toBeNull();
    const swept = surfaceText(container);
    for (const hp of Object.values(HP)) expect(swept).toContain(hp);
    expect(container.querySelectorAll(".party-strip-hp")).toHaveLength(4);
    expect(container.querySelectorAll("button.party-strip-entry")).toHaveLength(4);
  });

  it("still offers the empty state's way out", () => {
    const onOpenRoster = vi.fn();
    const { container } = render(
      <PartyStrip role="gm" state={{ revision: 1, actors: [] } as unknown as GmView} onOpenRoster={onOpenRoster} />
    );
    expect(container.querySelector(".party-strip-empty")).not.toBeNull();
  });
});
