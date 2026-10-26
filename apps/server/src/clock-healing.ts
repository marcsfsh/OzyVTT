import { isDead, ROUNDS_PER_MINUTE, type GameState } from "@vtt/domain";
import { abilityModifier, parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorDefinition, RegainHitPoints } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import { itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { healActor } from "./hit-points.js";
import { rowRecord } from "./item-records.js";
import { hitDieSizesToSpend } from "./rests.js";

/**
 * Hit Points regained as time passes, from a worn item (a Ring of Regeneration's 1d6 every 10 minutes, an Ioun Stone of
 * Regeneration's 15 at the end of each hour) or an effect (a Rod of Security's demiplane: each hour "as if it had spent
 * 1 Hit Point Die"), only while the creature has at least 1 Hit Point. Outside a fight the game clock counts the
 * intervals it passes; in a fight, its rounds do, 10 to the minute, as each of the creature's turns starts.
 */

type Actor = GameState["actors"][number];

export type ClockHealingDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: (sides: number) => number;
}>;

type Regenerator = Readonly<{ name: string; regains: RegainHitPoints }>;

/** What makes this creature regain Hit Points over time: its worn items' and its effects'. */
function regeneratorsOf(actor: Actor, catalog: EquipmentCatalog | undefined): Regenerator[] {
  const fromItems = catalog
    ? actor.inventory.flatMap((row) => {
        const record = rowRecord(catalog, row);
        return record?.regainsHitPoints && row.quantity > 0 && itemIsActive(row, record)
          ? [{ name: record.name, regains: record.regainsHitPoints }]
          : [];
      })
    : [];
  const fromEffects = actor.effects.flatMap((effect) =>
    effect.regainsHitPoints ? [{ name: effect.name, regains: effect.regainsHitPoints }] : []
  );
  return [...fromItems, ...fromEffects];
}

/** One interval's Hit Points: its dice or number, or a Hit Point Die rolled with the Constitution modifier (at least 1)
 *  and not spent. */
function rolledRegain(actor: Actor, regains: RegainHitPoints, deps: ClockHealingDeps): number {
  if (regains.hitPointDie) {
    const [sides] = actor.hitDice
      ? hitDieSizesToSpend(
          actor.hitDice.entries.map((entry) => ({ ...entry, remaining: 1 })),
          1
        )
      : [];
    if (sides === undefined) return 0;
    const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
    const con = definition ? abilityModifier(definition.abilityScores.con) : 0;
    return Math.max(1, deps.random(sides) + con);
  }
  const formula = regains.formula ?? "0";
  return /^\d+$/.test(formula) ? Number(formula) : resolveDice(parseDiceFormula(formula), deps.random).total;
}

/** Heals `times` intervals of one regenerator, stopping once the creature is at its maximum or can't heal. */
function regainTimes(
  state: GameState,
  actor: Actor,
  source: Regenerator,
  times: number,
  deps: ClockHealingDeps
): EffectNarration[] {
  const before = actor.hp.current;
  const events: EffectNarration[] = [];
  for (let interval = 0; interval < times; interval += 1) {
    if (actor.hp.current < 1 || actor.hp.current >= actor.hp.maximum || isDead(actor)) break;
    const amount = rolledRegain(actor, source.regains, deps);
    if (amount <= 0) break;
    const was = actor.hp.current;
    const healed = healActor(state, actor.id, amount, { role: "gm" });
    // Something bars the healing (Chill Touch): it says so once.
    if (actor.hp.current === was) {
      events.push(...healed);
      break;
    }
  }
  const regained = actor.hp.current - before;
  if (regained > 0)
    events.push({
      kind: "effect",
      text: `${actor.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${source.name}).`,
      actorId: actor.id,
      ...(actor.kind === "player-character" ? {} : { gmOnly: true as const })
    });
  return events;
}

/** The game clock moved from `before` to `total` minutes: each creature in time regains what each interval ending in
 *  that span gives it. */
export function healingOverTime(
  state: GameState,
  inTime: ReadonlySet<string>,
  before: number,
  total: number,
  deps: ClockHealingDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    if (!inTime.has(actor.id) || actor.hp.current < 1) continue;
    for (const source of regeneratorsOf(actor, deps.catalog)) {
      const every = source.regains.everyMinutes;
      const times = Math.floor(total / every) - Math.floor(before / every);
      if (times > 0) events.push(...regainTimes(state, actor, source, times, deps));
    }
  }
  return events;
}

/** Whether any of the creature's regenerators completes an interval as this round's turn of it starts. */
export function regeneratesThisRound(
  state: GameState,
  actorId: string,
  catalog: EquipmentCatalog | undefined
): boolean {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const round = state.combat.round;
  if (!actor || actor.hp.current < 1 || actor.hp.current >= actor.hp.maximum || round <= 1) return false;
  return regeneratorsOf(actor, catalog).some(
    (source) => (round - 1) % (source.regains.everyMinutes * ROUNDS_PER_MINUTE) === 0
  );
}

/** In a fight, a creature's turn that starts as an interval of the fight's rounds ends (10 rounds a minute) regains
 *  what each such regenerator gives. */
export function healingThisRound(state: GameState, actorId: string, deps: ClockHealingDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const round = state.combat.round;
  if (!actor || actor.hp.current < 1 || round <= 1) return [];
  return regeneratorsOf(actor, deps.catalog).flatMap((source) =>
    (round - 1) % (source.regains.everyMinutes * ROUNDS_PER_MINUTE) === 0
      ? regainTimes(state, actor, source, 1, deps)
      : []
  );
}
