/** The monster wizard: who it is (with its challenge rating, which sets the Proficiency Bonus and XP), how it
    defends, its ability scores, traits, actions, bonus actions, reactions and legendary actions, as a stat block. */

import { useId } from "react";
import { CREATURE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { CHALLENGE_RATINGS, HIT_DIE_BY_SIZE, experienceForChallenge, monsterHitPoints } from "@vtt/rules-5e";
import { Chip, Field, FieldGrid, Input, NumberField, RowEditor, Select, Stepper, Switch, Textarea } from "@vtt/ui";
import { opt, type Draft, type FieldDef } from "../schema";
import { MonsterActions } from "./MonsterActions";
import { MonsterBenchmarks } from "./MonsterBenchmarks";
import { StatBlockPreview } from "./StatBlockPreview";
import { ask } from "./questions";
import {
  ABILITY_IDS,
  ABILITY_NAMES,
  SENSES,
  SPEED_MODES,
  challengeOf,
  hitDiceOf,
  modifierOf,
  proficiencyOf,
  proficientSaves,
  scoresOf,
  sensesOf,
  signed,
  sizeOf,
  skillTiers,
  speedsOf,
  statblockOf,
  withChallenge,
  withHitDice,
  withHover,
  withIdentity,
  withSaves,
  withScore,
  withSense,
  withSize,
  withSkills,
  withSpeed,
  withStatblock,
  type AbilityId,
  type Tier
} from "./monster-build";
import { withName } from "./monster-actions";
import type { StepProps, WizardDef } from "./types";

const ratingWords = (rating: number) =>
  rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);
const title = (slug: string) =>
  slug
    .split("-")
    .map((word, index) => (index > 0 && word === "of" ? word : word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

/** A key of the stat-block bag the editor doesn't ask, as a wizard question. */
const statblockField = (key: string, words: Partial<FieldDef>): FieldDef => ({
  key,
  label: key,
  ...words,
  read: (draft) => statblockOf(draft)[key],
  write: (next, draft) =>
    withStatblock(draft, { [key]: typeof next === "string" && next.trim() === "" ? undefined : next })
});

const ALIGNMENTS = [
  "lawful good",
  "neutral good",
  "chaotic good",
  "lawful neutral",
  "neutral",
  "chaotic neutral",
  "lawful evil",
  "neutral evil",
  "chaotic evil",
  "unaligned"
].map((alignment) => opt(alignment, title(alignment)));

/* --------------------------------------------------------------- identity ---- */

function ChallengeQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const rating = challengeOf(draft);
  return (
    <div className="hb-field">
      <Field
        label="Its challenge rating"
        htmlFor={`${idPrefix}-cr`}
        help="How hard a fight it is for a party of four at that level. It sets the Proficiency Bonus and the XP, as every SRD stat block does."
      >
        <Select
          id={`${idPrefix}-cr`}
          value={rating === null ? "" : String(rating)}
          onChange={(event) => {
            if (event.target.value !== "") onDraft(withChallenge(draft, Number(event.target.value)));
          }}
        >
          <option value="">Not set</option>
          {CHALLENGE_RATINGS.map((value) => (
            <option key={value} value={String(value)}>
              CR {ratingWords(value)}
            </option>
          ))}
        </Select>
      </Field>
      {rating !== null && (
        <p className="hb-wiz-derived tabular">
          CR {ratingWords(rating)} · XP {experienceForChallenge(rating)?.toLocaleString("en") ?? "None"} · Proficiency
          Bonus {signed(proficiencyOf(draft))}
        </p>
      )}
      <MonsterBenchmarks draft={draft} keys={["armorClass", "hitPoints", "attackBonus", "saveDc", "damagePerRound"]} />
    </div>
  );
}

/* --------------------------------------------------------------- defences ---- */

function HitPointsQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const size = sizeOf(draft);
  const con = scoresOf(draft).con;
  const dice = hitDiceOf(draft);
  const preview = monsterHitPoints(dice ?? 1, size, con);
  return (
    <div className="hb-field">
      <Field
        label="Its Hit Point Dice"
        htmlFor={`${idPrefix}-hd`}
        help={`A ${title(size)} monster rolls d${HIT_DIE_BY_SIZE[size]}s, and adds its Constitution modifier (${signed(modifierOf(con))}) once for each die.`}
      >
        <NumberField
          id={`${idPrefix}-hd`}
          value={dice}
          min={1}
          max={60}
          placeholder="How many dice"
          onChange={(next) => {
            if (next !== null) onDraft(withHitDice(draft, next));
          }}
        />
      </Field>
      {dice !== null && (
        <p className="hb-wiz-derived tabular">
          {preview.average} Hit Points ({preview.formula})
        </p>
      )}
    </div>
  );
}

