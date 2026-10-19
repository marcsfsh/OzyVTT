import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { areEnemies } from "./creature-sides.js";
import type { EffectNarration } from "./effects.js";
import { applyDamageDetailed, type DamageDeps } from "./hit-points.js";

/**
 * How a creature's traits let it past walls and through other creatures' spaces (SRD 5.2.1 stat blocks): Amorphous,
 * Compression and the elementals' forms "move through a space as narrow as 1 inch without expending extra movement",
 * a swarm "through any opening large enough for a Tiny" creature, Earth Glide burrows through earth and stone and
 * Tunneler through solid rock at half its Burrow Speed, the Invisible Stalker's Air Form and Water Form stop only in an
 * enemy's space, and Fire Form burns a creature the first time the elemental enters its space on a turn.
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

/** A stat block's trait text by name, from the SRD 2024 extension. */
function traitText(definition: ActorDefinition | undefined, name: string): string | null {
  for (const bag of Object.values(definition?.extensions ?? {})) {
    const traits = bag !== null && typeof bag === "object" ? (bag as { traits?: unknown }).traits : undefined;
    if (!Array.isArray(traits)) continue;
    for (const trait of traits) {
      const record = trait as { name?: unknown; description?: unknown };
      if (record.name === name && typeof record.description === "string") return record.description;
    }
  }
  return null;
}

const traitTexts = (definition: ActorDefinition | undefined): string[] => {
  const texts: string[] = [];
  for (const bag of Object.values(definition?.extensions ?? {})) {
    const traits = bag !== null && typeof bag === "object" ? (bag as { traits?: unknown }).traits : undefined;
    if (!Array.isArray(traits)) continue;
    for (const trait of traits) {
      const description = (trait as { description?: unknown }).description;
      if (typeof description === "string") texts.push(description);
    }
  }
  return texts;
};

/** How narrow an opening the creature passes with no extra movement: any gap a point fits through ("as narrow as 1
 *  inch"), or one a Tiny creature fits through (a swarm); null when it squeezes as its size says. */
export function openingPassage(definition: ActorDefinition | undefined): "point" | "tiny" | null {
  const texts = traitTexts(definition);
  if (texts.some((text) => /\bspace as narrow as 1 inch\b/.test(text))) return "point";
  if (texts.some((text) => /\bany opening large enough for a Tiny\b/.test(text))) return "tiny";
  return null;
}

/** How the creature burrows through a wall: freely through earth and stone (Earth Glide), or through solid rock at half
 *  its Burrow Speed, each foot costing two (Tunneler). Null when a wall stops its burrowing. */
export function burrowsThroughWalls(definition: ActorDefinition | undefined): "free" | "half" | null {
  if (traitText(definition, "Earth Glide") !== null) return "free";
  if (traitText(definition, "Tunneler") !== null) return "half";
  return null;
}

/** Air Form and Water Form as some stat blocks print them: "can enter an enemy's space and stop there". */
export function stopsOnlyInEnemySpace(definition: ActorDefinition | undefined): boolean {
  return ["Air Form", "Water Form"].some((name) => /\ban enemy's space\b/.test(traitText(definition, name) ?? ""));
}

/** The turn's mark that this mover has burned this creature with Fire Form. */
const burnKey = (moverId: string, targetId: string) => `${moverId}:fire-form:${targetId}`;

/**
 * SRD Fire Form: "The first time it enters a creature's space on a turn, that creature takes 5 (1d10) Fire damage." The
 * creatures whose spaces the mover's path entered, each burned once a turn, the damage rolled by the server.
 */
export function fireFormBurns(
  state: GameState,
  mover: Actor,
  path: readonly Point[],
  deps: DamageDeps & Readonly<{ rollDie: (sides: number) => number; squarePx: number }>
): EffectNarration[] {
  const definition = mover.definitionId ? deps.resolveDefinition(mover.definitionId) : undefined;
  if (traitText(definition, "Fire Form") === null || path.length < 2) return [];
  const events: EffectNarration[] = [];
  for (const token of state.combat.tokens) {
    if (token.actorId === mover.id || !token.position) continue;
    const half = (deps.squarePx * token.sizeCells) / 2;
    const at = token.position;
    // Entered: a step after the start lies in its space.
    const entered = path
      .slice(1)
      .some((point) => Math.abs(point.x - at.x) < half - 0.5 && Math.abs(point.y - at.y) < half - 0.5);
    if (!entered) continue;
    const key = burnKey(mover.id, token.actorId);
    if ((state.combat.turn.turnUses[key] ?? 0) > 0) continue;
    const target = state.actors.find((actor) => actor.id === token.actorId);
    if (!target || target.hp.current <= 0) continue;
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
    };
    const amount = deps.rollDie(10);
    const outcome = applyDamageDetailed(
      state,
      target.id,
      { amount, parts: [{ amount, type: "fire" }], sourceActorId: mover.id, sourceName: mover.name },
      { role: "gm" },
      deps
    );
    events.push({
      kind: "damage",
      text: `${target.name} takes ${outcome.application.totalApplied} Fire damage from ${mover.name}'s Fire Form.`,
      actorId: target.id,
      source: { actorId: mover.id, name: mover.name }
    });
    events.push(...outcome.events);
  }
  return events;
}

/** Whether a creature with Air Form or Water Form printed for enemies may stop where it ends: in no creature's space but
 *  an enemy's. */
export function endsInFriendlySpace(
  state: GameState,
  mover: Actor,
  occupantIds: readonly string[],
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): boolean {
  return occupantIds.some((id) => {
    const occupant = state.actors.find((actor) => actor.id === id);
    return occupant !== undefined && !areEnemies(mover, occupant, resolveDefinition);
  });
}
