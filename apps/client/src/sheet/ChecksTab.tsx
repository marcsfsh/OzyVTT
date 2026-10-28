import { useState, type ReactNode } from "react";
import { withArticle, type ActorDefinition, type ActorDerivedSheet, type DerivedDefence } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { ABILITIES, abilityModifier, saveBonus, skillBonus, type Ability } from "@vtt/rules-5e";
import { useSkillCatalog } from "../content/catalogs";
import { signed, titleCase } from "../encounter/format";
import { modeLabel } from "../encounter/roll-mode-notes";
import { RollModeNotes, RollModeTag } from "../encounter/RollModeTag";
import type { SrdExtension } from "../encounter/sheet-extension";
import { HelpAnAlly } from "./HelpAnAlly";
import { ToolUses } from "./ToolUses";
import { ABILITY_WORDS, exhaustionLevel, type SheetActor, type SheetState } from "./sheet-model";
import type { Quarry } from "./useSheetController";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

/** One skill as the sheet shows it: the server's bonus and tier when it has answered, the stat block's until then. */
export type SkillRow = Readonly<{
  id: string;
  name: string;
  ability: Ability | null;
  bonus: number | null;
  tier: "proficient" | "expertise" | undefined;
  sources: readonly string[];
  mode: ActorDerivedSheet["skills"][number]["mode"] | undefined;
  reliableTalent: boolean;
}>;

