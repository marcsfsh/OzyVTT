import { TELEPORT_FAMILIARITY } from "@vtt/domain";
import { applyDamageDetailed } from "../hit-points.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Teleport: "Your familiarity with the destination determines whether you arrive there successfully. The GM
 * rolls 1d100 and consults the Teleportation Outcome table." The caster picks the familiarity as it casts; the server
 * rolls. A Mishap deals each traveller 3d10 Force damage and rolls again; Off Target rolls the 2d12 miles and the d8
 * direction. Where the destination is, and the scene the travellers arrive in, are the GM's.
 */

type Outcome = "mishap" | "similar-area" | "off-target" | "on-target";

/** Each familiarity's highest d100 for Mishap, Similar Area and Off Target; the rest is On Target. */
const TABLE: Readonly<Record<string, readonly [number, number, number]>> = {
  "permanent-circle": [0, 0, 0],
  "linked-object": [0, 0, 0],
  "very-familiar": [5, 13, 24],
  "seen-casually": [33, 43, 53],
  "viewed-once": [43, 53, 73],
  "false-destination": [50, 100, 100]
};

const DIRECTIONS = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"] as const;

export function outcomeOf(familiarity: string, roll: number): Outcome {
  const [mishap, similar, off] = TABLE[familiarity] ?? TABLE["very-familiar"]!;
  if (roll <= mishap) return "mishap";
  if (roll <= similar) return "similar-area";
  return roll <= off ? "off-target" : "on-target";
}

/** Rolls the cast's outcome: mishaps hurt each traveller (the caster and the creatures it takes) and roll again. */
export function teleportOutcome(ctx: ResolveContext): void {
  const { action, attacker, input, state, deps } = ctx;
  if (!action.teleportOutcome || input.commit === false) return;
  const picked = TELEPORT_FAMILIARITY.find((option) => option.id === input.optionId);
  const familiarity = picked ?? TELEPORT_FAMILIARITY.find((option) => option.id === "very-familiar")!;
  if (!picked) ctx.warnings.push(`Teleport: no familiarity was picked, so it is ${familiarity.name}.`);
  const travellers = [...new Set([attacker.id, ...ctx.targets.map((target) => target.id)])];
  const line = (text: string) => ctx.tableNarration.push({ kind: "effect", text, actorIds: travellers });
  // Multiple mishaps can occur; ten is past any table's reasonable run.
  for (let mishaps = 0; mishaps < 10; mishaps += 1) {
    const roll = Math.max(1, Math.min(100, deps.random(100)));
    const outcome = outcomeOf(familiarity.id, roll);
    const opening = `Teleport (${familiarity.name}), d100 ${roll}:`;
    if (outcome === "on-target") return void line(`${opening} On Target. The travellers appear where intended.`);
    if (outcome === "similar-area")
      return void line(`${opening} Similar Area. The travellers appear in the closest place like the destination.`);
    if (outcome === "off-target") {
      const miles = deps.random(12) + deps.random(12);
      const direction = DIRECTIONS[Math.max(1, Math.min(8, deps.random(8))) - 1]!;
      return void line(`${opening} Off Target. The travellers appear ${miles} miles ${direction} of the destination.`);
    }
    const force = deps.random(10) + deps.random(10) + deps.random(10);
    line(`${opening} Mishap. Each traveller takes ${force} Force damage, and the table is rolled again.`);
    for (const travellerId of travellers) {
      const { events } = applyDamageDetailed(
        state,
        travellerId,
        {
          amount: force,
          parts: [{ amount: force, type: "force" }],
          sourceName: "Teleport",
          sourceActorId: attacker.id
        },
        { role: "gm" },
        {
          resolveDefinition: deps.resolveDefinition ?? (() => undefined),
          newId: deps.newRollId,
          now: deps.now,
          ...(deps.catalog ? { catalog: deps.catalog } : {}),
          rollDie: deps.random
        }
      );
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    }
  }
}
