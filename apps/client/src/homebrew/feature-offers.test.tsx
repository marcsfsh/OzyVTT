/**
 * **The feature panel's six offer boxes are CHOOSERS — the Wave-2 back-fill's one user-visible hole.**
 *
 * `3a` and `3d` gave `pick` to rarity and to the thirteen damage types, and `pick-fields.test.tsx`
 * holds their far ends. Six boxes on the richest authoring surface in the app were left behind:
 * `choice.kind`, `extraPicks[].offer`, `replaces[].offer`, `fromPicks.offer`, `requires.offer` and
 * `requires.id`. Each declared a complete list and rendered it into an `<input list>` + `<datalist>`
 * — no arrow, no border cue, nothing on screen saying a list exists, and **on iOS Safari no control
 * at all**. A phone is first-class here (CLAUDE.md rule 5), so a vocabulary a phone cannot open is
 * a vocabulary that does not ship.
 *
 * The gate pair lives in `option-row.test.tsx`, which already drives an inline option row. This file
 * holds the other four, and one thing neither of the earlier `pick` units could have found:
 *
 * **A pick budget is `<namespace>:<slug>`, and the colon is a separator.** `suggestionLabel`
 * title-cased on hyphens only, so `feature:divine-order` read "Feature:divine Order" — a label whose
 * first word is not a word. Both halves of the round trip are asserted below: the list reads
 * "Feature: Echoed Ward", and what lands in the published body is `feature:echoed-ward`, whether the
 * GM tapped the row or typed the printed name at it.
 *
 * **What these tests CANNOT prove**, per `test/setup.ts`: the 44px touch floor and the iOS symptom
 * itself. No stylesheet is loaded in jsdom. That half is `Combobox.css` route 1 and a real browser
 * at 375px; the commit message records the measurement.
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

/** A feat, for the reason `option-row.test.tsx` uses one: it stores ONE `FeatureRecord` under a
    singular key, so the panel renders bare — no list chrome, no level chips, nothing between the
    test and the control. Its feature is what makes `feature:echoed-ward` an offer at all. */
const WARD_FEAT: Draft = {
  ...blankDraft("feat"),
  name: "Echoed Ward",
  category: "origin",
  summary: "A ward that echoes an earlier answer.",
  description: "The echo you were born under wards you.",
  feature: {
    id: "echoed-ward",
    name: "Echoed Ward",
    description: "The echo you were born under wards you.",
    choice: { kind: "cantrip", choose: 1, repeatable: false, from: ["light", "spare-the-dying"] }
  }
};

/** The eight named budgets as they are PRINTED, plus this record's own feature. The order is
    `NAMED_PICK_BUDGET_KEYS`', which is the server's own list — one list, read from both ends. */
const OFFERED = [
  "Class Skills", "Class Tools", "Background Skills", "Background Tools",
  "Background Languages", "Species Languages", "Class Cantrips", "Class Spells",
  "Feature: Echoed Ward"
];

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

function mount(seed: Draft = WARD_FEAT) {
  let body: Draft = seed;
  render(<RecordForm seed={seed} onBody={(next) => { body = next; }} />);
  const user = userEvent.setup();
  return {
    user,
    /** A `pick` box while it is EMPTY — `Combobox` swaps the input for a chip once it holds one. */
    box: (name: string) => screen.getByRole("combobox", { name }) as HTMLInputElement,
    /** The chip's own X, which is how a held value gets back to the box. `Clear <label>` is
        `Combobox`'s wording, so this is the gesture and not a shortcut around it. */
    clear: (label: string) => screen.getByRole("button", { name: `Clear ${label}` }),
    /** What is on screen when the chooser is open, in order. This is the assertion the datalist
        could not have: with a `<datalist>` there is no listbox at all. */
    offered: (name: string) =>
      within(screen.getByRole("listbox", { name })).getAllByRole("option").map((option) => option.textContent),
    /** The body `useAutosave` would PUT — where `undefined` is dropped and editor-only keys go. */
    feature: () => (forStorage(body) as { feature?: Record<string, unknown> }).feature ?? {},
    choice: () => ((forStorage(body) as { feature?: { choice?: Record<string, unknown> } }).feature?.choice ?? {})
  };
}

