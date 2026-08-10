/**
 * **An inline option's row writes what its controls write — including a REMOVAL.**
 *
 * `choice.options` is the one `rows` field in the editor that `FieldRenderer`'s own rows branch
 * cannot draw: an option mounts `RiderEditor`, and a row-scoped `custom` field is handed the whole
 * RECORD and the record's setter rather than its row, so `FeatureEditor` draws the list by hand from
 * the field's declared shape. That split is deliberate and it has one hazard, which is what this
 * file guards: the hand-written half owns the write-back, so it can disagree with the renderer about
 * what a write MEANS.
 *
 * It did. The row's setter merged (`{...entry, ...next}`) where the renderer replaces
 * (`copy[index] = nextRow`), and both of its callers hand over a whole option — a `FieldDef.write`
 * returns its container and `RiderEditor` writes whole-body. A merge restores every key the write
 * deleted, so an option-row control could add a value and change a value and never take one away.
 *
 * Nothing noticed until U16, because `requires` is the first control on that row whose own ruling is
 * a removal: `requires` is `.optional()`, so clearing both boxes has to drop the clause rather than
 * leave `{}` behind and refuse the record at publish for a question the GM had just answered "no"
 * to. `applyField` — which calls the field's `write` directly — did exactly that, while the rendered
 * form silently put the clause back. The unit suite could not see the difference because it drives
 * the field and not the form, which is why this test drives the FORM.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { blankDraft, forStorage } from "./defaults";
import { FeatureEditor } from "./FeatureEditor";
import { SchemaForm } from "./SchemaForm";
import { SCHEMAS } from "./schemas";
import { EMPTY_CONTEXT, type Draft } from "./schema";

/** A feat whose one feature offers two inline options, the first of them gated. A feat because it
    stores ONE `FeatureRecord` under a singular key, so the panel renders bare — no list chrome, no
    level chips, and nothing between the test and the option row. */
const GATED_FEAT: Draft = {
  ...blankDraft("feat"),
  name: "Echoed Ward",
  category: "origin",
  summary: "A ward decided by an earlier answer.",
  description: "The echo you were born under wards you.",
  feature: {
    id: "echoed-ward",
    name: "Echoed Ward",
    description: "The echo you were born under wards you.",
    choice: {
      kind: "echo-ward",
      choose: 1,
      repeatable: false,
      options: [
        {
          id: "ember-ward",
          name: "Ember Ward",
          description: "Resistance to Fire damage.",
          requires: { offer: "feature:echoed-ward", id: "emberborn" }
        }
      ]
    }
  }
};

/** The real form, driven the way `RecordDetail` drives it: one draft, one `onDraft`, and the same
    `custom` map — `features` is a `custom` field, so without its renderer the section draws empty. */
