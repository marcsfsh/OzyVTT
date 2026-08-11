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
import { DAMAGE_TYPE_IDS, RARITY_IDS, WEAPON_MASTERY_IDS, WEAPON_PROPERTY_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { blankDraft, forStorage } from "./defaults";
import { RiderEditor } from "./RiderEditor";
import { SchemaForm } from "./SchemaForm";
import { SCHEMAS } from "./schemas";
import { EMPTY_CONTEXT, pickValue, suggestionLabel, type Draft } from "./schema";
import type { HomebrewType } from "./types";

/** The real form, driven the way `RecordDetail` drives it: one draft, one `onDraft`. */
function RecordForm({ type, seed, onBody }: { type: HomebrewType; seed: Draft; onBody: (body: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(seed);
  return (
    <SchemaForm
      schema={SCHEMAS[type]}
      draft={draft}
      onDraft={(next) => { setDraft(next); onBody(next); }}
      ctx={EMPTY_CONTEXT}
    />
  );
}

/** The last body the form wrote, through the save path's own shaping — what would be PUT. */
function mount(type: HomebrewType = "equipment", seed: Draft = { name: "Mace of Storms", isMagic: true }) {
  let body: Draft = {};
  render(<RecordForm type={type} seed={seed} onBody={(next) => { body = next; }} />);
  const chooser = (name: string) => screen.getByRole("combobox", { name });
  return {
    chooser,
    rarity: () => chooser("Rarity"),
    /** Scoped to the chooser's OWN listbox: these forms have real `<select>`s in them, so a bare
        `getAllByRole("option")` counts the slot list and the weapon categories too. */
    options: (name: string) => within(screen.getByRole("listbox", { name })).getAllByRole("option").map((option) => option.textContent),
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

/**
 * **`3d` — the same defect, nine times, and two thirds of them are LISTS.**
 *
 * The client reported "damage type is an unconstrained field". Same correction as `3a`: it never was.
 * `vocabularies.test.ts` has asserted since it was written that all thirteen SRD types are offered at
 * every site — and offered them into an `<input list>` or a `TagInput`'s `<datalist>`, which is to say
 * into nothing a GM can see and nothing at all on iOS Safari.
 *
 * What differs from `3a` is the shape of the fix. Rarity is one value on one field; damage types are
 * nine sites across **three control kinds**, so the far ends below are one per kind rather than one
 * per site — the census in `vocabularies.test.ts` is what holds the other six, and it holds them by
 * count so a tenth cannot land unflagged:
 *
 *   1. `kind: "text"` + `pick` → `Combobox` — `weapon.damageType`, the client's own mace;
 *   2. `kind: "tags"` + `pick` → `TagInput` wearing that same `Combobox` — a monster's resistances;
 *   3. `GrantsEditor`'s bespoke "Which" box, which has **no `FieldDef` at all** and is therefore
 *      invisible to every census in this repo. It is here precisely because nothing else can see it.
 *
 * Each proves the same four things: the list renders unprompted, a listed value lands as its slug, a
 * word the SRD has never heard of survives, and the value reaches the body that gets published.
 * `DamageTypeIdSchema` stays an open max-40 string throughout — a homebrew "void" damage type is the
 * point, and a closed control over an open slug is the inverse bug.
 */
describe("3d — every damage-type control is a visible chooser that still takes a homebrew type", () => {
  const NAMES = DAMAGE_TYPE_IDS.map(suggestionLabel);

  it("kind 1, text: the weapon's damage type shows the whole vocabulary, not eight of it", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Damage type"));

    // ALL THIRTEEN, unprompted. Not a rhetorical number: `Combobox`'s own default is a page of 8,
    // which rarity never noticed because there are only 7 rungs — so a list-paging bug would have
    // reproduced "ten of the thirteen damage types" at the renderer having just fixed it at the
    // constant, and the three it dropped would have been the last three alphabetically.
    expect(form.options("Damage type")).toEqual(NAMES);
    expect(form.options("Damage type")).toContain("Thunder");
  });

  it("kind 1, text: picking Lightning writes the slug into the weapon block", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Damage type"));
    await user.click(screen.getByRole("option", { name: "Lightning" }));

    // THE FAR END: the body that gets published, and the whole `weapon` container seeded around it —
    // `inContainer` is what stops a first touch here producing `weapon: { damageType: "lightning" }`
    // and three `Required` refusals.
    expect(form.body().weapon).toMatchObject({ damageType: "lightning", rangeFeet: null, longRangeFeet: null });
    expect(screen.getByText("Lightning")).toBeInTheDocument();
  });

  it("kind 1, text: a homebrew “void” type survives — the column stays open", async () => {
    const user = userEvent.setup();
    const form = mount();

    // The half a closed `<select>` would have broken, and the reason `DamageTypeIdSchema` is an open
    // max-40 string rather than an enum. Tab-out rather than Enter, because leaving a field is the
    // gesture people actually make and it is the one that used to discard what was typed.
    await user.type(form.chooser("Damage type"), "void");
    await user.click(screen.getByLabelText("Name"));

    expect((form.body().weapon as { damageType?: string }).damageType).toBe("void");
  });

  it("kind 2, tags: a monster's resistances offer the list and land as slugs", async () => {
    const user = userEvent.setup();
    const form = mount("monster", { ...blankDraft("monster"), name: "Storm Herald" });

    await user.click(form.chooser("Damage resistances"));
    expect(form.options("Damage resistances")).toEqual(NAMES);

    await user.click(screen.getByRole("option", { name: "Fire" }));
    expect(form.body().damageResistances).toEqual(["fire"]);

    // A chosen entry leaves the menu: `TagInput` refuses a duplicate anyway, so offering one again
    // would be offering a tap that does nothing.
    await user.click(form.chooser("Damage resistances"));
    expect(form.options("Damage resistances")).not.toContain("Fire");

    // ...and the list is still open at the far end. "Fire" or "flame" typed into this box used to
    // store a value the typed-defence pass never matches — silently, at play time.
    await user.type(form.chooser("Damage resistances"), "void{Enter}");
    expect(form.body().damageResistances).toEqual(["fire", "void"]);
  });

  it("kind 2, tags: “Necrotic” typed by hand is the slug, not a string the store refuses", async () => {
    const user = userEvent.setup();
    const form = mount("monster", { ...blankDraft("monster"), name: "Storm Herald" });

    // `TagInput`'s own `slugify` is what normalises here — the same job `pickValue` does on the text
    // branch, spelled once per control rather than once per call site.
    await user.type(form.chooser("Damage immunities"), "Necrotic{Enter}");
    expect(form.body().damageImmunities).toEqual(["necrotic"]);
  });

  it("both rider sites, in the nested rows they really live in", async () => {
    const user = userEvent.setup();
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>({});
      return (
        <RiderEditor
          value={held}
          onChange={(next) => { setHeld(next); value = next; }}
          enabled={["modifiers"]}
          scope="item"
          ctx={EMPTY_CONTEXT}
          idPrefix="hb-equipment"
        />
      );
    }
    render(<Harness />);

    /**
     * Sites 6 and 7 are the only two that render **inside a `RowEditor` row**, and one of them is
     * nested two deep (a gating condition on a modifier). Everything above drives a top-level field,
     * so nothing else here would notice a chooser that works on the record and not in a row — which
     * is a live risk in this renderer, where a row's fields are re-keyed by position and handed a
     * different `idPrefix` per row.
     */
    await user.click(screen.getByRole("button", { name: "Add a modifier" }));
    await user.selectOptions(screen.getByLabelText("What it changes"), "extra-damage");

    // Site 7 — the mace's "+1d6 lightning", one row deep.
    await user.click(screen.getByRole("combobox", { name: "Damage type" }));
    expect(within(screen.getByRole("listbox", { name: "Damage type" })).getAllByRole("option").map((option) => option.textContent))
      .toEqual(NAMES);
    await user.click(screen.getByRole("option", { name: "Lightning" }));
    expect((value.modifiers as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "extra-damage", damageType: "lightning" });

    // Site 6 — the `damage-type-is` gate, two rows deep, and the one where a mistyped slug is
    // completely silent: the rider simply never fires.
    await user.click(screen.getByRole("button", { name: "Add a condition" }));
    await user.selectOptions(screen.getByLabelText("Condition"), "damage-type-is");
    await user.click(screen.getByRole("combobox", { name: "Damage types" }));
    expect(within(screen.getByRole("listbox", { name: "Damage types" })).getAllByRole("option").map((option) => option.textContent))
      .toEqual(NAMES);

    await user.click(screen.getByRole("option", { name: "Cold" }));
    const when = ((value.modifiers as Array<Record<string, unknown>>)[0].when as Array<Record<string, unknown>>)[0];
    expect(when).toMatchObject({ type: "damage-type-is", damageTypes: ["cold"] });
  });

  it("kind 3, grants: the one damage-type control no census in this repo can see", async () => {
    const user = userEvent.setup();
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>({});
      return (
        <RiderEditor
          value={held}
          onChange={(next) => { setHeld(next); value = next; }}
          enabled={["grants"]}
          scope="item"
          ctx={EMPTY_CONTEXT}
          idPrefix="hb-equipment"
        />
      );
    }
    const { container } = render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Grant something" }));
    // `GrantsEditor` is eleven parallel arrays behind one `[What ▾][Which…]` row and has no `FieldDef`
    // anywhere, so its "What" select carries no id to be labelled by — queried through the DOM for
    // that reason, and it is the same reason `authoring-harness.ts` still exempts `grants`.
    const what = container.querySelector("select")!;
    await user.selectOptions(what, "damageResistances");

    await user.click(screen.getByRole("combobox", { name: "Which damage resistances" }));
    expect(within(screen.getByRole("listbox", { name: "Which damage resistances" })).getAllByRole("option").map((option) => option.textContent))
      .toEqual(NAMES);

    await user.click(screen.getByRole("option", { name: "Cold" }));
    await user.type(screen.getByRole("combobox", { name: "Which damage resistances" }), "void{Enter}");

    expect((value.grants as { damageResistances?: readonly string[] }).damageResistances).toEqual(["cold", "void"]);
  });

  it("a tag field with NO list keeps the plain box — `pick` is not “always a menu”", async () => {
    const user = userEvent.setup();
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>({});
      return (
        <RiderEditor
          value={held}
          onChange={(next) => { setHeld(next); value = next; }}
          enabled={["grants"]}
          scope="item"
          ctx={EMPTY_CONTEXT}
          idPrefix="hb-equipment"
        />
      );
    }
    const { container } = render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Grant something" }));
    await user.selectOptions(container.querySelector("select")!, "languages");

    // `pick` is set for the CONTROL rather than per grant kind — one box must not teach two things
    // about itself as the select beside it changes. `TagInput` falls back to the plain input when
    // there is no vocabulary to show, so "show the list when there is one" stays true either way.
    expect(screen.queryByRole("combobox", { name: "Which languages" })).toBeNull();
    await user.type(screen.getByLabelText("Which languages"), "elvish{Enter}");
    expect((value.grants as { languages?: readonly string[] }).languages).toEqual(["elvish"]);
  });
});

