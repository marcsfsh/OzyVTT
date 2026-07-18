import type { ActorDefinition } from "@vtt/schemas";

type BuiltinAction = ActorDefinition["actions"][number];

/**
 * The SRD 5.2.1 generic actions every combatant can take (rules glossary "[Action]" entries), plus
 * the Unarmed Strike options — engine behavior, not licensed content data, so they live in code and
 * ride the exact same ActionSchema vocabulary and resolution path as stat-block actions. A test pins
 * every entry against ActionSchema so the catalog can never drift from the schema.
 *
 * Ids are a FROZEN replay contract (journaled action.resolve payloads reference them); a stat-block
 * action with the same id wins on lookup, so imports can shadow a builtin deliberately.
 *
 * Mechanics live in the declarative vocabulary where it reaches (grants); the rest (check rolls for
 * Hide/Influence/Search/Study, unarmed strike math) is special-cased in resolveDefinitionAction
 * keyed by builtin id. Descriptions quote the SRD rule so the table sees the text it's using.
 */
export const BUILTIN_ACTIONS: readonly BuiltinAction[] = [
  {
    id: "dash",
    name: "Dash",
    activation: "action",
    description: "When you take the Dash action, you gain extra movement for the current turn equal to your Speed after modifiers. (SRD 5.2.1, Dash [Action])",
    damage: [],
    grants: { name: "Dashing", tags: ["dashing"], duration: { type: "until-source-next-turn" }, modifiers: [], onEnd: [], target: "self", voidWhileIncapacitated: false }
  },
  {
    id: "disengage",
    name: "Disengage",
    activation: "action",
    description: "If you take the Disengage action, your movement doesn't provoke Opportunity Attacks for the rest of the current turn. (SRD 5.2.1, Disengage [Action])",
    damage: [],
    grants: { name: "Disengaged", tags: ["disengaged"], duration: { type: "until-source-next-turn" }, modifiers: [], onEnd: [], target: "self", voidWhileIncapacitated: false }
  },
  {
    id: "dodge",
    name: "Dodge",
    activation: "action",
    description: "Until the start of your next turn, attack rolls against you have Disadvantage if you can see the attacker, and you make Dexterity saving throws with Advantage. You lose these benefits if you have the Incapacitated condition or if your Speed is 0. (SRD 5.2.1, Dodge [Action])",
    damage: [],
    grants: { name: "Dodging", tags: ["dodging"], duration: { type: "until-source-next-turn" }, modifiers: [{ type: "incoming-attack-disadvantage" }, { type: "save-advantage", ability: "dex" }], onEnd: [], target: "self", voidWhileIncapacitated: true }
  },
  {
    id: "help",
    name: "Help",
    activation: "action",
    description: "Choose one ally: they gain Advantage on their attack rolls until the start of your next turn (the SRD's distract variant, simplified from next-attack-only — documented). The Help action also covers assisting a check or stabilizing a dying creature; adjudicate those narratively. (SRD 5.2.1, Help [Action])",
    damage: [],
    grants: { name: "Helped", tags: ["helped"], duration: { type: "until-source-next-turn" }, modifiers: [{ type: "attack-advantage" }], onEnd: [], target: "target", voidWhileIncapacitated: false }
  },
  {
    id: "hide",
    name: "Hide",
    activation: "action",
    description: "Make a DC 15 Dexterity (Stealth) check while Heavily Obscured or behind Three-Quarters or Total Cover, out of any enemy's line of sight (the GM adjudicates eligibility — the engine can't see sight lines). On a success you have the Invisible condition while hidden; making an attack roll ends it. (SRD 5.2.1, Hide [Action])",
    damage: []
  },
  {
    id: "influence",
    name: "Influence",
    activation: "action",
    description: "Urge a monster to do something: make a Charisma check (Deception, Intimidation, Performance, or Persuasion — or Wisdom/Animal Handling) against DC 15 or the monster's Intelligence score, whichever is higher; the GM adjudicates attitude and outcome. (SRD 5.2.1, Influence [Action])",
    damage: []
  },
  {
    id: "magic",
    name: "Magic",
    activation: "action",
    description: "Cast a spell with a casting time of an action, or use a feature or magic item that requires the Magic action. Spell mechanics stay with the GM (slots and effects aren't modeled yet). (SRD 5.2.1, Magic [Action])",
    damage: []
  },
  {
    id: "ready",
    name: "Ready",
    activation: "action",
    description: "Choose a perceivable trigger and a response: the response is taken as a Reaction before the start of your next turn. Resolving any action off-turn while Readied spends your Reaction and releases the ready. (SRD 5.2.1, Ready [Action])",
    damage: [],
    grants: { name: "Readied", tags: ["readied"], duration: { type: "until-source-next-turn" }, modifiers: [], onEnd: [], target: "self", voidWhileIncapacitated: false }
  },
  {
    id: "search",
    name: "Search",
    activation: "action",
    description: "Make a Wisdom check to discern something that isn't obvious (Insight, Medicine, Perception, or Survival); the GM sets the DC and adjudicates. (SRD 5.2.1, Search [Action])",
    damage: []
  },
  {
    id: "study",
    name: "Study",
    activation: "action",
    description: "Make an Intelligence check to recall or discover information (Arcana, History, Investigation, Nature, or Religion); the GM sets the DC and adjudicates. (SRD 5.2.1, Study [Action])",
    damage: []
  },
  {
    id: "utilize",
    name: "Utilize",
    activation: "action",
    description: "Interact with an object that requires an action to use (beyond your one free interaction per turn). (SRD 5.2.1, Utilize [Action])",
    damage: []
  },
  {
    id: "unarmed-strike",
    name: "Unarmed Strike (Damage)",
    activation: "action",
    description: "A melee attack within 5 feet using your body: attack roll is Strength modifier + Proficiency Bonus; on a hit the target takes Bludgeoning damage equal to 1 + your Strength modifier. (SRD 5.2.1, Unarmed Strike)",
    damage: []
  },
  {
    id: "unarmed-grapple",
    name: "Unarmed Strike (Grapple)",
    activation: "action",
    description: "The target must succeed on a Strength or Dexterity saving throw (its choice) against DC 8 + your Strength modifier + your Proficiency Bonus, or it has the Grappled condition (that DC is also the escape DC). Only targets no more than one size larger, and you need a hand free — the GM adjudicates the hand. (SRD 5.2.1, Unarmed Strike / Grappling)",
    damage: []
  },
  {
    id: "unarmed-shove-prone",
    name: "Unarmed Strike (Shove Prone)",
    activation: "action",
    description: "The target must succeed on a Strength or Dexterity saving throw (its choice) against DC 8 + your Strength modifier + your Proficiency Bonus, or it has the Prone condition. Only targets no more than one size larger. (SRD 5.2.1, Unarmed Strike)",
    damage: []
  },
  {
    id: "unarmed-shove-push",
    name: "Unarmed Strike (Shove Push)",
    activation: "action",
    description: "The target must succeed on a Strength or Dexterity saving throw (its choice) against DC 8 + your Strength modifier + your Proficiency Bonus, or you push it 5 feet away — on a failure, the GM moves the token. Only targets no more than one size larger. (SRD 5.2.1, Unarmed Strike)",
    damage: []
  },
  {
    id: "escape-grapple",
    name: "Escape a Grapple",
    activation: "action",
    description: "Use your action to make a Strength (Athletics) or Dexterity (Acrobatics) check (your best) against the grapple's escape DC, ending the Grappled condition on a success. (SRD 5.2.1, Grappling)",
    damage: []
  }
] as const;

export function builtinAction(actionId: string): BuiltinAction | undefined {
  return BUILTIN_ACTIONS.find((action) => action.id === actionId);
}

/** Builtins that resolve against exactly one chosen combatant; everything else is a single direct tap. */
export const BUILTIN_TARGETING: Readonly<Record<string, "single">> = {
  help: "single",
  "unarmed-strike": "single",
  "unarmed-grapple": "single",
  "unarmed-shove-prone": "single",
  "unarmed-shove-push": "single"
};
