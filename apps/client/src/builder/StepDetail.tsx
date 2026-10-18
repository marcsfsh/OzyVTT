import type { ReactNode } from "react";
import type {
  ContentBackgroundSummary,
  ContentClassSummary,
  ContentFeatSummary,
  ContentFeatureSummary,
  ContentSpeciesSummary,
  ContentSubclassSummary
} from "@vtt/domain";
import { FeatureList, type FeatureItem } from "@vtt/ui";
import { titleize, type OfferContext, type StepId } from "./build-payload";
import { withArticle } from "@vtt/domain";
import "./step-detail.css";

/**
 * What a class, species, background, subclass or feat is, read from its catalog row. The builder's detail column and
 * the Compendium show these same components, so a record reads the same where it is chosen and where it is looked up.
 */

const ABILITY_WORDS: Readonly<Record<string, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};
const abilityWord = (id: string) => ABILITY_WORDS[id] ?? titleize(id);

/** "Wisdom", "Wisdom and Charisma", "Strength, Dexterity and Wisdom"; "None" for nothing. */
function listed(values: readonly string[], word: (value: string) => string = titleize, joiner = "and"): string {
  const named = values.map(word);
  if (named.length === 0) return "None";
  return named.length === 1 ? named[0]! : `${named.slice(0, -1).join(", ")} ${joiner} ${named.at(-1)}`;
}

/** The level a feature arrives at: its own, or the first level its class table grants it. */
const levelOf = (feature: ContentFeatureSummary) => feature.level ?? feature.grantedAtLevels[0] ?? null;

/**
 * One row per distinct trait name. Content lists per-lineage variants as separate features
 * (Dragonborn's "Breath Weapon (Fire)" etc.), and the repeats say the same thing.
 */
function featureItems(features: readonly ContentFeatureSummary[], limit = 40): FeatureItem[] {
  const seen = new Set<string>();
  const distinct = features.filter((feature) => (seen.has(feature.name) ? false : (seen.add(feature.name), true)));
  return distinct.slice(0, limit).map((feature) => {
    const level = levelOf(feature);
    return {
      id: feature.id,
      title: feature.name,
      meta: level != null ? `Level ${level}` : undefined,
      body: <p>{feature.description}</p>
    };
  });
}

