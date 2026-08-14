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

function mount(allowShield: boolean) {
  let latest: Draft = body(allowShield);
  function Riders() {
    const [draft, setDraft] = useState<Draft>(latest);
    return (
      <RiderEditor
        value={draft}
        onChange={(next) => { setDraft(next); latest = next; }}
        enabled={["modifiers", "uses", "tags", "actions", "effects"]}
        scope="feature"
        ctx={EMPTY_CONTEXT}
        idPrefix="hb-feature"
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
