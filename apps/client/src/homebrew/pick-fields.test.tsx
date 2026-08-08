/**
 * **`pick`: an open slug that a GM can SEE the list of — the client's issue `3a`.**
 *
 * The reported defect was "item rarity is free-form". The diagnosis it deserved is narrower and
 * changes the fix: rarity was never free-form. `schemas.ts` has declared `suggestions: RARITY_IDS`
 * for as long as the field has existed, and `vocabularies.test.ts` already proved the list was
 * complete. What it did not prove — because no assertion in this repo could — is that the list was
 * *reachable*. `kind: "text"` + `suggestions` renders `<input list>` + `<datalist>`, which has no
 * arrow, no border cue and no hint of any kind that a list exists, and which iOS Safari renders as
 * **nothing at all**. A complete vocabulary, shipped invisible.
 *
 * So `pick` is a renderer flag (`schema.ts`'s standing rule: a flag before a `kind`), and these are
 * its far ends. Not "the flag is set" and not "the value survived derivation" — the assertions below
 * are **what a GM sees on the screen** and **what lands in the body that gets published**:
 *
 *   - every rung is rendered, by its printed name, without typing anything;
 *   - picking "Very Rare" writes the slug `"very-rare"`;
 *   - typing "unique" writes `"unique"` — the open slug is still open, which is the half
 *     `vocabularies.test.ts` deliberately pins and a closed `<select>` would have broken;
 *   - clearing removes the key rather than writing `null`, because `rarity` is `.optional()` and
 *     `null` is the 409 that made four ordinary authoring gestures unpublishable.
 *
 * **What these tests CANNOT prove**, per `test/setup.ts`: the 44px touch floor. No stylesheet is
 * loaded in jsdom, so `min-height: var(--tap-min)` on `.nh-combobox-option` is real paint that
 * nothing here measures. That floor is `Combobox.css` route 1 and `scripts/tap-audit.mjs`'s job.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RARITY_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { forStorage } from "./defaults";
import { SchemaForm } from "./SchemaForm";
import { SCHEMAS } from "./schemas";
import { EMPTY_CONTEXT, pickValue, suggestionLabel, type Draft } from "./schema";

/** The real form, driven the way `RecordDetail` drives it: one draft, one `onDraft`. */
function ItemForm({ onBody }: { onBody: (body: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>({ name: "Mace of Storms", isMagic: true });
  return (
    <SchemaForm
      schema={SCHEMAS.equipment}
      draft={draft}
      onDraft={(next) => { setDraft(next); onBody(next); }}
      ctx={EMPTY_CONTEXT}
    />
  );
}

/** The last body the form wrote, through the save path's own shaping — what would be PUT. */
function mount() {
  let body: Draft = {};
  render(<ItemForm onBody={(next) => { body = next; }} />);
  return {
    rarity: () => screen.getByRole("combobox", { name: "Rarity" }),
    /** Scoped to the chooser's OWN listbox: the equipment form has real `<select>`s in it, so a
        bare `getAllByRole("option")` counts the slot list and the weapon categories too. */
    rungs: () => within(screen.getByRole("listbox", { name: "Rarity" })).getAllByRole("option"),
    // `forStorage` is what `useAutosave` sends, and it is where `emptyValue: "omit"` actually takes
    // effect (`setAt` writes `undefined`; this drops the key). Asserting the raw draft instead would
    // be the "it survived derivation" non-proof.
    body: () => forStorage(body)
  };
}

describe("3a — the rarity control is a visible chooser that still takes a word of the GM's own", () => {
  it("shows all seven rungs by their printed names, before anything is typed", async () => {
    const user = userEvent.setup();
    const form = mount();

    // The bug, stated as an assertion: with a `<datalist>` there is no `combobox` role, no listbox,
    // and nothing on screen reads "Very Rare" until the GM has already guessed the word.
    await user.click(form.rarity());
    const shown = form.rungs().map((option) => option.textContent);
    expect(shown).toEqual(["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact", "Varies"]);
    // ...and the names are the LIST's, derived rather than retyped, so a new rung reads correctly
    // the day it lands in `RARITY_IDS` with nothing to remember.
    expect(shown).toEqual(RARITY_IDS.map(suggestionLabel));
  });

  it("picking “Very Rare” writes the slug, and shows the name back", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.rarity());
    await user.click(screen.getByRole("option", { name: "Very Rare" }));

    // THE FAR END: the body that gets published carries the slug the engine and the bundle spell.
    expect(form.body().rarity).toBe("very-rare");
    // ...and the GM reads the printed name back, not the slug — the chip, where the box used to be.
    expect(screen.getByText("Very Rare")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Rarity" })).toBeNull();
  });

  it("typing “unique” writes “unique” — the open slug stays open", async () => {
    const user = userEvent.setup();
    const form = mount();

    // The reason `vocabularies.test.ts` pins `equipment.rarity` to `kind: "text"`: closing the enum
    // would have been the inverse bug. A GM's own rung has to survive the fix that makes the six
    // printed ones visible.
    await user.type(form.rarity(), "unique{Enter}");

    expect(form.body().rarity).toBe("unique");
    expect(screen.getByText("unique")).toBeInTheDocument();
  });

  it("typing “unique” and moving to the next field keeps it — Enter is not the only way out", async () => {
    const user = userEvent.setup();
    const form = mount();

    // Measured in a real browser at 375px before this was fixed: typed text was discarded on blur,
    // so a GM who typed a custom rung and tapped the next field kept nothing, with no error. That
    // is a regression the `<input>` this replaced did not have, and it would have made "still
    // accepts a custom value" true only for people who press Enter.
    await user.type(form.rarity(), "unique");
    await user.click(screen.getByLabelText("Name"));

    expect(form.body().rarity).toBe("unique");
  });

  it("typing a rung by its printed name lands on the rung, not beside it", async () => {
    const user = userEvent.setup();
    const form = mount();

    // "Very Rare" typed rather than picked used to produce exactly that string, which
    // `ContentIdSchema` (/^[a-z0-9-]+$/) refuses — an unpublishable record from a gesture that looks
    // right on screen. `pickValue` makes the typed case the same shape as the picked one.
    await user.type(form.rarity(), "Very Rare{Enter}");

    expect(form.body().rarity).toBe("very-rare");
    expect(pickValue("Very Rare")).toBe("very-rare");
  });

  it("clearing it REMOVES the key, rather than writing null into an optional column", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.rarity());
    await user.click(screen.getByRole("option", { name: "Legendary" }));
    expect(form.body().rarity).toBe("legendary");

    await user.click(screen.getByRole("button", { name: "Clear Legendary" }));

    // `emptyValue: "omit"` — the key goes away. `null` here is the 409 reading "Required" that named
    // nothing, which is the whole of `FieldDef.emptyValue`.
    expect("rarity" in form.body()).toBe(false);
    expect(form.rarity()).toBeInTheDocument();
  });
});