describe("choice.kind — the reserved kinds are on screen, and a homebrew kind still lands", () => {
  /** The seeded block already holds a kind, so a GM changing it clears the chip first. That is the
      real gesture and it is worth driving: `setEmpty` runs the field's own `write`, which is where
      a `pick` box on a `write`-bearing field could have gone wrong and did not. */
  const emptied = async () => {
    const form = mount();
    await form.user.click(form.clear("Cantrip"));
    return form;
  };

  it("all fourteen read as printed names, before anything is typed", async () => {
    const form = await emptied();
    await form.user.click(form.box("What kind of choice"));
    expect(form.offered("What kind of choice")).toEqual([
      "Feat", "Fighting Style", "Asi Or Feat", "Subclass", "Lineage", "Spell", "Cantrip",
      "Skill", "Tool", "Language", "Skill Or Tool", "Expertise", "Ability Score", "Weapon Mastery"
    ]);
  });

  it("picking “Fighting Style” writes the slug the engine matches on", async () => {
    const form = await emptied();
    await form.user.click(form.box("What kind of choice"));
    await form.user.click(screen.getByRole("option", { name: "Fighting Style" }));
    // THE FAR END: the published body carries the reserved slug, and the GM reads the name back.
    expect(form.choice().kind).toBe("fighting-style");
    expect(screen.getByText("Fighting Style")).toBeInTheDocument();
  });

  it("typing “echo ward” writes “echo-ward” — `FeatureChoiceSchema.kind` is an OPEN slug", async () => {
    const form = await emptied();
    // The inverse bug the flag must not introduce. A closed `<select>` here would make a homebrew
    // kind unauthorable, which is why this is `pick` on `text` and not `kind: "select"`.
    await form.user.type(form.box("What kind of choice"), "echo ward{Enter}");
    expect(form.choice().kind).toBe("echo-ward");
  });
});

describe("the three offer boxes — one namespace, opened rather than spelled", () => {
  it("extraPicks: a budget is TAPPED, and the colon survives the round trip", async () => {
    const form = mount();
    await form.user.click(screen.getByRole("button", { name: "Add an extra pick" }));

    await form.user.click(form.box("Which pick"));
    expect(form.offered("Which pick")).toEqual(OFFERED);

    await form.user.click(screen.getByRole("option", { name: "Feature: Echoed Ward" }));
    // THE FAR END. `PickBudgetKeySchema` is `^[a-z0-9-]+(:[a-z0-9-]+)?$`, so the label's spaces are
    // display only — the value is the key the server folds into the build's budgets.
    expect(form.feature().extraPicks).toEqual([{ offer: "feature:echoed-ward", amount: 1 }]);
    expect(screen.getByText("Feature: Echoed Ward")).toBeInTheDocument();
  });

  it("replaces: the printed name typed by hand lands on the SLUG, not beside it", async () => {
    const form = mount();
    await form.user.click(screen.getByRole("button", { name: "Add a re-openable pick" }));

    // The gesture that broke when the label grew a space: a GM reads "Feature: Echoed Ward" off the
    // list and types it. `Combobox` commits an exact label match as the option's id.
    await form.user.type(form.box("Which pick"), "Feature: Echoed Ward{Enter}");
    expect(form.feature().replaces).toEqual([{ offer: "feature:echoed-ward", when: "long-rest", amount: 1 }]);
  });

  it("replaces: a budget the record has NOT authored keeps its colon too", async () => {
    const form = mount();
    await form.user.click(screen.getByRole("button", { name: "Add a re-openable pick" }));

    // No option matches, so this is the free-text arm — `pickValue`, not an exact-label commit. The
    // colon eats its own padding; without that the key is `feature:-my-ward`, which names no budget
    // any build has and which `offerValidate` refuses on screen.
    await form.user.type(form.box("Which pick"), "feature: my ward{Enter}");
    expect(form.feature().replaces).toEqual([{ offer: "feature:my-ward", when: "long-rest", amount: 1 }]);
    expect(screen.queryByText("Write it as an offer key — lowercase-with-dashes, or feature:<a-feature-id>.")).toBeNull();
  });

  it("fromPicks: the fourth source names its budget from the same list", async () => {
    const form = mount();
    // The source machinery is a `SegmentedControl` over a UI mode; "Their earlier picks" seeds
    // `{fromPicks: {offer: ""}}`, which is what makes the group visible at all.
    await form.user.click(screen.getByRole("button", { name: "Their earlier picks" }));

    await form.user.click(form.box("Answers to"));
    expect(form.offered("Answers to")).toEqual(OFFERED);

    await form.user.click(screen.getByRole("option", { name: "Class Cantrips" }));
    expect(form.choice().fromPicks).toEqual({ offer: "class-cantrips" });
    // ...and the source stayed exclusive, which is `writeFromPicks`' whole job.
    expect(Object.keys(form.choice())).not.toContain("from");
  });
});
