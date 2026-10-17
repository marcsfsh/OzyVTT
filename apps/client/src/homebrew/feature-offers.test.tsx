/**
 * The feature panel's offer boxes (`choice.kind`, `extraPicks[].offer`, `replaces[].offer`,
 * `fromPicks.offer`) are visible choosers, with no datalists; the `requires` pair is in
 * `option-row.test.tsx`. Also checks the `<namespace>:<slug>` round trip: the list reads
 * "Feature: Echoed Ward" and the body stores `feature:echoed-ward`, whether tapped or typed.
 *
 * jsdom loads no stylesheet, so the 44px touch floor is not tested here.
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

/** A feat, so the panel renders its single feature bare. Its feature makes `feature:echoed-ward` an offer. */
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

/** The named budgets as printed, in `NAMED_PICK_BUDGET_KEYS` order, plus this record's own feature. */
const OFFERED = [
  "Class Skills",
  "Class Tools",
  "Background Skills",
  "Background Tools",
  "Background Languages",
  "Species Languages",
  "Class Cantrips",
  "Class Spells",
  "Feature: Echoed Ward"
];

function RecordForm({ seed, onBody }: { seed: Draft; onBody: (body: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(seed);
  const write = (next: Draft) => {
    setDraft(next);
    onBody(next);
  };
  return (
    <SchemaForm
      schema={SCHEMAS.feat}
      draft={draft}
      onDraft={write}
      ctx={EMPTY_CONTEXT}
      custom={{
        features: ({ field }) => (
          <FeatureEditor
            draft={draft}
            onDraft={write}
            ctx={EMPTY_CONTEXT}
            featuresKey={field.key}
            single
            idPrefix="hb-feat"
          />
        )
      }}
    />
  );
}

function mount(seed: Draft = WARD_FEAT) {
  let body: Draft = seed;
  render(
    <RecordForm
      seed={seed}
      onBody={(next) => {
        body = next;
      }}
    />
  );
  const user = userEvent.setup();
  return {
    user,
    /** An empty `pick` box; `Combobox` replaces the input with a chip once it holds a value. */
    box: (name: string) => screen.getByRole("combobox", { name }) as HTMLInputElement,
    /** The chip's own clear button (`Clear <label>` is `Combobox`'s wording). */
    clear: (label: string) => screen.getByRole("button", { name: `Clear ${label}` }),
    /** The open chooser's options, in order. A datalist has no listbox at all. */
    offered: (name: string) =>
      within(screen.getByRole("listbox", { name }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    /** The body `useAutosave` would send. */
    feature: () => (forStorage(body) as { feature?: Record<string, unknown> }).feature ?? {},
    choice: () => (forStorage(body) as { feature?: { choice?: Record<string, unknown> } }).feature?.choice ?? {}
  };
}

describe("choice.kind: the reserved kinds are on screen, and a homebrew kind still lands", () => {
  /** The seeded block already holds a kind, so changing it starts by clearing the chip, which runs
      the field's own `write` via `setEmpty`. */
  const emptied = async () => {
    const form = mount();
    await form.user.click(form.clear("Cantrip"));
    return form;
  };

  it("all fourteen read as printed names, before anything is typed", async () => {
    const form = await emptied();
    await form.user.click(form.box("What kind of choice"));
    expect(form.offered("What kind of choice")).toEqual([
      "Feat",
      "Fighting Style",
      "Asi Or Feat",
      "Subclass",
      "Lineage",
      "Spell",
      "Cantrip",
      "Skill",
      "Tool",
      "Language",
      "Skill Or Tool",
      "Expertise",
      "Ability Score",
      "Weapon Mastery"
    ]);
  });

  it('picking "Fighting Style" writes the slug the engine matches on', async () => {
    const form = await emptied();
    await form.user.click(form.box("What kind of choice"));
    await form.user.click(screen.getByRole("option", { name: "Fighting Style" }));
    // The body carries the reserved slug.
    expect(form.choice().kind).toBe("fighting-style");
    expect(screen.getByText("Fighting Style")).toBeInTheDocument();
  });

  it('typing "echo ward" writes "echo-ward": `FeatureChoiceSchema.kind` is an OPEN slug', async () => {
    const form = await emptied();
    // A homebrew kind must still be typeable: `pick` on text, and no closed select.
    await form.user.type(form.box("What kind of choice"), "echo ward{Enter}");
    expect(form.choice().kind).toBe("echo-ward");
  });
});

describe("the three offer boxes: one namespace, opened as a list and never spelled", () => {
  it("extraPicks: a budget is TAPPED, and the colon survives the round trip", async () => {
    const form = mount();
    await form.user.click(screen.getByRole("button", { name: "Add an extra pick" }));

    await form.user.click(form.box("Which pick"));
    expect(form.offered("Which pick")).toEqual(OFFERED);

    await form.user.click(screen.getByRole("option", { name: "Feature: Echoed Ward" }));
    // `PickBudgetKeySchema` is `^[a-z0-9-]+(:[a-z0-9-]+)?$`; the label's spaces are display only.
    expect(form.feature().extraPicks).toEqual([{ offer: "feature:echoed-ward", amount: 1 }]);
    expect(screen.getByText("Feature: Echoed Ward")).toBeInTheDocument();
  });

  it("replaces: the printed name typed by hand lands on the SLUG, not beside it", async () => {
    const form = mount();
    await form.user.click(screen.getByRole("button", { name: "Add a re-openable pick" }));

    // Typing the printed label: `Combobox` commits an exact label match as the option's id.
    await form.user.type(form.box("Which pick"), "Feature: Echoed Ward{Enter}");
    expect(form.feature().replaces).toEqual([{ offer: "feature:echoed-ward", when: "long-rest", amount: 1 }]);
  });

  it("replaces: a budget the record has NOT authored keeps its colon too", async () => {
    const form = mount();
    await form.user.click(screen.getByRole("button", { name: "Add a re-openable pick" }));

    // Free text goes through `pickValue`, which strips the padding around the colon; otherwise the key
    // would be `feature:-my-ward`, which `offerValidate` refuses.
    await form.user.type(form.box("Which pick"), "feature: my ward{Enter}");
    expect(form.feature().replaces).toEqual([{ offer: "feature:my-ward", when: "long-rest", amount: 1 }]);
    expect(
      screen.queryByText("Write it as an offer key: lowercase-with-dashes, or feature:<a-feature-id>.")
    ).toBeNull();
  });

  it("fromPicks: the fourth source names its budget from the same list", async () => {
    const form = mount();
    // "Their earlier picks" seeds `{fromPicks: {offer: ""}}`, which shows the group.
    await form.user.click(screen.getByRole("button", { name: "Their earlier picks" }));

    await form.user.click(form.box("Answers to"));
    expect(form.offered("Answers to")).toEqual(OFFERED);

    await form.user.click(screen.getByRole("option", { name: "Class Cantrips" }));
    expect(form.choice().fromPicks).toEqual({ offer: "class-cantrips" });
    // The source stays exclusive (`writeFromPicks`).
    expect(Object.keys(form.choice())).not.toContain("from");
  });
});