const SPEED_WORDS: Readonly<Record<(typeof SPEED_MODES)[number], string>> = {
  walk: "Walking",
  fly: "Flying",
  swim: "Swimming",
  climb: "Climbing",
  burrow: "Burrowing"
};

function SpeedsQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const speeds = speedsOf(draft);
  return (
    <div className="hb-field">
      <span className="nh-field-label">How it moves</span>
      <FieldGrid min="8rem">
        {SPEED_MODES.map((mode) => (
          <Field key={mode} label={SPEED_WORDS[mode]} htmlFor={`${idPrefix}-speed-${mode}`}>
            <NumberField
              id={`${idPrefix}-speed-${mode}`}
              value={typeof speeds[mode] === "number" && (mode === "walk" || speeds[mode]! > 0) ? speeds[mode]! : null}
              min={0}
              max={200}
              unit="ft"
              placeholder={mode === "walk" ? "30" : "None"}
              onChange={(next) => onDraft(withSpeed(draft, mode, next))}
            />
          </Field>
        ))}
      </FieldGrid>
      {typeof speeds.fly === "number" && speeds.fly > 0 && (
        <Switch
          checked={speeds.hover === true}
          onChange={(next) => onDraft(withHover(draft, next))}
          label="It hovers"
        />
      )}
      <p className="nh-field-help">
        A swimming or climbing speed lets it move that way without spending extra movement.
      </p>
    </div>
  );
}

function SavesQuestion({ draft, onDraft }: StepProps) {
  const id = useId();
  const saves = proficientSaves(draft);
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  return (
    <div className="hb-field">
      <span className="nh-field-label" id={id}>
        The saving throws it is proficient in
      </span>
      <div className="hb-chips" role="group" aria-labelledby={id}>
        {ABILITY_IDS.map((ability) => {
          const on = saves.has(ability);
          const total = modifierOf(scores[ability]) + (on ? proficiency : 0);
          return (
            <Chip
              key={ability}
              pressed={on}
              onClick={() => {
                const next = new Set(saves);
                if (on) next.delete(ability);
                else next.add(ability);
                onDraft(withSaves(draft, next));
              }}
            >
              {ABILITY_NAMES[ability]} {signed(total)}
            </Chip>
          );
        })}
      </div>
      <p className="nh-field-help">
        A proficient save adds its Proficiency Bonus ({signed(proficiency)}). Most monsters have none or two.
      </p>
    </div>
  );
}

const SENSE_WORDS: Readonly<Record<(typeof SENSES)[number], string>> = {
  blindsight: "Blindsight",
  darkvision: "Darkvision",
  tremorsense: "Tremorsense",
  truesight: "Truesight"
};

function SensesQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const senses = sensesOf(draft);
  const perception = statblockOf(draft).passivePerception;
  return (
    <div className="hb-field">
      <span className="nh-field-label">What it senses</span>
      <FieldGrid min="8rem">
        {SENSES.map((sense) => (
          <Field key={sense} label={SENSE_WORDS[sense]} htmlFor={`${idPrefix}-sense-${sense}`}>
            <NumberField
              id={`${idPrefix}-sense-${sense}`}
              value={senses[sense] ?? null}
              min={0}
              max={300}
              unit="ft"
              placeholder="None"
              onChange={(next) => onDraft(withSense(draft, sense, next))}
            />
          </Field>
        ))}
      </FieldGrid>
      <p className="nh-field-help">
        Blindsight sees without eyes, Darkvision sees in darkness as dim light, Tremorsense feels movement through the
        ground, Truesight sees through illusions and invisibility.
        {typeof perception === "number" ? ` Its Passive Perception is ${perception}.` : ""}
      </p>
    </div>
  );
}

/* --------------------------------------------------------- ability scores ---- */

function AbilityScoresQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const scores = scoresOf(draft);
  return (
    <div className="hb-field">
      <span className="nh-field-label">Its ability scores</span>
      <div className="hb-wiz-abilities">
        {ABILITY_IDS.map((ability) => (
          <Field key={ability} label={ABILITY_NAMES[ability]} htmlFor={`${idPrefix}-${ability}`}>
            <NumberField
              id={`${idPrefix}-${ability}`}
              value={scores[ability]}
              min={1}
              max={30}
              onChange={(next) => onDraft(withScore(draft, ability as AbilityId, next ?? 10))}
            />
            <span className="hb-wiz-modifier tabular" aria-label={`${ABILITY_NAMES[ability]} modifier`}>
              {signed(modifierOf(scores[ability]))}
            </span>
          </Field>
        ))}
      </div>
      <p className="nh-field-help">
        10 is a typical person&rsquo;s score. Its saves, skills, Initiative and Hit Points follow these numbers.
      </p>
    </div>
  );
}

