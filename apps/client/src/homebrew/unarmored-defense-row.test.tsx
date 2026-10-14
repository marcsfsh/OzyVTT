/**
 * **U28's control half — `unarmored-defense.allowShield`.**
 *
 * The row shipped with the honesty note `"Not read yet."`, which was true: `character-build.ts`
 * stored the flag and the armour-class fold read only `.ability`, so a GM could author "a shield
 * still counts" and the engine would ignore it. U28 landed the reader, and the note had to go in the
 * same commit — a stale honesty note is a lie pointing the other way, and it is worse than the
 * original gap because it tells a GM their working control does nothing.
 *
 * Two things are asserted, and the pair is the point: the note is GONE, and the switch still writes
 * the key the server now reads. Deleting the note alone would prove nothing about the control, and
 * these tests are the only place the client half is held to it.
 *
 * SCOPE IS THE THIRD THING. The row is offered on an ITEM too - `EquipmentReferenceSchema` accepts
 * `unarmored-defense`, so only `ability-score` and `hit-points-per-level` are withdrawn there - and
 * on that carrier nothing reads it: the rider is baked from a feature or a feat at build time and
 * `deriveEquipment` sums no such rider off an inventory row. Deleting the note for EVERY scope
 * turned an accidentally-true caveat into an affirmative promise at item scope, so the note is back
 * where it is still true. Both scopes are mounted below, because a claim made from one scope about
 * the whole form is exactly how that regression got in.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RiderEditor } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft } from "./schema";

/** One authored Unarmored Defense rider, in the shape `FeatureModifierSchema` accepts. */
const body = (allowShield: boolean): Draft => ({
  modifiers: [{ rowId: "row-1", type: "unarmored-defense", ability: "con", allowShield }]
}) as unknown as Draft;

function mount(allowShield: boolean, scope: "feature" | "item" = "feature") {
  let latest: Draft = body(allowShield);
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
  return {
    container: view.container,
    /** A modifier row with more than two fields is COLLAPSIBLE, so the row body has to be opened
     *  before any of it is in the accessibility tree - the same tap a GM makes. */
    open: () => userEvent.click(within(view.container).getByRole("button", { expanded: false, name: /Unarmoured defence/ })),
    shieldSwitch: () => within(view.container).getByRole("switch", { name: "A shield still counts" }),
    /** Every interactive target on the form - the count a 375px tap audit walks. */
    controls: () => view.container.querySelectorAll("button, input, select, textarea, [role='switch']").length,
    stored: () => (latest as unknown as { modifiers: Array<Record<string, unknown>> }).modifiers[0]
  };
}

describe("the unarmored-defense rider row", () => {
  it("no longer carries the 'Not read yet.' note", async () => {
    const form = mount(true);
    await form.open();
    // The switch is on screen, so the absence below is a real absence and not a row that failed to
    // render - the note text is checked against the WHOLE form, since `note` rides in the help slot.
    expect(form.shieldSwitch()).toBeTruthy();
    expect(form.container.textContent).not.toContain("Not read yet");
    // Nor the ITEM-scope note below: on a feature the reader is real, so no caveat of any kind.
    expect(form.container.textContent).not.toContain("Not read on an item");
  });

  /**
   * The same row on an ITEM, where the reader does not exist. The help stays - it is the right
   * sentence about what the flag MEANS - and the absence is named beside it, so a GM authoring
   * "Bracers of Defense" is told the item will not move their armour class before they publish it
   * rather than after the number fails to change. Measured server-side: an item carrying this rider
   * moves AC by 0 in either switch position, where an `armor-class: +1` on the same item moves it by 1.
   */
  it("names the absence on an item, where nothing reads the rider", async () => {
    const form = mount(true, "item");
    await form.open();
    expect(form.shieldSwitch()).toBeTruthy();
    expect(form.container.textContent).toContain("Not read on an item");
    // The help is not replaced by the note - `FieldRenderer` composes them, and the meaning of the
    // flag is true wherever it is authored. Only the promise that something acts on it is scoped.
    expect(form.container.textContent).toContain("On is the Barbarian's rule");

    // MOBILE PARITY, measured rather than argued: the note is prose in the field's own help slot
    // (`<em class="hb-note">`, styled with colour and italics only), so it adds no tap target. Both
    // scopes are counted and the item form must not have gained one - a 375px tap audit walks
    // exactly this set, and a text node cannot enter it.
    const feature = mount(true, "feature");
    await feature.open();
    expect(form.controls()).toBe(feature.controls());
    expect(form.controls()).toBe(16); // measured, so a form that rendered nothing cannot pass the line above
  });

  it("writes the flag the engine reads", async () => {
    const form = mount(true);
    await form.open();
    expect(form.shieldSwitch().getAttribute("aria-checked")).toBe("true");
    await userEvent.click(form.shieldSwitch());
    // The Monk's answer, authored by hand: off means a shield replaces the defence, which is the
    // number `unarmored-defense-shield.test.ts` measures on the server side.
    expect(form.stored().allowShield).toBe(false);
    expect(form.shieldSwitch().getAttribute("aria-checked")).toBe("false");
  });
});
