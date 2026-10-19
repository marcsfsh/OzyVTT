import { endEffect, READIED_TAG, releaseReadied } from "../effects.js";
import { castsWithVerbal } from "./components.js";
import { endedEffect, type ResolveContext } from "./context.js";
import { shapingOf } from "./metamagic.js";

/** The resolve casts a spell with a Verbal component: a new cast, not what the spell lets its caster do later. */
function castsAloud(ctx: ResolveContext): boolean {
  const spellId = ctx.action.spellId;
  return castsWithVerbal({
    attacker: ctx.attacker,
    action: ctx.action,
    spell: spellId ? ctx.deps.catalog?.spellRecord?.(spellId) : undefined,
    definition: ctx.deps.definition,
    catalog: ctx.deps.catalog,
    subtle: shapingOf(ctx.input.shaping, "subtle-spell") !== undefined
  });
}

/** Counts a ray of a released readied spell off its held rays: "held" while rays are left to make, so the ready
 *  stays; "last" for its last ray, which lets it go; null for anything else. */
function readiedRay(ctx: ResolveContext): "held" | "last" | null {
  const { state, action, attacker } = ctx;
  if (state.combat.turnActorId === attacker.id || ctx.attack === null) return null;
  const readied = attacker.effects.find(
    (effect) => effect.tags.includes(READIED_TAG) && effect.readiedSpell?.actionId === action.id
  );
  const held = readied?.readiedSpell;
  if (!readied || !held) return null;
  const left = (held.raysLeft ?? action.attack?.count ?? 1) - 1;
  if (left <= 0) return held.raysLeft === undefined ? null : "last";
  attacker.effects = attacker.effects.map((effect) =>
    effect.id === readied.id ? { ...effect, readiedSpell: { ...held, raysLeft: left } } : effect
  );
  return "held";
}

/** An effect that ends once its bearer takes an action, a Bonus Action or a Reaction (Merge with Shadows). */
export const UNTIL_NEXT_ACTION_TAG = "until-next-action";

/** Rule consequences of having acted: attacking reveals a hidden creature, and a Reaction taken off-turn uses up
 *  the ready. The economy already spent that Reaction on the readied response (`isReadiedResponse`); any other
 *  Reaction leaves none to take the readied action with. */
export function releaseHideAndReady(ctx: ResolveContext): void {
  const { state, action, attacker, plan, effectsEnded } = ctx;
  const end = (tag: string) => {
    const effect = attacker.effects.find((candidate) => candidate.tags.includes(tag));
    if (!effect) return;
    endEffect(state, attacker.id, effect.id);
    effectsEnded.push(endedEffect(attacker, effect));
  };
  // SRD Hide: "the condition ends on you immediately after ... you make an attack roll, or you cast a spell with a
  // Verbal component"; the attack still had Invisible's Advantage. A throw that asks for a save (a Net, a flask, a
  // breath) is neither, and a sound louder than a whisper is the GM's call. Supreme Sneak's Stealth Attack keeps it, if
  // the Thief ends the turn behind Three-Quarters or Total Cover.
  if (ctx.keepsHidden && attacker.effects.some((effect) => effect.tags.includes("hidden")))
    ctx.warnings.push(
      `Stealth Attack: ${attacker.name} stays hidden only if it ends this turn behind Three-Quarters Cover or Total Cover. If it doesn't, end its Invisible condition then.`
    );
  else if (action.attack !== undefined || castsAloud(ctx)) end("hidden");
  // "The condition ends on you immediately after you take an action, a Bonus Action, or a Reaction": any of them but
  // the one that gave it.
  const tookTurnAction =
    action.activation === "action" ||
    action.activation === "bonus-action" ||
    action.activation === "reaction" ||
    plan.markReaction;
  if (tookTurnAction)
    for (const effect of attacker.effects.filter(
      (candidate) => candidate.tags.includes(UNTIL_NEXT_ACTION_TAG) && !candidate.id.startsWith(ctx.input.commandId)
    )) {
      endEffect(state, attacker.id, effect.id);
      effectsEnded.push(endedEffect(attacker, effect));
    }
  // A released spell of several rays (Scorching Ray) keeps its ready until its last ray, all on the one Reaction.
  const ray = readiedRay(ctx);
  if (ray === "held") return;
  // A spell the ready held, released now or not, goes with it.
  if (
    ray === "last" ||
    (state.combat.turnActorId !== attacker.id &&
      action.id !== "ready" &&
      (plan.markReaction || action.activation === "reaction"))
  )
    for (const name of releaseReadied(state, attacker.id))
      effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name });
}
