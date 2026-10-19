import type { CharacterChoice } from "@vtt/schemas";
import { ABILITIES, type Ability } from "@vtt/rules-5e";

/**
 * A hand edit of a built sheet's saving throw and skill proficiencies (the sheet's proficiency editor), kept in the
 * choices ledger as the difference from what the build gives. The build applies it last, so a rebuild (a level up, a
 * re-chosen pick, a content change) keeps the edit and still takes every proficiency the content adds.
 */

export const SHEET_PROFICIENCIES_KIND = "sheet-proficiencies";

/** Saving throw and skill proficiencies, as the build makes them and as a sheet stores them. */
type Proficiencies = Readonly<{
  saves: readonly string[];
  skills: ReadonlyArray<Readonly<{ id: string; proficiency: string }>>;
}>;
type SkillLevel = "proficient" | "expertise" | "none";
type ProficiencyEdit = Readonly<{
  saves: Readonly<{ add: readonly Ability[]; remove: readonly Ability[] }>;
  skills: ReadonlyArray<Readonly<{ id: string; proficiency: SkillLevel }>>;
}>;

const skillLevels = (proficiencies: Proficiencies | undefined): Map<string, SkillLevel> =>
  new Map(
    (proficiencies?.skills ?? []).map((skill) => [
      skill.id,
      skill.proficiency === "expertise" ? "expertise" : "proficient"
    ])
  );

/** The ledger row recording how `edited` differs from `built`, or null when they agree. */
export function proficiencyEditRow(
  built: Proficiencies | undefined,
  edited: Proficiencies | undefined
): CharacterChoice | null {
  const builtSaves = new Set<string>(built?.saves ?? []);
  const editedSaves = new Set<string>(edited?.saves ?? []);
  const add = ABILITIES.filter((ability) => editedSaves.has(ability) && !builtSaves.has(ability));
  const remove = ABILITIES.filter((ability) => builtSaves.has(ability) && !editedSaves.has(ability));
  const before = skillLevels(built);
  const after = skillLevels(edited);
  const skills = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((id) => (before.get(id) ?? "none") !== (after.get(id) ?? "none"))
    .map((id) => ({ id, proficiency: after.get(id) ?? ("none" as const) }));
  if (add.length === 0 && remove.length === 0 && skills.length === 0) return null;
  return { level: 1, kind: SHEET_PROFICIENCIES_KIND, id: "hand-edit", payload: { saves: { add, remove }, skills } };
}

/** The edit a ledger row carries; a malformed payload reads as no edit. */
function editOf(row: CharacterChoice | undefined): ProficiencyEdit | null {
  const payload = row?.payload as { saves?: { add?: unknown; remove?: unknown }; skills?: unknown } | undefined;
  if (!payload) return null;
  const abilities = (value: unknown): Ability[] =>
    Array.isArray(value) ? ABILITIES.filter((ability) => value.includes(ability)) : [];
  const skills = Array.isArray(payload.skills)
    ? payload.skills.flatMap((entry: unknown) => {
        const skill = entry as { id?: unknown; proficiency?: unknown };
        return typeof skill.id === "string" &&
          (skill.proficiency === "proficient" || skill.proficiency === "expertise" || skill.proficiency === "none")
          ? [{ id: skill.id, proficiency: skill.proficiency as SkillLevel }]
          : [];
      })
    : [];
  return { saves: { add: abilities(payload.saves?.add), remove: abilities(payload.saves?.remove) }, skills };
}

/** The ledger's hand edit, if any. */
export function proficiencyEditOf(choices: readonly CharacterChoice[]): CharacterChoice | undefined {
  return choices.find((row) => row.kind === SHEET_PROFICIENCIES_KIND);
}

/** The build's proficiencies with the ledger's hand edit applied. */
export function withProficiencyEdit<T extends Proficiencies>(proficiencies: T, choices: readonly CharacterChoice[]): T {
  const edit = editOf(proficiencyEditOf(choices));
  if (!edit) return proficiencies;
  const saves = ABILITIES.filter(
    (ability) =>
      (proficiencies.saves.includes(ability) || edit.saves.add.includes(ability)) &&
      !edit.saves.remove.includes(ability)
  );
  const levels = skillLevels(proficiencies);
  for (const skill of edit.skills) levels.set(skill.id, skill.proficiency);
  const skills = [...levels.entries()]
    .filter((entry): entry is [string, "proficient" | "expertise"] => entry[1] !== "none")
    .map(([id, proficiency]) => ({ id, proficiency }));
  return { ...proficiencies, saves, skills } as T;
}

/** The ledger with `row` in place of any earlier hand edit (or without one, for null). */
export function withProficiencyEditRow(
  choices: readonly CharacterChoice[],
  row: CharacterChoice | null
): CharacterChoice[] {
  return [...choices.filter((entry) => entry.kind !== SHEET_PROFICIENCIES_KIND), ...(row ? [row] : [])];
}
