/** The wizards for what a character is built from, from a class to a spell list. Their feature steps use the
    editor's own feature form, and each preview shows the record as the character builder lists it. */

import { FeatureList, Field, Select, type FeatureItem } from "@vtt/ui";
import { useBuilderCatalogs, useFeatCatalog } from "../../content/catalogs";
import { FeatureEditor } from "../FeatureEditor";
import { LevelTableEditor } from "../LevelTableEditor";
import { SpellListContents } from "../SpellListContents";
import { getAt } from "../paths";
import { opt, type Draft } from "../schema";
import { ask } from "./questions";
import type { PreviewProps, StepProps, WizardDef, WizardStep } from "./types";

type Feature = Readonly<{ id?: string; name?: string; level?: number; description?: string }>;

const title = (slug: string) =>
  slug
    .split("-")
    .map((word, index) => (index > 0 && word === "of" ? word : word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
const nameOf = (draft: Draft, fallback: string) =>
  typeof draft.name === "string" && draft.name.trim() ? draft.name : fallback;
const textOf = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** The levels a class grants a feature at, from its level table, as the builder counts them. */
function grantLevels(draft: Draft): ReadonlyMap<string, number[]> {
  const out = new Map<string, number[]>();
  const rows = Array.isArray(draft.levelTable)
    ? (draft.levelTable as Array<{ level: number; features?: string[] }>)
    : [];
  for (const row of rows) for (const id of row.features ?? []) out.set(id, [...(out.get(id) ?? []), row.level]);
  return out;
}

const featuresAt = (draft: Draft, key: string): Feature[] => {
  const held = draft[key];
  if (Array.isArray(held)) return held as Feature[];
  return held && typeof held === "object" ? [held as Feature] : [];
};

/** The builder's feature rows: a name, the level it arrives at, its text. */
function featureItems(features: readonly Feature[], levels?: ReadonlyMap<string, number[]>): FeatureItem[] {
  return features.map((feature, index) => {
    const at = (feature.id && levels?.get(feature.id)?.[0]) ?? feature.level;
    return {
      id: feature.id ?? String(index),
      title: feature.name?.trim() || "Unnamed feature",
      meta: at ? `Level ${at}` : undefined,
      body: <p>{feature.description?.trim() || "No text yet."}</p>
    };
  });
}

const identity = (
  type: "class" | "subclass" | "species" | "background" | "feat" | "spell-list",
  word: string
): WizardStep => ({
  id: "identity",
  title: "Name and summary",
  owns: ["name", "summary", "description", "attribution"],
  sections: ["basics"],
  questions: [
    ask(type, "name", { label: "Name" }),
    ask(type, "summary", {
      label: "Summary",
      help: `Write one sentence. It is the whole card for this ${word} in the character builder's list.`
    }),
    ask(type, "description", { label: "Description", help: "The character builder shows it beside the card." }),
    ask(type, "attribution", { label: "Source" })
  ]
});

/* ------------------------------------------------------------------ class ---- */

function ClassLevels({ draft }: StepProps) {
  const levels = grantLevels(draft);
  const features = featuresAt(draft, "features");
  const asi = Array.isArray(draft.asiLevels) ? (draft.asiLevels as number[]) : [];
  const subclassLevel = typeof draft.subclassLevel === "number" ? draft.subclassLevel : null;
  const label = textOf(draft.subclassLabel) ?? "Subclass";
  const rows = Array.from({ length: 20 }, (_, index) => index + 1).map((level) => {
    const names = features
      .filter((feature) => feature.id && levels.get(feature.id)?.includes(level))
      .map((feature) => feature.name?.trim() || "Unnamed feature");
    if (subclassLevel === level) names.push(label);
    if (asi.includes(level)) names.push("Ability Score Improvement");
    return { level, names };
  });
  return (
    <div className="hb-field">
      <span className="nh-field-label">Features by level</span>
      <ol className="hb-wiz-levels">
        {rows.map((row) => (
          <li key={row.level}>
            <span className="hb-wiz-levels-at tabular">Level {row.level}</span>
            <span className={row.names.length === 0 ? "hb-wiz-levels-none" : undefined}>
              {row.names.length > 0 ? row.names.join(", ") : "Nothing new"}
            </span>
          </li>
        ))}
      </ol>
      <p className="nh-field-help">Add features below and pick the level of each. A level can have nothing new.</p>
    </div>
  );
}

function ClassFeatures({ draft, onDraft, ctx }: StepProps) {
  return (
    <FeatureEditor
      draft={draft}
      onDraft={onDraft}
      ctx={ctx}
      featuresKey="features"
      levelAware
      singular="feature"
      idPrefix="hb-wiz-class"
    />
  );
}

function ClassTable({ draft, onDraft, recordId }: StepProps) {
  return <LevelTableEditor draft={draft} onDraft={onDraft} classId={recordId} />;
}

function ClassPreview({ draft }: PreviewProps) {
  const levels = grantLevels(draft);
  const saves = Array.isArray(draft.savingThrows) ? (draft.savingThrows as string[]) : [];
  const armor = Array.isArray(draft.armorProficiencies) ? (draft.armorProficiencies as string[]) : [];
  const weapons = Array.isArray(draft.weaponProficiencies) ? (draft.weaponProficiencies as string[]) : [];
  const features = [...featuresAt(draft, "features")].sort(
    (left, right) => (levels.get(left.id ?? "")?.[0] ?? 21) - (levels.get(right.id ?? "")?.[0] ?? 21)
  );
  return (
    <article className="hb-wiz-card" aria-label={`${nameOf(draft, "Untitled class")} in the character builder`}>
      <h4 className="hb-wiz-card-name">{nameOf(draft, "Untitled class")}</h4>
      {textOf(draft.summary) && <p className="hb-wiz-card-meta">{draft.summary as string}</p>}
      <p className="hb-wiz-card-text">{textOf(draft.description) ?? textOf(draft.summary) ?? "No text yet."}</p>
      <p className="tabular">
        Hit Point Die {typeof draft.hitDie === "string" ? draft.hitDie : "None"} · Saving throws{" "}
        {saves.map((ability) => ability.toUpperCase()).join(", ") || "None"}
      </p>
      <p className="tabular">
        Armor training: {armor.join(", ") || "None"} · Weapons: {weapons.join(", ") || "None"}
      </p>
      {features.length > 0 && (
        <FeatureList items={featureItems(features, levels)} allowExpandAll ariaLabel="Class features" />
      )}
    </article>
  );
}

export const CLASS_WIZARD: WizardDef = {
  type: "class",
  steps: [
    identity("class", "class"),
    {
      id: "core",
      title: "Core traits",
      intro: "These answers fill the top of the class's Core Traits table.",
      owns: ["hitDie", "primaryAbilities", "savingThrows"],
      sections: ["progression"],
      questions: [
        ask("class", "hitDie", {
          label: "Hit Point Die",
          chips: true,
          help: "The Wizard has a d6 and the Barbarian a d12. Most classes sit between them."
        }),
        ask("class", "primaryAbilities", {
          label: "Primary ability",
          help: "A Barbarian relies on Strength and a Wizard on Intelligence. Pick one or two."
        }),
        ask("class", "savingThrows", {
          label: "Saving throw proficiencies",
          help: "Every SRD class has two. One is Dexterity, Constitution or Wisdom, and the other is Strength, Intelligence or Charisma."
        })
      ]
    },
    {
      id: "proficiencies",
      title: "Proficiencies",
      owns: ["armorProficiencies", "weaponProficiencies", "toolProficiencies", "skillChoices", "toolChoices"],
      sections: ["proficiencies"],
      questions: [
        ask("class", "armorProficiencies", { label: "Armor training" }),
        ask("class", "weaponProficiencies", { label: "Weapon proficiencies" }),
        ask("class", "toolProficiencies", { label: "Tool proficiencies" }),
        ask("class", "skillChoices", {
          label: "Skill choices",
          help: "A new character of this class picks this many skills from the list. Most SRD classes offer two."
        })
      ]
    },
    {
      id: "multiclass",
      title: "Multiclassing",
      intro: "These rules apply when a character takes this class after another one.",
      owns: ["multiclassPrerequisites", "multiclassProficiencies"],
      sections: ["advanced"],
      questions: [
        ask("class", "multiclassPrerequisites", { label: "Prerequisites" }),
        ask("class", "multiclassProficiencies", {
          label: "Proficiencies gained",
          help: "These are usually fewer than a level 1 character of the class gets. The SRD's Fighter gives Light and Medium armor, Shields and Martial weapons."
        })
      ]
    },
    {
      id: "equipment",
      title: "Starting equipment",
      intro: "A new character picks one of these bundles, or the gold.",
      owns: ["startingEquipment"],
      sections: ["equipment"],
      questions: [ask("class", "startingEquipment", { label: "Starting bundles" })]
    },
    {
      id: "spellcasting",
      title: "Spellcasting",
      intro:
        "A full caster like the Wizard gains spell slots fastest, and a half caster like the Paladin about half as fast. Pact Magic is the Warlock's: a few slots that come back on a Short Rest.",
      owns: ["spellcasting"],
      sections: ["progression"],
      questions: [
        ask("class", "spellcasting", { label: "Spellcasting", help: "Pick None for a class with no spells." }),
        {
          key: "levelTable",
          render: (props) =>
            props.draft.spellcasting ? (
              <div className="hb-field">
                <span className="nh-field-label">Spell slots</span>
                <ClassTable {...props} />
              </div>
            ) : null
        }
      ]
    },
    {
      id: "levels",
      title: "Subclass and improvements",
      owns: ["subclassLevel", "subclassLabel", "asiLevels"],
      sections: ["progression"],
      questions: [
        ask("class", "subclassLevel", {
          label: "Subclass level",
          help: "Every SRD class gains its subclass at level 3."
        }),
        ask("class", "subclassLabel", { label: "Name for its subclasses", placeholder: "Fighter Subclass" }),
        ask("class", "asiLevels", {
          label: "Ability Score Improvement levels",
          help: "Every SRD class gains one at levels 4, 8, 12 and 16. The Fighter and Rogue gain more."
        })
      ]
    },
    {
      id: "features",
      title: "Features",
      intro: "Each feature arrives at a level of the class.",
      owns: ["features", "levelTable.features"],
      sections: ["features"],
      questions: [
        { key: "levelTable", render: (props) => <ClassLevels {...props} /> },
        { key: "features", render: (props) => <ClassFeatures {...props} /> }
      ]
    },
    {
      id: "table",
      title: "Level table",
      intro:
        "The table fills in the Proficiency Bonus, features and spell slots from your answers. Add any other column a level needs, like Cantrips or Rages.",
      owns: ["levelTable"],
      sections: ["level-table"],
      questions: [{ key: "levelTable", render: (props) => <ClassTable {...props} /> }]
    }
  ],
  Preview: ClassPreview
};

/* --------------------------------------------------------------- subclass ---- */

/** The levels a class's subclasses add features at, read from the subclasses it already has (the Champion's 3, 7,
 *  10, 15 and 18), with the class's own subclass level first. */
function useSubclassLevels(classId: string): readonly number[] {
  const catalogs = useBuilderCatalogs();
  const owner = catalogs.choice.classes.find((entry) => entry.id === classId);
  const levels = new Set<number>(owner?.subclassLevel ? [owner.subclassLevel] : []);
  for (const subclass of catalogs.choice.subclasses)
    if (subclass.classId === classId)
      for (const feature of subclass.features) if (feature.level) levels.add(feature.level);
  return [...levels].sort((left, right) => left - right);
}

function SubclassLevels({ draft }: StepProps) {
  const classId = typeof draft.classId === "string" ? draft.classId : "";
  const levels = useSubclassLevels(classId);
  const features = featuresAt(draft, "features");
  if (!classId)
    return <p className="nh-field-help">Choose its class first. The class sets the levels of subclass features.</p>;
  return (
    <div className="hb-field">
      <span className="nh-field-label">Subclass feature levels</span>
      {levels.length === 0 ? (
        <p className="nh-field-help">
          No subclass of this class exists yet to read the levels from. Start at its subclass level.
        </p>
      ) : (
        <ol className="hb-wiz-levels">
          {levels.map((level) => {
            const here = features
              .filter((feature) => feature.level === level)
              .map((feature) => feature.name?.trim() || "Unnamed feature");
            return (
              <li key={level}>
                <span className="hb-wiz-levels-at tabular">Level {level}</span>
                <span className={here.length === 0 ? "hb-wiz-levels-none" : undefined}>
                  {here.length > 0 ? here.join(", ") : "Nothing yet"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="nh-field-help">Add a feature below for each level and pick its level.</p>
    </div>
  );
}

function SubclassFeatures({ draft, onDraft, ctx }: StepProps) {
  return (
    <FeatureEditor
      draft={draft}
      onDraft={onDraft}
      ctx={ctx}
      featuresKey="features"
      levelAware
      singular="feature"
      idPrefix="hb-wiz-subclass"
    />
  );
}

function FeaturesPreview({ draft, featuresKey, word }: PreviewProps & Readonly<{ featuresKey: string; word: string }>) {
  const features = [...featuresAt(draft, featuresKey)].sort((left, right) => (left.level ?? 0) - (right.level ?? 0));
  return (
    <article className="hb-wiz-card" aria-label={`${nameOf(draft, `Untitled ${word}`)} in the character builder`}>
      <h4 className="hb-wiz-card-name">{nameOf(draft, `Untitled ${word}`)}</h4>
      {textOf(draft.summary) && <p className="hb-wiz-card-meta">{draft.summary as string}</p>}
      <p className="hb-wiz-card-text">{textOf(draft.description) ?? textOf(draft.summary) ?? "No text yet."}</p>
      {word === "species" && (
        <p className="tabular">
          {(Array.isArray(draft.sizes) ? (draft.sizes as string[]) : []).map(title).join(" or ") || "No size"} · Speed{" "}
          {typeof draft.speedFeet === "number" ? draft.speedFeet : 0} ft.
          {typeof draft.darkvisionFeet === "number" && draft.darkvisionFeet > 0
            ? ` · Darkvision ${draft.darkvisionFeet} ft.`
            : ""}
        </p>
      )}
      {word === "background" && <BackgroundLines draft={draft} />}
      {features.length > 0 ? (
        <FeatureList
          items={featureItems(features)}
          allowExpandAll={features.length > 6}
          ariaLabel={`${title(word)} features`}
        />
      ) : (
        <p className="nh-field-help">No {word === "species" ? "traits" : "features"} yet.</p>
      )}
    </article>
  );
}

function BackgroundLines({ draft }: Readonly<{ draft: Draft }>) {
  const feats = useFeatCatalog();
  const skills = Array.isArray(draft.skillProficiencies) ? (draft.skillProficiencies as string[]) : [];
  const abilities = (getAt(draft, "abilityOptions.from") as string[] | undefined) ?? [];
  const featId = typeof draft.originFeatId === "string" ? draft.originFeatId : "";
  const feat = feats.items.find((entry) => entry.id === featId)?.name ?? (featId ? title(featId) : "None");
  return (
    <>
      <p className="tabular">Skills: {skills.map(title).join(", ") || "None"}</p>
      <p className="tabular">
        Ability scores: {abilities.map((ability) => ability.toUpperCase()).join(", ") || "None"} · Origin feat: {feat}
      </p>
    </>
  );
}

export const SUBCLASS_WIZARD: WizardDef = {
  type: "subclass",
  steps: [
    identity("subclass", "subclass"),
    {
      id: "class",
      title: "Class",
      intro: "A subclass belongs to one class and is chosen at that class's subclass level.",
      owns: ["classId", "subclassLevel", "spellcasting"],
      sections: ["belongs-to"],
      questions: [
        ask("subclass", "classId", { label: "Class" }),
        ask("subclass", "subclassLevel", {
          label: "Subclass level",
          help: "Leave it at the class's own level unless this subclass is chosen earlier."
        })
      ]
    },
    {
      id: "features",
      title: "Features",
      intro: "A subclass adds features at the levels its class sets aside for them.",
      owns: ["features"],
      sections: ["features"],
      questions: [
        { key: "levels", render: (props) => <SubclassLevels {...props} /> },
        { key: "features", render: (props) => <SubclassFeatures {...props} /> }
      ]
    }
  ],
  Preview: (props) => <FeaturesPreview {...props} featuresKey="features" word="subclass" />
};

/* ---------------------------------------------------------------- species ---- */

function SpeciesTraits({ draft, onDraft, ctx }: StepProps) {
  return (
    <FeatureEditor
      draft={draft}
      onDraft={onDraft}
      ctx={ctx}
      featuresKey="traits"
      singular="trait"
      idPrefix="hb-wiz-species"
    />
  );
}

export const SPECIES_WIZARD: WizardDef = {
  type: "species",
  steps: [
    identity("species", "species"),
    {
      id: "body",
      title: "Size and speed",
      owns: ["sizes", "speedFeet", "darkvisionFeet", "creatureType"],
      sections: ["body"],
      questions: [
        ask("species", "sizes", { label: "Size", help: "With both sizes picked, the player chooses Small or Medium." }),
        ask("species", "speedFeet", { label: "Speed", help: "Most SRD species have 30 feet." }),
        ask("species", "darkvisionFeet", {
          label: "Darkvision",
          help: "Most species with Darkvision see 60 feet. Leave it empty for none."
        }),
        ask("species", "creatureType", { label: "Type", help: "Every SRD species is a Humanoid." })
      ]
    },
    {
      id: "languages",
      title: "Languages",
      owns: ["languages", "languageChoices"],
      sections: ["languages"],
      questions: [ask("species", "languages", { label: "Languages" })]
    },
    {
      id: "traits",
      title: "Traits",
      intro: "Every member of the species has these traits, like Darkvision or a Breath Weapon.",
      owns: ["traits"],
      sections: ["traits"],
      questions: [{ key: "traits", render: (props) => <SpeciesTraits {...props} /> }]
    },
    {
      id: "lineages",
      title: "Lineages",
      intro:
        "A lineage is a branch of the species a player picks, like an Elf's Drow or High Elf. Many species have none.",
      owns: ["lineages"],
      sections: ["lineages"],
      questions: [ask("species", "lineages", { label: "Lineages" })]
    }
  ],
  Preview: (props) => <FeaturesPreview {...props} featuresKey="traits" word="species" />
};

/* ------------------------------------------------------------- background ---- */

function OriginFeat({ draft, onDraft, idPrefix }: StepProps) {
  const feats = useFeatCatalog();
  const origin = feats.items.filter((feat) => feat.category === "origin");
  const value = typeof draft.originFeatId === "string" ? draft.originFeatId : "";
  return (
    <Field
      label="Origin feat"
      htmlFor={`${idPrefix}-feat`}
      help="Every SRD background grants one Origin feat, like Alert or Magic Initiate."
    >
      <Select
        id={`${idPrefix}-feat`}
        value={value}
        onChange={(event) => {
          const { originFeatId: _old, ...rest } = draft;
          onDraft(event.target.value ? { ...rest, originFeatId: event.target.value } : rest);
        }}
      >
        <option value="">Not set</option>
        {(origin.length > 0 ? origin : feats.items).map((feat) => (
          <option key={feat.id} value={feat.id}>
            {feat.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function BackgroundFeatures({ draft, onDraft, ctx }: StepProps) {
  return (
    <FeatureEditor
      draft={draft}
      onDraft={onDraft}
      ctx={ctx}
      featuresKey="features"
      singular="feature"
      idPrefix="hb-wiz-background"
    />
  );
}

export const BACKGROUND_WIZARD: WizardDef = {
  type: "background",
  steps: [
    identity("background", "background"),
    {
      id: "abilities",
      title: "Ability scores",
      intro: "A background raises three ability scores, split +2 and +1 or +1 to each, as the player chooses.",
      owns: ["abilityOptions"],
      sections: ["origin"],
      questions: [ask("background", "abilityOptions", { label: "Abilities it can raise" })]
    },
    {
      id: "feat",
      title: "Origin feat",
      owns: ["originFeatId"],
      sections: ["origin"],
      questions: [{ key: "originFeatId", render: (props) => <OriginFeat {...props} /> }]
    },
    {
      id: "proficiencies",
      title: "Proficiencies",
      intro: "Every SRD background gives two skills and one tool.",
      owns: ["skillProficiencies", "toolProficiencies"],
      sections: ["proficiencies"],
      questions: [
        ask("background", "skillProficiencies", { label: "Skill proficiencies" }),
        ask("background", "toolProficiencies", { label: "Tool proficiency" })
      ]
    },
    {
      id: "equipment",
      title: "Starting equipment",
      intro: "An SRD background offers a bundle of gear or 50 GP.",
      owns: ["startingEquipment"],
      sections: ["equipment"],
      questions: [ask("background", "startingEquipment", { label: "Starting bundles" })]
    },
    {
      id: "features",
      title: "Other features",
      intro:
        "SRD backgrounds have no features of their own, since the Origin feat does that work. Add one if yours needs it.",
      owns: ["features"],
      sections: ["features"],
      questions: [{ key: "features", render: (props) => <BackgroundFeatures {...props} /> }]
    }
  ],
  Preview: (props) => <FeaturesPreview {...props} featuresKey="features" word="background" />
};

/* ------------------------------------------------------------------- feat ---- */

function FeatEffect({ draft, onDraft, ctx }: StepProps) {
  return (
    <FeatureEditor
      draft={draft}
      onDraft={onDraft}
      ctx={ctx}
      featuresKey="feature"
      single
      singular="feature"
      idPrefix="hb-wiz-feat"
    />
  );
}

export const FEAT_WIZARD: WizardDef = {
  type: "feat",
  steps: [
    identity("feat", "feat"),
    {
      id: "category",
      title: "Category and prerequisite",
      intro:
        "An Origin feat comes with a background at level 1. A General feat can replace an Ability Score Improvement from level 4.",
      owns: ["category", "repeatable", "prerequisite"],
      sections: ["category"],
      questions: [
        ask("feat", "category", {
          label: "Category",
          kind: "select",
          chips: true,
          pick: false,
          options: (ctx) =>
            ctx.featCategories.length > 0
              ? ctx.featCategories
              : [
                  opt("origin", "Origin"),
                  opt("general", "General"),
                  opt("fighting-style", "Fighting Style"),
                  opt("epic-boon", "Epic Boon")
                ]
        }),
        ask("feat", "repeatable", { label: "Repeatable" }),
        ask("feat", "prerequisite", { label: "Prerequisite" })
      ]
    },
    {
      id: "feature",
      title: "Benefit",
      intro: "Write the benefit in the feat's words. Then add what the game rolls or counts for it.",
      owns: ["feature"],
      sections: ["feature"],
      questions: [{ key: "feature", render: (props) => <FeatEffect {...props} /> }]
    }
  ],
  Preview: (props) => <FeaturesPreview {...props} featuresKey="feature" word="feat" />
};

/* ------------------------------------------------------------- spell list ---- */

function ListContents({ draft, onDraft, ctx, recordId, spells }: StepProps) {
  return <SpellListContents draft={draft} onDraft={onDraft} ctx={ctx} listId={recordId} spells={spells} />;
}

function SpellListPreview({ draft, recordId, ctx }: PreviewProps) {
  const basedOn = Array.isArray(draft.basedOn) ? (draft.basedOn as string[]) : [];
  const add = new Set(Array.isArray(draft.add) ? (draft.add as string[]) : []);
  const remove = new Set(Array.isArray(draft.remove) ? (draft.remove as string[]) : []);
  const byId = new Map(ctx.spells.map((spell) => [spell.id, spell]));
  return (
    <article className="hb-wiz-card" aria-label={`${nameOf(draft, "Untitled spell list")} spells`}>
      <h4 className="hb-wiz-card-name">{nameOf(draft, "Untitled spell list")}</h4>
      <p className="hb-wiz-card-text">{textOf(draft.description) ?? textOf(draft.summary) ?? "No text yet."}</p>
      <p className="tabular">
        {basedOn.length > 0 ? `Starts from ${basedOn.map(title).join(", ")}` : "Starts empty"} · {add.size} added ·{" "}
        {remove.size} removed
      </p>
      {add.size > 0 && (
        <ul className="hb-wiz-card-list">
          {[...add].map((id) => (
            <li key={id}>
              {byId.get(id)?.name ?? title(id)}
              {byId.get(id)?.meta ? ` · ${byId.get(id)!.meta}` : ""}
            </li>
          ))}
        </ul>
      )}
      <p className="nh-field-help">Spells that name this list ({recordId}) in their own lists also join it.</p>
    </article>
  );
}

export const SPELL_LIST_WIZARD: WizardDef = {
  type: "spell-list",
  steps: [
    identity("spell-list", "spell list"),
    {
      id: "contents",
      title: "Spells",
      intro: "Start from an SRD list and change it, or build the list spell by spell.",
      owns: ["basedOn", "add", "remove"],
      sections: ["contents"],
      questions: [
        ask("spell-list", "basedOn", { label: "Starts from" }),
        { key: "add", render: (props) => <ListContents {...props} /> }
      ]
    }
  ],
  Preview: SpellListPreview
};
