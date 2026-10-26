import type { CombatState, GameState, RuleFamily, RuleMode } from "@vtt/domain";

/**
 * Every rule id the engine can raise, and the family a GM relaxes it under. GMs relax rules one family
 * at a time (movement without the action economy, say), and the per-turn override memory is keyed by
 * family, so one Allow stops that kind of block re-prompting for the rest of the turn. A new rule needs
 * an entry here before anything can raise it.
 */
const RULE_FAMILIES = {
  "movement.exceeds-speed": "movement",
  "movement.no-movement-remaining": "movement",
  "movement.stand-up-cost": "movement",
  // Standing spends movement, which a creature has only on its own turn.
  "movement.stand-up-off-turn": "movement",
  // Dropping Prone happens on your own turn, and not at Speed 0.
  "movement.drop-prone": "movement",
  // Steady Aim is only for a creature that hasn't moved this turn.
  "movement.already-moved": "movement",
  // A player's move off their turn, and a player's teleport, are the GM's to allow.
  "movement.off-turn": "movement",
  "movement.teleport": "movement",
  // "You can't willingly end a move in a space occupied by another creature."
  "movement.occupied": "movement",
  // Flying or burrowing without the speed, and a path that hostile creatures shut.
  "movement.no-speed": "movement",
  "movement.blocked-path": "movement",
  // Height changes by flying, climbing, jumping or teleporting, and a creature in the air moves by flying.
  "movement.altitude": "movement",
  "movement.jump": "movement",
  // Frightened: "You can't willingly move closer to the source of fear."
  "movement.toward-fear": "movement",
  // A move an effect compels: Fear's flight, Compulsion's heading, Confusion's wander, and the movement it must spend.
  "movement.compelled": "movement",
  "movement.mount": "movement",
  // A Climber's Kit anchor holds its user within 25 feet of the anchor point.
  "movement.tether": "movement",
  // A pit's smooth walls hold a creature with no Climb Speed, climbing gear or magic.
  "movement.pit": "movement",
  "economy.action-used": "economy",
  "economy.bonus-action-used": "economy",
  "economy.reaction-used": "economy",
  "economy.not-your-turn": "economy",
  // "At the start of your turn" (Superior Defense) and "when you take the Attack action" (Sacred Weapon).
  "economy.turn-start": "economy",
  "economy.attack-action": "economy",
  // Rage: "if you aren't wearing Heavy armor".
  "economy.heavy-armor": "economy",
  // Only the GM gives back a spent action, Bonus Action or Reaction: un-marking it would let a creature act twice.
  "economy.spent-slot": "economy",
  // Wait mode: no one acts until every player has rolled initiative.
  "initiative.gathering": "economy",
  // Being incapacitated or down means you have no actions: an economy block.
  "condition.incapacitated": "economy",
  "condition.down": "economy",
  // Ending a condition or effect someone else imposed skips the action (Escape) or the save its own rules ask for.
  "condition.imposed": "economy",
  // A raging Barbarian can't cast spells (SRD Rage).
  "condition.raging": "economy",
  // A familiar can't attack; a summoned creature's commands cost its summoner an action, a Bonus Action or range.
  "summon.cant-attack": "economy",
  "summon.command": "economy",
  // An effect that takes away Reactions (Slow).
  "condition.no-reactions": "economy",
  "condition.no-spells": "economy",
  // Effects that take away Bonus Actions (Confusion), attacks (Gaseous Form), every action but Dash (Wind Walk), or
  // all but one of moving, an action and a Bonus Action a turn (Abjure Foes).
  "condition.cant-attack": "economy",
  "condition.dash-only": "economy",
  // Confusion's and Gibbering's 7-8: one melee attack on the creature the roll picked.
  "condition.forced-attack": "economy",
  "condition.one-thing-a-turn": "economy",
  // A controlled mount takes only the Dash, Disengage and Dodge actions (SRD Mounted Combat).
  "mount.controlled": "economy",
  // A creature that can't end the Prone condition on itself (Hideous Laughter).
  "movement.cant-stand": "movement",
  // A form forbids it: spells (Wild Shape, Polymorph), actions (a vampire's mist), or another form's attack.
  "form.no-spells": "economy",
  "form.no-actions": "economy",
  "form.no-attacks": "economy",
  "form.wrong-form": "economy",
  // "Legendary actions are taken right after other creatures' turns" is a timing/economy rule...
  "legendary.own-turn": "economy",
  "legendary.after-a-turn": "economy",
  // What a creature can do only underwater (a seahorse's Bubble Dash) in a fight that isn't.
  "action.underwater-only": "economy",
  // An extra attack (Light, Cleave) is owed only once the swing that opens it has happened this turn.
  "attack.light-needs-attack": "economy",
  "attack.cleave-needs-hit": "economy",
  // Reckless Attack is decided with the first attack roll on the Barbarian's turn.
  "attack.after-first-roll": "economy",
  // A Loading weapon fires once per action, however many attacks the action allows.
  "attack.loading": "economy",
  "attack.no-ammunition": "economy",
  // A Two-Handed weapon can't swing while a Shield takes one hand.
  "attack.two-handed": "economy",
  // No spellcasting in armor the caster isn't trained with: what the character can do at all, whatever its slots
  // (the GM can stop policing slots, and this rule stays).
  "spell.untrained-armor": "economy",
  // A Spell Scroll in a spell the reader's lists don't have is unintelligible.
  "spell.scroll-unreadable": "economy",
  // What a spell offers "on your later turns" isn't taken on the turn it was cast (Spiritual Weapon, Heat Metal).
  "spell.later-turn": "economy",
  // Sneak Attack, a smite and the like add to a hit: they're chosen when the hit is confirmed and never taken alone.
  "attack.rides-a-hit": "economy",
  // Indomitable, Cutting Words and the like answer a roll once it is shown, and are never taken alone.
  "roll.answers-a-roll": "economy",
  // ...while "no legendary actions left this round" is a spent resource, like limited uses.
  "legendary.no-actions-remaining": "resources",
  // "Can't take this action again until the start of its next turn": spent for the round, like the pool.
  "legendary.once-per-round": "resources",
  "feature.no-uses-remaining": "resources",
  "feature.requires-effect": "resources",
  // "Once per turn" or "only once on a turn" (Action Surge with two uses, Stunning Strike): a per-turn limit.
  "feature.once-per-turn": "resources",
  "range.out-of-range": "targeting",
  "range.out-of-reach": "targeting",
  "range.underwater": "targeting",
  "target.grappled-by-source": "targeting",
  "target.too-large-to-grapple": "targeting",
  // Help distracts an enemy, so not the helper or one of its allies.
  "target.not-an-enemy": "targeting",
  // Hunter's Mark and Hex move only once the marked creature drops to 0 Hit Points.
  "target.mark-still-standing": "targeting",
  "cover.total": "targeting",
  // SRD Hide: out of any enemy's line of sight, which dynamic vision can tell.
  "hide.seen": "targeting",
  // SRD Hide: "while you're Heavily Obscured or behind Three-Quarters Cover or Total Cover".
  "hide.exposed": "targeting",
  // What works only in Dim Light or Darkness (a shadow's Shadow Stealth, One with Shadows) in Bright Light.
  "light.too-bright": "targeting",
  // Cleave's second creature: another one, within 5 feet of the first.
  "attack.cleave-same-target": "targeting",
  "attack.cleave-too-far": "targeting",
  // A spell aimed at more creatures than it can target (Hold Person at two Humanoids from a level 2 spell slot).
  "target.too-many": "targeting",
  // A spell aimed at a creature of a type it can't target (Hold Person at a Beast).
  "target.wrong-type": "targeting",
  // "A creature you can see": the map's vision says the caster can't see it.
  "target.unseen": "targeting",
  // A target picked among those in a spell's area that the area doesn't cover.
  "target.outside-area": "targeting",
  // A creature the action can't affect: the wrong creature type or size, unseen, not grappled or marked by the user,
  // an ally where it names an enemy, or a creature gone from the plane.
  "target.not-allowed": "targeting",
  // A revival spell, Gentle Repose or an action that raises a corpse, aimed at a creature it can't take: one alive, dead
  // longer than its limit, Undead when it died, or whose body or head is gone.
  "target.revival": "targeting",
  // The hit an extra is added to can't carry it (no Advantage or ally for Sneak Attack, a ranged smite).
  "attack.hit-option-unqualified": "targeting",
  // Being Charmed by your target is a targeting restriction.
  "condition.charmed-charmer": "targeting",
  // Spellcasting is its own family, so turning off "Check spell slots and prepared spells" relaxes these alone.
  "slots.none-remaining": "slots",
  "slots.below-spell-level": "slots",
  "slots.one-per-turn": "slots",
  // Casting a spell the character hasn't prepared is spellcasting bookkeeping too.
  "slots.not-prepared": "slots",
  // Metamagic and Sculpt Spells shape a cast: an option the caster doesn't have, one the spell can't take, more options
  // than one spell carries, and Quickened Spell's "can't cast a level 1+ spell on this turn" are spellcasting rules.
  "metamagic.unknown": "slots",
  "metamagic.unfit": "slots",
  "metamagic.too-many": "slots",
  "metamagic.quickened": "slots",
  // The creatures or the type a pick names (Careful Spell's, Heightened Spell's target) are a cast's targeting.
  "metamagic.choice": "targeting",
  // A Metamagic option's own row is chosen with a cast and never taken alone, as a hit rider is.
  "metamagic.with-a-cast": "economy",
  // Spell components (SRD Components) are their own family, so a table can stop checking hands and pouches alone.
  "spell.no-verbal": "components",
  "spell.no-free-hand": "components",
  "spell.no-material": "components"
} as const satisfies Record<string, RuleFamily>;

