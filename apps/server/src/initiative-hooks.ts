import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import { actionPools, effectiveActions } from "./effective-actions.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";

/**
 * What happens "when you roll Initiative" (SRD 5.2.1). Superior Inspiration, Perfect Focus and Archdruid's Evergreen
 * Wild Shape give uses back at once. Persistent Rage and Uncanny Metabolism are the creature's to choose: each
 * combatant has a window from rolling Initiative to the end of its first turn, in which they are offered
 * (`conversions.ts`). Rolling Initiative also closes the step a finished rest opened.
 */

type Deps = Readonly<{
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** Gives a pool back uses until `atLeast` are left, when fewer are. Returns how many came back. */
function regainUntil(actionUses: Record<string, number>, limit: number, poolId: string, atLeast: number): number {
  const spent = actionUses[poolId] ?? 0;
  const left = limit - spent;
  if (left >= atLeast || spent === 0) return 0;
  const back = Math.min(spent, atLeast - left);
  const next = spent - back;
  if (next > 0) actionUses[poolId] = next;
  else delete actionUses[poolId];
  return back;
}

/** The automatic regains for creatures that just rolled Initiative, and their window for the chosen ones. */
export function rolledInitiative(state: GameState, actorIds: Iterable<string>, deps: Deps): EffectNarration[] {
  const events: EffectNarration[] = [];
  const window = new Set(state.combat.initiativeWindow);
  for (const actorId of actorIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor) continue;
    window.add(actorId);
    actor.restStep = null;
    const definition = actor.definitionId ? deps.resolveDefinition?.(actor.definitionId) : undefined;
    if (!definition) continue;
    const pools = new Map(
      actionPools(effectiveActions(definition, actor, deps.catalog)).map((pool) => [pool.id, pool] as const)
    );
    const uses = { ...actor.actionUses };
    const regain = (featureId: string, name: string, poolId: string, atLeast: number, poolName: string) => {
      const pool = pools.get(poolId);
      if (!pool || !holdsFeature(definition, featureId, name)) return;
      const back = regainUntil(uses, pool.limit, poolId, atLeast);
      if (back > 0)
        events.push({
          kind: "effect",
          text: `${actor.name} rolls Initiative and regains ${back} ${back === 1 ? "use" : "uses"} of ${poolName} (${name}).`,
          actorId
        });
    };
    // "you regain expended uses of Bardic Inspiration until you have two if you have fewer than that"
    regain("superior-inspiration", "Superior Inspiration", "bardic-inspiration", 2, "Bardic Inspiration");
    // "you regain expended Focus Points until you have 4 if you have 3 or fewer"
    regain("perfect-focus", "Perfect Focus", "focus-points", 4, "Focus Points");
    // "Whenever you roll Initiative and have no uses of Wild Shape left, you regain one expended use of it."
    if ((pools.get("wild-shape")?.limit ?? 0) - (uses["wild-shape"] ?? 0) <= 0)
      regain("archdruid", "Archdruid", "wild-shape", 1, "Wild Shape");
    actor.actionUses = uses;
  }
  state.combat = { ...state.combat, initiativeWindow: [...window] };
  return events;
}

/** A combatant's first turn ended: the window for what it may do when it rolled Initiative closes. */
export function closeInitiativeWindow(state: GameState, actorId: string): void {
  if (!state.combat.initiativeWindow.includes(actorId)) return;
  state.combat = {
    ...state.combat,
    initiativeWindow: state.combat.initiativeWindow.filter((id) => id !== actorId)
  };
}
