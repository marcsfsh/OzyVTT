/** The spell wizard: what it is, how it's cast, what it does, how it scales, who can learn it, its text. */

import { useEffect, useState } from "react";
import type { ContentSpellSummary } from "@vtt/domain";
import { MAGIC_SCHOOL_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { spellComponentsText } from "@vtt/content-srd-5.2.1/spell-effect";
import { Button, Chip, Field, Input, NumberField, Stepper, Switch } from "@vtt/ui";
import { SpellCardContent } from "../../encounter/spells";
import { getAt, setAt } from "../paths";
import { opt, type Draft, type FieldDef } from "../schema";
import type { PreviewProps, StepProps, WizardDef } from "./types";
import { ask } from "./questions";
import {
  RANGE_KINDS,
  areaPhrase,
  healingOf,
  rangeKindOf,
  rescaled,
  scalingOf,
  spellTextFor,
  textNamesArea,
  withHealing,
  withRange,
  withScaling
} from "./spell-text";

const SCHOOL_WORDS: Readonly<Record<string, string>> = {
  abjuration: "Abjuration",
  conjuration: "Conjuration",
  divination: "Divination",
  enchantment: "Enchantment",
  evocation: "Evocation",
  illusion: "Illusion",
  necromancy: "Necromancy",
  transmutation: "Transmutation"
};

const hasSave = (draft: Draft) => draft.save !== null && draft.save !== undefined;
const isArea = (draft: Draft) => getAt(draft, "target.type") === "area";
const rollOf = (draft: Draft) => {
  const roll = getAt(draft, "damage.roll");
  return typeof roll === "string" ? roll.trim() : "";
};

/** How the spell reaches its target. One answer, because the engine rolls one or the other. */
const LANDS: FieldDef = {
  key: "attackRoll",
  label: "How it reaches its target",
  kind: "select",
  chips: true,
  options: [opt("attack", "An attack roll"), opt("save", "A saving throw"), opt("neither", "Neither, it just works")],
  help: "An attack roll is against the target's Armor Class; a saving throw is made by the target against your spell save DC.",
  read: (draft) => (draft.attackRoll === true ? "attack" : hasSave(draft) ? "save" : "neither"),
  write: (next, draft) => {
    if (next === "attack") return { ...draft, attackRoll: true, save: null };
    if (next === "save")
      return {
        ...draft,
        attackRoll: false,
        save: (draft.save as Draft | null | undefined) ?? {
          ability: "dex",
          successDamage: "half",
          failureConditions: []
        }
      };
    return { ...draft, attackRoll: false, save: null };
  }
};

/** A save outcome the editor has no switch for, stored as `true` or left out (the schema's `literal(true)`). */
const saveFlag = (key: "repeatSave" | "endsOnDamage", label: string, help: string): FieldDef => ({
  key: `save.${key}`,
  label,
  kind: "switch",
  help,
  visibleWhen: hasSave,
  write: (next, draft) => {
    const save = { ...((draft.save as Record<string, unknown> | null) ?? {}) };
    if (next === true) save[key] = true;
    else delete save[key];
    return { ...draft, save };
  }
});

function RangeQuestion({ draft, onDraft }: StepProps) {
  const kind = rangeKindOf(draft);
  const distance = getAt(draft, "range.distance");
  return (
    <div className="hb-field">
      <span className="nh-field-label" id="hb-wiz-spell-range-label">
        How far it reaches
      </span>
      <div className="hb-chips" role="group" aria-labelledby="hb-wiz-spell-range-label">
        {RANGE_KINDS.map((option) => (
          <Chip
            key={option.value}
            pressed={kind === option.value}
            onClick={() =>
              onDraft(
                withRange(draft, option.value, typeof distance === "number" && kind === option.value ? distance : null)
              )
            }
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {(kind === "feet" || kind === "miles") && (
        <Field label={kind === "feet" ? "How many feet" : "How many miles"}>
          <NumberField
            value={typeof distance === "number" ? distance : null}
            min={kind === "feet" ? 5 : 1}
            max={kind === "feet" ? 5280 : 100}
            unit={kind === "feet" ? "ft" : "mi"}
            onChange={(next) => onDraft(withRange(draft, kind, next))}
          />
        </Field>
      )}
      <p className="nh-field-help">
        A distance is measured from you. Self is for a spell that comes from you, often in an area such as a cone; Touch
        is a creature or object you touch.
      </p>
    </div>
  );
}

const HEAL_FORMULA = /^(?:\d+d\d+(?:\s*\+\s*\d+)?|\d+)$/i;

/** Healing is read from the spell's text, so this answer is the healing sentence in it. */
function HealingQuestion({ draft, onDraft }: StepProps) {
  const healing = healingOf(draft);
  const [text, setText] = useState(healing?.formula ?? "");
  useEffect(() => setText(healing?.formula ?? ""), [healing?.formula]);
  const write = (formula: string, addsModifier: boolean) =>
    onDraft(rescaled(draft, withHealing(draft, formula ? { formula, addsModifier } : null)));
  const typed = text.trim();
  const malformed = typed !== "" && !HEAL_FORMULA.test(typed);
  return (
    <div className="hb-field">
      <Field
        label="Hit points it restores"
        help={
          malformed
            ? undefined
            : "Like 2d8. Leave it empty for a spell that heals nothing. The healing is a sentence in the spell's text, as the SRD writes it; this keeps it there."
        }
        error={malformed ? `“${typed}” isn't a roll the sheet can read. Try 2d8, 2d8 + 4 or 10.` : undefined}
      >
        <Input
          value={text}
          placeholder="2d8"
          invalid={malformed}
          onChange={(event) => {
            setText(event.target.value);
            const next = event.target.value.trim();
            if (next === "" || HEAL_FORMULA.test(next)) write(next, healing?.addsModifier ?? true);
          }}
        />
      </Field>
      {healing && (
        <Switch
          checked={healing.addsModifier}
          onChange={(next) => write(healing.formula, next)}
          label="Plus your spellcasting ability modifier"
        />
      )}
      {healing && rollOf(draft) !== "" && (
        <p className="nh-field-help hb-field-error">
          A spell that heals deals no damage at the table, so its damage roll is ignored. Clear one of them.
        </p>
      )}
    </div>
  );
}

const DICE_STEP = /^\d+d\d+$/i;

function ScalingQuestion({ draft, onDraft }: StepProps) {
  const scaling = scalingOf(draft);
  const level = typeof draft.level === "number" ? draft.level : 1;
  const [perSlot, setPerSlot] = useState(scaling.perSlot ?? "");
  useEffect(() => setPerSlot(scaling.perSlot ?? ""), [scaling.perSlot]);
  const rolls = rollOf(draft) !== "" || healingOf(draft) !== null;

  if (level === 0) {
    return (
      <div className="hb-field">
        <Switch
          checked={scaling.cantripTiers}
          disabled={!rolls}
          onChange={(next) => onDraft(withScaling(draft, { ...scaling, cantripTiers: next }))}
          label="Its dice grow at levels 5, 11 and 17"
        />
        <p className="nh-field-help">
          {rolls
            ? "Every SRD damage cantrip rolls one more die at character levels 5, 11 and 17, like Fire Bolt's 2d10, 3d10 and 4d10."
            : "Give it damage or healing first; a cantrip that rolls nothing has nothing to grow."}
        </p>
      </div>
    );
  }

  const typed = perSlot.trim();
  const malformed = typed !== "" && !DICE_STEP.test(typed);
  return (
    <div className="hb-field">
      <Field
        label="Dice it gains for each slot level above its own"
        help={
          malformed
            ? undefined
            : rolls
              ? "Like Fireball's 1d6: cast with a higher slot, it rolls this many more dice for each level above. Leave it empty if it doesn't grow."
              : "Give it damage or healing first; this adds to that roll."
        }
        error={malformed ? `“${typed}” isn't a number of dice. Try 1d6 or 2d8.` : undefined}
      >
        <Input
          value={perSlot}
          placeholder="1d6"
          disabled={!rolls}
          invalid={malformed}
          onChange={(event) => {
            setPerSlot(event.target.value);
            const next = event.target.value.trim();
            if (next === "" || DICE_STEP.test(next)) onDraft(withScaling(draft, { ...scaling, perSlot: next || null }));
          }}
        />
      </Field>
      <Stepper
        label="More creatures it can target for each slot level above"
        value={scaling.targetsPerSlot ?? 0}
        min={0}
        max={3}
        onChange={(next) => onDraft(withScaling(draft, { ...scaling, targetsPerSlot: next > 0 ? next : null }))}
      />
    </div>
  );
}

function TextHelper({ draft, onDraft }: StepProps) {
  const phrase = areaPhrase(draft);
  const generated = spellTextFor(draft);
  return (
    <div className="hb-field">
      <Button
        variant="secondary"
        disabled={generated === ""}
        onClick={() => onDraft({ ...draft, description: generated })}
      >
        Write it from my answers
      </Button>
      <p className="nh-field-help">
        {generated === ""
          ? "Answer what it does first, and this writes a first draft in the SRD's words."
          : "Replaces the text above with a first draft in the SRD's words, built from your answers. Edit it after."}
      </p>
      {phrase && !textNamesArea(draft) && (
        <p className="nh-field-help hb-field-error">
          The text doesn&rsquo;t name its area as &ldquo;{phrase}&rdquo;, so the map can&rsquo;t draw its template. Say
          it that way, or write it from your answers.
        </p>
      )}
    </div>
  );
}

const SCHOOLS = MAGIC_SCHOOL_IDS.map((id) => opt(id, SCHOOL_WORDS[id] ?? id));

export const SPELL_WIZARD: WizardDef = {
  type: "spell",
  steps: [
    {
      id: "identity",
      title: "What it is",
      intro: "Every spell has a level from 0 to 9 and belongs to one of the eight schools of magic.",
      owns: ["name", "level", "school"],
      sections: ["basics"],
      questions: [
        ask("spell", "name", { label: "Its name", placeholder: "Ember Coil" }),
        ask("spell", "level", {
          label: "Its level",
          help: "0 is a cantrip, cast at will. A spell of level 1 to 9 takes a spell slot of that level or higher.",
          write: (next, draft) => rescaled(draft, { ...draft, level: next })
        }),
        ask("spell", "school", {
          label: "Its school of magic",
          kind: "select",
          chips: true,
          options: SCHOOLS,
          help: "Abjuration protects, Conjuration summons and transports, Divination reveals, Enchantment charms, Evocation unleashes energy, Illusion deceives, Necromancy commands life and death, Transmutation changes things."
        })
      ]
    },
    {
      id: "casting",
      title: "How it's cast",
      owns: ["castingTime", "reactionCondition", "range", "components", "duration", "concentration", "ritual"],
      sections: ["casting"],
      questions: [
        ask("spell", "castingTime", {
          label: "How long it takes to cast",
          presets: [
            opt("Action"),
            opt("Bonus Action"),
            opt("Reaction"),
            opt("1 minute"),
            opt("10 minutes"),
            opt("1 hour"),
            opt("8 hours")
          ],
          placeholder: "Or a time of your own",
          help: "Most spells take an Action. A spell of a minute or longer takes your action on each turn of it."
        }),
        ask("spell", "reactionCondition", {
          label: "What sets it off",
          help: "A Reaction spell says when you can cast it, as the SRD's Shield does."
        }),
        { key: "range", render: (props) => <RangeQuestion {...props} /> },
        ask("spell", "components.verbal", { label: "It needs spoken words (V)" }),
        ask("spell", "components.somatic", { label: "It needs a gesture (S)" }),
        ask("spell", "components.material", { label: "It needs a material (M)" }),
        ask("spell", "components.materialText", { label: "Which material", placeholder: "a pinch of sulfur" }),
        ask("spell", "components.materialConsumed", { label: "The spell uses the material up" }),
        ask("spell", "duration", {
          label: "How long it lasts",
          presets: [
            opt("Instantaneous"),
            opt("1 round"),
            opt("1 minute"),
            opt("10 minutes"),
            opt("1 hour"),
            opt("8 hours"),
            opt("Until dispelled")
          ],
          placeholder: "Or a time of your own"
        }),
        ask("spell", "concentration", {
          label: "It needs Concentration",
          help: "You can concentrate on one spell at a time, and taking damage can end it."
        }),
        ask("spell", "ritual", {
          label: "It can be cast as a Ritual",
          help: "A Ritual takes 10 minutes longer and needs no spell slot."
        })
      ]
    },
    {
      id: "effect",
      title: "What it does",
      intro:
        "Answer the parts the game rolls: how it reaches its target, what it deals or restores, and what it leaves on a target that fails its save.",
      owns: ["attackRoll", "save", "damage", "target", "shape"],
      sections: ["effect"],
      questions: [
        LANDS,
        ask("spell", "save.ability", { label: "Which saving throw", chips: true, visibleWhen: hasSave }),
        ask("spell", "save.successDamage", {
          label: "A target that succeeds takes",
          chips: true,
          options: [opt("half", "Half damage"), opt("none", "No damage")],
          visibleWhen: hasSave
        }),
        ask("spell", "save.failureConditions", {
          label: "A target that fails also has",
          help: "The condition lasts as long as the spell, unless you say how it ends below.",
          visibleWhen: hasSave
        }),
        saveFlag(
          "repeatSave",
          "It repeats the save at the end of each of its turns",
          "A success ends the condition on it, as with Hold Person."
        ),
        saveFlag("endsOnDamage", "Taking damage ends it early", "As with Sleep's Unconscious condition."),
        ask("spell", "damage.roll", {
          label: "Damage it deals",
          placeholder: "8d6",
          emptyValue: "null",
          help: "Like 8d6. Leave it empty for a spell that deals none.",
          write: (next, draft) => rescaled(draft, setAt(draft, "damage.roll", next))
        }),
        ask("spell", "damage.types", {
          label: "Its damage type",
          help: "Two types for a spell like Ice Knife; the first is the one the roll deals.",
          visibleWhen: (draft) => rollOf(draft) !== ""
        }),
        { key: "healing", render: (props) => <HealingQuestion {...props} /> },
        ask("spell", "target.type", {
          label: "What it targets",
          chips: true,
          placeholder: undefined
        }),
        ask("spell", "target.count", {
          label: "How many",
          visibleWhen: (draft) => {
            const type = getAt(draft, "target.type");
            return type === "creature" || type === "object";
          }
        }),
        ask("spell", "shape.type", { label: "The shape of its area", chips: true, visibleWhen: isArea }),
        ask("spell", "shape.size", {
          label: "Its size",
          help: "A sphere's radius; a cone's or a line's length; a cube's side.",
          visibleWhen: isArea
        })
      ]
    },
    {
      id: "scaling",
      title: "How it scales",
      intro: "Cast with a higher spell slot, many spells do more. A cantrip grows with the caster's level instead.",
      owns: ["castingOptions", "higherLevel"],
      sections: ["effect"],
      questions: [
        { key: "castingOptions", render: (props) => <ScalingQuestion {...props} /> },
        ask("spell", "higherLevel", {
          label: "In its own words",
          help: "Written for you from the answers above; change it if the spell does something more."
        })
      ]
    },
    {
      id: "lists",
      title: "Who can learn it",
      intro: "A class can learn the spells on its spell list. Naming a list here puts the spell on it.",
      owns: ["classes"],
      sections: ["lists"],
      questions: [ask("spell", "classes", { label: "The spell lists it is on" })]
    },
    {
      id: "text",
      title: "Its text",
      intro: "The text is what players read on the spell card. Healing and the map's template are read from it.",
      owns: ["description", "attribution"],
      sections: ["basics"],
      questions: [
        ask("spell", "description", { label: "What the spell says", help: undefined }),
        { key: "description", render: (props) => <TextHelper {...props} /> },
        ask("spell", "attribution", { label: "Where it came from" })
      ]
    }
  ],
  Preview: SpellPreview
};

/** The record as the catalog serves it to the card (`content-library.ts`'s spell summary). */
export function spellSummaryOf(draft: Draft, id: string): ContentSpellSummary {
  const range = (draft.range as { distance: number | null; unit: string | null; text: string | null } | undefined) ?? {
    distance: null,
    unit: null,
    text: null
  };
  const components = (draft.components as Parameters<typeof spellComponentsText>[0] | undefined) ?? {
    verbal: false,
    somatic: false,
    material: false,
    materialText: null,
    materialConsumed: false
  };
  return {
    id,
    name: typeof draft.name === "string" && draft.name.trim() ? draft.name : "Untitled spell",
    level: typeof draft.level === "number" ? draft.level : 1,
    school: typeof draft.school === "string" ? draft.school : "",
    castingTime: typeof draft.castingTime === "string" ? draft.castingTime : "",
    rangeText: range.text,
    attackRoll: draft.attackRoll === true,
    rangeFeet: range.unit === "feet" ? range.distance : null,
    componentsText: spellComponentsText(components),
    duration: typeof draft.duration === "string" ? draft.duration : "",
    concentration: draft.concentration === true,
    ritual: draft.ritual === true,
    description: typeof draft.description === "string" ? draft.description : "",
    higherLevel: typeof draft.higherLevel === "string" && draft.higherLevel.trim() ? draft.higherLevel : null,
    classes: Array.isArray(draft.classes) ? (draft.classes as string[]) : [],
    damageRoll: rollOf(draft) || null,
    damageTypes: (getAt(draft, "damage.types") as string[] | undefined) ?? [],
    castingOptions: [],
    cantripScaling: []
  };
}

function SpellPreview({ draft, recordId }: PreviewProps) {
  const spell = spellSummaryOf(draft, recordId);
  return (
    <article className="hb-wiz-card" aria-label={`${spell.name} spell card`}>
      <h4 className="hb-wiz-card-name">{spell.name}</h4>
      <SpellCardContent spell={spell} />
      {spell.classes.length > 0 && (
        <p className="hb-wiz-card-foot">
          On the {spell.classes.map((id) => id.replace(/-/g, " ")).join(", ")} spell lists.
        </p>
      )}
    </article>
  );
}