const SKILLS = [
  "acrobatics",
  "animal-handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight-of-hand",
  "stealth",
  "survival"
];

function SkillsQuestion({ draft, onDraft }: StepProps) {
  const id = useId();
  const tiers = skillTiers(draft);
  const proficiency = proficiencyOf(draft);
  const totals = (statblockOf(draft).skills as Record<string, number> | undefined) ?? {};
  /** Each tap moves a skill along: not proficient, proficient, Expertise, and back. */
  const cycle = (skill: string) => {
    const next = new Map<string, Tier>(tiers);
    const held = tiers.get(skill);
    if (!held) next.set(skill, "proficient");
    else if (held === "proficient") next.set(skill, "expertise");
    else next.delete(skill);
    onDraft(withSkills(draft, next));
  };
  return (
    <div className="hb-field">
      <span className="nh-field-label" id={id}>
        The skills it is proficient in
      </span>
      <div className="hb-chips" role="group" aria-labelledby={id}>
        {SKILLS.map((skill) => {
          const tier = tiers.get(skill);
          return (
            <Chip key={skill} pressed={!!tier} onClick={() => cycle(skill)}>
              {title(skill)}
              {tier ? ` ${signed(totals[skill] ?? 0)}${tier === "expertise" ? " (Expertise)" : ""}` : ""}
            </Chip>
          );
        })}
      </div>
      <p className="nh-field-help">
        A proficient skill adds its Proficiency Bonus ({signed(proficiency)}); tap again for Expertise, which adds it
        twice, and a third time to clear it.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ traits ---- */

type Trait = { name: string; description: string };
const traitsOf = (draft: Draft): Trait[] =>
  Array.isArray(statblockOf(draft).traits) ? (statblockOf(draft).traits as Trait[]) : [];

/** Traits are text the sheet prints; the bag has no id for them, so a row's key is its position at mount. */
function TraitsQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const traits = traitsOf(draft);
  const keyed = traits.map((trait, index) => ({ ...trait, key: `${index}` }));
  const write = (next: ReadonlyArray<Trait>) =>
    onDraft(
      withStatblock(draft, {
        traits: next.map((trait) => ({ name: trait.name, description: trait.description }))
      })
    );
  return (
    <RowEditor
      rows={keyed}
      onChange={(next) => write(next)}
      rowKey={(trait) => trait.key}
      onAdd={() => ({ name: "", description: "", key: `${traits.length}` })}
      addLabel="Add a trait"
      emptyText="No traits. A trait is always true of it, like Amphibious or Pack Tactics."
      collapsible
      max={12}
      maxReachedReason="Twelve traits is as many as this stat block holds."
      ariaLabel="Traits"
      rowLabel={(trait) => trait.name || "Unnamed trait"}
      renderRow={(trait, index) => (
        <FieldGrid>
          <Field label="Its name" htmlFor={`${idPrefix}-trait-${index}-name`}>
            <Input
              id={`${idPrefix}-trait-${index}-name`}
              value={trait.name}
              placeholder="Pack Tactics"
              onChange={(event) =>
                write(traits.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))
              }
            />
          </Field>
          <Field label="What it does" htmlFor={`${idPrefix}-trait-${index}-text`} className="nh-fieldgrid-wide">
            <Textarea
              id={`${idPrefix}-trait-${index}-text`}
              rows={3}
              value={trait.description}
              placeholder="The wolf has Advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature."
              onChange={(event) =>
                write(traits.map((entry, i) => (i === index ? { ...entry, description: event.target.value } : entry)))
              }
            />
          </Field>
        </FieldGrid>
      )}
    />
  );
}

/* --------------------------------------------------------------- legendary ---- */

