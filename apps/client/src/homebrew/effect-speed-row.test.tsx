/**
 * **U18's control half — the runtime `speed` row inside `effectModifiersField`.**
 *
 * The unit's whole point is that the schema member and this row are not enough on their own: an
 * effect modifier the engine never reads is authored, validated, stored, projected, and inert. So
 * this file proves only the client half — that the row exists, writes the shape
 * `EffectModifierSchema` accepts, and tells the truth about the one carrier that does not read it —
 * while the far end (the feet in the movement refusal) is proved server-side in
 * `apps/server/test/combat-rules-regression.test.ts` and `apps/server/test/feat-riders.test.ts`.
 *
 * **The row is in `effectModifiersField`, not `modifiersField`, and that is the ruling.** The record's
 * own modifier list already carries a `speed` variant — the BUILD-TIME one, baked into the sheet's
 * `speedFeet` — and mounting that list inside an effect would have offered eighteen variants an
 * effect cannot hold. The two rows look alike on purpose: same ±30/60 ft bounds, same units, because
 * the same GM authors both and a control whose bounds differ from the store's is a refusal that
 * arrives after they moved on.
 *
 * **SCOPE IS THE THIRD THING**, exactly as it is for `unarmored-defense.allowShield` one level up. An
 * ITEM's effect never becomes a live `actor.effects` entry: `takeEffects` turns its modifiers into
 * standing riders and `asRiderModifiers` hands `speed` to `EquipmentDerivation.speed`, which nothing
 * in production reads. The row is offered there WITH that named absence printed beside it rather than
 * silently withheld — and both scopes are mounted below, because a claim made from one scope about
 * the whole form is how the note regressed the last time.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RiderEditor } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft } from "./schema";

type Row = Record<string, unknown>;

/** One authored effect whose single modifier is the row under test. */
const withModifier = (modifier: Row): Draft => ({
  effects: [{
    rowId: "e1", name: "Striding", tags: ["striding"], duration: { type: "encounter" },
    modifiers: [{ rowId: "m1", ...modifier }], onEnd: []
  }]
}) as unknown as Draft;

function mount(scope: "feature" | "item", value: Draft) {
  let latest: Draft = value;
  function Riders() {
    const [draft, setDraft] = useState<Draft>(latest);
    return (
      <RiderEditor
        value={draft}
        onChange={(next) => { setDraft(next); latest = next; }}
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
    /** Both rows are collapsible, and the modifier row lives inside the effect row — the same two taps a GM makes. */
    openBoth: async (modifierRow: RegExp) => { await open(/Striding/); await open(modifierRow); },
    amount: () => within(view.container).getByRole("textbox", { name: "Amount" }),
    kind: () => within(view.container).getByRole("combobox", { name: "What it does" }),
    /** Every interactive target on the form — the set a 375px tap audit walks. */
    controls: () => view.container.querySelectorAll("button, input, select, textarea, [role='switch']").length,
    stored: () => ((latest as unknown as { effects: Array<{ modifiers: Row[] }> }).effects[0].modifiers[0])
  };
}

describe("the runtime speed effect-modifier row", () => {
  it("is offered in the EFFECT vocabulary and mints the shape the schema accepts", async () => {
    // Start on the default row the field mints, then switch variant the way the select does: the union
    // is `.strict()`, so the write must REPLACE the row rather than merge a `roll`/`mode` into it.
    const form = mount("feature", withModifier({ type: "roll-mode", roll: "attack", mode: "advantage" }));
    await form.openBoth(/Advantage on attack/);
    await userEvent.selectOptions(form.kind(), "speed");
    expect(form.stored()).toEqual({ rowId: "m1", type: "speed", amount: 10 });
  });

  it("carries the same ±30/60 ft bounds the build-time speed rider declares", async () => {
    const form = mount("feature", withModifier({ type: "speed", amount: 10 }));
    await form.openBoth(/Speed \+10 ft/);
    expect((form.amount() as HTMLInputElement).value).toBe("10");

    // NumberField clamps on BLUR, so this is the real bound rather than an attribute nobody enforces.
    await userEvent.clear(form.amount());
    await userEvent.type(form.amount(), "99");
    await userEvent.tab();
    expect(form.stored().amount).toBe(60);

    // Signed, which is the whole of `slow`: one row says Longstrider and the mastery alike.
    await userEvent.clear(form.amount());
    await userEvent.type(form.amount(), "-99");
    await userEvent.tab();
    expect(form.stored().amount).toBe(-30);
  });

  /**
   * The named absence, made visible where the GM types the number. Measured server-side: an item's
   * effect modifiers become standing RIDERS, and `EquipmentDerivation.speed` — the field a `speed`
   * rider lands in — is summed and read by nothing, so the feet never move on that carrier.
   */
  it("names the absence on an item, and stays silent on a feature where the reader is real", async () => {
    const item = mount("item", withModifier({ type: "speed", amount: 10 }));
    await item.openBoth(/Speed \+10 ft/);
    expect(item.amount()).toBeTruthy();
    expect(item.container.textContent).toContain("Not read on an item");
    // The help is not replaced by the note — what the number MEANS is true wherever it is authored.
    expect(item.container.textContent).toContain("given back when it ends");

    const feature = mount("feature", withModifier({ type: "speed", amount: 10 }));
    await feature.openBoth(/Speed \+10 ft/);
    expect(feature.container.textContent).not.toContain("Not read on an item");

    // MOBILE PARITY, measured rather than argued: the note is prose in the field's help slot, so it
    // adds no tap target. A 375px tap audit walks exactly this set and a text node cannot enter it.
    expect(item.controls()).toBe(feature.controls());
    expect(item.controls()).toBe(24); // measured, so a form that rendered nothing cannot pass the line above
  });
});
