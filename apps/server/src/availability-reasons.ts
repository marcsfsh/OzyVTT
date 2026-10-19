import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState, PassiveOption } from "@vtt/domain";
import { conditionLabel, incapacitatingCondition } from "./condition-rules.js";
import { hasEffectTag, NO_ACTIONS_TAG, SLOWED_TAG } from "./effects.js";
import { laterRowOf } from "./item-actions.js";
import { castSlot, useLimitFor } from "./resolution/economy.js";
import type { DefinitionAction, LiveActor } from "./resolution/context.js";
import { hitRiderOf } from "./resolution/hit-riders.js";
import { markMoveOf } from "./resolution/marks.js";
import { familyOf, type RuleId } from "./rules-families.js";
import { END_EFFECT_ACTION_ID, NO_ENDING_OPTION } from "./ending-actions.js";
import { readyIn } from "./clock-pools.js";

/**
 * What the sheet says about an option it can't use now, and which options stay off the turn list. The availability
 * check decides; these only word its answer in one short sentence for the player whose sheet it is.
 */

/** What a reason may read about the option and the creature it belongs to. */
export type ReasonFacts = Readonly<{
  state: GameState;
  attacker: LiveActor;
  action: DefinitionAction;
  siblings: readonly DefinitionAction[];
  spell: SpellReference | undefined;
}>;

const USES_COME_BACK = {
  turn: "this turn",
  "own-turn": "until your next turn",
  encounter: "until the fight ends",
  "short-rest": "until a Short Rest",
  "long-rest": "until a Long Rest"
} as const;

