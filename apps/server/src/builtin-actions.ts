import type { ActorDefinition, EffectInstance } from "@vtt/schemas";

type BuiltinAction = ActorDefinition["actions"][number];

/** The live creature taking the action, whose effects can offer actions of their own (Expeditious Retreat's Dash as a
 *  Bonus Action, Irresistible Dance's "collect itself"). */
export type ActionBearer = Readonly<{ effects: readonly EffectInstance[] }>;

/**
 * The SRD 5.2.1 generic actions every combatant can take (rules glossary "[Action]" entries) plus the
 * Unarmed Strike options. Engine behaviour, outside the content data, but in the same ActionSchema
 * vocabulary and resolution path as stat-block actions (a test pins every entry to the schema).
 *
 * Ids are a frozen replay contract (journaled payloads reference them); a stat-block action with the
 * same id wins on lookup. What the declarative vocabulary can't express (check rolls, unarmed strike
 * math) is a handler keyed by id in `resolution/builtins.ts`. Descriptions quote the SRD rule. The Unarmed Strike
 * options are attacks of the Attack action (`replacesAttack`), so Extra Attack covers them as it covers a weapon.
 */
export const BUILTIN_ACTIONS: readonly BuiltinAction[] = [
  {
    id: "dash",
    name: "Dash",
    activation: "action",
    description:
      "When you take the Dash action, you gain extra movement for the current turn equal to your Speed after modifiers. (SRD 5.2.1, Dash [Action])",
    damage: [],
    grants: {
      name: "Dashing",
      tags: ["dashing"],
      duration: { type: "until-source-next-turn" },
      modifiers: [],
      onEnd: [],
      target: "self",
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  {
    id: "disengage",
    name: "Disengage",
    activation: "action",
    description:
      "If you take the Disengage action, your movement doesn't provoke Opportunity Attacks for the rest of the current turn. (SRD 5.2.1, Disengage [Action])",
    damage: [],
    grants: {
      name: "Disengaged",
      tags: ["disengaged"],
      duration: { type: "until-source-next-turn" },
      modifiers: [],
      onEnd: [],
      target: "self",
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  {
    id: "dodge",
    name: "Dodge",
    activation: "action",
    description:
      "Until the start of your next turn, attack rolls against you have Disadvantage if you can see the attacker, and you make Dexterity saving throws with Advantage. You lose these benefits if you have the Incapacitated condition or if your Speed is 0. (SRD 5.2.1, Dodge [Action])",
    damage: [],
    grants: {
      name: "Dodging",
      tags: ["dodging"],
      duration: { type: "until-source-next-turn" },
      modifiers: [
        { type: "roll-mode", roll: "incoming-attack", mode: "disadvantage" },
        {
          type: "roll-mode",
          roll: "save",
          mode: "advantage",
          when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }]
        }
      ],
      onEnd: [],
      target: "self",
      voidWhileIncapacitated: true,
      concentration: false
    }
  },
  {
    id: "help",
    name: "Help",
    activation: "action",
    description:
      "Distract an enemy within 5 feet of you: the next attack roll one of your allies makes against it has Advantage. The benefit expires at the start of your next turn. Help can also assist an ally's ability check with one of your skill or tool proficiencies; adjudicate that one at the table. (SRD 5.2.1, Help [Action])",
    damage: [],
    // The effect sits on the distracted enemy; the attack roll reads and spends it (`resolution/attack.ts`).
    grants: {
      name: "Distracted",
      tags: ["distracted"],
      duration: { type: "until-source-next-turn" },
      modifiers: [],
      onEnd: [],
      target: "target",
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  {
    id: "hide",
    name: "Hide",
    activation: "action",
    description:
      "Make a DC 15 Dexterity (Stealth) check while Heavily Obscured or behind Three-Quarters or Total Cover, out of any enemy's line of sight (with dynamic vision on, an enemy you can see that sees you stops it; otherwise the GM decides). On a success you have the Invisible condition while hidden; making an attack roll ends it. (SRD 5.2.1, Hide [Action])",
    damage: []
  },
  {
    id: "influence",
    name: "Influence",
    activation: "action",
    description:
      "Urge a monster to do something: make a Charisma (Deception, Intimidation, Performance, or Persuasion) or Wisdom (Animal Handling) check against DC 15 or the monster's Intelligence score, whichever is higher; the GM adjudicates attitude and outcome. (SRD 5.2.1, Influence [Action])",
    damage: []
  },
  {
    id: "magic",
    name: "Magic",
    activation: "action",
    description:
      "Cast a spell with a casting time of an action, or use a feature or magic item that requires the Magic action. A spell's own row casts it and spends its slot; this row takes the action for anything else. (SRD 5.2.1, Magic [Action])",
    damage: []
  },
  {
    id: "ready",
    name: "Ready",
    activation: "action",
    description:
      "Choose a perceivable trigger and a response: the response is taken as a Reaction before the start of your next turn. Resolving any action off-turn while Readied spends your Reaction and releases the ready; a readied move goes up to your Speed. A spell is readied by casting it with Ready: its slot is spent now, and it is held with Concentration until the start of your next turn. (SRD 5.2.1, Ready [Action])",
    damage: [],
    grants: {
      name: "Readied",
      tags: ["readied"],
      duration: { type: "until-source-next-turn" },
      modifiers: [],
      onEnd: [],
      target: "self",
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  {
    id: "search",
    name: "Search",
    activation: "action",
    description:
      "Make a Wisdom check to discern something that isn't obvious (Insight, Medicine, Perception, or Survival); the GM sets the DC and adjudicates. (SRD 5.2.1, Search [Action])",
    damage: []
  },
  {
    id: "study",
    name: "Study",
    activation: "action",
    description:
      "Make an Intelligence check to recall or discover information (Arcana, History, Investigation, Nature, or Religion); the GM sets the DC and adjudicates. (SRD 5.2.1, Study [Action])",
    damage: []
  },
  {
    id: "utilize",
    name: "Utilize",
    activation: "action",
    description:
      "Interact with an object that requires an action to use (beyond your one free interaction per turn). (SRD 5.2.1, Utilize [Action])",
    damage: []
  },
  {
    id: "unarmed-strike",
    name: "Unarmed Strike (Damage)",
    activation: "action",
    description:
      "A melee attack within 5 feet using your body: attack roll is Strength modifier + Proficiency Bonus; on a hit the target takes Bludgeoning damage equal to 1 + your Strength modifier. (SRD 5.2.1, Unarmed Strike)",
    damage: [],
    replacesAttack: true
  },
  {
    id: "unarmed-grapple",
    name: "Unarmed Strike (Grapple)",
    activation: "action",
    description:
      "The target must succeed on a Strength or Dexterity saving throw (its choice) against DC 8 + your Strength modifier + your Proficiency Bonus, or it has the Grappled condition (that DC is also the escape DC). Only targets no more than one size larger, and you need a hand free; the GM adjudicates the hand. (SRD 5.2.1, Unarmed Strike / Grappling)",
    damage: [],
    replacesAttack: true
  },
  {
    id: "unarmed-shove-prone",
    name: "Unarmed Strike (Shove Prone)",
    activation: "action",
    description:
      "The target must succeed on a Strength or Dexterity saving throw (its choice) against DC 8 + your Strength modifier + your Proficiency Bonus, or it has the Prone condition. Only targets no more than one size larger. (SRD 5.2.1, Unarmed Strike)",
    damage: [],
    replacesAttack: true
  },
  {
    id: "unarmed-shove-push",
    name: "Unarmed Strike (Shove Push)",
    activation: "action",
    description:
      "The target must succeed on a Strength or Dexterity saving throw (its choice) against DC 8 + your Strength modifier + your Proficiency Bonus, or you push it 5 feet away. On a failure, the GM moves the token. Only targets no more than one size larger. (SRD 5.2.1, Unarmed Strike)",
    damage: [],
    replacesAttack: true
  },
  {
    id: "escape-grapple",
    name: "Escape a Grapple",
    activation: "action",
    description:
      "Use your action to make a Strength (Athletics) or Dexterity (Acrobatics) check (your best) against the grapple's escape DC. On a success, the Grappled condition ends. (SRD 5.2.1, Grappling)",
    damage: []
  },
  {
    id: "shake-awake",
    name: "Shake Awake",
    activation: "action",
    description:
      "Shake or slap a creature within 5 feet out of a magical sleep, which ends it (SRD 5.2.1 Sleep: someone within 5 feet of it takes an action to shake it out of the spell's effect).",
    damage: []
  },
  {
    id: "extinguish-fire",
    name: "Put Out the Fire",
    activation: "action",
    description:
      "As an action, you can extinguish fire on yourself by giving yourself the Prone condition and rolling on the ground. The fire also goes out if it is doused, submerged, or suffocated; the GM ends it then. (SRD 5.2.1, Burning [Hazard])",
    damage: [],
    requiresEffectTag: "burning"
  }
] as const;

export function builtinAction(actionId: string): BuiltinAction | undefined {
  return BUILTIN_ACTIONS.find((action) => action.id === actionId);
}

/** The generic actions a feature can turn into a Bonus Action. */
type BonusBase =
  "dash" | "disengage" | "hide" | "unarmed-strike" | "unarmed-grapple" | "unarmed-shove-prone" | "unarmed-shove-push";
const UNARMED: readonly BonusBase[] = [
  "unarmed-strike",
  "unarmed-grapple",
  "unarmed-shove-prone",
  "unarmed-shove-push"
];

/** The id a generic action takes as a Bonus Action ("dash-bonus"); its handler is the base action's. */
export const BONUS_SUFFIX = "-bonus";

/** "The goblin takes the Disengage or Hide action": the generic actions a stat block's Bonus Action offers one of. A
 *  row that takes two at once ("the Dash and Disengage actions") is `withTakenActions`'s. */
function offeredActions(description: string): BonusBase[] {
  const match = /\btakes the ((?:Dash|Disengage|Hide)(?:,? (?:or )?(?:Dash|Disengage|Hide))*) action\b/i.exec(
    description
  );
  if (!match) return [];
  return [...match[1].matchAll(/Dash|Disengage|Hide/gi)].map((found) => found[0].toLowerCase() as BonusBase);
}

/** The generic actions whose whole effect is a grant, so two taken at once can share one effect. */
type GrantedBase = "dash" | "disengage" | "dodge";

/** Feature actions that take two generic actions at once, by id: the Focus Point forms of Patient Defense and Step of
 *  the Wind (SRD 5.2.1 Monk's Focus). Keyed by id so sheets built before this table get them too. */
const TAKEN_TOGETHER: Readonly<Record<string, readonly GrantedBase[]>> = {
  "patient-defense": ["disengage", "dodge"],
  "step-of-the-wind": ["disengage", "dash"]
};

function takenTogether(action: BuiltinAction): readonly GrantedBase[] {
  const listed = TAKEN_TOGETHER[action.id];
  if (listed) return listed;
  // A stat block's row: "The golem takes the Dash and Disengage actions."
  const match = /\btakes the (Dash|Disengage|Dodge) and (?:the )?(Dash|Disengage|Dodge) actions\b/i.exec(
    action.description
  );
  return match ? [match[1].toLowerCase() as GrantedBase, match[2].toLowerCase() as GrantedBase] : [];
}

/**
 * An action that takes two generic actions at once grants both as one effect. It carries each one's tags and modifiers
 * (Dash's measured movement, Disengage's no-provoke, Dodge's Disadvantage) and lasts as they do. An action that grants
 * something of its own keeps it.
 */
export function withTakenActions(action: BuiltinAction): BuiltinAction {
  if (action.grants !== undefined) return action;
  const taken = takenTogether(action);
  if (taken.length < 2) return action;
  const grants = taken.flatMap((id) => {
    const grant = builtinAction(id)?.grants;
    return grant ? [grant] : [];
  });
  return {
    ...action,
    grants: {
      name: action.name,
      tags: [...new Set(grants.flatMap((grant) => grant.tags))],
      duration: { type: "until-source-next-turn" },
      modifiers: grants.flatMap((grant) => grant.modifiers),
      onEnd: [],
      target: "self",
      // Dodge's half lapses while Incapacitated or at Speed 0; the tags still answer for Dash and Disengage.
      voidWhileIncapacitated: grants.some((grant) => grant.voidWhileIncapacitated),
      concentration: false
    }
  };
}

/**
 * The generic actions this creature may take as a Bonus Action, and the feature that lets it: Cunning Action (Dash,
 * Disengage or Hide), a stat block's Nimble Escape and the like, the free Dash of Step of the Wind and Disengage of
 * Patient Defense, and Martial Arts' Unarmed Strike (SRD 5.2.1). Read from the sheet's features and actions, so a
 * sheet built before this list gets them too. The first feature offering one names it.
 */
function bonusSources(definition: ActorDefinition | undefined, bearer?: ActionBearer): ReadonlyMap<BonusBase, string> {
  const offered = new Map<BonusBase, string>();
  const offer = (bases: readonly BonusBase[], source: string) => {
    for (const base of bases) if (!offered.has(base)) offered.set(base, source);
  };
  const features = definition?.character?.features ?? [];
  const actions = definition?.actions ?? [];
  const holds = (id: string) =>
    features.some((feature) => feature.id === id) || actions.some((action) => action.id === id);
  if (holds("cunning-action")) offer(["dash", "disengage", "hide"], "Cunning Action");
  if (features.some((feature) => feature.id === "martial-arts")) offer(UNARMED, "Martial Arts");
  if (holds("step-of-the-wind")) offer(["dash"], "Step of the Wind");
  if (holds("patient-defense")) offer(["disengage"], "Patient Defense");
  for (const action of actions)
    if (action.activation === "bonus-action") offer(offeredActions(action.description), action.name);
  // A live effect's own: Expeditious Retreat's Dash, Conjure Woodland Beings' Disengage.
  for (const effect of bearer?.effects ?? []) offer(effect.bonusActions ?? [], effect.name);
  return offered;
}

/** The id of the action that ends one of the bearer's effects (Irresistible Dance's "collect itself"); a Bonus Action
 *  one takes `BONUS_SUFFIX`. */
export const END_EFFECT_ID = "end-effect";

/** The actions the bearer's effects offer to end them, one for each activation: the first effect needing it names it. */
function endEffectActions(bearer: ActionBearer | undefined): BuiltinAction[] {
  const byActivation = new Map<"action" | "bonus-action", EffectInstance>();
  for (const effect of bearer?.effects ?? [])
    if (effect.endAction && !byActivation.has(effect.endAction.activation))
      byActivation.set(effect.endAction.activation, effect);
  return [...byActivation].map(([activation, effect]) => {
    const end = effect.endAction!;
    const roll = `${ABILITY_WORDS[end.ability]}${end.skill ? ` (${skillWords(end.skill)})` : ""} ${end.kind === "save" ? "saving throw" : "check"}`;
    return {
      id: activation === "action" ? END_EFFECT_ID : `${END_EFFECT_ID}${BONUS_SUFFIX}`,
      name: `${end.label} (${effect.name})`.slice(0, 120),
      activation,
      description: `End ${effect.name} with a DC ${end.dc} ${roll}. A success ends it.`,
      damage: [],
      // Brought forward on the sheet while the effect lasts.
      ...(effect.tags[0] !== undefined ? { requiresEffectTag: effect.tags[0] } : {})
    };
  });
}

const ABILITY_WORDS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
} as const;
const skillWords = (skill: string) =>
  skill
    .split("-")
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(" ");

/** SRD Empowered Strikes: "Whenever you deal damage with your Unarmed Strike, it can deal your choice of Force damage or
 *  its normal damage type." A Monk 6's own Unarmed Strike offers both; anything else stays as it is. */
export function withEmpoweredStrikes(action: BuiltinAction, definition: ActorDefinition | undefined): BuiltinAction {
  if (builtinBaseId(action.id) !== "unarmed-strike" || action.damage.length === 0 || action.damageTypes) return action;
  if (!(definition?.character?.features ?? []).some((feature) => feature.id === "empowered-strikes")) return action;
  const own = action.damage[0]!.type as NonNullable<BuiltinAction["damageTypes"]>[number];
  return own === "force" ? action : { ...action, damageTypes: [own, "force"] };
}

/** A generic action taken as a Bonus Action through a feature. Martial Arts' strike keeps the Monk's own numbers
 *  (its die, Dexterity) when the sheet has them; it is one attack outside the Attack action, so Extra Attack's
 *  count and the attack it replaces don't come along. */
function bonusVariant(base: BonusBase, source: string, definition: ActorDefinition | undefined): BuiltinAction {
  const generic = builtinAction(base)!;
  const own =
    base === "unarmed-strike"
      ? definition?.actions.find((action) => action.id === base && action.attack !== undefined)
      : undefined;
  const { replacesAttack: _attack, ...shape } = withEmpoweredStrikes(own ?? generic, definition);
  const { count: _count, ...attack } = shape.attack ?? { bonus: 0 };
  return {
    ...shape,
    ...(shape.attack ? { attack } : {}),
    id: `${base}${BONUS_SUFFIX}`,
    name: `${source}: ${generic.name}`,
    activation: "bonus-action",
    description: `With ${source}, you can take this as a Bonus Action. ${generic.description}`
  };
}

/** The generic actions every combatant has, then the Bonus Action forms its features and effects give it, and the
 *  actions its effects offer to end them. */
export function builtinActionsFor(
  definition: ActorDefinition | undefined,
  bearer?: ActionBearer
): readonly BuiltinAction[] {
  const variants = [...bonusSources(definition, bearer)].map(([base, source]) =>
    bonusVariant(base, source, definition)
  );
  return [...BUILTIN_ACTIONS, ...variants, ...endEffectActions(bearer)];
}

/** One generic action this combatant can take, by id. */
export function builtinActionFor(
  definition: ActorDefinition | undefined,
  actionId: string,
  bearer?: ActionBearer
): BuiltinAction | undefined {
  return builtinActionsFor(definition, bearer).find((action) => action.id === actionId);
}

/** The id of the generic action a Bonus Action form is taken from ("hide" for "hide-bonus"), or the id itself. */
export function builtinBaseId(actionId: string): string {
  return actionId.endsWith(BONUS_SUFFIX) ? actionId.slice(0, -BONUS_SUFFIX.length) : actionId;
}

/** Builtins that resolve against exactly one chosen combatant; everything else is a single direct tap. Influence
 *  targets the creature it would sway, whose Intelligence can raise its DC. */
export const BUILTIN_TARGETING: Readonly<Record<string, "single">> = {
  help: "single",
  influence: "single",
  "unarmed-strike": "single",
  "unarmed-grapple": "single",
  "unarmed-shove-prone": "single",
  "unarmed-shove-push": "single",
  "unarmed-strike-bonus": "single",
  "unarmed-grapple-bonus": "single",
  "unarmed-shove-prone-bonus": "single",
  "unarmed-shove-push-bonus": "single",
  "shake-awake": "single"
};
