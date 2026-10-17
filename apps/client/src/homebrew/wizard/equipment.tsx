/** The item wizard. Its steps branch on the kind of item, and a magic item gets two more steps for its rarity and
    its powers. */

import { useEffect, useState } from "react";
import type { ContentEquipmentSummary } from "@vtt/domain";
import { RARITY_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { Chip, Field, Input, Select } from "@vtt/ui";
import { metaLine } from "../../encounter/equipment";
import { newId } from "../../lib/ids";
import { RiderEditor, ITEM_RIDERS } from "../RiderEditor";
import { SUB_OBJECT_DEFAULTS } from "../defaults";
import { getAt } from "../paths";
import { opt, type Draft } from "../schema";
import { DAMAGE_TYPES } from "../vocabulary";
import { ChipGroup } from "./MonsterActions";
import { ask } from "./questions";
import type { PreviewProps, StepProps, WizardDef } from "./types";

export type ItemKind = "weapon" | "armor" | "shield" | "gear" | "consumable" | "ammunition" | "wondrous";

const KINDS: ReadonlyArray<Readonly<{ value: ItemKind; label: string }>> = [
  { value: "weapon", label: "Weapon" },
  { value: "armor", label: "Armor" },
  { value: "shield", label: "Shield" },
  { value: "gear", label: "Gear or tool" },
  { value: "consumable", label: "Potion, scroll or other consumable" },
  { value: "ammunition", label: "Ammunition" },
  { value: "wondrous", label: "Wondrous item, ring, wand or staff" }
];

const WORN_SLOTS = new Set([
  "head",
  "eyes",
  "neck",
  "shoulders",
  "body",
  "hands",
  "bracers",
  "ring",
  "belt",
  "feet",
  "wondrous",
  "held"
]);

/** What the item is, read from the record as the engine reads it: its stat blocks first, then its slot. */
export function itemKindOf(draft: Draft): ItemKind {
  const slot = typeof draft.slot === "string" ? draft.slot : "";
  const category = typeof draft.category === "string" ? draft.category : "";
  if (draft.weapon) return "weapon";
  if (draft.armor) return category === "shield" || slot === "shield" ? "shield" : "armor";
  if (category === "ammunition" || slot === "ammunition") return "ammunition";
  if (draft.consumedOnUse === true || category === "consumable" || slot === "consumable") return "consumable";
  if (WORN_SLOTS.has(slot) || ["wondrous-item", "ring", "wand", "staff", "rod"].includes(category)) return "wondrous";
  return "gear";
}

/** The record as its new kind, with that kind's category, slot and stat block. A block left from another kind
 *  goes, since the schema is strict and a stray block would derive the wrong thing. */
export function withItemKind(draft: Draft, kind: ItemKind): Draft {
  const {
    weapon: _weapon,
    armor: _armor,
    consumedOnUse: _consumed,
    spellScroll: _scroll,
    ammunition: _ammunition,
    slot: _slot,
    ...rest
  } = draft as Record<string, unknown>;
  switch (kind) {
    case "weapon":
      return {
        ...rest,
        category: "weapon",
        slot: "weapon",
        weapon: (draft.weapon as Draft | undefined) ?? { ...SUB_OBJECT_DEFAULTS.equipment!.weapon }
      };
    case "armor":
      return {
        ...rest,
        category: "armor",
        slot: "armor",
        armor:
          draft.armor && draft.category !== "shield"
            ? draft.armor
            : { ...SUB_OBJECT_DEFAULTS.equipment!.armor, addDexModifier: true }
      };
    case "shield":
      // A shield's block carries its bonus, +2 for every shield the SRD prints.
      return {
        ...rest,
        category: "shield",
        slot: "shield",
        armor: {
          acBase: 2,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: false,
          strengthRequired: null
        }
      };
    case "consumable":
      return { ...rest, category: "consumable", slot: "consumable", consumedOnUse: true };
    case "ammunition":
      return {
        ...rest,
        category: "ammunition",
        slot: "ammunition",
        ammunition: (draft.ammunition as Draft | undefined) ?? { kind: "arrow", count: 20 }
      };
    case "wondrous":
      return { ...rest, category: "wondrous-item", slot: "wondrous", isMagic: true };
    default:
      return { ...rest, category: "adventuring-gear" };
  }
}

const isKind =
  (...kinds: ItemKind[]) =>
  (draft: Draft) =>
    kinds.includes(itemKindOf(draft));
const isMagic = (draft: Draft) => draft.isMagic === true;

function KindQuestion({ draft, onDraft, idPrefix }: StepProps) {
  return (
    <ChipGroup
      label="Kind"
      id={`${idPrefix}-kind`}
      options={KINDS}
      value={itemKindOf(draft)}
      onChange={(next) => onDraft(withItemKind(draft, next as ItemKind))}
      help="The kind decides how a sheet uses it. A weapon makes attacks, and armor or a shield sets Armor Class."
    />
  );
}

/* ------------------------------------------------------------------ armor ---- */

type ArmorBand = "light" | "medium" | "heavy";

const bandOf = (draft: Draft): ArmorBand | null => {
  const armor = draft.armor as { addDexModifier?: boolean; dexModifierCap?: number | null } | undefined;
  if (!armor) return null;
  if (!armor.addDexModifier) return "heavy";
  return armor.dexModifierCap === 2 ? "medium" : "light";
};

/** The SRD's three bands, as the Dexterity rule each one carries. */
function ArmorBandQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const band = bandOf(draft);
  return (
    <ChipGroup
      label="Category"
      id={`${idPrefix}-band`}
      options={[
        { value: "light", label: "Light" },
        { value: "medium", label: "Medium" },
        { value: "heavy", label: "Heavy" }
      ]}
      value={band ?? ""}
      onChange={(next) => {
        const armor = { ...((draft.armor as Draft | undefined) ?? SUB_OBJECT_DEFAULTS.equipment!.armor) };
        onDraft({
          ...draft,
          armor: {
            ...armor,
            addDexModifier: next !== "heavy",
            dexModifierCap: next === "medium" ? 2 : null
          }
        });
      }}
      help="Light armor adds the whole Dexterity modifier. Medium armor adds up to +2 of it, and Heavy armor adds none."
    />
  );
}

