import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ConversionOffer, Rechoice } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ConversionList, RestStep } from "./Conversions";
import type { SheetEdit } from "./useSheetEdit";

const ACTOR = "10000000-0000-4000-8000-000000000001";

const fontOfMagic: ConversionOffer = {
  id: "font-of-magic-points",
  name: "Font of Magic",
  line: "Spend a spell slot to gain Sorcery Points equal to its level, up to your maximum.",
  timing: "no-action",
  reason: null,
  pick: {
    kind: "slot",
    options: [
      { level: 1, pact: false, left: 2 },
      { level: 2, pact: false, left: 1 }
    ]
  }
};

const arcaneRecovery: ConversionOffer = {
  id: "arcane-recovery",
  name: "Arcane Recovery",
  line: "When a Short Rest finishes, recover spent spell slots adding up to 2 levels, none of level 6 or higher.",
  timing: "after-short-rest",
  reason: null,
  pick: {
    kind: "recover-slots",
    budget: 2,
    options: [
      { level: 1, spent: 2 },
      { level: 2, spent: 1 }
    ]
  }
};

const mountList = (offers: readonly ConversionOffer[]) => {
  const edit = vi.fn(() => Promise.resolve({ ok: true, line: "Done." }));
  const onFeedback = vi.fn();
  render(
    <ConversionList
      actorId={ACTOR}
      offers={offers}
      busy={false}
      edit={edit as unknown as SheetEdit}
      onFeedback={onFeedback}
    />
  );
  return { edit, onFeedback };
};

describe("the sheet's conversions", () => {
  it("spends the slot picked, and says what the server did", async () => {
    const { edit, onFeedback } = mountList([fontOfMagic]);
    fireEvent.change(screen.getByRole("combobox", { name: "Spell slot Font of Magic spends" }), {
      target: { value: "2:" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Spend" }));
    expect(edit).toHaveBeenLastCalledWith("actor:convert", {
      actorId: ACTOR,
      conversionId: "font-of-magic-points",
      level: 2
    });
    await vi.waitFor(() => expect(onFeedback).toHaveBeenLastCalledWith("Done."));
  });

  it("shows why a conversion can't be used now, with no control", () => {
    mountList([{ ...fontOfMagic, reason: "Sorcery Points are full." }]);
    expect(screen.getByText("Sorcery Points are full.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Spend" })).toBeNull();
  });

  it("recovers slots up to the budget, one stepper per level", () => {
    const { edit } = mountList([arcaneRecovery]);
    const recover = screen.getByRole("button", { name: "Recover" }) as HTMLButtonElement;
    expect(recover.disabled).toBe(true);
    const level1 = within(screen.getByRole("group", { name: "Level 1 slots to recover" }));
    fireEvent.click(level1.getByRole("button", { name: "Increase" }));
    fireEvent.click(level1.getByRole("button", { name: "Increase" }));
    expect(screen.getByText("2 of 2 levels")).toBeTruthy();
    // The budget is spent, so a level 2 slot can't be added.
    const level2 = within(screen.getByRole("group", { name: "Level 2 slots to recover" }));
    expect((level2.getByRole("button", { name: "Increase" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(recover);
    expect(edit).toHaveBeenLastCalledWith("actor:convert", {
      actorId: ACTOR,
      conversionId: "arcane-recovery",
      levels: [1, 1]
    });
  });
});

describe("the step a finished rest opens", () => {
  const resilience: Rechoice = {
    offer: "feature:fiendish-resilience",
    label: "Fiendish Resilience",
    per: "short-rest",
    options: [
      { id: "cold", name: "Cold" },
      { id: "fire", name: "Fire" }
    ],
    chosen: "cold"
  };
  const mastery: Rechoice = {
    ...resilience,
    offer: "feature:weapon-mastery",
    label: "Weapon Mastery",
    per: "long-rest"
  };

  it("after a Short Rest, offers the recoveries and the picks either rest allows, and Done closes it", () => {
    const edit = vi.fn(() => Promise.resolve({ ok: true }));
    render(
      <RestStep
        actorId={ACTOR}
        after="short-rest"
        offers={[arcaneRecovery, fontOfMagic]}
        rechoices={[resilience, mastery]}
        busy={false}
        edit={edit as unknown as SheetEdit}
        onFeedback={() => {}}
      />
    );
    const step = within(screen.getByRole("group", { name: "After the Short Rest" }));
    expect(step.getByText("Arcane Recovery")).toBeTruthy();
    expect(step.queryByText("Font of Magic")).toBeNull();
    expect(step.getByRole("combobox", { name: "Fiendish Resilience" })).toBeTruthy();
    expect(step.queryByRole("combobox", { name: "Weapon Mastery" })).toBeNull();
    fireEvent.change(step.getByRole("combobox", { name: "Fiendish Resilience" }), { target: { value: "fire" } });
    expect(edit).toHaveBeenLastCalledWith("actor:rechoose", {
      actorId: ACTOR,
      offer: "feature:fiendish-resilience",
      id: "fire"
    });
    fireEvent.click(step.getByRole("button", { name: "Done" }));
    expect(edit).toHaveBeenLastCalledWith("character:finish-preparing", { actorId: ACTOR, rest: true });
  });

  it("after a Long Rest, offers the Long Rest picks too", () => {
    render(
      <RestStep
        actorId={ACTOR}
        after="long-rest"
        offers={[arcaneRecovery]}
        rechoices={[resilience, mastery]}
        busy={false}
        edit={vi.fn() as unknown as SheetEdit}
        onFeedback={() => {}}
      />
    );
    const step = within(screen.getByRole("group", { name: "After the Long Rest" }));
    expect(step.getByRole("combobox", { name: "Weapon Mastery" })).toBeTruthy();
    expect(step.queryByText("Arcane Recovery")).toBeNull();
  });

  it("swaps one held Weapon Mastery for another, naming the one it replaces", () => {
    const edit = vi.fn(() => Promise.resolve({ ok: true }));
    const swaps: Rechoice = {
      offer: "feature:weapon-mastery",
      label: "Weapon Mastery",
      per: "long-rest",
      options: [
        { id: "greataxe", name: "Greataxe" },
        { id: "handaxe", name: "Handaxe" },
        { id: "maul", name: "Maul" }
      ],
      chosen: null,
      held: ["greataxe", "handaxe"],
      swaps: 1
    };
    render(
      <RestStep
        actorId={ACTOR}
        after="long-rest"
        offers={[]}
        rechoices={[swaps]}
        busy={false}
        edit={edit as unknown as SheetEdit}
        onFeedback={() => {}}
      />
    );
    const step = within(screen.getByRole("group", { name: "After the Long Rest" }));
    expect(step.getByText("Change one after a Long Rest.")).toBeTruthy();
    const greataxe = step.getByRole("combobox", { name: "Weapon Mastery: Greataxe" });
    // The other held answer is no option to swap in.
    expect(within(greataxe).queryByRole("option", { name: "Handaxe" })).toBeNull();
    fireEvent.change(greataxe, { target: { value: "maul" } });
    expect(edit).toHaveBeenLastCalledWith("actor:rechoose", {
      actorId: ACTOR,
      offer: "feature:weapon-mastery",
      id: "maul",
      replacing: "greataxe"
    });
  });
});