function RecordForm({ seed, onBody }: { seed: Draft; onBody: (body: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(seed);
  const write = (next: Draft) => { setDraft(next); onBody(next); };
  return (
    <SchemaForm
      schema={SCHEMAS.feat}
      draft={draft}
      onDraft={write}
      ctx={EMPTY_CONTEXT}
      custom={{
        features: ({ field }) => (
          <FeatureEditor draft={draft} onDraft={write} ctx={EMPTY_CONTEXT} featuresKey={field.key} single idPrefix="hb-feat" />
        )
      }}
    />
  );
}

async function mount(seed: Draft = GATED_FEAT) {
  let body: Draft = seed;
  render(<RecordForm seed={seed} onBody={(next) => { body = next; }} />);
  // The option list is `collapsible`, so a stored row renders closed. Open it the way a GM does.
  const toggle = screen.getByRole("button", { name: /Ember Ward/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await userEvent.setup().click(toggle);
  return {
    /** The EMPTY state of a `pick` box — `Combobox` swaps its input for a chip the moment it holds
        a value, so this is only queryable while the half it names is unset. (Both gate boxes were
        `<input list>` until the six offer boxes became `pick`s; a datalist is also a `combobox` to
        the accessibility tree, which is why the role did not have to change and the chip did.) */
    box: (name: string) => screen.getByRole("combobox", { name }) as HTMLInputElement,
    /** What the GM READS back — the chosen slug as its printed name, or the words they typed. */
    chip: (label: string) => screen.getByText(label),
    /** The chip's own X. `Clear <label>` is `Combobox`'s wording, so this is the real gesture. */
    clear: (label: string) => screen.getByRole("button", { name: `Clear ${label}` }),
    /** The body `useAutosave` would send — where `undefined` is dropped and a surviving `{}` is not. */
    option: () => {
      const stored = forStorage(body) as { feature?: { choice?: { options?: Array<Record<string, unknown>> } } };
      return stored.feature?.choice?.options?.[0] ?? {};
    }
  };
}

describe("an inline option's gate can be cleared, not only set", () => {
  it("renders the stored clause in its own two boxes", async () => {
    const form = await mount();
    // The stored halves read back as PRINTED NAMES now, not as slugs in a bare box: the offer is one
    // of this record's own features so it resolves to an option and reads "Feature: Echoed Ward";
    // the answer names an option id the record has not authored, so it stands as the GM wrote it.
    expect(form.chip("Feature: Echoed Ward")).toBeInTheDocument();
    expect(form.chip("emberborn")).toBeInTheDocument();
    // Reading must not write: the body is still the record that was seeded.
    expect(form.option().requires).toEqual({ offer: "feature:echoed-ward", id: "emberborn" });
  });

  it("THE LOOP: clear one half and the other stands; clear both and the clause is GONE", async () => {
    const user = userEvent.setup();
    const form = await mount();

    await user.click(form.clear("Feature: Echoed Ward"));
    // Half-cleared is still a clause — the publish checklist names the empty half, which is the
    // honest state for "I have started saying this and not finished".
    expect(form.option().requires).toEqual({ id: "emberborn" });

    await user.click(form.clear("emberborn"));
    // THE FAR END, and the thing the merge undid: no key at all, not `{}`. A surviving empty object
    // is `.strict()`-legal shape with two `Required` issues under the Publish button, for a gate the
    // GM has just removed.
    expect(Object.keys(form.option()), "the cleared clause must not survive as an empty object").not.toContain("requires");
    expect(form.option()).toMatchObject({ id: "ember-ward", name: "Ember Ward" });

    // ...and the boxes are still where they were, so re-typing the gate is one tap and not a hunt.
    expect(form.box("Which pick").value).toBe("");
    expect(form.box("Which answer").value).toBe("");
  });

  it("a gate typed from nothing lands whole, so the row can add as well as remove", async () => {
    const user = userEvent.setup();
    const seed = JSON.parse(JSON.stringify(GATED_FEAT)) as typeof GATED_FEAT;
    delete ((seed.feature as Record<string, unknown>).choice as { options: Array<Record<string, unknown>> }).options[0].requires;
    const form = await mount(seed);
    expect(Object.keys(form.option())).not.toContain("requires");

    await user.type(form.box("Which pick"), "feature:echoed-ward{Enter}");
    await user.type(form.box("Which answer"), "frostborn{Enter}");
    expect(form.option().requires).toEqual({ offer: "feature:echoed-ward", id: "frostborn" });
  });

  it("THE GATE IS PICKED, not spelled — the half a datalist could not do on a phone", async () => {
    const user = userEvent.setup();
    const seed = JSON.parse(JSON.stringify(GATED_FEAT)) as typeof GATED_FEAT;
    delete ((seed.feature as Record<string, unknown>).choice as { options: Array<Record<string, unknown>> }).options[0].requires;
    const form = await mount(seed);

    // OPEN it — the gesture `<input list>` has no answer to on iOS Safari, where the control is not
    // rendered at all. A `listbox` existing at all is the whole fix.
    await user.click(form.box("Which pick"));
    const offered = within(screen.getByRole("listbox", { name: "Which pick" })).getAllByRole("option").map((option) => option.textContent);
    // The eight named budgets by their printed names, plus this record's own feature — the open
    // ninth form, read with the colon as a separator rather than as a letter.
    expect(offered).toEqual([
      "Class Skills", "Class Tools", "Background Skills", "Background Tools",
      "Background Languages", "Species Languages", "Class Cantrips", "Class Spells",
      "Feature: Echoed Ward"
    ]);

    await user.click(screen.getByRole("option", { name: "Feature: Echoed Ward" }));
    // THE FAR END, and the round trip the colon has to survive: the label is words, the value is
    // the slug the server's `PickBudgetKeySchema` takes.
    expect(form.option().requires).toEqual({ offer: "feature:echoed-ward" });
    expect(form.chip("Feature: Echoed Ward")).toBeInTheDocument();
  });

  it("the answer half offers the ids the record really declares", async () => {
    const user = userEvent.setup();
    const seed = JSON.parse(JSON.stringify(GATED_FEAT)) as typeof GATED_FEAT;
    delete ((seed.feature as Record<string, unknown>).choice as { options: Array<Record<string, unknown>> }).options[0].requires;
    const form = await mount(seed);

    await user.click(form.box("Which answer"));
    // `optionIdsOf` — the answers any pick on THIS record could hold. One option is authored, so
    // one is offered, and the gate can be built without knowing how the id was spelled.
    expect(within(screen.getByRole("listbox", { name: "Which answer" })).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Ember Ward"]);

    await user.click(screen.getByRole("option", { name: "Ember Ward" }));
    expect(form.option().requires).toEqual({ id: "ember-ward" });
  });
});
