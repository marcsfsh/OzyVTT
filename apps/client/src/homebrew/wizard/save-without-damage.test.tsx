import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Draft } from "../schema";
import { MonsterActions } from "./MonsterActions";
import { placeIssues } from "./issues";
import { actionsOf, partsOf, saveText } from "./monster-actions";
import { MONSTER_WIZARD } from "./monster";
import { wizardSteps } from "./steps";

const undertow = {
  id: "action-undertow",
  name: "Undertow",
  activation: "other",
  legendary: { cost: 1 },
  description: "",
  save: { ability: "str", dc: 15, successDamage: "half", failureConditions: ["prone"] },
  damage: [{ formula: "2d6", type: "fire" }]
};

function Harness({ onDraft }: Readonly<{ onDraft: (draft: Draft) => void }>) {
  const [draft, setDraft] = useState<Draft>({ name: "Drowned Abbess", actions: [undertow] });
  return (
    <MonsterActions
      draft={draft}
      activation="legendary"
      idPrefix="test"
      onDraft={(next) => {
        setDraft(next);
        onDraft(next);
      }}
    />
  );
}

describe("a saving throw with no damage", () => {
  it("drops a damage row whose dice are cleared, and prints no damage", async () => {
    const user = userEvent.setup();
    let last: Draft = {};
    render(<Harness onDraft={(draft) => (last = draft)} />);
    await user.click(screen.getByRole("button", { name: /Undertow/ }));
    const dice = screen.getByLabelText("Dice");
    await user.clear(dice);
    // The row stays to be typed into, and the record holds no part without dice.
    expect(screen.getByLabelText("Dice")).toHaveValue("");
    const action = actionsOf(last)[0]!;
    expect(action.damage).toEqual([]);
    const text = saveText(action, "drowned abbess");
    expect(text).not.toContain("()");
    expect(text).not.toContain("Success");
    expect(text).toContain("Failure: The target has the Prone condition.");
  });

  it("reads a stored part with blank dice as no damage", () => {
    const stored = { ...undertow, damage: [{ formula: " ", type: "fire" }] };
    expect(partsOf(stored)).toEqual([]);
    expect(saveText(stored, "drowned abbess")).not.toContain("()");
  });

  it("places a legendary action's problem on Legendary Actions", () => {
    const draft: Draft = {
      name: "Drowned Abbess",
      actions: [{ ...undertow, id: "a", legendary: undefined }, undertow]
    };
    const steps = wizardSteps(MONSTER_WIZARD, draft);
    const [placed] = placeIssues(
      steps,
      [
        {
          text: "Fill in the dice for Undertow, or remove that damage row.",
          path: "actions.damage.formula",
          segments: ["actions", 1, "damage", 0, "formula"]
        }
      ],
      draft
    );
    expect(placed!.stepId).toBe("legendary");
  });
});
