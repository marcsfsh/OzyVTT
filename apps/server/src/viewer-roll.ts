import { createHmac, randomBytes } from "node:crypto";
import type { GameState, RollPurpose, RollRecord } from "@vtt/domain";
import { hiddenFrom } from "./vision/audience.js";
import type { SightContent } from "./vision/senses.js";

/**
 * The latest public roll as the table screen shows it (ADR-0040). Built from an allow-list on every send: who rolled,
 * what for, the total and the dice. No target, outcome, visibility, session or roll id crosses.
 */
export type ViewerRollCard = Readonly<{
  id: string;
  who: string;
  what: string;
  total: number;
  dice: readonly Readonly<{ sides: number; face: number; kept: boolean }>[];
  /** The roll's flat modifiers, summed with their signs. */
  modifier: number;
  /** When the roll was made, so the screen can say how recent it is. */
  at: string;
}>;

/** How long a card stays on the screen after its roll. */
export const ROLL_CARD_MS = 10 * 60 * 1000;

const PURPOSE_WORD: Readonly<Record<Exclude<RollPurpose, "builder">, string>> = {
  manual: "Roll",
  attack: "Attack",
  damage: "Damage",
  healing: "Healing",
  save: "Save",
  check: "Check"
};

// Drawn once per server run: the same roll keeps its card id while the server runs, and the id says nothing of the
// roll's own, so the screen can't line its cards up with anything a player's device holds.
const CARD_ID_KEY = randomBytes(32);
const cardId = (rollId: string) => createHmac("sha256", CARD_ID_KEY).update(rollId).digest("hex").slice(0, 16);

/**
 * The newest roll the room may see, made after `since`, after the live scene went live and within the last ten
 * minutes, or null. A roll qualifies
 * only when it is public, not the builder's, and its creature (when it has one) is one the table can see now, by
 * `hiddenFrom` so fog and dynamic vision count as well as GM-only.
 */
export function projectViewerRoll(
  state: GameState,
  since: number | undefined,
  now: number,
  content: SightContent = {}
): ViewerRollCard | null {
  const hidden = hiddenFrom(state, content);
  // A scene going live is a new thing on the screen too, even on the same map.
  const liveAt = state.combat.encounters.find((scene) => scene.id === state.combat.activeEncounterId)?.liveAt ?? 0;
  const floor = Math.max(since ?? 0, liveAt, now - ROLL_CARD_MS);
  for (let index = state.rolls.length - 1; index >= 0; index -= 1) {
    const roll = state.rolls[index];
    const madeAt = Date.parse(roll.createdAt);
    if (!Number.isFinite(madeAt) || madeAt < floor) continue;
    if (roll.visibility !== "public" || roll.purpose === "builder") continue;
    if (roll.actorId !== null && hidden(roll.actorId)) continue;
    return cardOf(state, roll);
  }
  return null;
}

function cardOf(state: GameState, roll: RollRecord): ViewerRollCard {
  const actor = roll.actorId === null ? undefined : state.actors.find((candidate) => candidate.id === roll.actorId);
  return {
    id: cardId(roll.id),
    who: actor?.name ?? roll.initiatorLabel ?? (roll.initiatorRole === "gm" ? "GM" : "A player"),
    what: roll.label ?? PURPOSE_WORD[roll.purpose as Exclude<RollPurpose, "builder">],
    total: roll.total,
    dice: roll.dice.map((die) => ({ sides: die.sides, face: die.face, kept: die.kept })),
    modifier: roll.modifiers.reduce((sum, part) => sum + part.sign * part.value, 0),
    at: roll.createdAt
  };
}
