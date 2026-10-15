import { useState } from "react";
import type { ActorDefinition, ActorDerivedSheet, GmActor, PlayerActor } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { ABILITIES, saveBonus, skillBonus, type Ability } from "@vtt/rules-5e";
import { useSkillCatalog } from "../content/catalogs";
import { signed } from "./format";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

/** One skill row: the ability governing its check comes from the catalog. */
type SheetSkill = Readonly<{ id: string; name: string; ability: Ability | null }>;
type ProficiencyDraft = { saves: string[]; skills: Record<string, "proficient" | "expertise"> };

/** Saving throws and skills as roll chips, and their light hand-edit (owner and GM, server-enforced). */
export function SheetProficiencies({
  actor,
  definition,
  derived,
  rolls,
  editing,
  onEditingChange,
  busy,
  edit,
  onEdited
}: Readonly<{
  actor: GmActor | PlayerActor;
  definition: ActorDefinition;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  /** The sheet opens one editor at a time, so it owns this flag. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  busy: boolean;
  edit: SheetEdit;
  /** Shows the edited definition before the server's broadcast arrives. */
  onEdited: (next: ActorDefinition) => void;
}>) {
  const { rolling, rollD20 } = rolls;
  const proficiencies = definition.proficiencies;
  const [profDraft, setProfDraft] = useState<ProficiencyDraft>({ saves: [], skills: {} });
  // Skills and the ability each check uses come from the catalog, ordered by name. A row whose
  // ability the bundle never set shows no bonus rather than a wrong one.
  const skillCatalog = useSkillCatalog();
  const sheetSkills: readonly SheetSkill[] = [...skillCatalog.items]
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      ability: (ABILITIES as readonly string[]).includes(skill.ability ?? "") ? (skill.ability as Ability) : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const derivedAbility = (ability: Ability) => derived?.abilities.find((row) => row.ability === ability) ?? null;
  const openProfEditor = () => {
    setProfDraft({
      saves: proficiencies?.saves ? [...proficiencies.saves] : [],
      skills: Object.fromEntries((proficiencies?.skills ?? []).map((skill) => [skill.id, skill.proficiency]))
    });
    onEditingChange(true);
  };
  // Edits auto-save like the rest of the sheet.
  const persistProficiencies = (draft: ProficiencyDraft) => {
    const proficiencies = {
      saves: draft.saves as Ability[],
      skills: Object.entries(draft.skills).map(([id, proficiency]) => ({ id, proficiency }))
    };
    onEdited({ ...definition, proficiencies });
    void edit("character:set-proficiencies", { actorId: actor.id, proficiencies });
  };
  const toggleSave = (ability: string) => {
    const next = {
      ...profDraft,
      saves: profDraft.saves.includes(ability)
        ? profDraft.saves.filter((entry) => entry !== ability)
        : [...profDraft.saves, ability]
    };
    setProfDraft(next);
    persistProficiencies(next);
  };
  const cycleSkill = (id: string) => {
    const current = profDraft.skills[id];
    const tier = current === undefined ? "proficient" : current === "proficient" ? "expertise" : undefined;
    const skills = { ...profDraft.skills };
    if (tier) skills[id] = tier;
    else delete skills[id];
    const next = { ...profDraft, skills };
    setProfDraft(next);
    persistProficiencies(next);
  };
  if (
    !(proficiencies && (proficiencies.saves.length > 0 || proficiencies.skills.length > 0)) &&
    actor.kind !== "player-character"
  )
    return null;
  return (
    <section className="sheet-section">
      <h3>
        Proficiencies
        {actor.kind === "player-character" && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-section-edit"
            onClick={() => (editing ? onEditingChange(false) : openProfEditor())}
          >
            {editing ? "Done" : "Edit"}
          </Button>
        )}
      </h3>
      {editing ? (
        <div className="sheet-editor">
          <p className="sheet-editor-hint">
            Changes save as you go. Tap a save to toggle it; tap a skill to cycle it through proficient, expertise and
            none. Press <strong>Done</strong> when finished.
          </p>
          <div className="sheet-roll-row">
            <span className="sheet-roll-label">Saves</span>
            {ABILITIES.map((ability) => (
              <button
                type="button"
                key={ability}
                className={`sheet-prepare${profDraft.saves.includes(ability) ? " is-prepared" : ""}`}
                disabled={busy}
                onClick={() => toggleSave(ability)}
              >
                {ability.toUpperCase()}
              </button>
            ))}
          </div>
          <ul className="sheet-skill-list sheet-skill-edit">
            {sheetSkills.map((skill) => {
              const tier = profDraft.skills[skill.id];
              return (
                <li key={skill.id}>
                  <span>{skill.name}</span>
                  <button
                    type="button"
                    className={`sheet-prepare${tier ? " is-prepared" : ""}`}
                    disabled={busy}
                    onClick={() => cycleSkill(skill.id)}
                  >
                    {tier ?? "—"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <>
          <div className="sheet-roll-row">
            <span className="sheet-roll-label">Saves</span>
            {ABILITIES.map((ability) => {
              const row = derivedAbility(ability);
              const isProf = row?.saveProficient ?? proficiencies?.saves.includes(ability) ?? false;
              const bonus =
                row?.save ?? saveBonus(definition.abilityScores[ability], definition.proficiencyBonus, isProf);
              const fromItems = row?.saveFromItems ?? 0;
              return (
                <button
                  type="button"
                  key={ability}
                  className={`sheet-roll-chip${isProf ? " is-proficient" : ""}`}
                  disabled={rolling}
                  title={`Roll a ${ability.toUpperCase()} saving throw${isProf ? " (proficient)" : ""}${fromItems !== 0 ? ` - includes ${signed(fromItems)} from your equipment` : ""}`}
                  onClick={() => void rollD20(bonus, "save", `${ability.toUpperCase()} save`)}
                >
                  {ability.toUpperCase()} {signed(bonus)}
                </button>
              );
            })}
          </div>
          <ul className="sheet-skill-list sheet-skill-cols">
            {sheetSkills.map((skill) => {
              const row = derived?.skills.find((entry) => entry.id === skill.id) ?? null;
              const baseTier = proficiencies?.skills.find((entry) => entry.id === skill.id)?.proficiency;
              const effective = row?.tier ?? baseTier ?? "none";
              const tier = effective === "none" ? undefined : effective;
              const sources = row?.sources ?? [];
              const bonus = row
                ? row.bonus
                : skill.ability
                  ? skillBonus(definition.abilityScores[skill.ability], definition.proficiencyBonus, baseTier ?? "none")
                  : null;
              return (
                <li key={skill.id}>
                  {bonus === null ? (
                    <span
                      className="sheet-roll-chip"
                      title={`${skill.name} names no governing ability, so it has no rollable bonus`}
                    >
                      —
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="sheet-roll-chip"
                      disabled={rolling}
                      title={`Roll ${skill.name}`}
                      onClick={() => void rollD20(bonus, "check", `${skill.name} check`)}
                    >
                      {signed(bonus)}
                    </button>
                  )}
                  <span
                    className={`sheet-prof-dot${tier === "expertise" ? " expertise" : tier === "proficient" ? " proficient" : ""}`}
                    title={`${tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient"}${sources.length > 0 ? ` (${sources.join(", ")})` : ""}`}
                    aria-label={`${tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient"}${sources.length > 0 ? ` from ${sources.join(", ")}` : ""}`}
                  >
                    {tier === "expertise" ? "E" : tier === "proficient" ? "P" : ""}
                  </span>
                  <span className="sheet-skill-name">
                    {skill.name} {skill.ability && <em>{skill.ability.toUpperCase()}</em>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
