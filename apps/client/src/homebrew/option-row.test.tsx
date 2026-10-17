/**
 * An inline option's row writes what its controls write, including removals. `FeatureEditor` draws
 * `choice.options` by hand (an option mounts `RiderEditor`, which the renderer's rows branch can't),
 * so its setter must replace the row as the renderer does; a merge would restore keys a write deleted.
 * Clearing both `requires` boxes must drop the clause and never leave `{}`. Drives the rendered form,
 * since `applyField` calls the field's `write` directly and can't see this.
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

/** A feat with one feature offering two inline options, the first gated. A feat renders its single
    feature without list chrome or level chips. */
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

/** The real form, driven as `RecordDetail` drives it: one draft, one `onDraft`, the same `custom`
    map (without it the custom `features` section renders empty). */
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

async function mount(seed: Draft = GATED_FEAT) {
  let body: Draft = seed;
  render(
    <RecordForm
      seed={seed}
      onBody={(next) => {
        body = next;
      }}
    />
  );
  // The option list is collapsible, so open the stored row as a GM would.
  const toggle = screen.getByRole("button", { name: /Ember Ward/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await userEvent.setup().click(toggle);
  return {
    /** An empty `pick` box; `Combobox` replaces the input with a chip once it holds a value. */
    box: (name: string) => screen.getByRole("combobox", { name }) as HTMLInputElement,
    /** What the GM reads back: the slug's printed name, or the typed words. */
    chip: (label: string) => screen.getByText(label),
    /** The chip's own clear button (`Clear <label>` is `Combobox`'s wording). */
    clear: (label: string) => screen.getByRole("button", { name: `Clear ${label}` }),
    /** The body `useAutosave` would send: `undefined` is dropped, a surviving `{}` is not. */
    option: () => {
      const stored = forStorage(body) as { feature?: { choice?: { options?: Array<Record<string, unknown>> } } };
      return stored.feature?.choice?.options?.[0] ?? {};
    }
  };
}

describe("an inline option's gate can be cleared, not only set", () => {
  it("renders the stored clause in its own two boxes", async () => {
    const form = await mount();
    // Stored values read back as printed names: the offer resolves to "Feature: Echoed Ward"; the
    // unauthored answer id stands as written.
    expect(form.chip("Feature: Echoed Ward")).toBeInTheDocument();
    expect(form.chip("emberborn")).toBeInTheDocument();
    // Reading must not write.
    expect(form.option().requires).toEqual({ offer: "feature:echoed-ward", id: "emberborn" });
  });

  it("THE LOOP: clear one half and the other stands; clear both and the clause is GONE", async () => {
    const user = userEvent.setup();
    const form = await mount();

    await user.click(form.clear("Feature: Echoed Ward"));
    // Half-cleared is still a clause; the checklist names the empty half.
    expect(form.option().requires).toEqual({ id: "emberborn" });

    await user.click(form.clear("emberborn"));
    // No key at all: `{}` would raise two "Required" issues for a removed gate.
    expect(Object.keys(form.option()), "the cleared clause must not survive as an empty object").not.toContain(
      "requires"
    );
    expect(form.option()).toMatchObject({ id: "ember-ward", name: "Ember Ward" });

    // The boxes remain, so re-entering the gate is one tap.
    expect(form.box("Which pick").value).toBe("");
    expect(form.box("Which answer").value).toBe("");
  });

  it("a gate typed from nothing lands whole, so the row can add as well as remove", async () => {
    const user = userEvent.setup();
    const seed = JSON.parse(JSON.stringify(GATED_FEAT)) as typeof GATED_FEAT;
    delete ((seed.feature as Record<string, unknown>).choice as { options: Array<Record<string, unknown>> }).options[0]
      .requires;
    const form = await mount(seed);
    expect(Object.keys(form.option())).not.toContain("requires");

    await user.type(form.box("Which pick"), "feature:echoed-ward{Enter}");
    await user.type(form.box("Which answer"), "frostborn{Enter}");
    expect(form.option().requires).toEqual({ offer: "feature:echoed-ward", id: "frostborn" });
  });

  it("THE GATE IS PICKED and never spelled: the half a datalist could not do on a phone", async () => {
    const user = userEvent.setup();
    const seed = JSON.parse(JSON.stringify(GATED_FEAT)) as typeof GATED_FEAT;
    delete ((seed.feature as Record<string, unknown>).choice as { options: Array<Record<string, unknown>> }).options[0]
      .requires;
    const form = await mount(seed);

    // A listbox exists at all, which a datalist never provides.
    await user.click(form.box("Which pick"));
    const offered = within(screen.getByRole("listbox", { name: "Which pick" }))
      .getAllByRole("option")
      .map((option) => option.textContent);
    // The named budgets by printed name, plus this record's own feature (colon as separator).
    expect(offered).toEqual([
      "Class Skills",
      "Class Tools",
      "Background Skills",
      "Background Tools",
      "Background Languages",
      "Species Languages",
      "Class Cantrips",
      "Class Spells",
      "Feature: Echoed Ward"
    ]);

    await user.click(screen.getByRole("option", { name: "Feature: Echoed Ward" }));
    // The label is words; the stored value is the `PickBudgetKeySchema` slug.
    expect(form.option().requires).toEqual({ offer: "feature:echoed-ward" });
    expect(form.chip("Feature: Echoed Ward")).toBeInTheDocument();
  });

  it("the answer half offers the ids the record really declares", async () => {
    const user = userEvent.setup();
    const seed = JSON.parse(JSON.stringify(GATED_FEAT)) as typeof GATED_FEAT;
    delete ((seed.feature as Record<string, unknown>).choice as { options: Array<Record<string, unknown>> }).options[0]
      .requires;
    const form = await mount(seed);

    await user.click(form.box("Which answer"));
    // `optionIdsOf`: answers any pick on this record could hold.
    expect(
      within(screen.getByRole("listbox", { name: "Which answer" }))
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["Ember Ward"]);

    await user.click(screen.getByRole("option", { name: "Ember Ward" }));
    expect(form.option().requires).toEqual({ id: "ember-ward" });
  });
});