/** A limited use's refusal: none left, or fewer than this use costs. */
function usesReason({ state, attacker, action, siblings }: ReasonFacts): string {
  const uses = action.uses;
  if (!uses) return "No uses left.";
  if (uses.per === "recharge") return "It hasn't recharged yet.";
  const key = uses.pool ?? action.id;
  const spent =
    uses.per === "turn" ? (state.combat.turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
  if (spent < useLimitFor(siblings, action)) return "Not enough uses left.";
  if (uses.per === "never") return "No uses left, and they don't come back.";
  if (uses.per === "time") {
    const wait = readyIn(state, attacker, key);
    return wait
      ? `No uses left. It can be used again in ${wait} of game time.`
      : "No uses left until enough game time passes.";
  }
  return uses.per === "turn" ? "No uses left this turn." : `No uses left ${USES_COME_BACK[uses.per]}.`;
}

/** No slot to cast it with: the level it needs, or none at that level or above. */
function slotsReason({ attacker, action }: ReasonFacts): string {
  const base = action.spellSlot?.level ?? 1;
  const { level, pact } = castSlot(attacker, base, undefined);
  if (pact) return "No Pact Magic slots left.";
  const higher = (attacker.spellSlots ?? []).some((slot) => slot.level > level);
  return higher ? `No spell slots of level ${level} or higher left.` : `No level ${level} spell slots left.`;
}

/** Names as a sentence lists them: "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The action is spent: by an earlier action, by Slow, or by the attacks this action still has to make. */
function actionSpentReason({ state, attacker, siblings }: ReasonFacts): string {
  const turn = state.combat.turn;
  if (hasEffectTag(attacker, SLOWED_TAG) && turn.bonusActionUsed && !turn.actionUsed)
    return "You took a Bonus Action this turn, and Slow allows only one of the two.";
  const open = turn.actionInstance?.actorId === attacker.id ? turn.actionInstance : null;
  const left = Object.entries(open?.components ?? {})
    .filter(([, count]) => count > 0)
    .map(([key]) =>
      key === "attack"
        ? "attacks"
        : key
            .split("|")
            .map((id) => siblings.find((sibling) => sibling.id === id)?.name ?? id)
            .join(" or ")
    );
  return left.length > 0 ? `Your action has only ${listed(left)} left.` : "You used your action this turn.";
}

/** A requirement the option names: an effect the character must have, or a spell it must have cast. */
function requiresReason({ attacker, action, spell }: ReasonFacts): string {
  if (action.requiresEffectTag && !hasEffectTag(attacker, action.requiresEffectTag))
    return `Only while ${conditionLabel(action.requiresEffectTag)}.`;
  if (spell && markMoveOf(spell, action.id)) return `You aren't concentrating on ${spell.name}.`;
  if (spell && laterRowOf(spell, action.id)) return `Cast ${spell.name} first.`;
  if (action.id === END_EFFECT_ACTION_ID) return NO_ENDING_OPTION;
  return "It needs an effect you don't have now.";
}

/** One sentence per rule, so a new rule doesn't compile until it says why in the sheet's words. */
const REASONS: Readonly<Record<RuleId, (facts: ReasonFacts) => string>> = {
  "movement.exceeds-speed": () => "Not enough movement left.",
  "movement.no-movement-remaining": () => "No movement left.",
  "movement.stand-up-cost": () => "Not enough movement left to stand up.",
  "movement.stand-up-off-turn": () => "Stand up on your own turn.",
  "movement.already-moved": () => "You moved this turn.",
  "movement.off-turn": () => "It isn't your turn.",
  "movement.teleport": () => "The GM moves a token that teleports.",
  "movement.occupied": () => "Another creature is in that space.",
  "movement.no-speed": () => "You don't have that speed.",
  "movement.blocked-path": () => "Enemies block the way.",
  "movement.altitude": () => "Fly, climb or jump to change height.",
  "movement.jump": () => "A jump goes as far as the creature's Strength allows.",
  "movement.toward-fear": () => "You can't move closer to what you fear.",
  "movement.mount": () => "Mount a creature within 5 feet that is at least one size larger.",
  "economy.action-used": actionSpentReason,
  "economy.bonus-action-used": ({ state, attacker }) =>
    hasEffectTag(attacker, SLOWED_TAG) && state.combat.turn.actionUsed && !state.combat.turn.bonusActionUsed
      ? "You took an action this turn, and Slow allows only one of the two."
      : "You used your Bonus Action this turn.",
  "economy.reaction-used": () => "Your Reaction is spent until your next turn.",
  "economy.not-your-turn": () => "It isn't your turn.",
  "economy.spent-slot": () => "Only the GM gives that back.",
  "initiative.gathering": () => "Turns begin once everyone has rolled Initiative.",
  "condition.incapacitated": ({ attacker }) => {
    const condition = incapacitatingCondition(attacker);
    if (condition !== null) return `You can't act while ${conditionLabel(condition)}.`;
    return hasEffectTag(attacker, NO_ACTIONS_TAG)
      ? "You can't take an action or a Bonus Action this turn."
      : "You can't act now.";
  },
  "condition.down": () => "You can't act at 0 Hit Points.",
  "condition.imposed": () => "It ends by its own rules or the GM's say.",
  "condition.raging": () => "You can't cast spells while raging.",
  "summon.cant-attack": () => "This creature can't attack.",
  "summon.command": () => "Your command doesn't reach that far.",
  "condition.no-reactions": () => "You can't take Reactions now.",
  "condition.no-spells": () => "You can't cast spells now.",
  "condition.cant-attack": () => "You can't attack now.",
  "condition.dash-only": () => "You can take only the Dash action now.",
  "condition.one-thing-a-turn": () => "This turn you can only move, take an action or take a Bonus Action.",
  "movement.cant-stand": () => "You can't stand up now.",
  "form.no-spells": ({ spell }) =>
    spell && (spell.components.materialConsumed || (spell.components.costly ?? []).length > 0)
      ? "Beast Spells leaves out a spell with a costly or consumed Material component."
      : "You can't cast spells in this form.",
  "form.no-actions": () => "You can't take actions in this form.",
  "form.no-attacks": () => "You can't attack in this form.",
  "form.wrong-form": ({ action }) => `Only in ${action.formOnly?.length === 1 ? "one" : "some"} of your forms.`,
  "legendary.own-turn": () => "Take it right after another creature's turn.",
  "legendary.after-a-turn": () => "Take it right after another creature's turn, before the next one acts.",
  "attack.light-needs-attack": () => "Attack with another Light weapon first.",
  "attack.cleave-needs-hit": () => "Hit with this weapon in melee first.",
  "attack.after-first-roll": () => "Decide it before your first attack roll.",
  "attack.loading": () => "It fires once per action.",
  "attack.no-ammunition": () => "No ammunition for it.",
  "attack.two-handed": () => "It needs two hands. Unequip the Shield first.",
  "spell.untrained-armor": () => "You can't cast spells in armor you aren't trained with.",
  "spell.scroll-unreadable": () => "That spell isn't on your spell lists.",
  "spell.later-turn": () => "It comes on a later turn.",
  "attack.rides-a-hit": () => "Choose it when an attack hits.",
  "roll.answers-a-roll": () => "Use it on a roll it answers, once the roll is shown.",
  "legendary.no-actions-remaining": () => "No legendary actions left this round.",
  "legendary.once-per-round": () => "Not again until your next turn.",
  "feature.no-uses-remaining": usesReason,
  "feature.requires-effect": requiresReason,
  "feature.once-per-turn": () => "You used it this turn.",
  "range.out-of-range": () => "Out of range.",
  "range.out-of-reach": () => "Out of reach.",
  "range.underwater": () => "Out of range underwater.",
  "action.underwater-only": () => "Only underwater.",
  "target.grappled-by-source": () => "You aren't grappling that creature.",
  "target.too-large-to-grapple": () => "That creature is too large.",
  "target.not-an-enemy": () => "Choose an enemy.",
  "target.mark-still-standing": () => "It moves once its creature drops to 0 Hit Points.",
  "cover.total": () => "The target has Total Cover.",
  "hide.seen": () => "An enemy can see you.",
  "hide.exposed": () => "Hide in darkness, fog or behind a wall.",
  "light.too-bright": () => "Only in Dim Light or darkness.",
  "attack.cleave-same-target": () => "Choose a second creature.",
  "attack.cleave-too-far": () => "The second creature must be within 5 feet of the first.",
  "target.too-many": () => "Too many targets.",
  "target.wrong-type": () => "It can't target that kind of creature.",
  "target.unseen": () => "You can't see that creature.",
  "target.outside-area": () => "Those creatures don't fit in one of its areas.",
  "target.not-allowed": () => "It can't affect that creature.",
  "target.revival": () => "It can't bring that creature back.",
  "attack.hit-option-unqualified": () => "That hit can't carry it.",
  "condition.charmed-charmer": () => "You can't attack the creature that charmed you.",
  "slots.none-remaining": slotsReason,
  "slots.below-spell-level": ({ action }) => `It needs a level ${action.spellSlot?.level ?? 1} spell slot or higher.`,
  "slots.one-per-turn": () => "You already spent a spell slot this turn.",
  "slots.not-prepared": () => "Not prepared.",
  "metamagic.unknown": () => "You don't have that option.",
  "metamagic.unfit": () => "This spell can't take that option.",
  "metamagic.too-many": () => "Too many Metamagic options on one spell.",
  "metamagic.quickened": () => "You used Quickened Spell this turn, so no other level 1+ spell this turn.",
  "metamagic.choice": () => "Choose what the option names.",
  "metamagic.with-a-cast": () => "Choose it when you cast a spell.",
  "spell.no-verbal": () => "You can't speak now, and it has a Verbal component.",
  "spell.no-free-hand": () => "Its gestures need a free hand. Unequip a weapon or a Shield on the Gear tab.",
  "spell.no-material": materialReason
};

/** A Material component the caster lacks: the priced or consumed material itself, else a pouch or focus in reach. */
function materialReason({ spell }: ReasonFacts): string {
  const costly = spell?.components.costly ?? [];
  if (costly.length > 0)
    return `It needs ${listed(costly.map((material) => (material.costGp !== null ? `${material.name} worth ${material.costGp}+ GP` : material.name)))}. Add it to your gear.`;
  return "It needs a Component Pouch, or a Spellcasting Focus you can use, and a hand free to reach it.";
}

/** Rules about the option itself, which outlast the turn, so they are named before the turn's own. */
const ABOUT_THE_OPTION: ReadonlySet<RuleId> = new Set([
  "slots.not-prepared",
  "spell.untrained-armor",
  "spell.no-verbal",
  "spell.no-free-hand",
  "spell.no-material",
  "spell.scroll-unreadable",
  "attack.no-ammunition",
  "attack.two-handed",
  "feature.requires-effect",
  "attack.rides-a-hit",
  "roll.answers-a-roll",
  "metamagic.with-a-cast",
  "feature.no-uses-remaining",
  "slots.none-remaining",
  "slots.below-spell-level",
  "legendary.no-actions-remaining",
  "legendary.once-per-round"
]);

/** Which violation the sentence names: the character first (Stunned, 0 Hit Points), then the option, then the turn,
 *  then targeting. Within a rank, the order the check found them. */
function rankOf(rule: RuleId): number {
  if (rule.startsWith("condition.") && rule !== "condition.charmed-charmer" && rule !== "condition.imposed") return 0;
  if (ABOUT_THE_OPTION.has(rule)) return 1;
  const family = familyOf(rule);
  return family === "targeting" || family === "movement" ? 3 : 2;
}

/** The sentence for an unavailable option, or undefined when nothing stops it. */
export function unavailableReason(
  violations: readonly Readonly<{ rule: RuleId }>[],
  facts: ReasonFacts
): string | undefined {
  const first = [...violations].sort((left, right) => rankOf(left.rule) - rankOf(right.rule))[0];
  return first ? REASONS[first.rule](facts) : undefined;
}

/** Features a creature takes on its own turn though their activation reads "other". */
const TAKEN_ON_A_TURN: ReadonlySet<string> = new Set(["action-surge"]);
/** Features used outside a fight that their text doesn't tie to a rest's end. */
const USED_BETWEEN_FIGHTS: ReadonlySet<string> = new Set(["magical-cunning"]);

/** Whether the action does something the resolver runs: a roll, damage, healing, an effect, a spell or a slot. */
const structured = (action: DefinitionAction): boolean =>
  action.attack !== undefined ||
  action.save !== undefined ||
  action.damage.length > 0 ||
  action.healing !== undefined ||
  action.grants !== undefined ||
  action.multiattack !== undefined ||
  action.spellId !== undefined ||
  action.spellSlot !== undefined ||
  action.legendary !== undefined ||
  action.endsConditions !== undefined ||
  action.replacesAttack === true;

/**
 * Why an option belongs off the turn list, or undefined when it belongs on it. A hit rider is chosen on an attack's
 * result. Any other feature with no activation of its own and nothing structured to resolve is a use counter: it
 * answers a roll, a hit or a cast (Savage Attacker, Indomitable, Metamagic), or a rest's end (Arcane Recovery). A
 * spell area's later step is run by the server.
 */
export function passiveOf(action: DefinitionAction, builtin: boolean): PassiveOption | undefined {
  if (builtin) return undefined;
  // A rider tapped before its roll (Brutal Strike) is on the turn list; any other is chosen on a hit.
  if (hitRiderOf(action)) return hitRiderOf(action)!.declaredBeforeRoll ? undefined : "rider";
  if (action.activation !== "other") return undefined;
  if (/^spell-.+-then-/.test(action.id)) return "automatic";
  if (structured(action) || TAKEN_ON_A_TURN.has(action.id)) return undefined;
  if (/\bas (?:a|an|your) (?:magic action|bonus action|action|reaction)\b/i.test(action.description)) return undefined;
  if (USED_BETWEEN_FIGHTS.has(action.id) || /\bwhen you finish a (?:short|long) rest\b/i.test(action.description))
    return "rest";
  return "rider";
}