const LEGENDARY_RESISTANCE = /^Legendary Resistance \(\d+\/Day/;

/** Legendary Resistance is both the count the engine spends and the trait the stat block prints; they move
 *  together. */
function withLegendaryResistance(draft: Draft, perDay: number | null): Draft {
  const legendary = { ...((draft.legendary as Record<string, unknown> | undefined) ?? {}) };
  if (perDay) legendary.resistancesPerDay = perDay;
  else delete legendary.resistancesPerDay;
  const creature = (typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "creature").toLowerCase();
  const others = traitsOf(draft).filter((trait) => !LEGENDARY_RESISTANCE.test(trait.name));
  const traits = perDay
    ? [
        ...others,
        {
          name: `Legendary Resistance (${perDay}/Day)`,
          description: `If the ${creature} fails a saving throw, it can choose to succeed instead.`
        }
      ]
    : others;
  const { legendary: _old, ...rest } = draft as Record<string, unknown>;
  const next = Object.keys(legendary).length > 0 ? { ...rest, legendary } : rest;
  return withStatblock(next, { traits });
}

function LegendaryQuestion({ draft, onDraft, idPrefix }: StepProps) {
  const legendary = draft.legendary as { actionsPerRound?: number; resistancesPerDay?: number } | undefined;
  const isLegendary = legendary?.actionsPerRound !== undefined;
  return (
    <div className="hb-field">
      <Switch
        checked={isLegendary}
        onChange={(next) => {
          const { actionsPerRound: _actions, ...rest } = legendary ?? {};
          const nextLegendary = next ? { ...rest, actionsPerRound: 3 } : rest;
          const { legendary: _old, ...body } = draft as Record<string, unknown>;
          const cleared = next
            ? body
            : {
                ...body,
                actions: ((body.actions as Array<Record<string, unknown>>) ?? []).filter((action) => !action.legendary)
              };
          onDraft(Object.keys(nextLegendary).length > 0 ? { ...cleared, legendary: nextLegendary } : cleared);
        }}
        label="It takes legendary actions"
      />
      <p className="nh-field-help">
        A legendary monster acts again on other creatures&rsquo; turns, spending a few uses each round that come back at
        the start of its own turn. Turning this off removes its legendary actions.
      </p>
      {isLegendary && (
        <Stepper
          label="Legendary actions each round"
          value={legendary?.actionsPerRound ?? 3}
          min={1}
          max={5}
          onChange={(actionsPerRound) => onDraft({ ...draft, legendary: { ...legendary, actionsPerRound } })}
        />
      )}
      <Stepper
        label="Legendary Resistance each day"
        value={legendary?.resistancesPerDay ?? 0}
        min={0}
        max={6}
        onChange={(perDay) => onDraft(withLegendaryResistance(draft, perDay > 0 ? perDay : null))}
      />
      <p className="nh-field-help">
        When it fails a saving throw it can succeed instead, this many times between long rests. Most legendary monsters
        have 3.
      </p>
      {isLegendary && <MonsterActions draft={draft} onDraft={onDraft} activation="legendary" idPrefix={idPrefix} />}
    </div>
  );
}

/* ----------------------------------------------------------------- the wizard ---- */

export const MONSTER_WIZARD: WizardDef = {
  type: "monster",
  steps: [
    {
      id: "identity",
      title: "Who it is",
      intro: "Its size, its creature type and its challenge rating are the first line of any stat block.",
      owns: ["name", "size", "extensions", "proficiencyBonus", "summary", "token"],
      sections: ["identity"],
      questions: [
        ask("monster", "name", {
          label: "Its name",
          placeholder: "Ash Hound",
          write: (next, draft) => withName(draft, typeof next === "string" ? next : "")
        }),
        ask("monster", "size", {
          label: "Its size",
          chips: true,
          help: "Tiny and Small fit a 5-foot square with others; Large takes 10 feet, Huge 15 and Gargantuan 20 or more.",
          write: (next, draft) => withSize(draft, (next as ReturnType<typeof sizeOf>) ?? "medium")
        }),
        ask("monster", "type", {
          label: "Its creature type",
          kind: "select",
          chips: true,
          options: CREATURE_TYPE_IDS.map((id) => opt(id, title(id))),
          help: "Some rules and spells name a type, like a paladin's Divine Smite against Fiends and Undead.",
          write: (next, draft) => withIdentity(draft, { type: typeof next === "string" ? next : undefined })
        }),
        statblockField("alignment", {
          label: "Its alignment",
          presets: ALIGNMENTS,
          placeholder: "Or in your own words",
          write: (next, draft) =>
            withIdentity(draft, { alignment: typeof next === "string" && next.trim() ? next : undefined })
        }),
        { key: "extensions", render: (props) => <ChallengeQuestion {...props} /> },
        ask("monster", "summary", {
          label: "Its line in the bestiary",
          help: "Written from your answers above until you change it."
        })
      ]
    },
    {
      id: "defences",
      title: "How it defends",
      owns: [
        "armorClass",
        "hitPoints",
        "speedFeet",
        "damageResistances",
        "damageImmunities",
        "damageVulnerabilities",
        "conditionImmunities"
      ],
      sections: ["defences"],
      questions: [
        ask("monster", "armorClass", {
          label: "Its Armor Class",
          help: "10 plus its Dexterity modifier with no armor."
        }),
        statblockField("armorDetail", { label: "What gives it that AC", placeholder: "natural armor" }),
        {
          key: "armorClass",
          render: (props) => <MonsterBenchmarks draft={props.draft} keys={["armorClass"]} />
        },
        { key: "hitPoints", render: (props) => <HitPointsQuestion {...props} /> },
        ask("monster", "hitPoints.maximum", {
          label: "Its Hit Points",
          help: "Set from its Hit Point Dice; change it to set your own."
        }),
        { key: "hitPoints.formula", render: (props) => <MonsterBenchmarks draft={props.draft} keys={["hitPoints"]} /> },
        { key: "speedFeet", render: (props) => <SpeedsQuestion {...props} /> },
        { key: "savingThrows", render: (props) => <SavesQuestion {...props} /> },
        ask("monster", "damageResistances", {
          label: "Damage it resists",
          help: "It takes half damage of these types."
        }),
        ask("monster", "damageImmunities", {
          label: "Damage it is immune to",
          help: "It takes no damage of these types."
        }),
        ask("monster", "damageVulnerabilities", {
          label: "Damage it is vulnerable to",
          help: "It takes double damage of these types."
        }),
        ask("monster", "conditionImmunities", { label: "Conditions it is immune to", pick: true }),
        { key: "senses", render: (props) => <SensesQuestion {...props} /> },
        statblockField("languages", {
          label: "The languages it knows",
          presets: [opt("Common"), opt("Common plus one other language"), opt("Understands Common but can't speak")],
          placeholder: "Or in your own words"
        })
      ]
    },
    {
      id: "abilities",
      title: "Its abilities",
      owns: ["abilityScores", "initiativeBonus"],
      sections: ["abilities"],
      questions: [
        { key: "abilityScores", render: (props) => <AbilityScoresQuestion {...props} /> },
        { key: "skills", render: (props) => <SkillsQuestion {...props} /> },
        ask("monster", "initiativeBonus", {
          label: "Its Initiative bonus",
          help: "Its Dexterity modifier, which follows its score; raise it for a monster that acts quickly."
        })
      ]
    },
    {
      id: "traits",
      title: "Its traits",
      intro: "Traits are always true of it, or true in a situation the trait names. The sheet prints them for you.",
      owns: [],
      sections: [],
      questions: [{ key: "traits", render: (props) => <TraitsQuestion {...props} /> }]
    },
    {
      id: "actions",
      title: "Its actions",
      intro:
        "What it does on its turn: its attacks, a breath or a gaze that forces a saving throw, and a Multiattack that makes several attacks as one action.",
      owns: ["actions"],
      sections: ["actions"],
      questions: [
        {
          key: "actions",
          render: (props) => (
            <MonsterBenchmarks draft={props.draft} keys={["attackBonus", "saveDc", "damagePerRound"]} />
          )
        },
        {
          key: "actions",
          render: (props) => (
            <MonsterActions draft={props.draft} onDraft={props.onDraft} activation="action" idPrefix={props.idPrefix} />
          )
        }
      ]
    },
    {
      id: "bonus-actions",
      title: "Bonus actions",
      intro: "Something it does as well as its action, like a goblin's Nimble Escape. Most monsters have none.",
      owns: [],
      sections: [],
      questions: [
        {
          key: "actions",
          render: (props) => (
            <MonsterActions
              draft={props.draft}
              onDraft={props.onDraft}
              activation="bonus-action"
              idPrefix={props.idPrefix}
            />
          )
        }
      ]
    },
    {
      id: "reactions",
      title: "Reactions",
      intro: "Something it does in answer to a trigger, even on another creature's turn, like a knight's Parry.",
      owns: [],
      sections: [],
      questions: [
        {
          key: "actions",
          render: (props) => (
            <MonsterActions
              draft={props.draft}
              onDraft={props.onDraft}
              activation="reaction"
              idPrefix={props.idPrefix}
            />
          )
        }
      ]
    },
    {
      id: "legendary",
      title: "Legendary actions",
      owns: ["legendary"],
      sections: ["token"],
      questions: [{ key: "legendary", render: (props) => <LegendaryQuestion {...props} /> }]
    }
  ],
  Preview: StatBlockPreview
};