/* ------------------------------------------------------------------ magic ---- */

type Modifier = Record<string, unknown> & { type?: string; amount?: number };
const modifiersOf = (draft: Draft): Modifier[] =>
  Array.isArray(draft.modifiers) ? (draft.modifiers as Modifier[]) : [];

/** The amount on the first modifier of a type, or 0 when it has none. */
const bonusOf = (draft: Draft, type: string) =>
  modifiersOf(draft).find((modifier) => modifier.type === type)?.amount ?? 0;

/** Rows of these types replaced by one each at `amount` (none at 0), shaped as the rider form's own rows are. */
function withBonus(
  draft: Draft,
  types: readonly string[],
  amount: number,
  extra: Readonly<Record<string, unknown>> = {}
) {
  const kept = modifiersOf(draft).filter((modifier) => !types.includes(String(modifier.type)));
  const added = amount === 0 ? [] : types.map((type) => ({ rowId: newId(), type, amount, ...extra }));
  return { ...draft, modifiers: [...kept, ...added] };
}

const BONUSES = [
  { value: "0", label: "None" },
  { value: "1", label: "+1" },
  { value: "2", label: "+2" },
  { value: "3", label: "+3" }
];

/** The magic most SRD items have, as the rows the full rider form would write. Anything else is below. */
function CommonMagic({ draft, onDraft, idPrefix }: StepProps) {
  const kind = itemKindOf(draft);
  const resistance = ((getAt(draft, "grants.damageResistances") as string[] | undefined) ?? [])[0] ?? "";
  return (
    <div className="hb-wiz-questions">
      {kind === "weapon" && (
        <ChipGroup
          label="Attack and damage bonus"
          id={`${idPrefix}-weapon-bonus`}
          options={BONUSES}
          value={String(bonusOf(draft, "attack-bonus"))}
          onChange={(next) => onDraft(withBonus(draft, ["attack-bonus", "damage-bonus"], Number(next)))}
        />
      )}
      {kind !== "weapon" && kind !== "consumable" && kind !== "ammunition" && (
        <ChipGroup
          label="Armor Class bonus while worn"
          id={`${idPrefix}-ac-bonus`}
          options={BONUSES}
          value={String(bonusOf(draft, "armor-class"))}
          onChange={(next) => onDraft(withBonus(draft, ["armor-class"], Number(next), { whileArmored: false }))}
          help="A Cloak of Protection gives +1."
        />
      )}
      {kind !== "consumable" && kind !== "ammunition" && (
        <ChipGroup
          label="Saving throw bonus"
          id={`${idPrefix}-save-bonus`}
          options={BONUSES}
          value={String(bonusOf(draft, "save-bonus"))}
          onChange={(next) => onDraft(withBonus(draft, ["save-bonus"], Number(next)))}
        />
      )}
      {kind !== "consumable" && kind !== "ammunition" && (
        <Field
          label="Damage resistance"
          htmlFor={`${idPrefix}-resists`}
          help="While the item is worn, the wearer takes half damage of this type."
        >
          <Select
            id={`${idPrefix}-resists`}
            value={resistance}
            onChange={(event) => {
              const grants = { ...((draft.grants as Draft | undefined) ?? {}) };
              const next = event.target.value;
              onDraft({ ...draft, grants: { ...grants, damageResistances: next ? [next] : [] } });
            }}
          >
            <option value="">None</option>
            {DAMAGE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}

/** A potion's one use: the action a sheet drinks it with. It restores Hit Points as the SRD's Potion of Healing
 *  does. */
function HealingUse({ draft, onDraft, idPrefix }: StepProps) {
  const actions = Array.isArray(draft.actions) ? (draft.actions as Draft[]) : [];
  const use = actions.find((action) => action.id === "use");
  const formula = (use?.healing as { formula?: string } | undefined)?.formula ?? "";
  const [text, setText] = useState(formula);
  useEffect(() => setText(formula), [formula]);
  const name = typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "it";
  const write = (next: string) => {
    const others = actions.filter((action) => action.id !== "use");
    if (!next) return onDraft({ ...draft, actions: others });
    onDraft({
      ...draft,
      actions: [
        ...others,
        {
          id: "use",
          name: `Drink ${name}`,
          activation: "bonus-action",
          description: `The drinker regains ${next} Hit Points.`,
          damage: [],
          healing: { formula: next }
        }
      ]
    });
  };
  const typed = text.trim();
  const malformed = typed !== "" && !/^\d+d\d+(?:\s*\+\s*\d+)?$|^\d+$/.test(typed);
  return (
    <Field
      label="Hit Points when drunk"
      htmlFor={`${idPrefix}-heals`}
      help={
        malformed
          ? undefined
          : "A Potion of Healing restores 2d4 + 2. The sheet drinks it as a Bonus Action. Leave it empty for a potion that heals nothing."
      }
      error={malformed ? `"${typed}" is not a roll the sheet can read. Try 2d4 + 2.` : undefined}
    >
      <Input
        id={`${idPrefix}-heals`}
        value={text}
        placeholder="2d4 + 2"
        invalid={malformed}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.value.trim();
          if (next === "" || /^\d+d\d+(?:\s*\+\s*\d+)?$|^\d+$/.test(next)) write(next);
        }}
      />
    </Field>
  );
}

function MoreMagic({ draft, onDraft, ctx, idPrefix }: StepProps) {
  return (
    <details className="hb-wiz-more">
      <summary className="hb-section-summary">More powers</summary>
      <RiderEditor value={draft} onChange={onDraft} enabled={ITEM_RIDERS} scope="item" ctx={ctx} idPrefix={idPrefix} />
    </details>
  );
}

/* ------------------------------------------------------------------- text ---- */

const RARITY_WORDS = (rarity: string) => rarity.replace(/-/g, " ");

/** The SRD's first line for an item, like "Weapon (Longsword), Rare (Requires Attunement)." The sheet shows rarity
 *  and attunement only in this line. */
export function typeLineOf(draft: Draft): string {
  const kind = itemKindOf(draft);
  const word: Readonly<Record<ItemKind, string>> = {
    weapon: "Weapon",
    armor: "Armor",
    shield: "Armor (Shield)",
    gear: "Adventuring Gear",
    consumable: "Potion",
    ammunition: "Ammunition",
    wondrous: "Wondrous Item"
  };
  const rarity = typeof draft.rarity === "string" && draft.isMagic === true ? RARITY_WORDS(draft.rarity) : null;
  const attunes = getAt(draft, "attunement.required") === true;
  const head = [word[kind], rarity ? `${rarity.charAt(0).toUpperCase()}${rarity.slice(1)}` : null]
    .filter(Boolean)
    .join(", ");
  return `${head}${attunes ? " (Requires Attunement)" : ""}.`;
}

function TextHelper({ draft, onDraft }: StepProps) {
  const line = typeLineOf(draft);
  const text = typeof draft.description === "string" ? draft.description : "";
  const has = text.startsWith(line);
  return (
    <div className="hb-field">
      <Chip
        disabled={has}
        onClick={() =>
          onDraft({ ...draft, description: `${line}${text.trim() ? ` ${text.replace(/^[^.]*\.\s*/, "")}` : ""}` })
        }
      >
        {`Start it with "${line}"`}
      </Chip>
      <p className="nh-field-help">
        The SRD starts every magic item's text with this line. It is where the sheet shows rarity and attunement.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- preview ---- */

/** The record as the catalog serves it to the equipment picker and a sheet's inventory. */
export function equipmentSummaryOf(draft: Draft, id: string): ContentEquipmentSummary {
  const weapon = draft.weapon as ContentEquipmentSummary["weapon"] | undefined;
  const armor = draft.armor as ContentEquipmentSummary["armor"] | undefined;
  return {
    id,
    name: typeof draft.name === "string" && draft.name.trim() ? draft.name : "Untitled item",
    category: typeof draft.category === "string" ? draft.category : "gear",
    costGp: typeof draft.costGp === "number" ? draft.costGp : null,
    weightLb: typeof draft.weightLb === "number" ? draft.weightLb : null,
    description: typeof draft.description === "string" ? draft.description : null,
    weapon: weapon ?? null,
    armor: armor && typeof armor.acBase === "number" ? armor : null,
    appliesTo: null
  } as ContentEquipmentSummary;
}

function ItemPreview({ draft, recordId }: PreviewProps) {
  const item = equipmentSummaryOf(draft, recordId);
  const effects = [
    bonusOf(draft, "attack-bonus")
      ? `${bonusOf(draft, "attack-bonus") > 0 ? "+" : ""}${bonusOf(draft, "attack-bonus")} to hit and damage`
      : null,
    bonusOf(draft, "armor-class")
      ? `${bonusOf(draft, "armor-class") > 0 ? "+" : ""}${bonusOf(draft, "armor-class")} AC`
      : null,
    bonusOf(draft, "save-bonus")
      ? `${bonusOf(draft, "save-bonus") > 0 ? "+" : ""}${bonusOf(draft, "save-bonus")} to saving throws`
      : null
  ].filter(Boolean);
  return (
    <article className="hb-wiz-card" aria-label={`${item.name} item card`}>
      <h4 className="hb-wiz-card-name">{item.name}</h4>
      <p className="hb-wiz-card-meta tabular">{metaLine(item)}</p>
      {effects.length > 0 && <p className="hb-wiz-card-meta tabular">{effects.join(" · ")}</p>}
      {item.description ? (
        <p className="hb-wiz-card-text">{item.description}</p>
      ) : (
        <p className="hb-wiz-card-text">No text yet.</p>
      )}
    </article>
  );
}

/* ----------------------------------------------------------------- wizard ---- */

export const EQUIPMENT_WIZARD: WizardDef = {
  type: "equipment",
  steps: [
    {
      id: "identity",
      title: "Name and kind",
      owns: ["name", "category", "slot", "isMagic"],
      sections: ["basics"],
      questions: [
        ask("equipment", "name", { label: "Name", placeholder: "Lantern of Embers" }),
        { key: "category", render: (props) => <KindQuestion {...props} /> },
        ask("equipment", "isMagic", {
          label: "Magic item",
          help: "A magic item has a rarity and powers of its own.",
          visibleWhen: (draft) => itemKindOf(draft) !== "wondrous"
        })
      ]
    },
    {
      id: "weapon",
      title: "Weapon",
      intro: "These answers match the columns of the SRD's Weapons table.",
      owns: ["weapon"],
      sections: ["weapon"],
      visibleWhen: isKind("weapon"),
      questions: [
        ask("equipment", "weapon.category", { label: "Simple or Martial", chips: true }),
        ask("equipment", "weapon.melee", { label: "Melee or Ranged", chips: true }),
        ask("equipment", "weapon.damageDice", { label: "Damage dice", help: "A Longsword deals 1d8." }),
        ask("equipment", "weapon.damageType", { label: "Damage type" }),
        ask("equipment", "weapon.properties", { label: "Properties" }),
        ask("equipment", "weapon.versatileDice", {
          label: "Versatile damage",
          visibleWhen: (draft) =>
            ((getAt(draft, "weapon.properties") as string[] | undefined) ?? []).includes("versatile")
        }),
        ask("equipment", "weapon.rangeFeet", {
          label: "Normal range",
          help: "Leave both ranges empty for a melee weapon without the Thrown property."
        }),
        ask("equipment", "weapon.longRangeFeet", { label: "Long range" }),
        ask("equipment", "weapon.ammunition", {
          label: "Ammunition",
          visibleWhen: (draft) =>
            ((getAt(draft, "weapon.properties") as string[] | undefined) ?? []).includes("ammunition")
        }),
        ask("equipment", "weapon.mastery", { label: "Mastery property" })
      ]
    },
    {
      id: "armor",
      title: "Armor",
      owns: ["armor"],
      sections: ["armor"],
      visibleWhen: isKind("armor", "shield"),
      questions: [
        {
          key: "armor.addDexModifier",
          render: (props) => (itemKindOf(props.draft) === "armor" ? <ArmorBandQuestion {...props} /> : null)
        },
        ask("equipment", "armor.acBase", {
          label: "Armor Class",
          help: "Body armor has a base AC, like 16 for Chain Mail. A shield has a bonus, +2 for every SRD shield."
        }),
        ask("equipment", "armor.strengthRequired", {
          label: "Strength needed",
          help: "A wearer with a lower score has 10 feet less Speed. Heavy armor usually has one.",
          visibleWhen: isKind("armor")
        }),
        ask("equipment", "armor.stealthDisadvantage", {
          label: "Disadvantage on Stealth checks",
          visibleWhen: isKind("armor")
        })
      ]
    },
    {
      id: "use",
      title: "Use",
      owns: ["consumedOnUse", "spellScroll", "ammunition", "slot"],
      sections: ["basics"],
      visibleWhen: isKind("consumable", "ammunition", "wondrous"),
      questions: [
        ask("equipment", "slot", {
          label: "Where it is worn or held",
          visibleWhen: isKind("wondrous")
        }),
        ask("equipment", "spellScroll", { label: "Spell Scroll of", visibleWhen: isKind("consumable") }),
        {
          key: "actions",
          render: (props) => (itemKindOf(props.draft) === "consumable" ? <HealingUse {...props} /> : null)
        },
        ask("equipment", "ammunition.kind", { label: "Piece", visibleWhen: isKind("ammunition") }),
        ask("equipment", "ammunition.count", { label: "Pieces in one bundle", visibleWhen: isKind("ammunition") })
      ]
    },
    {
      id: "magic",
      title: "Rarity and attunement",
      intro:
        "A magic item's rarity is a guide to its power. Attuning to one takes a Short Rest, and a character can be attuned to three at once.",
      owns: ["rarity", "attunement", "cursed", "charges"],
      sections: ["magic"],
      visibleWhen: isMagic,
      questions: [
        ask("equipment", "rarity", {
          label: "Rarity",
          kind: "select",
          chips: true,
          pick: false,
          options: RARITY_IDS.map((id) =>
            opt(
              id,
              id.replace(/-/g, " ").replace(/^./, (letter) => letter.toUpperCase())
            )
          )
        }),
        ask("equipment", "attunement.required", { label: "Requires Attunement" }),
        ask("equipment", "attunement.restrictedTo", { label: "Who can attune to it" }),
        ask("equipment", "cursed", { label: "Cursed" }),
        ask("equipment", "charges.regain", { label: "Charges regained each dawn" }),
        ask("equipment", "charges.lastChargeRoll", { label: "Roll a d20 when the last charge is spent" })
      ]
    },
    {
      id: "powers",
      title: "Powers",
      intro:
        "Most SRD magic items do one of these. Anything else, like a spell it casts or an action it gives, is below.",
      owns: [
        "modifiers",
        "grants",
        "uses",
        "actions",
        "effects",
        "tags",
        "casts",
        "grantsFeatIds",
        "appliesTo",
        "damageTypeChoice",
        "vulnerableToOtherChoices",
        "removesArmorDrawbacks"
      ],
      sections: ["magic"],
      visibleWhen: isMagic,
      questions: [
        { key: "modifiers", render: (props) => <CommonMagic {...props} /> },
        ask("equipment", "casts", { label: "Spells it casts" }),
        { key: "actions", render: (props) => <MoreMagic {...props} /> }
      ]
    },
    {
      id: "value",
      title: "Cost and weight",
      owns: ["costGp", "weightLb"],
      sections: ["basics"],
      questions: [
        ask("equipment", "costGp", { label: "Cost", help: "Leave it empty for a magic item, which has no set price." }),
        ask("equipment", "weightLb", { label: "Weight" })
      ]
    },
    {
      id: "text",
      title: "Item text",
      intro: "A player reads this text in the inventory.",
      owns: ["description"],
      sections: ["basics"],
      questions: [
        { key: "description", render: (props) => <TextHelper {...props} /> },
        ask("equipment", "description", { label: "Text" })
      ]
    }
  ],
  Preview: ItemPreview
};
