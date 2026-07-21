import type { ActorDefinition, GameState } from "@vtt/domain";
import { endEffectsSustainedBy } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";

const MAX_ACTORS = 200;
const MAX_IMPORTED_DEFINITIONS = 100;

/** "Goblin Warrior" -> "Goblin Warrior 2" -> "Goblin Warrior 3" ... deterministic and collision-free. */
function dedupedName(state: GameState, base: string): string {
  const names = new Set(state.actors.map((actor) => actor.name));
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} ${suffix}`.slice(0, 120);
    if (!names.has(candidate)) return candidate;
  }
}

/** SRD Hit Point Dice pool from a definition's hit-point formula ("7d8 + 14" → 7 × d8); no parseable formula = unmodeled (null, the fail-open pattern). */
export function hitDiceFromDefinition(definition: ActorDefinition): { die: "d4" | "d6" | "d8" | "d10" | "d12" | "d20"; maximum: number; remaining: number } | null {
  const match = definition.hitPoints.formula?.match(/^(\d+)d(4|6|8|10|12|20)\b/i);
  if (!match) return null;
  const count = Math.min(40, Number.parseInt(match[1], 10));
  if (count < 1) return null;
  return { die: `d${match[2]}` as "d4" | "d6" | "d8" | "d10" | "d12" | "d20", maximum: count, remaining: count };
}

function instantiate(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only", kind: "player-character" | "monster", definitionId: string) {
  if (state.actors.length >= MAX_ACTORS) throw new CommandRejectedError("The roster is full - remove unused combatants first.");
  state.actors.push({
    id,
    name: dedupedName(state, definition.name),
    kind,
    visibility,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    armorClass: definition.armorClass,
    initiative: definition.initiativeBonus,
    ownerSessionId: null,
    conditions: [],
    effects: [],
    deathSaves: null,
    actionUses: {},
    conditionImmunities: definition.conditionImmunities ? [...definition.conditionImmunities] : [],
    speedFeet: definition.speedFeet,
    ...(definition.legendary ? { legendary: { ...definition.legendary } } : {}),
    hitDice: hitDiceFromDefinition(definition),
    ...(definition.summary ? { notes: definition.summary } : {}),
    definitionId,
    size: definition.size,
    sizeCells: Math.max(definition.token.footprint.width, definition.token.footprint.height)
  });
}

export function addActorFromDefinition(state: GameState, definition: ActorDefinition, id: string, visibility: "public" | "gm-only") {
  if (definition.schemaId !== "vtt.actor-monster") throw new CommandRejectedError("Only monster definitions can be added this way.");
  if (!definition.source.externalId) throw new CommandRejectedError("That bundled definition is missing its content id.");
  instantiate(state, definition, id, visibility, "monster", definition.source.externalId);
}

/**
 * Import a canonical ActorDefinition (character or monster) shipped as JSON: the inert
 * definition persists with the campaign and a live actor is instantiated from it. Characters
 * become claimable player-characters; the ActorDefinitionSchema already forces them friendly.
 */
export function importActorDefinition(state: GameState, definition: ActorDefinition, actorId: string, visibility: "public" | "gm-only") {
  if (state.definitions.length >= MAX_IMPORTED_DEFINITIONS) throw new CommandRejectedError("The imported-sheet library is full - remove unused combatants first.");
  const definitionId = `import-${actorId}`;
  const kind = definition.schemaId === "vtt.actor-character" ? "player-character" as const : "monster" as const;
  instantiate(state, definition, actorId, visibility, kind, definitionId);
  state.definitions = [...state.definitions, { id: definitionId, definition }];
}

export function removeActor(state: GameState, actorId: string) {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (actor.kind === "player-character" && actor.ownerSessionId !== null) throw new CommandRejectedError("Release that character's claim before removing it.");
  if (actor.kind === "player-character" && !actor.definitionId?.startsWith("import-")) throw new CommandRejectedError("Player characters can't be removed from the roster.");
  // A recorded turn snapshot may reference this actor; removing it while rewound would leave the
  // restore pointing at a combatant that no longer exists. Make the GM leave history review first.
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before removing a combatant.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) {
    throw new CommandRejectedError("End the encounter before removing a combatant who is in it.");
  }
  // A parked scene can hold a paused, still-active fight; block removal if this actor is in one.
  if (state.combat.scenes.some((scene) => scene.combat.active && scene.combat.initiative.some((entry) => entry.actorId === actorId))) {
    throw new CommandRejectedError("End the paused encounter in the prepared scene that uses this combatant first.");
  }
  // A removed actor can no longer sustain effects on others (its grapples release, ADR-0020).
  endEffectsSustainedBy(state, actorId);
  state.actors = state.actors.filter((item) => item.id !== actorId);
  // Drop the actor from every inactive prepared scene so no scene references a combatant that no longer exists.
  if (state.combat.scenes.some((scene) => !scene.combat.active && (scene.combat.initiative.some((entry) => entry.actorId === actorId) || scene.combat.tokens.some((token) => token.actorId === actorId)))) {
    state.combat = { ...state.combat, scenes: state.combat.scenes.map((scene) => scene.combat.active ? scene : ({ ...scene, combat: { ...scene.combat, initiative: scene.combat.initiative.filter((entry) => entry.actorId !== actorId), tokens: scene.combat.tokens.filter((token) => token.actorId !== actorId) } })) };
  }
  // Imported stat blocks live only for their actors; drop one nothing references anymore.
  if (actor.definitionId?.startsWith("import-") && !state.actors.some((item) => item.definitionId === actor.definitionId)) {
    state.definitions = state.definitions.filter((entry) => entry.id !== actor.definitionId);
  }
  // A finished encounter keeps its initiative for reference; drop this actor's stale entry
  // and token so nothing references a combatant that no longer exists.
  if (!state.combat.active) {
    state.combat = {
      ...state.combat,
      initiative: state.combat.initiative.filter((entry) => entry.actorId !== actorId),
      tokens: state.combat.tokens.filter((token) => token.actorId !== actorId)
    };
  }
}

/** Definition lookup for sheets/actions: imported stat blocks first, then the bundled content. */
export function storedDefinition(state: GameState, definitionId: string): ActorDefinition | undefined {
  return state.definitions.find((entry) => entry.id === definitionId)?.definition;
}
