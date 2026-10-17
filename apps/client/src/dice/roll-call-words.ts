import type { AbilityId, CheckSubject, RollCall } from "@vtt/domain";

export const ABILITY_WORDS: Readonly<Record<AbilityId, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** A content id read aloud ("thieves-tools" reads "Thieves Tools") when the catalog has no name for it. */
const spoken = (id: string) =>
  id
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

/** What a call asks for, in the SRD's words: "Wisdom (Perception) check", "Dexterity saving throw". */
export function callLabel(
  call: Readonly<{ kind: RollCall["kind"]; subject: CheckSubject }>,
  skillName?: (id: string) => string | undefined
): string {
  const ability = ABILITY_WORDS[call.subject.ability];
  if (call.kind === "save") return `${ability} saving throw`;
  if (call.subject.skill) return `${ability} (${skillName?.(call.subject.skill) ?? spoken(call.subject.skill)}) check`;
  if (call.subject.tool) return `${ability} check with ${spoken(call.subject.tool)}`;
  return `${ability} check`;
}

type CallResult = NonNullable<RollCall["entries"][number]["result"]>;

/** One character's answer: "17 (d20 12) · success", or the condition that failed a save without a roll. */
export function resultWords(result: CallResult): string {
  if (result.autoFailed) return `fails without a roll (${spoken(result.autoFailed)})`;
  const verdict = result.success === null ? "" : result.success ? " · success" : " · failure";
  return `${result.total}${result.natural > 0 ? ` (d20 ${result.natural})` : ""}${verdict}`;
}