function Facts({ rows }: Readonly<{ rows: ReadonlyArray<readonly [string, ReactNode]> }>) {
  return (
    <dl className="cb-facts">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Intro({ record }: Readonly<{ record: Readonly<{ description: string | null; summary: string | null }> }>) {
  const text = record.description ?? record.summary;
  return text ? <p className="cb-detail-text">{text}</p> : null;
}

/** A class: its summary, its core traits in the words of the SRD's Core Traits table, and its features. */
export function ClassDetail({
  record,
  level,
  table = false
}: Readonly<{
  record: ContentClassSummary;
  /** Only the features up to this level, as the builder shows them for the level being built. */
  level?: number;
  /** The class's table by level, as the Compendium's page shows it. */
  table?: boolean;
}>) {
  const skills =
    record.skillChoiceCount > 0
      ? `Choose ${record.skillChoiceCount}: ${listed(record.skillChoices, titleize, "or")}`
      : "None";
  const features = record.features.filter((feature) => level === undefined || (levelOf(feature) ?? 1) <= level);
  const caster: ReadonlyArray<readonly [string, ReactNode]> = record.spellcasting
    ? [
        [
          "Spellcasting",
          `${abilityWord(record.spellcasting.ability)} · ${titleize(record.spellcasting.progression)} caster`
        ]
      ]
    : [];
  return (
    <div className="cb-detail">
      <Intro record={record} />
      <Facts
        rows={[
          ["Primary ability", listed(record.primaryAbilities, abilityWord)],
          ["Hit Point Die", `${record.hitDie.toUpperCase()} per ${record.name} level`],
          ["Saving throw proficiencies", listed(record.savingThrows, abilityWord)],
          ["Skill proficiencies", skills],
          ["Weapon proficiencies", listed(record.weaponProficiencies)],
          ["Armor training", listed(record.armorProficiencies)],
          ...caster
        ]}
      />
      {table && <ClassTable record={record} />}
      {features.length > 0 && (
        <FeatureList items={featureItems(features)} allowExpandAll ariaLabel={`${record.name} features`} />
      )}
    </div>
  );
}

/** The class's table by level: Proficiency Bonus, the features each level brings, cantrips and spell slots. */
function ClassTable({ record }: Readonly<{ record: ContentClassSummary }>) {
  const at = (level: number) =>
    record.features.filter((feature) =>
      feature.grantedAtLevels.length > 0 ? feature.grantedAtLevels.includes(level) : feature.level === level
    );
  const cantrips = record.levelTable.some((row) => row.cantripsKnown !== null);
  const slots = record.levelTable.some((row) => row.spellSlots !== null || row.pactSlots !== null);
  return (
    <div className="cb-class-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">PB</th>
            <th scope="col">Class features</th>
            {cantrips && <th scope="col">Cantrips</th>}
            {slots && <th scope="col">Spell slots</th>}
          </tr>
        </thead>
        <tbody>
          {record.levelTable.map((row) => (
            <tr key={row.level}>
              <th scope="row" className="tabular">
                {row.level}
              </th>
              <td className="tabular">+{row.proficiencyBonus}</td>
              <td>
                {at(row.level)
                  .map((feature) => feature.name)
                  .join(", ") || "None"}
              </td>
              {cantrips && <td className="tabular">{row.cantripsKnown ?? "None"}</td>}
              {slots && (
                <td className="tabular">
                  {row.pactSlots
                    ? `${row.pactSlots.slots} · level ${row.pactSlots.level}`
                    : row.spellSlots && row.spellSlots.some((count) => count > 0)
                      ? row.spellSlots.filter((count) => count > 0).join(" · ")
                      : "None"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SpeciesDetail({ record }: Readonly<{ record: ContentSpeciesSummary }>) {
  const darkvision: ReadonlyArray<readonly [string, ReactNode]> = record.darkvisionFeet
    ? [["Darkvision", `${record.darkvisionFeet} feet`]]
    : [];
  return (
    <div className="cb-detail">
      <Intro record={record} />
      <Facts
        rows={[
          ["Creature type", titleize(record.creatureType)],
          ["Size", listed(record.sizes, titleize, "or")],
          ["Speed", `${record.speedFeet} feet`],
          ...darkvision
        ]}
      />
      {record.features.length > 0 && (
        <FeatureList
          items={featureItems(record.features)}
          allowExpandAll={record.features.length > 6}
          ariaLabel={`${record.name} traits`}
        />
      )}
    </div>
  );
}

export function BackgroundDetail({
  record,
  featName = titleize
}: Readonly<{ record: ContentBackgroundSummary; featName?: (id: string) => string }>) {
  return (
    <div className="cb-detail">
      <Intro record={record} />
      <Facts
        rows={[
          ["Ability scores", record.abilityOptions ? listed(record.abilityOptions.from, abilityWord) : "None"],
          ["Feat", record.originFeatId ? featName(record.originFeatId) : "None"],
          ["Skill proficiencies", listed(record.skillProficiencies)],
          ["Tool proficiency", listed(record.toolProficiencies)]
        ]}
      />
      {record.features.length > 0 && (
        <FeatureList items={featureItems(record.features)} ariaLabel={`${record.name} features`} />
      )}
    </div>
  );
}

export function SubclassDetail({
  record,
  className
}: Readonly<{ record: ContentSubclassSummary; className?: string }>) {
  return (
    <div className="cb-detail">
      <Intro record={record} />
      {className && <Facts rows={[["Class", className]]} />}
      {record.features.length > 0 && (
        <FeatureList items={featureItems(record.features)} ariaLabel={`${record.name} features`} />
      )}
    </div>
  );
}

export function FeatDetail({ record }: Readonly<{ record: ContentFeatSummary }>) {
  const prerequisite = [
    record.prerequisiteLevel ? `Level ${record.prerequisiteLevel}+` : null,
    ...record.prerequisiteAbilities.map((entry) => `${abilityWord(entry.ability)} ${entry.minimum}+`),
    record.prerequisiteText
  ].filter((part): part is string => Boolean(part));
  return (
    <div className="cb-detail">
      <Intro record={record} />
      <Facts
        rows={[
          ["Category", `${titleize(record.category)} feat`],
          ["Prerequisite", prerequisite.join(", ") || "None"],
          ["Repeatable", record.repeatable ? "Yes" : "No"]
        ]}
      />
      {record.feature.description && <p className="cb-detail-text">{record.feature.description}</p>}
    </div>
  );
}

export function stepDetail(step: StepId, context: OfferContext, level: number): ReactNode {
  if (step === "species" && context.species) return <SpeciesDetail record={context.species} />;
  if (step === "background" && context.background) {
    const feat = context.originFeat;
    return <BackgroundDetail record={context.background} {...(feat ? { featName: () => feat.name } : {})} />;
  }
  if (step === "class" && context.classRecord) return <ClassDetail record={context.classRecord} level={level} />;
  if (step === "features" && context.subclass) return <SubclassDetail record={context.subclass} />;
  return null;
}

/** What the reserved detail column says while it has nothing to show. A subclass pane is reserved
    only when a subclass can be picked; below the subclass level the step body says so and keeps the
    full width. */
export function detailPlaceholder(step: StepId, context: OfferContext, subclassPending: boolean): string | undefined {
  const placeholders: Partial<Record<StepId, string>> = {
    species: "Pick a species to read its traits here.",
    background: "Pick a background to read about it here.",
    class: "Pick a class to read about it here.",
    ...(subclassPending
      ? {}
      : {
          features: context.classRecord?.subclassLabel
            ? `Pick ${withArticle(context.classRecord.subclassLabel.toLowerCase())} to read about it here.`
            : "Pick a subclass to read about it here."
        })
  };
  return placeholders[step];
}
