import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { HeroicGift, hasGift } from "./HeroicGift";
import type { SheetActor, SheetState } from "./sheet-model";

// SRD Heroic Inspiration: "the excess is lost unless you give it to a player character who lacks it".

const BORIN = { id: "10000000-0000-4000-8000-0000000000b1", name: "Borin", kind: "player-character" };
const LYRA = { id: "10000000-0000-4000-8000-0000000000b2", name: "Lyra", kind: "player-character" };
const MIRENA = {
  id: "10000000-0000-4000-8000-0000000000b3",
  name: "Mirena",
  kind: "player-character",
  heroicInspiration: true
};
const GOBLIN = { id: "10000000-0000-4000-8000-0000000000b4", name: "Goblin", kind: "monster" };
const actor = { ...BORIN, heroicInspiration: true, heroicInspirationToGive: true } as unknown as SheetActor;
const state = { actors: [actor, LYRA, MIRENA, GOBLIN] } as unknown as SheetState;

describe("a second Heroic Inspiration on the sheet", () => {
  it("offers the party characters who have none and gives it to the one picked", async () => {
    expect(hasGift(actor)).toBe(true);
    render(<HeroicGift actor={actor} state={state} onFeedback={() => {}} />);
    const picker = screen.getByRole("combobox", { name: "Give it to" });
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Lyra"]);
    fireEvent.click(screen.getByRole("button", { name: "Give" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("actor:give-heroic-inspiration", { actorId: BORIN.id, recipientId: LYRA.id })
    );
  });

  it("lets it go", async () => {
    render(<HeroicGift actor={actor} state={state} onFeedback={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Let it go" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("actor:give-heroic-inspiration", { actorId: BORIN.id, recipientId: null })
    );
  });
});
