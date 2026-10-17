/** The spell wizard. Its steps follow the spell card from top to bottom, ending with the spell lists and the text. */

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

/** One answer, because the engine rolls an attack or a save for a cast and never both. */
const LANDS: FieldDef = {
  key: "attackRoll",
  label: "Attack roll or saving throw",
  kind: "select",
  chips: true,
  options: [opt("attack", "An attack roll"), opt("save", "A saving throw"), opt("neither", "Neither")],
  help: "An attack roll is made against the target's Armor Class. A saving throw is made by the target against your spell save DC. Neither means the spell takes effect with no roll.",
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

/** The schema stores these as `true` or leaves them out, so a switch turned off removes the key. */
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

function RangeQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const kind = rangeKindOf(draft);
  const distance = getAt(draft, "range.distance");
  return (
    <div className="hb-field">
      <span className="nh-field-label" id={`${idPrefix}-range-label`}>
        Range
      </span>
      <div className="hb-chips" role="group" aria-labelledby={`${idPrefix}-range-label`}>
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
        <Field label={kind === "feet" ? "Feet" : "Miles"} htmlFor={`${idPrefix}-range-distance`}>
          <NumberField
            id={`${idPrefix}-range-distance`}
            value={typeof distance === "number" ? distance : null}
            min={kind === "feet" ? 5 : 1}
            max={kind === "feet" ? 5280 : 100}
            unit={kind === "feet" ? "ft" : "mi"}
            onChange={(next) => onDraft(withRange(draft, kind, next))}
          />
        </Field>
      )}
      <p className="nh-field-help">
        A distance counts from you. A Self spell starts from you, often as an area such as a Cone. A Touch spell needs
        you to touch the target.
      </p>
    </div>
  );
}

const HEAL_FORMULA = /^(?:\d+d\d+(?:\s*\+\s*\d+)?|\d+)$/i;

/** The engine reads a spell's healing from its text, so this answer is the healing sentence in the description. */
function HealingQuestion({ draft, onDraft, idPrefix }: StepProps) {
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
        label="Hit Points it restores"
        htmlFor={`${idPrefix}-healing`}
        help={
          malformed
            ? undefined
            : "Leave it empty for a spell that heals nothing. The healing goes into the spell's text, where the sheet reads it."
        }
        error={malformed ? `"${typed}" is not a roll the sheet can read. Try 2d8 or 2d8 + 4.` : undefined}
      >
        <Input
          id={`${idPrefix}-healing`}
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
          label="Add the spellcasting ability modifier"
        />
      )}
      {healing && rollOf(draft) !== "" && (
        <p className="nh-field-help hb-field-error">
          A spell that restores Hit Points deals no damage at the table, so its damage roll is ignored. Clear one of
          them.
        </p>
      )}
    </div>
  );
}

const DICE_STEP = /^\d+d\d+$/i;