export type RuleId = keyof typeof RULE_FAMILIES;

export const RULE_IDS = Object.keys(RULE_FAMILIES) as readonly RuleId[];

export function familyOf(rule: RuleId): RuleFamily {
  return RULE_FAMILIES[rule];
}

/** The mode in force for one family: its exception if the GM set one, otherwise this fight's dial. */
export function familyModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, family: RuleFamily): RuleMode {
  return combat.ruleExceptions[family] ?? combat.rulesMode;
}

/** The rules in force: the fight's dial and exceptions while one runs, else the table's standing policy, which the
 *  next fight starts from. */
export function rulesInForce(
  state: Pick<GameState, "combat" | "rulesPolicy">
): Pick<CombatState, "rulesMode" | "ruleExceptions"> {
  return state.combat.active
    ? state.combat
    : { rulesMode: state.rulesPolicy.dial, ruleExceptions: state.rulesPolicy.exceptions };
}

/** The mode in force for one rule id. The single reader: never read `combat.rulesMode` at a rule site. */
export function effectiveModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, rule: RuleId): RuleMode {
  return familyModeFor(combat, familyOf(rule));
}

/** Whether the GM already allowed this kind of block this turn. */
export function overrideCovers(turn: CombatState["turn"], rule: RuleId): boolean {
  return turn.rulesOverriddenFamilies?.includes(familyOf(rule)) ?? false;
}

