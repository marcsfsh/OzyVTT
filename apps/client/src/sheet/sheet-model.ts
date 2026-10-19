/** What the remastered sheet reads off the actor and its stat block, as plain functions the tabs and tests share. */
import {
  armorClassInPlay,
  gameTimeSpanChip,
  type ActorDefinition,
  type GmActor,
  type GmView,
  type PlayerActor,
  type PlayerView
} from "@vtt/domain";
import { formatChallenge, titleCase } from "../encounter/format";
import type { SrdExtension } from "../encounter/sheet-extension";

export type SheetActor = GmActor | PlayerActor;
export type SheetState = GmView | PlayerView;

/** Hit points as this viewer received them: exact for the GM and the owner, a band for anyone else. */
export function exactHp(actor: SheetActor): { current: number; maximum: number; temporary: number } | null {
  const hp = actor.hp;
  if ("kind" in hp) return hp.kind === "exact" ? hp : null;
  return hp;
}

/** The character's total level across its classes; null for a stat block without classes. */
export function characterLevel(definition: ActorDefinition | null): number | null {
  const classes = definition?.character?.classes ?? [];
  if (classes.length === 0) return null;
  return classes.reduce((sum, entry) => sum + entry.level, 0);
}

/** "Evoker Wizard 9 · High Elf · Sage" for a character, "Medium humanoid, neutral · CR 1/4" for a monster. */
export function identityLine(actor: SheetActor, definition: ActorDefinition | null, extension: SrdExtension): string {
  const character = definition?.character;
  if (character) {
    const classes = character.classes
      .map((klass) => `${klass.subclass ? `${klass.subclass.name} ` : ""}${klass.name} ${klass.level}`)
      .join(" / ");
    return [classes, character.race?.name, character.background?.name].filter(Boolean).join(" · ");
  }
  if (definition)
    return `${titleCase(definition.size)} ${extension.type ?? "being"}${extension.alignment ? `, ${extension.alignment}` : ""}${extension.challengeRating !== undefined ? ` · CR ${formatChallenge(extension.challengeRating)}` : ""}`;
  return `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM only" : ""}`;
}

/** The class a single-class character's spells and level panel name ("Wizard"); null for several or none. */
export function soleClassName(definition: ActorDefinition | null): string | null {
  const classes = definition?.character?.classes ?? [];
  return classes.length === 1 ? classes[0].name : null;
}

/** Speed now and the base it was lowered from. `speedFeet` is the server's (Exhaustion, Slow, Grappled included). */
export function speedOf(
  actor: SheetActor,
  definition: ActorDefinition | null,
  extension: SrdExtension,
  speedFeet: number | null
): { now: number | null; base: number | null; lowered: boolean; modes: string | null } {
  const base =
    ("speedFeet" in actor ? actor.speedFeet : undefined) ?? extension.speeds?.walk ?? definition?.speedFeet ?? null;
  const now = speedFeet ?? base;
  // Another mode at 0 is no mode at all; a walking Speed of 0 still shows (Grappled).
  const other = extension.speeds
    ? (["swim", "fly", "climb", "burrow"] as const).flatMap((mode) => {
        const feet = extension.speeds?.[mode];
        return feet ? [`${mode} ${feet} ft${mode === "fly" && extension.speeds?.hover ? " (hover)" : ""}`] : [];
      })
    : [];
  return {
    now,
    base,
    lowered: speedFeet !== null && base !== null && speedFeet < base,
    modes: other.length > 0 ? other.join(", ") : null
  };
}

export const armorClassOf = (actor: SheetActor) => armorClassInPlay(actor);

/** Heroic Inspiration as this viewer received it; undefined when the projection does not carry it. */
export function heroicInspirationOf(actor: SheetActor): boolean | undefined {
  return "heroicInspiration" in actor ? actor.heroicInspiration === true : undefined;
}

/** Exhaustion's level, or 0. */
export function exhaustionLevel(actor: SheetActor): number {
  const instance = actor.conditions.find((condition) => condition.id === "exhaustion");
  return instance ? (instance.level ?? 1) : 0;
}

/** What Exhaustion costs at a level (SRD 5.2.1): each level takes 2 off every d20 Test and 5 feet off Speed. */
export function exhaustionCost(level: number): string {
  return `-${2 * level} to d20 Tests · -${5 * level} ft Speed`;
}

type DurationOf = Readonly<{ duration: PlayerActor["effects"][number]["duration"] }>;

/** How long an effect has left, short enough for a chip ("10 rounds", "this fight"); null when it lasts until ended. */
export function shortDuration(effect: DurationOf): string | null {
  const duration = effect.duration;
  switch (duration.type) {
    case "rounds":
      return `${duration.remaining} ${duration.remaining === 1 ? "round" : "rounds"}`;
    case "minutes":
      return gameTimeSpanChip(duration.remaining);
    case "until-rest":
      return duration.rest === "long" ? "until a Long Rest" : "until a rest";
    case "until-source-next-turn":
    case "until-bearer-next-turn":
      return "until next turn";
    case "until-bearer-turn-end":
    case "until-source-turn-end":
      return "until a turn ends";
    case "encounter":
      return "this fight";
    case "manual":
      return null;
  }
}

/** The effect that is the character's own Concentration ("Concentrating on Web"), if any. */
export function concentrationOf<E extends Readonly<{ tags: readonly string[]; concentration?: boolean; name: string }>>(
  effects: readonly E[]
): E | null {
  return effects.find((effect) => effect.tags.includes("concentrating")) ?? null;
}

/** The spell a Concentration effect holds, from its name ("Concentrating on Web" reads "Web"). */
export const concentrationSpell = (name: string) => name.replace(/^Concentrating on\s+/i, "");

/** Hit Point Dice per die size, in the order the pool keeps them. */
export function hitDiceEntries(actor: SheetActor) {
  if (!("hitDice" in actor) || !actor.hitDice) return [];
  return actor.hitDice.entries;
}

/** Whether this viewer may level the character: the GM always, its player while the builder is open to players. */
export function mayLevel(role: "gm" | "player", state: SheetState | undefined, actor: SheetActor): boolean {
  if (actor.kind !== "player-character") return false;
  if (role === "gm") return true;
  return state?.builderPolicy?.playerBuilder === "open";
}

/** The level a step up reaches, or null at the table's cap. */
export function levelUpTarget(level: number | null, state: SheetState | undefined): number | null {
  if (level === null) return null;
  const cap = state?.builderPolicy?.maxLevel ?? 20;
  return level < cap ? level + 1 : null;
}

/** Whether the character is in the running fight. */
export function inRunningFight(state: SheetState | undefined, actorId: string): boolean {
  return state ? state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId) : false;
}

/** The character is at 0 Hit Points and making Death Saving Throws (or stable there). */
export function isDown(actor: SheetActor): boolean {
  const hp = exactHp(actor);
  return actor.deathSaves !== null && actor.deathSaves !== undefined && (hp === null || hp.current <= 0);
}

/** Words for an ability id. */
export const ABILITY_WORDS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
} as const;

/** The turn card's pins, which only the owner's and the GM's copies of the character carry. */
export const pinsOf = (actor: SheetActor | null): readonly string[] | null => actor?.favouriteOptionIds ?? null;

/** How often each option has resolved for the character, as the server counts it. */
export const optionCountsOf = (actor: SheetActor | null): Readonly<Record<string, number>> =>
  actor?.optionUseCounts ?? {};
