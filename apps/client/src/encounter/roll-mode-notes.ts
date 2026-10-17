import type { AbilityId, ActionRollMode, ActorDerivedSheet, DerivedAbilityRow } from "@vtt/domain";

/** A roll's mode as the server counts it, with what grants each side. */
export type RollModeSummary = DerivedAbilityRow["checkMode"];
type Side = "advantage" | "disadvantage";
const SIDES: readonly Side[] = ["advantage", "disadvantage"];
const ABILITY_WORDS: Readonly<Record<AbilityId, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};
const ALL_ABILITIES = Object.keys(ABILITY_WORDS) as AbilityId[];

/** " with Disadvantage (Poisoned)", for a roll button's accessible name; empty for a plain d20. */
export function modeLabel(mode: RollModeSummary | undefined | null): string {
  if (!mode || mode.mode === "normal") return "";
  const sources = mode[mode.mode];
  return ` with ${mode.mode === "advantage" ? "Advantage" : "Disadvantage"}${sources.length > 0 ? ` (${sources.join(", ")})` : ""}`;
}

/** " · Disadvantage (Poisoned)", for a result line; empty for a plain d20. The GM's forced mode reads "GM's choice". */
export function modeWords(mode: ActionRollMode | undefined): string {
  if (!mode || mode.mode === "normal") return "";
  const sources = mode.mode === "advantage" ? mode.advantage : mode.disadvantage;
  return ` · ${mode.mode === "advantage" ? "Advantage" : "Disadvantage"}${sources.length > 0 ? ` (${sources.join(", ")})` : ""}`;
}

/** One thing that gives some of the sheet's rolls Advantage or Disadvantage, and which rolls. */
export type RollModeNote = Readonly<{ side: Side; source: string; rolls: string }>;

const listed = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Why the sheet's rolls have Advantage or Disadvantage, grouped by what grants it, so a player reads the reason before
 * rolling: "Disadvantage on ability checks · Poisoned", "Disadvantage on Stealth checks · Chain Mail (Stealth)". A skill
 * or tool whose ability's checks are already named is left out.
 */
export function rollModeNotes(derived: ActorDerivedSheet | null): RollModeNote[] {
  if (!derived) return [];
  type Entry = {
    side: Side;
    source: string;
    checks: Set<AbilityId>;
    saves: Set<AbilityId>;
    named: Map<string, AbilityId>;
  };
  const entries = new Map<string, Entry>();
  const entry = (side: Side, source: string) => {
    const key = `${side}:${source}`;
    const found = entries.get(key) ?? { side, source, checks: new Set(), saves: new Set(), named: new Map() };
    entries.set(key, found);
    return found;
  };
  for (const row of derived.abilities)
    for (const side of SIDES) {
      for (const source of row.checkMode?.[side] ?? []) entry(side, source).checks.add(row.ability);
      for (const source of row.saveMode?.[side] ?? []) entry(side, source).saves.add(row.ability);
    }
  for (const row of [...derived.skills, ...(derived.tools ?? [])])
    for (const side of SIDES)
      for (const source of row.mode?.[side] ?? [])
        if (row.ability) entry(side, source).named.set(row.name, row.ability);
  const notes: RollModeNote[] = [];
  for (const { side, source, checks, saves, named } of entries.values()) {
    const parts: string[] = [];
    if (checks.size === ALL_ABILITIES.length) parts.push("ability checks");
    else if (checks.size > 0)
      parts.push(`${listed(ALL_ABILITIES.filter((id) => checks.has(id)).map((id) => ABILITY_WORDS[id]))} checks`);
    const own = [...named].filter(([, ability]) => !checks.has(ability)).map(([name]) => name);
    if (own.length > 0) parts.push(`${listed(own)} checks`);
    if (saves.size === ALL_ABILITIES.length) parts.push("saving throws");
    else if (saves.size > 0)
      parts.push(`${listed(ALL_ABILITIES.filter((id) => saves.has(id)).map((id) => ABILITY_WORDS[id]))} saves`);
    if (parts.length > 0) notes.push({ side, source, rolls: listed(parts) });
  }
  return notes.sort((left, right) => left.side.localeCompare(right.side) || left.source.localeCompare(right.source));
}