/** A GM override as a command carries it. `families` names the kinds of block it waives (an Allow names the one
 *  the GM was asked about); absent, it is the GM's own ruling on the command and waives every block. */
export type RulesOverride = Readonly<{ reason?: string; families?: readonly RuleFamily[] }>;

/** Whether an override waives a block of this rule: only one of a family it names, so allowing one kind of block
 *  never waves another through. */
export function overrideWaives(override: RulesOverride | null | undefined, rule: RuleId): boolean {
  if (!override) return false;
  return override.families === undefined || override.families.includes(familyOf(rule));
}

/** Records a GM override so the family stops re-prompting for the rest of this turn. Cleared with `turn`
 *  on turn advance. */
export function rememberOverride(state: GameState, rule: RuleId, override?: RulesOverride | null): void {
  const existing = state.combat.turn.rulesOverriddenFamilies ?? [];
  const families = [familyOf(rule), ...(override?.families ?? [])].filter(
    (family, index, all) => !existing.includes(family) && all.indexOf(family) === index
  );
  if (families.length === 0) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, rulesOverriddenFamilies: [...existing, ...families] }
  };
}

/** The audited reason for an override; optional, so an override is one tap. */
export function overrideReason(override: RulesOverride | null | undefined): string {
  return override?.reason?.trim() || "GM override";
}