function ScalingQuestion({ draft, onDraft, idPrefix }: StepProps) {
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
          label="Dice grow at levels 5, 11 and 17"
        />
        <p className="nh-field-help">
          {rolls
            ? "Every SRD damage cantrip rolls one more die at character levels 5, 11 and 17, like Fire Bolt's 2d10, 3d10 and 4d10."
            : "Give it damage or healing first, so there is a roll to grow."}
        </p>
      </div>
    );
  }

  const typed = perSlot.trim();
  const malformed = typed !== "" && !DICE_STEP.test(typed);
  return (
    <div className="hb-field">
      <Field
        label="Extra dice per slot level"
        htmlFor={`${idPrefix}-per-slot`}
        help={
          malformed
            ? undefined
            : rolls
              ? "Fireball adds 1d6 for each spell slot level above 3. Leave it empty for a spell that does not grow."
              : "Give it damage or healing first, so there is a roll to add to."
        }
        error={malformed ? `"${typed}" is not a number of dice. Try 1d6 or 2d8.` : undefined}
      >
        <Input
          id={`${idPrefix}-per-slot`}
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
        label="Extra targets per slot level"
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
          ? "Fill in the effect step first. This then writes a first draft in the SRD's words."
          : "This replaces the text above with a first draft in the SRD's words. Edit it after."}
      </p>
      {phrase && !textNamesArea(draft) && (
        <p className="nh-field-help hb-field-error">
          The text does not name its area as "{phrase}", so the map cannot draw its template. Say it that way, or write
          it from your answers.
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
      title: "Name and level",
      intro: "Every spell has a level from 0 to 9 and a school of magic.",
      owns: ["name", "level", "school"],
      sections: ["basics"],
      questions: [
        ask("spell", "name", { label: "Name", placeholder: "Ember Coil" }),
        ask("spell", "level", {
          label: "Level",
          help: "Level 0 is a cantrip, cast at will. A spell of level 1 or higher needs a spell slot of its level or higher.",
          write: (next, draft) => rescaled(draft, { ...draft, level: next })
        }),
        ask("spell", "school", {
          label: "School of magic",
          kind: "select",
          chips: true,
          options: SCHOOLS,
          help: "The school is the kind of magic, like Evocation for Fireball. A few features name a school."
        })
      ]
    },
    {
      id: "casting",
      title: "Casting",
      owns: ["castingTime", "reactionCondition", "range", "components", "duration", "concentration", "ritual"],
      sections: ["casting"],
      questions: [
        ask("spell", "castingTime", {
          label: "Casting time",
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
          help: "Most spells take an Action. A spell of 1 minute or longer needs the Magic action on each turn of its casting."
        }),
        ask("spell", "reactionCondition", {
          label: "Trigger",
          help: "A Reaction spell says when it can be cast, as Shield does when you are hit by an attack roll."
        }),
        { key: "range", render: (props) => <RangeQuestion {...props} /> },
        ask("spell", "components.verbal", { label: "Verbal (V)", help: "The caster speaks." }),
        ask("spell", "components.somatic", { label: "Somatic (S)", help: "The caster gestures." }),
        ask("spell", "components.material", { label: "Material (M)", help: "The caster holds an object or a focus." }),
        ask("spell", "components.materialText", { label: "Material", placeholder: "a pinch of sulfur" }),
        ask("spell", "components.materialConsumed", { label: "The spell consumes it" }),
        ask("spell", "duration", {
          label: "Duration",
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
          label: "Concentration",
          help: "A caster concentrates on one spell at a time, and taking damage can end it."
        }),
        ask("spell", "ritual", {
          label: "Ritual",
          help: "A Ritual takes 10 minutes longer to cast and needs no spell slot."
        })
      ]
    },
    {
      id: "effect",
      title: "Effect",
      intro: "These are the parts the game rolls when the spell is cast. The text step says the rest.",
      owns: ["attackRoll", "save", "damage", "target", "shape"],
      sections: ["effect"],
      questions: [
        LANDS,
        ask("spell", "save.ability", { label: "Saving throw", chips: true, visibleWhen: hasSave }),
        ask("spell", "save.successDamage", {
          label: "On a successful save",
          chips: true,
          options: [opt("half", "Half damage"), opt("none", "No damage")],
          visibleWhen: hasSave
        }),
        ask("spell", "save.failureConditions", {
          label: "On a failed save, the target also has",
          help: "The condition lasts as long as the spell, unless a switch below ends it sooner.",
          visibleWhen: hasSave
        }),
        saveFlag(
          "repeatSave",
          "It repeats the save at the end of each of its turns",
          "A success ends the condition on it, as with Hold Person."
        ),
        saveFlag("endsOnDamage", "Taking damage ends it early", "Sleep's Unconscious condition ends this way."),
        ask("spell", "damage.roll", {
          label: "Damage",
          placeholder: "8d6",
          emptyValue: "null",
          help: "Leave it empty for a spell with no damage.",
          write: (next, draft) => rescaled(draft, setAt(draft, "damage.roll", next))
        }),
        ask("spell", "damage.types", {
          label: "Damage type",
          help: "A spell like Ice Knife deals two types. The roll deals the first one.",
          visibleWhen: (draft) => rollOf(draft) !== ""
        }),
        { key: "healing", render: (props) => <HealingQuestion {...props} /> },
        ask("spell", "target.type", {
          label: "Target",
          chips: true,
          placeholder: undefined
        }),
        ask("spell", "target.count", {
          label: "Number of targets",
          visibleWhen: (draft) => {
            const type = getAt(draft, "target.type");
            return type === "creature" || type === "object";
          }
        }),
        ask("spell", "shape.type", { label: "Area shape", chips: true, visibleWhen: isArea }),
        ask("spell", "shape.size", {
          label: "Area size",
          help: "A Sphere's radius or a Cube's side. For a Cone or a Line, its length.",
          visibleWhen: isArea
        })
      ]
    },
    {
      id: "scaling",
      title: "At higher levels",
      intro:
        "A spell cast with a higher spell slot often does more. A cantrip grows with the caster's character level.",
      owns: ["castingOptions", "higherLevel"],
      sections: ["effect"],
      questions: [
        { key: "castingOptions", render: (props) => <ScalingQuestion {...props} /> },
        ask("spell", "higherLevel", {
          label: "At Higher Levels text",
          help: "It follows your answers above. Change it if the spell does more."
        })
      ]
    },
    {
      id: "lists",
      title: "Spell lists",
      intro: "A class learns the spells on its spell list. Naming a list here adds the spell to it.",
      owns: ["classes"],
      sections: ["lists"],
      questions: [ask("spell", "classes", { label: "Spell lists" })]
    },
    {
      id: "text",
      title: "Spell text",
      intro: "Players read this on the spell card. The sheet reads healing from it, and the map reads the area.",
      owns: ["description", "attribution"],
      sections: ["basics"],
      questions: [
        ask("spell", "description", { label: "Spell text", help: undefined }),
        { key: "description", render: (props) => <TextHelper {...props} /> },
        ask("spell", "attribution", { label: "Source" })
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
