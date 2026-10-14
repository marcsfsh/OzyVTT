/**
 * `pick` fields render a visible chooser over an open slug. A `<datalist>` has no visible cue and
 * renders nothing on iOS Safari, so these tests assert what a GM sees and what lands in the published
 * body:
 * - every value is listed by its printed name without typing;
 * - picking "Very Rare" writes `"very-rare"`;
 * - typing "unique" writes `"unique"` (the slug stays open);
 * - clearing removes the key rather than writing `null` (`rarity` is `.optional()`).
 *
 * jsdom loads no stylesheet, so the 44px touch floor is left to `Combobox.css` and
 * `scripts/tap-audit.mjs`.
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

/** The real form, driven as `RecordDetail` drives it: one draft, one `onDraft`. */
function RecordForm({ type, seed, onBody }: { type: HomebrewType; seed: Draft; onBody: (body: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(seed);
  return (
    <SchemaForm
      schema={SCHEMAS[type]}
      draft={draft}
      onDraft={(next) => {
        setDraft(next);
        onBody(next);
      }}
      ctx={EMPTY_CONTEXT}
    />
  );
}

/** Mounts the form; `body()` is the last write after the save path's shaping. */
function mount(type: HomebrewType = "equipment", seed: Draft = { name: "Mace of Storms", isMagic: true }) {
  let body: Draft = {};
  render(
    <RecordForm
      type={type}
      seed={seed}
      onBody={(next) => {
        body = next;
      }}
    />
  );
  const chooser = (name: string) => screen.getByRole("combobox", { name });
  return {
    chooser,
    rarity: () => chooser("Rarity"),
    /** Scoped to the chooser's own listbox: these forms also contain real `<select>`s. */
    options: (name: string) =>
      within(screen.getByRole("listbox", { name }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    rungs: () => within(screen.getByRole("listbox", { name: "Rarity" })).getAllByRole("option"),
    // `forStorage` is what `useAutosave` sends and where `emptyValue: "omit"` drops the key.
    body: () => forStorage(body)
  };
}

describe("3a — the rarity control is a visible chooser that still takes a word of the GM's own", () => {
  it("shows all seven rungs by their printed names, before anything is typed", async () => {
    const user = userEvent.setup();
    const form = mount();

    // A datalist has no `combobox` role or listbox, so this would fail on the old control.
    await user.click(form.rarity());
    const shown = form.rungs().map((option) => option.textContent);
    expect(shown).toEqual(["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact", "Varies"]);
    // Names are derived from `RARITY_IDS`, not retyped.
    expect(shown).toEqual(RARITY_IDS.map(suggestionLabel));
  });

  it("picking “Very Rare” writes the slug, and shows the name back", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.rarity());
    await user.click(screen.getByRole("option", { name: "Very Rare" }));

    // The published body carries the slug.
    expect(form.body().rarity).toBe("very-rare");
    // The GM reads back the printed name on the chip.
    expect(screen.getByText("Very Rare")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Rarity" })).toBeNull();
  });

  it("typing “unique” writes “unique” — the open slug stays open", async () => {
    const user = userEvent.setup();
    const form = mount();

    // An open slug: a GM's own value must survive alongside the printed ones.
    await user.type(form.rarity(), "unique{Enter}");

    expect(form.body().rarity).toBe("unique");
    expect(screen.getByText("unique")).toBeInTheDocument();
  });

  it("typing “unique” and moving to the next field keeps it — Enter is not the only way out", async () => {
    const user = userEvent.setup();
    const form = mount();

    // Typed text must be kept on blur, not only on Enter.
    await user.type(form.rarity(), "unique");
    await user.click(screen.getByLabelText("Name"));

    expect(form.body().rarity).toBe("unique");
  });

  it("typing a rung by its printed name lands on the rung, not beside it", async () => {
    const user = userEvent.setup();
    const form = mount();

    // Typed "Very Rare" must become `very-rare`; the raw string fails `ContentIdSchema`. `pickValue`
    // makes typed and picked values the same shape.
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

    // `emptyValue: "omit"`: the key goes away rather than holding `null`.
    expect("rarity" in form.body()).toBe(false);
    expect(form.rarity()).toBeInTheDocument();
  });
});

/**
 * Every damage-type site is a visible chooser that still accepts a homebrew type. One test per
 * control kind (the census in `vocabularies.test.ts` covers every site by count):
 * 1. `kind: "text"` + `pick` → `Combobox` (`weapon.damageType`);
 * 2. `kind: "tags"` + `pick` → `TagInput` with the same `Combobox` (monster resistances);
 * 3. `GrantsEditor`'s bespoke "Which" box, which no census can see.
 * Each checks: the list renders unprompted, a listed value lands as its slug, an unknown word
 * survives, and the value reaches the published body. `DamageTypeIdSchema` stays an open string.
 */
describe("3d — every damage-type control is a visible chooser that still takes a homebrew type", () => {
  const NAMES = DAMAGE_TYPE_IDS.map(suggestionLabel);

  it("kind 1, text: the weapon's damage type shows the whole vocabulary, not eight of it", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Damage type"));

    // All thirteen: `Combobox` defaults to a page of 8, which would silently drop the last five.
    expect(form.options("Damage type")).toEqual(NAMES);
    expect(form.options("Damage type")).toContain("Thunder");
  });

  it("kind 1, text: picking Lightning writes the slug into the weapon block", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Damage type"));
    await user.click(screen.getByRole("option", { name: "Lightning" }));

    // `inContainer` seeds the whole weapon container around the first touched field.
    expect(form.body().weapon).toMatchObject({ damageType: "lightning", rangeFeet: null, longRangeFeet: null });
    expect(screen.getByText("Lightning")).toBeInTheDocument();
  });

  it("kind 1, text: a homebrew “void” type survives — the column stays open", async () => {
    const user = userEvent.setup();
    const form = mount();

    // An open slug: a homebrew type survives. Tab out rather than Enter, the common gesture.
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

    // A chosen entry leaves the menu; `TagInput` refuses duplicates anyway.
    await user.click(form.chooser("Damage resistances"));
    expect(form.options("Damage resistances")).not.toContain("Fire");

    // The list stays open to unknown words.
    await user.type(form.chooser("Damage resistances"), "void{Enter}");
    expect(form.body().damageResistances).toEqual(["fire", "void"]);
  });

  it("kind 2, tags: “Necrotic” typed by hand is the slug, not a string the store refuses", async () => {
    const user = userEvent.setup();
    const form = mount("monster", { ...blankDraft("monster"), name: "Storm Herald" });

    // `TagInput`'s own `slugify` normalises here, as `pickValue` does on the text branch.
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
          onChange={(next) => {
            setHeld(next);
            value = next;
          }}
          enabled={["modifiers"]}
          scope="item"
          ctx={EMPTY_CONTEXT}
          idPrefix="hb-equipment"
        />
      );
    }
    render(<Harness />);

    /** Sites inside `RowEditor` rows: the `extra-damage` rider one row deep and the `damage-type-is`
        gate two deep. Row fields are re-keyed by position with a per-row `idPrefix`, so they need
        their own check. */
    await user.click(screen.getByRole("button", { name: "Add a modifier" }));
    await user.selectOptions(screen.getByLabelText("What it changes"), "extra-damage");

    // The `extra-damage` rider, one row deep.
    await user.click(screen.getByRole("combobox", { name: "Damage type" }));
    expect(
      within(screen.getByRole("listbox", { name: "Damage type" }))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(NAMES);
    await user.click(screen.getByRole("option", { name: "Lightning" }));
    expect((value.modifiers as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "extra-damage",
      damageType: "lightning"
    });

    // The `damage-type-is` gate, two rows deep; a mistyped slug here means the rider never fires.
    await user.click(screen.getByRole("button", { name: "Add a condition" }));
    await user.selectOptions(screen.getByLabelText("Condition"), "damage-type-is");
    await user.click(screen.getByRole("combobox", { name: "Damage types" }));
    expect(
      within(screen.getByRole("listbox", { name: "Damage types" }))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(NAMES);

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
          onChange={(next) => {
            setHeld(next);
            value = next;
          }}
          enabled={["grants"]}
          scope="item"
          ctx={EMPTY_CONTEXT}
          idPrefix="hb-equipment"
        />
      );
    }
    const { container } = render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Grant something" }));
    // `GrantsEditor` has no `FieldDef`, so its "What" select has no labelled id; query the DOM directly.
    const what = container.querySelector("select")!;
    await user.selectOptions(what, "damageResistances");

    await user.click(screen.getByRole("combobox", { name: "Which damage resistances" }));
    expect(
      within(screen.getByRole("listbox", { name: "Which damage resistances" }))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(NAMES);

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
          onChange={(next) => {
            setHeld(next);
            value = next;
          }}
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

    // `pick` is set for the control, not per kind; `TagInput` falls back to a plain input for kinds
    // with no vocabulary.
    expect(screen.queryByRole("combobox", { name: "Which languages" })).toBeNull();
    await user.type(screen.getByLabelText("Which languages"), "elvish{Enter}");
    expect((value.grants as { languages?: readonly string[] }).languages).toEqual(["elvish"]);
  });
});

