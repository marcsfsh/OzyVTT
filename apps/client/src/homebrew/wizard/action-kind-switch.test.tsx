import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Draft } from "../schema";
import { MonsterActions } from "./MonsterActions";
import { actionsOf } from "./monster-actions";

const toll = {
  id: "action-toll",
  name: "Toll of the Deep Bell",
  activation: "action",
  description:
    "Wisdom Saving Throw: DC 15, each creature in a 30-foot Emanation. Failure: 27 (6d8) Psychic damage. Success: Half damage.",
  save: { ability: "wis", dc: 15, successDamage: "half", failureConditions: ["frightened"] },
  area: { shape: "emanation", sizeFeet: 30, widthFeet: null },
  damage: [{ formula: "6d8", type: "psychic" }]
};

function Harness({ onDraft }: Readonly<{ onDraft: (draft: Draft) => void }>) {
  const [draft, setDraft] = useState<Draft>({
    name: "Drowned Abbess",
    abilityScores: { str: 18, dex: 14, con: 16, int: 13, wis: 17, cha: 18 },
    actions: [toll]
  });
  return (
    <MonsterActions
      draft={draft}
      activation="action"
      idPrefix="test"
      onDraft={(next) => {
        setDraft(next);
        onDraft(next);
      }}
    />
  );
}

describe("changing an action's kind", () => {
  it("asks first, and a change back brings every answer back", async () => {
    const user = userEvent.setup();
    let last: Draft = {};
    render(<Harness onDraft={(draft) => (last = draft)} />);
    await user.click(screen.getByRole("button", { name: /Toll of the Deep Bell/ }));
    const kind = screen.getByRole("group", { name: "Kind" });

    await user.click(within(kind).getByRole("button", { name: "Attack" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Its saving throw answers are kept while this monster is open.");
    await user.click(within(dialog).getByRole("button", { name: "Make it an attack" }));
    expect(actionsOf(last)[0]!.attack).toBeDefined();
    expect(actionsOf(last)[0]!.save).toBeUndefined();

    await user.click(within(screen.getByRole("group", { name: "Kind" })).getByRole("button", { name: "Saving throw" }));
    const back = screen.queryByRole("dialog");
    if (back) await user.click(within(back).getByRole("button", { name: /Make it/ }));
    const restored = actionsOf(last)[0]!;
    expect(restored.save).toEqual(toll.save);
    expect(restored.area).toEqual(toll.area);
    expect(restored.damage).toEqual(toll.damage);
    expect(restored.description).toBe(toll.description);
    expect(restored.attack).toBeUndefined();
  });

  it("leaves the action as it was when the GM cancels", async () => {
    const user = userEvent.setup();
    let last: Draft | null = null;
    render(<Harness onDraft={(draft) => (last = draft)} />);
    await user.click(screen.getByRole("button", { name: /Toll of the Deep Bell/ }));
    await user.click(within(screen.getByRole("group", { name: "Kind" })).getByRole("button", { name: "Attack" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(last).toBeNull();
  });
});