/** The skills in the catalog's order by name, each with the number the server would roll. */
export function useSkillRows(definition: ActorDefinition, derived: ActorDerivedSheet | null): SkillRow[] {
  const catalog = useSkillCatalog();
  return [...catalog.items]
    .map((skill) => {
      const ability = (ABILITIES as readonly string[]).includes(skill.ability ?? "")
        ? (skill.ability as Ability)
        : null;
      const row = derived?.skills.find((entry) => entry.id === skill.id) ?? null;
      const baseTier = definition.proficiencies?.skills.find((entry) => entry.id === skill.id)?.proficiency;
      const effective = row?.tier ?? baseTier ?? "none";
      const bonus = row
        ? row.bonus
        : ability
          ? skillBonus(definition.abilityScores[ability], definition.proficiencyBonus, baseTier ?? "none")
          : null;
      return {
        id: skill.id,
        name: skill.name,
        ability,
        bonus,
        tier: effective === "none" ? undefined : effective,
        sources: row?.sources ?? [],
        mode: row?.mode,
        reliableTalent: row?.reliableTalent ?? false
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** A skill's roll button, named for what it rolls and why it has Advantage or Disadvantage. */
export function SkillButton({
  skill,
  rolls,
  label = false
}: Readonly<{ skill: SkillRow; rolls: SheetRolls; label?: boolean }>) {
  if (skill.bonus === null || !skill.ability)
    return (
      <span className="cs-roll is-static" title={`${skill.name} names no ability, so it has no bonus to roll`}>
        None
      </span>
    );
  return (
    <button
      type="button"
      className={`cs-roll${skill.tier ? " is-proficient" : ""}${label ? " has-label" : ""}`}
      disabled={rolls.rolling}
      aria-label={`Roll ${skill.name}, ${signed(skill.bonus)}${modeLabel(skill.mode)}${skill.reliableTalent ? ", Reliable Talent" : ""}`}
      onClick={() =>
        void rolls.rollCheck(
          { ability: skill.ability!, skill: skill.id },
          `${ABILITY_WORDS[skill.ability!]} (${skill.name})`
        )
      }
    >
      {label && <span className="cs-roll-label">{skill.name}</span>}
      <strong>{signed(skill.bonus)}</strong>
      <RollModeTag mode={skill.mode} />
    </button>
  );
}

/** The situations the character's gear and features name (a Book's topic, prying with a Crowbar), each a toggle the
 *  next check it fits carries to the server. The GM judges whether the check really fits. */
export function CheckSituations({
  situations,
  rolls
}: Readonly<{ situations: ActorDerivedSheet["situations"]; rolls: SheetRolls }>) {
  if (situations.length === 0) return null;
  return (
    <div className="cs-situations" role="group" aria-label="Situations">
      <span className="cs-eyebrow">Situations</span>
      <p className="cs-sub">Turn one on, then roll the check it fits. Your GM decides whether it does.</p>
      <div className="cs-chiprow">
        {situations.map((situation) => {
          const on = rolls.declared.some((entry) => entry.situation === situation.situation);
          return (
            <button
              key={situation.situation}
              type="button"
              className={`cs-toggle interactive${on ? " is-on" : ""}`}
              aria-pressed={on}
              disabled={rolls.rolling}
              title={situation.source}
              onClick={() => rolls.toggleSituation(situation)}
            >
              {situation.situation.charAt(0).toUpperCase() + situation.situation.slice(1)} ({situation.effect})
            </button>
          );
        })}
      </div>
    </div>
  );
}

const tierWord = (tier: SkillRow["tier"]) =>
  tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient";

/** Each ability's score, check and saving throw, as the engine works them out. */
function abilityRows(definition: ActorDefinition, derived: ActorDerivedSheet | null) {
  return ABILITIES.map((ability) => {
    const score = definition.abilityScores[ability];
    const row = derived?.abilities.find((entry) => entry.ability === ability) ?? null;
    const proficient = row?.saveProficient ?? definition.proficiencies?.saves.includes(ability) ?? false;
    return {
      ability,
      score,
      row,
      check: row?.check ?? abilityModifier(score),
      proficient,
      save: row?.save ?? saveBonus(score, definition.proficiencyBonus, proficient),
      fromItems: row?.saveFromItems ?? 0,
      // Paralyzed, Stunned, Petrified or Unconscious: a Strength or Dexterity save fails without a roll.
      fails: row?.saveAutoFails ?? null
    };
  });
}

/**
 * The six saving throws as rows, with a cyan square where the character is proficient. A save the character owes now
 * (`owed`) takes its ability's row, so the tap answers it; the others roll freely.
 */
export function SavingThrowList({
  definition,
  derived,
  rolls,
  owed
}: Readonly<{
  definition: ActorDefinition;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  owed?: (ability: Ability) => ReactNode;
}>) {
  return (
    <ul className="cs-saves">
      {abilityRows(definition, derived).map(({ ability, row, proficient, save, fromItems, fails }) => {
        const answer = owed?.(ability);
        if (answer) return <li key={ability}>{answer}</li>;
        const saveName = `${ABILITY_WORDS[ability]} saving throw`;
        return (
          <li key={ability}>
            <button
              type="button"
              className={`cs-save interactive${proficient ? " is-proficient" : ""}${fails ? " is-failing" : ""}`}
              disabled={rolls.rolling}
              aria-label={`Roll ${withArticle(saveName)}, ${signed(save)}${proficient ? ", proficient" : ""}${fromItems !== 0 ? `, ${signed(fromItems)} from equipment` : ""}${fails ? ", fails automatically" : modeLabel(row?.saveMode)}`}
              onClick={() => void rolls.rollSave(ability)}
            >
              <span className={`cs-tier${proficient ? " is-proficient" : ""}`} aria-hidden="true" />
              <span className="cs-save-name">
                <span className="cs-save-long">{ABILITY_WORDS[ability]}</span>
                <span className="cs-save-short">{ability.toUpperCase()}</span>
              </span>
              {fails ? (
                <span className="roll-mode-tag is-disadvantage" aria-hidden="true">
                  Fails
                </span>
              ) : (
                <RollModeTag mode={row?.saveMode} />
              )}
              <strong className="cs-save-bonus">{signed(save)}</strong>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The six scores, each with its check and its saving throw side by side. */
function AbilityGrid({
  definition,
  derived,
  rolls
}: Readonly<{ definition: ActorDefinition; derived: ActorDerivedSheet | null; rolls: SheetRolls }>) {
  // Abilities as tiles that roll the check (the modifier large, the score under it), then the saving throws.
  return (
    <>
      <div className="cs-abilities" role="group" aria-label="Abilities">
        {abilityRows(definition, derived).map(({ ability, score, row, check }) => {
          const checkName = `${ABILITY_WORDS[ability]} check`;
          return (
            <button
              key={ability}
              type="button"
              className="cs-ability interactive"
              disabled={rolls.rolling}
              aria-label={`Roll ${withArticle(checkName)}, ${signed(check)}${modeLabel(row?.checkMode)}`}
              onClick={() => void rolls.rollCheck({ ability }, checkName)}
            >
              <span className="cs-ability-name">{ABILITY_WORDS[ability]}</span>
              <strong className="cs-ability-mod">{signed(check)}</strong>
              <span className="cs-ability-score">{score}</span>
              <RollModeTag mode={row?.checkMode} />
            </button>
          );
        })}
      </div>
      <span className="cs-eyebrow">Saving throws</span>
      <SavingThrowList definition={definition} derived={derived} rolls={rolls} />
    </>
  );
}

/** A defence row as the engine applies it: each type, and what grants it when that isn't the stat block. */
const defenceText = (rows: readonly DerivedDefence[]) =>
  rows.map((row) => (row.source ? `${titleCase(row.type)} (${row.source})` : titleCase(row.type))).join(", ");

/** Senses, Passive Perception and the damage defences the engine applies; a monster's prose where nothing is typed. */
export function SensesAndDefences({
  definition,
  extension,
  derived
}: Readonly<{ definition: ActorDefinition; extension: SrdExtension; derived: ActorDerivedSheet | null }>) {
  const defence = (typed: readonly DerivedDefence[] | undefined, prose: string | null | undefined) =>
    typed && typed.length > 0 ? defenceText(typed) : prose;
  const rows: Array<[string, string]> = [];
  if (extension.senses && extension.senses.length > 0) rows.push(["Senses", extension.senses.join(", ")]);
  const passive = derived?.passivePerception ?? extension.passivePerception ?? null;
  if (passive !== null) rows.push(["Passive Perception", String(passive)]);
  const vulnerabilities = defence(derived?.defences.vulnerabilities, extension.damageVulnerabilities);
  const resistances = defence(derived?.defences.resistances, extension.damageResistances);
  const immunities = defence(derived?.defences.immunities, extension.damageImmunities);
  if (vulnerabilities) rows.push(["Vulnerabilities", vulnerabilities]);
  if (resistances) rows.push(["Resistances", resistances]);
  if (immunities) rows.push(["Immunities", immunities]);
  if (extension.conditionImmunities) rows.push(["Condition immunities", extension.conditionImmunities]);
  rows.push(["Proficiency", signed(derived?.proficiencyBonus ?? definition.proficiencyBonus)]);
  return (
    <dl className="cs-facts">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type ProficiencyDraft = { saves: string[]; skills: Record<string, "proficient" | "expertise"> };

/** The light hand-edit of saving throw and skill proficiencies (the owner and the GM; the server enforces it). */
function ProficiencyEditor({
  actor,
  definition,
  skills,
  busy,
  edit,
  onEdited,
  onDone
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  skills: readonly SkillRow[];
  busy: boolean;
  edit: SheetEdit;
  onEdited: (next: ActorDefinition) => void;
  onDone: () => void;
}>) {
  const proficiencies = definition.proficiencies;
  const [draft, setDraft] = useState<ProficiencyDraft>(() => ({
    saves: proficiencies?.saves ? [...proficiencies.saves] : [],
    skills: Object.fromEntries((proficiencies?.skills ?? []).map((skill) => [skill.id, skill.proficiency]))
  }));
  // Edits save as they are made, like the rest of the sheet.
  const persist = (next: ProficiencyDraft) => {
    setDraft(next);
    const sent = {
      saves: next.saves as Ability[],
      skills: Object.entries(next.skills).map(([id, proficiency]) => ({ id, proficiency }))
    };
    onEdited({ ...definition, proficiencies: sent });
    void edit("character:set-proficiencies", { actorId: actor.id, proficiencies: sent });
  };
  return (
    <div className="cs-editor" role="group" aria-label="Edit proficiencies">
      <p className="cs-sub">
        Changes save as you go. Tap a saving throw to turn it on or off; tap a skill to move it through proficient,
        Expertise and none.
      </p>
      <div className="cs-chiprow">
        {ABILITIES.map((ability) => (
          <button
            key={ability}
            type="button"
            className={`cs-toggle${draft.saves.includes(ability) ? " is-on" : ""}`}
            aria-pressed={draft.saves.includes(ability)}
            disabled={busy}
            onClick={() =>
              persist({
                ...draft,
                saves: draft.saves.includes(ability)
                  ? draft.saves.filter((entry) => entry !== ability)
                  : [...draft.saves, ability]
              })
            }
          >
            {ABILITY_WORDS[ability]} save
          </button>
        ))}
      </div>
      <ul className="cs-skill-edit">
        {skills.map((skill) => {
          const tier = draft.skills[skill.id];
          return (
            <li key={skill.id}>
              <span>{skill.name}</span>
              <button
                type="button"
                className={`cs-toggle${tier ? " is-on" : ""}`}
                disabled={busy}
                onClick={() => {
                  const next = tier === undefined ? "proficient" : tier === "proficient" ? "expertise" : undefined;
                  const skillsNext = { ...draft.skills };
                  if (next) skillsNext[skill.id] = next;
                  else delete skillsNext[skill.id];
                  persist({ ...draft, skills: skillsNext });
                }}
              >
                {tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "None"}
              </button>
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="primary" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/**
 * The checks: each ability's check and saving throw, the skills in two columns with the ability each uses, the tools,
 * the quarry of a Hunter's Mark, outside a fight the help it can give an ally's check, and the senses. A tap rolls on
 * the server, which works out the bonus and any Advantage or Disadvantage, so a button can't disagree with the roll.
 * On a laptop this is the sheet's left column.
 */
export function ChecksTab({
  actor,
  definition,
  extension,
  derived,
  rolls,
  quarry,
  busy,
  edit,
  onEdited,
  helping,
  onFeedback,
  inFight = false,
  party
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  extension: SrdExtension;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  quarry: readonly Quarry[];
  busy: boolean;
  edit: SheetEdit;
  onEdited: (next: ActorDefinition) => void;
  /** Outside a fight, the table whose party members the character may help with a check. */
  helping?: SheetState | undefined;
  onFeedback?: (text: string) => void;
  /** The character is in the running fight, where a tool's use takes its action. */
  inFight?: boolean;
  /** The table, for the creature a use works for (Cobbler's Tools' footwear). */
  party?: SheetState | undefined;
}>) {
  const skills = useSkillRows(definition, derived);
  const [editing, setEditing] = useState(false);
  const exhaustion = exhaustionLevel(actor);
  const tools = derived?.tools ?? [];
  return (
    <div className="cs-checks">
      <AbilityGrid definition={definition} derived={derived} rolls={rolls} />
      {exhaustion > 0 && (
        <p className="cs-sub is-caution">
          Every d20 Test here includes the -{2 * exhaustion} from Exhaustion {exhaustion}.
        </p>
      )}
      <RollModeNotes derived={derived} />
      <CheckSituations situations={derived?.situations ?? []} rolls={rolls} />
      <div className="cs-section-head">
        <span className="cs-eyebrow">Skills</span>
        {actor.kind === "player-character" && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit proficiencies
          </Button>
        )}
      </div>
      {editing ? (
        <ProficiencyEditor
          actor={actor}
          definition={definition}
          skills={skills}
          busy={busy}
          edit={edit}
          onEdited={onEdited}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ul className="cs-skills">
          {skills.map((skill) => (
            <li key={skill.id} className="cs-skill">
              <span
                className={`cs-tier${skill.tier === "expertise" ? " is-expertise" : skill.tier === "proficient" ? " is-proficient" : ""}`}
                role="img"
                aria-label={`${tierWord(skill.tier)}${skill.sources.length > 0 ? ` from ${skill.sources.join(", ")}` : ""}`}
              ></span>
              <span className="cs-skill-name">
                {skill.name}
                {skill.ability && <em>{skill.ability.toUpperCase()}</em>}
              </span>
              <SkillButton skill={skill} rolls={rolls} />
            </li>
          ))}
        </ul>
      )}
      {tools.length > 0 && (
        <>
          <span className="cs-eyebrow">Tools</span>
          <div className="cs-chiprow">
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={`cs-roll has-label${tool.proficient !== false ? " is-proficient" : ""}`}
                disabled={rolls.rolling}
                aria-label={`Roll ${tool.name}, ${signed(tool.bonus)}${modeLabel(tool.mode)}`}
                onClick={() =>
                  void rolls.rollCheck(
                    { ability: tool.ability, tool: tool.id },
                    `${tool.name} (${ABILITY_WORDS[tool.ability]})`
                  )
                }
              >
                <span className="cs-roll-label">{tool.name}</span>
                <strong>{signed(tool.bonus)}</strong>
                <RollModeTag mode={tool.mode} />
              </button>
            ))}
          </div>
        </>
      )}
      <ToolUses actor={actor} derived={derived} rolls={rolls} inFight={inFight} state={party} />
      {quarry.map((creature) => (
        <div key={creature.id} className="cs-chiprow" role="group" aria-label={`Find ${creature.name}`}>
          <span className="cs-eyebrow">Find {creature.name}</span>
          {(["perception", "survival"] as const).map((skill) => {
            const word = skill === "perception" ? "Perception" : "Survival";
            return (
              <button
                key={skill}
                type="button"
                className="cs-roll has-label"
                disabled={rolls.rolling}
                aria-label={`Roll Wisdom (${word}) to find ${creature.name} (Hunter's Mark)`}
                onClick={() => void rolls.rollCheck({ ability: "wis", skill }, `Wisdom (${word})`, creature.id)}
              >
                <span className="cs-roll-label">{word}</span>
              </button>
            );
          })}
        </div>
      ))}
      {helping && onFeedback && (
        <HelpAnAlly
          actor={actor}
          state={helping}
          choices={[
            ...skills.filter((skill) => skill.tier !== undefined).map(({ id, name }) => ({ id, name })),
            ...tools.map(({ id, name }) => ({ id, name }))
          ]}
          onFeedback={onFeedback}
        />
      )}
      <SensesAndDefences definition={definition} extension={extension} derived={derived} />
    </div>
  );
}