describe("U9 — the eleventh grant kind is a spell PICKER, because a spell id cannot be typed", () => {
  /**
   * The other ten grant kinds are slug sets a GM can reasonably type — six skills, four armour
   * families, a handful of damage types. A spell id is one of 339, and one character wrong is a
   * grant that hands out nothing, silently, forever. So this "Which" is not a `TagInput` at all: it
   * is the `CatalogPicker` the item's cast row already uses, plus removable chips for what has been
   * picked.
   *
   * Driven through the RENDERED form for the same reason the damage-type grant test above is:
   * `GrantsEditor` has no `FieldDef` anywhere, so no census in this repo can see it and
   * `authoring-harness.ts` still exempts `grants`. The body half — that the picked ids become
   * `{id, alwaysPrepared}` and reach a prepared spell on a real sheet — is
   * `vocabulary-parity.mirror.test.ts`.
   */
  const SPELL_CTX = {
    ...EMPTY_CONTEXT,
    spells: [
      { id: "bless", name: "Bless", origin: "srd" as const, meta: "Level 1 enchantment" },
      { id: "cure-wounds", name: "Cure Wounds", origin: "srd" as const, meta: "Level 1 abjuration" },
      { id: "shield-of-faith", name: "Shield of Faith", origin: "srd" as const, meta: "Level 1 abjuration" }
    ]
  };

  function mountGrants() {
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>({});
      return (
        <RiderEditor
          value={held}
          onChange={(next) => { setHeld(next); value = next; }}
          enabled={["grants"]}
          scope="feature"
          ctx={SPELL_CTX}
          idPrefix="hb-class"
        />
      );
    }
    const { container } = render(<Harness />);
    return { container, grants: () => value.grants as { spells?: ReadonlyArray<Record<string, unknown>> } | undefined };
  }

  it("“Spells” is offered as a kind at all — the eleventh array stops being write-only", async () => {
    const user = userEvent.setup();
    const { container } = mountGrants();
    await user.click(screen.getByRole("button", { name: "Grant something" }));
    const what = container.querySelector("select")!;
    expect([...what.options].map((option) => option.textContent)).toContain("Spells");
  });

  it("...and it is NOT offered on an item, because nothing on that road reads it", async () => {
    // `EquipmentReferenceSchema` spreads `featureRiders`, so an item's body PARSES `grants.spells`
    // and `takeGrants` folds nine grant arrays without it. Offering the kind here would store a
    // value the fight never sees. The other ten stay.
    const user = userEvent.setup();
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>({});
      return (
        <RiderEditor
          value={held}
          onChange={(next) => { setHeld(next); value = next; }}
          enabled={["grants"]}
          scope="item"
          ctx={SPELL_CTX}
          idPrefix="hb-equipment"
        />
      );
    }
    const { container } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Grant something" }));
    const labels = [...container.querySelector("select")!.options].map((option) => option.textContent);
    expect(labels).not.toContain("Spells");
    expect(labels).toContain("Damage resistances");
    expect(value.grants).toBeDefined();
  });

  it("picking Bless writes `{id, alwaysPrepared}` — the shape 41 SRD records author", async () => {
    const user = userEvent.setup();
    const { container, grants } = mountGrants();
    await user.click(screen.getByRole("button", { name: "Grant something" }));
    await user.selectOptions(container.querySelector("select")!, "spells");

    // Not a text box: there is nothing to type into, and that is the point of the row.
    expect(screen.queryByRole("combobox", { name: "Which spells" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add a spell" }));
    await user.click(screen.getByRole("radio", { name: /^Bless/ }));

    expect(grants()?.spells).toEqual([{ id: "bless", alwaysPrepared: true }]);
  });

  it("a second spell joins the first, and a chip takes one back off", async () => {
    const user = userEvent.setup();
    const { container, grants } = mountGrants();
    await user.click(screen.getByRole("button", { name: "Grant something" }));
    await user.selectOptions(container.querySelector("select")!, "spells");

    await user.click(screen.getByRole("button", { name: "Add a spell" }));
    await user.click(screen.getByRole("radio", { name: /^Bless/ }));
    await user.click(screen.getByRole("button", { name: "Add a spell" }));
    await user.click(screen.getByRole("radio", { name: /^Cure Wounds/ }));
    expect(grants()?.spells?.map((spell) => spell.id)).toEqual(["bless", "cure-wounds"]);

    // The chips ARE the value, so removing one is how a grant is taken back.
    await user.click(screen.getByRole("button", { name: "Remove Bless" }));
    expect(grants()?.spells).toEqual([{ id: "cure-wounds", alwaysPrepared: true }]);
  });

  it("an already-picked spell is not offered a second time", async () => {
    const user = userEvent.setup();
    const { container } = mountGrants();
    await user.click(screen.getByRole("button", { name: "Grant something" }));
    await user.selectOptions(container.querySelector("select")!, "spells");

    await user.click(screen.getByRole("button", { name: "Add a spell" }));
    await user.click(screen.getByRole("radio", { name: /^Bless/ }));
    await user.click(screen.getByRole("button", { name: "Add a spell" }));
    expect(screen.queryByRole("radio", { name: /^Bless/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^Cure Wounds/ })).toBeTruthy();
  });
});

/**
 * **C3 — the weapon block's sixth row, on screen.**
 *
 * `weapon-properties.mirror.test.ts` proves the row reaches the ENGINE: a GM-authored Finesse weapon
 * swings off Dexterity. It drives the form MODEL, though, and the model is not the screen — the whole
 * point of `pick` is that a complete vocabulary shipped invisible is a vocabulary a GM does not have,
 * which is exactly what `<datalist>` did to rarity and to damage types before `3a`/`3d`. So the
 * assertions here are what a GM SEES and TAPS.
 *
 * The one that is specific to this unit is the SECOND: the chooser must offer the nine weapon
 * PROPERTIES and must not offer the eight masteries. `ctx.weaponProperties` is the union of both
 * families — right for the `weapon-property-is` trigger, which matches either — and offering `topple`
 * here would suggest a value the weapon column cannot mean, silently inert at play time. That is the
 * hardest homebrew failure to diagnose, and it is a one-word mistake to make.
 */
describe("C3 — a homebrew weapon's Properties row is a visible chooser over the properties alone", () => {
  const PROPERTY_NAMES = WEAPON_PROPERTY_IDS.map(suggestionLabel);

  it("offers all nine properties unprompted, and none of the eight masteries", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Properties"));

    expect(form.options("Properties")).toEqual(PROPERTY_NAMES);
    expect(form.options("Properties")).toContain("Two Handed");
    // The union guard, named per slug so a regression says WHICH family leaked.
    for (const mastery of WEAPON_MASTERY_IDS) {
      expect(form.options("Properties"), `${mastery} is a mastery, not a property`)
        .not.toContain(suggestionLabel(mastery));
    }
  });

  it("tapping Finesse writes the slug into the weapon block, container and all", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Properties"));
    await user.click(screen.getByRole("option", { name: "Finesse" }));

    // THE FAR END for this file: the body that gets published. `inContainer` seeds the rest of the
    // weapon block around it, so a first touch here cannot produce `weapon: { properties: [...] }`
    // alone and the three `Required` refusals that used to follow.
    expect(form.body().weapon).toMatchObject({ properties: ["finesse"], rangeFeet: null, longRangeFeet: null });
    // A chosen property leaves the menu — offering it again would be offering a tap that does nothing.
    await user.click(form.chooser("Properties"));
    expect(form.options("Properties")).not.toContain("Finesse");
  });

  it("a homebrew “duelling” property survives — the column stays open", async () => {
    const user = userEvent.setup();
    const form = mount();

    // The half a closed enum would have broken. `WEAPON_PROPERTY_IDS` is what the chooser SHOWS; the
    // column is `z.array(z.string().regex(/^[a-z0-9-]+$/))`, so a GM's own word is a legal value.
    await user.type(form.chooser("Properties"), "Duelling{Enter}");
    expect((form.body().weapon as { properties?: string[] }).properties).toEqual(["duelling"]);
  });
});
