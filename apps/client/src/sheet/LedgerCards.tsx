import { useState, type ReactNode } from "react";
import type { ActorDefinition, ActorDerivedSheet } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { signed } from "../encounter/format";
import { modeLabel } from "../encounter/roll-mode-notes";
import { RollModeTag } from "../encounter/RollModeTag";
import type { SrdExtension } from "../encounter/sheet-extension";
import { CheckSituations, ProficiencyEditor, useSkillRows, type SkillRow } from "./ChecksTab";
import { HelpAnAlly } from "./HelpAnAlly";
import { ToolUses } from "./ToolUses";
import { ABILITY_WORDS, type SheetActor, type SheetState } from "./sheet-model";
import type { Quarry } from "./useSheetController";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

const pinnedKey = (actorId: string) => `vtt.sheet.pinned-checks.${actorId}`;
const readPinned = (actorId: string): string[] | null => {
  try {
    const stored = localStorage.getItem(pinnedKey(actorId));
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : null;
  } catch {
    return null;
  }
};
const writePinned = (actorId: string, ids: readonly string[]) => {
  try {
    localStorage.setItem(pinnedKey(actorId), JSON.stringify(ids));
  } catch {
    /* private mode: the pins last as long as the page */
  }
};

/** Until a player pins their own, the checks a table calls for most: Perception, then the character's best. */
function defaultPins(skills: readonly SkillRow[]): string[] {
  const best = [...skills]
    .filter((skill) => skill.tier && skill.bonus !== null && skill.id !== "perception")
    .sort((left, right) => (right.bonus ?? 0) - (left.bonus ?? 0))
    .map((skill) => skill.id);
  return ["perception", ...best].slice(0, 4);
}

/** The checks this player keeps at the top of Skills, remembered on this device, with Edit to choose them. */
function PinnedChecks({
  actorId,
  skills,
  rolls
}: Readonly<{ actorId: string; skills: readonly SkillRow[]; rolls: SheetRolls }>) {
  const [pinned, setPinned] = useState<string[] | null>(() => readPinned(actorId));
  const [editing, setEditing] = useState(false);
  const ids = pinned ?? defaultPins(skills);
  const shown = ids.flatMap((id) => skills.filter((skill) => skill.id === id));
  if (skills.length === 0) return null;
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
    setPinned(next);
    writePinned(actorId, next);
  };
  return (
    <div className="cs-group cs-pinned" role="group" aria-label="Pinned checks">
      <div className="cs-section-head">
        <span className="cs-eyebrow">Pinned</span>
        <Button size="sm" variant="ghost" aria-expanded={editing} onClick={() => setEditing((current) => !current)}>
          {editing ? "Done" : "Edit"}
        </Button>
      </div>
      {editing ? (
        <div className="cs-chiprow" role="group" aria-label="Choose the pinned checks">
          {skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className={`cs-toggle${ids.includes(skill.id) ? " is-on" : ""}`}
              aria-pressed={ids.includes(skill.id)}
              onClick={() => toggle(skill.id)}
            >
              {skill.name}
            </button>
          ))}
        </div>
      ) : shown.length > 0 ? (
        <ul className="cs-skills">
          {shown.map((skill) => (
            <SkillLine key={skill.id} skill={skill} rolls={rolls} />
          ))}
        </ul>
      ) : (
        <p className="cs-sub">None pinned. Edit chooses the checks to keep here.</p>
      )}
    </div>
  );
}

const tierWord = (tier: SkillRow["tier"]) =>
  tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient";

/** One skill as a whole-row button: the proficiency square, the ability, the name and the bonus it rolls. */
function SkillLine({ skill, rolls }: Readonly<{ skill: SkillRow; rolls: SheetRolls }>) {
  const tier = `${tierWord(skill.tier)}${skill.sources.length > 0 ? ` from ${skill.sources.join(", ")}` : ""}`;
  const square = (
    <span
      className={`cs-tier${skill.tier === "expertise" ? " is-expertise" : skill.tier === "proficient" ? " is-proficient" : ""}`}
      aria-hidden="true"
    />
  );
  const ability = <span className="cs-skill-ab">{skill.ability?.toUpperCase() ?? ""}</span>;
  const name = <span className="cs-skill-name">{skill.name}</span>;
  if (skill.bonus === null || !skill.ability)
    return (
      <li className={`cs-skill${skill.tier ? " is-proficient" : ""}`} title={`${skill.name} names no ability`}>
        <span className="cs-skill-row is-static">
          {square}
          {ability}
          {name}
          <span className="cs-skill-bonus">None</span>
        </span>
      </li>
    );
  return (
    <li className={`cs-skill${skill.tier ? " is-proficient" : ""}`}>
      <button
        type="button"
        className="cs-skill-row"
        title={tier}
        disabled={rolls.rolling}
        aria-label={`Roll ${skill.name}, ${signed(skill.bonus)}${modeLabel(skill.mode)}${skill.reliableTalent ? ", Reliable Talent" : ""}`}
        onClick={() =>
          void rolls.rollCheck(
            { ability: skill.ability!, skill: skill.id },
            `${ABILITY_WORDS[skill.ability!]} (${skill.name})`
          )
        }
      >
        {square}
        {ability}
        {name}
        <RollModeTag mode={skill.mode} />
        <strong className="cs-skill-bonus">{signed(skill.bonus)}</strong>
      </button>
    </li>
  );
}

