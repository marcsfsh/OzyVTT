/**
 * The runtime `speed` row in `effectModifiersField` (distinct from the build-time `speed` modifier,
 * with the same ±30/60 ft bounds). Client half only: the row exists, writes the shape
 * `EffectModifierSchema` accepts, and on an item (where effects become standing riders whose speed
 * nothing reads) shows a note. The movement far end is tested server-side in
 * `apps/server/test/combat-rules-regression.test.ts` and `apps/server/test/feat-riders.test.ts`.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RiderEditor } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft } from "./schema";

type Row = Record<string, unknown>;

/** One authored effect whose single modifier is the row under test. */
const withModifier = (modifier: Row): Draft =>
  ({
    effects: [
      {
        rowId: "e1",
        name: "Striding",
        tags: ["striding"],
        duration: { type: "encounter" },
        modifiers: [{ rowId: "m1", ...modifier }],
        onEnd: []
      }
    ]
  }) as unknown as Draft;

function mount(scope: "feature" | "item", value: Draft) {
  let latest: Draft = value;
  function Riders() {
    const [draft, setDraft] = useState<Draft>(latest);
    return (
      <RiderEditor
        value={draft}
        onChange={(next) => {
          setDraft(next);
          latest = next;
        }}
        enabled={["modifiers", "uses", "tags", "actions", "effects"]}
        scope={scope}
        ctx={EMPTY_CONTEXT}
        idPrefix={`hb-${scope}`}
      />
    );
  }
  const view = render(<Riders />);
  const open = async (name: RegExp) =>
    userEvent.click(within(view.container).getByRole("button", { expanded: false, name }));
  return {
    container: view.container,
    /** The modifier row sits inside the collapsible effect row, so open both. */
    openBoth: async (modifierRow: RegExp) => {
      await open(/Striding/);
      await open(modifierRow);
    },
    amount: () => within(view.container).getByRole("textbox", { name: "Amount" }),
    kind: () => within(view.container).getByRole("combobox", { name: "What it does" }),
    /** Every interactive target on the form (what a 375px tap audit walks). */
    controls: () => view.container.querySelectorAll("button, input, select, textarea, [role='switch']").length,
    stored: () => (latest as unknown as { effects: Array<{ modifiers: Row[] }> }).effects[0].modifiers[0]
  };
}

describe("the runtime speed effect-modifier row", () => {
  it("is offered in the EFFECT vocabulary and mints the shape the schema accepts", async () => {
    // Switching variant must replace the row (the union is `.strict()`), not merge `roll`/`mode` into it.
    const form = mount("feature", withModifier({ type: "roll-mode", roll: "attack", mode: "advantage" }));
    await form.openBoth(/Advantage on attack/);
    await userEvent.selectOptions(form.kind(), "speed");
    expect(form.stored()).toEqual({ rowId: "m1", type: "speed", amount: 10 });
  });

  it("carries the same ±30/60 ft bounds the build-time speed rider declares", async () => {
    const form = mount("feature", withModifier({ type: "speed", amount: 10 }));
    await form.openBoth(/Speed \+10 ft/);
    expect((form.amount() as HTMLInputElement).value).toBe("10");

    // NumberField clamps on blur, so this is the enforced bound.
    await userEvent.clear(form.amount());
    await userEvent.type(form.amount(), "99");
    await userEvent.tab();
    expect(form.stored().amount).toBe(60);

    // Signed: one row covers Longstrider and the `slow` mastery.
    await userEvent.clear(form.amount());
    await userEvent.type(form.amount(), "-99");
    await userEvent.tab();
    expect(form.stored().amount).toBe(-30);
  });

  /** On an item the speed rider lands in `EquipmentDerivation.speed`, which nothing reads, so the note
      appears there. */
  it("names the absence on an item, and stays silent on a feature where the reader is real", async () => {
    const item = mount("item", withModifier({ type: "speed", amount: 10 }));
    await item.openBoth(/Speed \+10 ft/);
    expect(item.amount()).toBeTruthy();
    expect(item.container.textContent).toContain("Not read on an item");
    // The note supplements the help; it doesn't replace it.
    expect(item.container.textContent).toContain("given back when it ends");

    const feature = mount("feature", withModifier({ type: "speed", amount: 10 }));
    await feature.openBoth(/Speed \+10 ft/);
    expect(feature.container.textContent).not.toContain("Not read on an item");

    // The note is prose in the help slot, so it adds no tap target.
    expect(item.controls()).toBe(feature.controls());
    expect(item.controls()).toBe(24); // a fixed count, so an empty render cannot pass the line above
  });
});