describe("U9 — the eleventh grant kind is a spell PICKER, because a spell id cannot be typed", () => {
  /** A spell id can't be typed reliably, so the spells grant kind uses `CatalogPicker` plus removable
      chips. Driven through the rendered form because `GrantsEditor` has no `FieldDef`. The body half
      (ids become `{id, alwaysPrepared}` and reach a sheet) is in `vocabulary-parity.mirror.test.ts`. */
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
          onChange={(next) => {
            setHeld(next);
            value = next;
          }}
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
    // The item body parses `grants.spells`, but `takeGrants` never reads it for equipped items.
    const user = userEvent.setup();
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>({});
      return (
        <RiderEditor
          value={held}
          onChange={(next) => {
            setHeld(next);
            value = next;
          }}
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

    // No text box to type into.
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

    // The chips are the value, so removing one revokes the grant.
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

/** `GrantsEditor` exposes no control for `grants.when` but rebuilds the bag on every edit, so it must
    carry the gate across. This drives the gesture (a real mount and tap, and the `onChange` payload
    `RecordDetail` would autosave); the body half is `grant-gate-preservation.mirror.test.ts`. */
describe("a gate the editor cannot show is a gate the editor must not drop", () => {
  /** `mindless-rage` as `subclasses.v1.json` ships it, as the opened body. */
  const GATED = {
    grants: {
      conditionImmunities: ["charmed", "frightened"],
      when: [{ type: "while-effect-tag", tags: ["raging"] }]
    }
  } as const;

  function mountGated() {
    let value: Draft = {};
    function Harness() {
      const [held, setHeld] = useState<Draft>(GATED as unknown as Draft);
      return (
        <RiderEditor
          value={held}
          onChange={(next) => {
            setHeld(next);
            value = next;
          }}
          enabled={["grants"]}
          scope="feature"
          ctx={EMPTY_CONTEXT}
          idPrefix="hb-subclass"
        />
      );
    }
    render(<Harness />);
    return { grants: () => value.grants as { conditionImmunities?: readonly string[]; when?: unknown } };
  }

  it("adding a condition to the row keeps the “while raging” gate on the block", async () => {
    const user = userEvent.setup();
    const { grants } = mountGated();

    // The stored block renders as one open row with its two conditions.
    await user.click(screen.getByRole("combobox", { name: "Which condition immunities" }));
    await user.click(screen.getByRole("option", { name: "Paralyzed" }));

    expect(grants().conditionImmunities).toEqual(["charmed", "frightened", "paralyzed"]);
    expect(grants().when, "one tap on a grant row must not silently make the immunity permanent").toEqual([
      { type: "while-effect-tag", tags: ["raging"] }
    ]);
  });
});

/**
 * The weapon `properties` row on screen. The chooser must list the weapon properties and not the
 * masteries: `ctx.weaponProperties` is the union (right for `weapon-property-is`), but a mastery slug
 * like `topple` means nothing in this column and would be silently inert. The engine half is
 * `weapon-properties.mirror.test.ts`.
 */
describe("C3 — a homebrew weapon's Properties row is a visible chooser over the properties alone", () => {
  const PROPERTY_NAMES = WEAPON_PROPERTY_IDS.map(suggestionLabel);

  it("offers all nine properties unprompted, and none of the eight masteries", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Properties"));

    expect(form.options("Properties")).toEqual(PROPERTY_NAMES);
    expect(form.options("Properties")).toContain("Two Handed");
    // Checked per slug so a failure names the leaked mastery.
    for (const mastery of WEAPON_MASTERY_IDS) {
      expect(form.options("Properties"), `${mastery} is a mastery, not a property`).not.toContain(
        suggestionLabel(mastery)
      );
    }
  });

  it("tapping Finesse writes the slug into the weapon block, container and all", async () => {
    const user = userEvent.setup();
    const form = mount();

    await user.click(form.chooser("Properties"));
    await user.click(screen.getByRole("option", { name: "Finesse" }));

    // `inContainer` seeds the rest of the weapon block around the first touch.
    expect(form.body().weapon).toMatchObject({ properties: ["finesse"], rangeFeet: null, longRangeFeet: null });
    // A chosen property leaves the menu.
    await user.click(form.chooser("Properties"));
    expect(form.options("Properties")).not.toContain("Finesse");
  });

  it("a homebrew “duelling” property survives — the column stays open", async () => {
    const user = userEvent.setup();
    const form = mount();

    // The column is an open slug (`z.array(z.string().regex(/^[a-z0-9-]+$/))`), so a GM's own word is legal.
    await user.type(form.chooser("Properties"), "Duelling{Enter}");
    expect((form.body().weapon as { properties?: string[] }).properties).toEqual(["duelling"]);
  });
});