/**
 * The skills (ADR-0047): Edit proficiencies in the heading, the situations the character's gear names as toggles, the
 * checks pinned on this device, then the eighteen skills, each one row that rolls it.
 */
export function SkillsCard({
  actor,
  definition,
  derived,
  rolls,
  busy,
  edit,
  onEdited
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  busy: boolean;
  edit: SheetEdit;
  onEdited: (next: ActorDefinition) => void;
}>) {
  const skills = useSkillRows(definition, derived);
  const [editing, setEditing] = useState(false);
  return (
    <section className="cs-card cs-skills-card" aria-label="Skills">
      <div className="cs-section-head">
        <span className="cs-eyebrow">Skills</span>
        {actor.kind === "player-character" && !editing && (
          <Button size="sm" variant="link" onClick={() => setEditing(true)}>
            Edit proficiencies
          </Button>
        )}
      </div>
      <CheckSituations situations={derived?.situations ?? []} rolls={rolls} />
      <PinnedChecks actorId={actor.id} skills={skills} rolls={rolls} />
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
        <ul className="cs-skills" aria-label="All skills">
          {skills.map((skill) => (
            <SkillLine key={skill.id} skill={skill} rolls={rolls} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The passive scores and senses, read only: an open group under the abilities. */
export function SensesCard({
  extension,
  derived
}: Readonly<{ extension: SrdExtension; derived: ActorDerivedSheet | null }>) {
  const passive = derived?.passivePerception ?? extension.passivePerception ?? null;
  const passives: Array<[string, number]> = [];
  if (passive !== null) passives.push(["Passive Perception", passive]);
  const senses = extension.senses ?? [];
  if (passives.length === 0 && senses.length === 0) return null;
  return (
    <section className="cs-open cs-senses" aria-label="Senses">
      <span className="cs-eyebrow">Senses</span>
      {passives.length > 0 && (
        <ul className="cs-senses-rows">
          {passives.map(([label, value]) => (
            <li key={label}>
              <strong className="cs-senses-v">{value}</strong>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
      {senses.length > 0 && <p className="cs-senses-text">{senses.join(", ")}</p>}
    </section>
  );
}

/** The tools the character rolls with, a tool's uses, finding a Hunter's Mark quarry and helping an ally's check. */
export function ToolsCard({
  actor,
  definition,
  derived,
  rolls,
  quarry,
  helping,
  inFight,
  party,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  quarry: readonly Quarry[];
  helping?: SheetState | undefined;
  inFight: boolean;
  party?: SheetState | undefined;
  onFeedback?: (text: string) => void;
}>) {
  const skills = useSkillRows(definition, derived);
  const tools = derived?.tools ?? [];
  const uses = <ToolUses actor={actor} derived={derived} rolls={rolls} inFight={inFight} state={party} />;
  const parts: ReactNode[] = [];
  if (tools.length > 0)
    parts.push(
      <div key="tools" className="cs-chiprow">
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
    );
  const hunting = quarry.map((creature) => (
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
  ));
  const help =
    helping && onFeedback ? (
      <HelpAnAlly
        actor={actor}
        state={helping}
        choices={[
          ...skills.filter((skill) => skill.tier !== undefined).map(({ id, name }) => ({ id, name })),
          ...tools.map(({ id, name }) => ({ id, name }))
        ]}
        onFeedback={onFeedback}
      />
    ) : null;
  return (
    <section className="cs-card cs-tools" aria-label="Tools">
      <span className="cs-eyebrow">Tools</span>
      {parts}
      {uses}
      {hunting}
      {help}
      {tools.length === 0 && quarry.length === 0 && !help && <p className="cs-sub">No tool proficiencies.</p>}
    </section>
  );
}
