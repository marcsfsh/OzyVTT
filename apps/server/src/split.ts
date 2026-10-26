import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { addSummonedActor, removeActor } from "./actor-roster.js";
import type { EffectNarration } from "./effects.js";
import { joinInitiative, removeCombatant } from "./encounter.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

type Actor = GameState["actors"][number];
type Size = NonNullable<Actor["size"]>;

const SIZES: readonly Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const CELLS: Record<Size, number> = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

/**
 * A black pudding's or an ochre jelly's Split: "The pudding splits into two new Black Puddings. Each new pudding is one
 * size smaller than the original pudding and acts on its Initiative. The original pudding's Hit Points are divided
 * evenly between the new puddings (round down)." Two creatures of the same stat block take its place on its
 * Initiative count, each with half its Hit Points as both current and maximum, in the space it filled; the original
 * leaves the fight and the roster.
 */
export function splitCreature(
  state: GameState,
  original: Actor,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    newId: () => string;
    catalog?: EquipmentCatalog;
  }>
): EffectNarration[] {
  const definitionId = original.definitionId;
  const definition = definitionId ? deps.resolveDefinition(definitionId) : undefined;
  if (!definitionId || !definition) throw new CommandRejectedError(`${original.name}'s stat block is gone.`);
  const size = SIZES[Math.max(0, SIZES.indexOf(original.size ?? definition.size) - 1)]!;
  const hitPoints = Math.floor(original.hp.current / 2);
  const entry = state.combat.initiative.find((candidate) => candidate.actorId === original.id);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === original.id);
  const perCell = token ? token.sizePx / (token.sizeCells ?? 1) : 48;
  // The two share the space the original filled; two that each fill the whole of it stand side by side.
  const inset = ((token?.sizeCells ?? 1) - CELLS[size]) * (perCell / 2);
  const offsets = inset > 0 ? [-inset, inset] : [0, perCell];
  const made: Array<{ id: string; name: string }> = [];
  for (const [index, offset] of offsets.entries()) {
    const id = deps.newId();
    addSummonedActor(state, definition, id, original.visibility, definitionId, deps.catalog);
    const copy = state.actors.find((candidate) => candidate.id === id)!;
    copy.size = size;
    copy.sizeCells = CELLS[size];
    copy.hp = { current: hitPoints, maximum: hitPoints, temporary: 0 };
    joinInitiative(state, {
      actorId: id,
      score: entry?.score ?? 0,
      tieBreaker: entry?.tieBreaker ?? 0,
      ...(index > 0 ? { follows: made[0]!.id } : entry?.follows ? { follows: entry.follows } : {})
    });
    if (token)
      state.combat = {
        ...state.combat,
        tokens: [
          ...state.combat.tokens,
          {
            actorId: id,
            position: token.position
              ? {
                  x: Math.max(0, token.position.x + offset),
                  y: Math.max(0, token.position.y + (inset > 0 ? offset : 0))
                }
              : null,
            sizePx: perCell * CELLS[size],
            gridSizePx: token.gridSizePx ?? null,
            gridRotationRadians: token.gridRotationRadians ?? null,
            sizeCells: CELLS[size],
            ...(token.altitudeFeet !== undefined ? { altitudeFeet: token.altitudeFeet } : {})
          }
        ]
      };
    made.push({ id, name: copy.name });
  }
  // Split on its own turn, the first new one carries the turn on.
  if (state.combat.turnActorId === original.id) state.combat = { ...state.combat, turnActorId: made[0]!.id };
  const events = removeCombatant(state, original.id, deps.resolveDefinition);
  try {
    removeActor(state, original.id);
  } catch {
    // Mid history review the original stays on the roster, out of the fight, for the GM to remove.
  }
  events.push({
    kind: "effect",
    text: `${original.name} splits into ${made[0]!.name} and ${made[1]!.name}, each ${size} with ${hitPoints} Hit Points.`,
    actorId: made[0]!.id
  });
  return events;
}
