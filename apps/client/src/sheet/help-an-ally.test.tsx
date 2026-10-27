import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { HelpAnAlly } from "./HelpAnAlly";
import type { SheetActor, SheetState } from "./sheet-model";

// SRD Help, Assist an Ability Check: "Choose one of your skill or tool proficiencies and one ally ... That ally has
// Advantage on the next ability check they make with the chosen skill or tool."

const BORIN = { id: "10000000-0000-4000-8000-0000000000c1", name: "Borin", kind: "player-character" };
const LYRA = { id: "10000000-0000-4000-8000-0000000000c2", name: "Lyra", kind: "player-character" };
const GOBLIN = { id: "10000000-0000-4000-8000-0000000000c3", name: "Goblin", kind: "monster" };
const actor = BORIN as unknown as SheetActor;
const state = { actors: [actor, LYRA, GOBLIN] } as unknown as SheetState;
const choices = [
  { id: "athletics", name: "Athletics" },
  { id: "thieves-tools", name: "Thieves' Tools" }
];

describe("helping an ally's check outside a fight", () => {
  it("offers the party and the character's proficiencies, and helps with the tool picked", async () => {
    const said = vi.fn();
    render(<HelpAnAlly actor={actor} state={state} choices={choices} onFeedback={said} />);
    const allies = screen.getByRole("combobox", { name: "Ally" });
    expect([...allies.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Lyra"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Help with" }), { target: { value: "thieves-tools" } });
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("action:resolve", {
        actorId: BORIN.id,
        actionId: "help-check",
        targetIds: [LYRA.id],
        skill: "thieves-tools"
      })
    );
    await waitFor(() => expect(said).toHaveBeenCalledWith("Lyra has Advantage on their next Thieves' Tools check."));
  });

  it("shows nothing when the character has no proficiency to help with", () => {
    const { container } = render(<HelpAnAlly actor={actor} state={state} choices={[]} onFeedback={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
