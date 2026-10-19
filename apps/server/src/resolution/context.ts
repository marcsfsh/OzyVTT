import type {
  ActionResolution,
  ActionResolutionAttack,
  ActionRollMode,
  ActionTableNarration,
  GameState,
  HitOptionChoice,
  RollRecord
} from "@vtt/domain";
import {
  abilityModifier as scoreModifier,
  type AttackKind,
  type DiceResolution,
  type RandomSource,
  type RiderContext
} from "@vtt/rules-5e";
import type { ActorDefinition, CastShaping } from "@vtt/schemas";
import type { EquipmentCatalog, EquipmentDerivation } from "../equipment-derivation.js";
import { recordRoll as recordRollInHistory, rolledTerms } from "../roll-history.js";
import type { RuleId, RulesOverride } from "../rules-families.js";
import type { EffectNarration } from "../effects.js";
import { withoutSourceName } from "../hidden-source.js";
import { hiddenFrom } from "../vision/audience.js";
import type { MasterySwing } from "../weapon-mastery.js";
import type { SummonChoice, SummonOutcome, SummonRequest } from "../summons.js";
import type { BuiltinHandler } from "./builtins.js";
import type { EconomyPlan } from "./economy.js";

export type DefinitionAction = ActorDefinition["actions"][number];
export type LiveActor = GameState["actors"][number];

export type ResolveInput = Readonly<{
  actorId: string;
  targetIds: readonly string[];
  commandId: string;
  conditionId?: string | null;
  /** Explicit GM roll-mode choice; wins over the aggregated advantage/disadvantage sources. */
  rollMode?: "advantage" | "disadvantage" | "normal" | null;
  /** GM override of a rules-mode rejection; audited in the log and journal (ADR-0020). */
  override?: RulesOverride | null;
  /** The action came from the builtin catalog (not the stat block); enables the builtin special cases. */
  builtin?: boolean;
  /** Free-text annotation (the Ready action's trigger); folded into the granted effect's name. */
  note?: string | null;
  /** The escapable effect to break (Escape a Grapple); defaults to the actor's first effect with an escape DC. */
  effectId?: string | null;
  /** GM-adjudicated cover for the target (SRD Cover): half +2 / three-quarters +5 to AC and Dex saves; total blocks targeting. */
  cover?: "half" | "three-quarters" | "total" | null;
  /** false previews the attack roll only (no damage, riders, prompts or economy); the confirm uses the held die. */
  commit?: boolean;
  /** A natural d20 to use with no roll: a typed physical die, or a parked attack's replay. */
  attackNatural?: number;
  /** `attackNatural` was typed from a physical die, so its record says so. */
  typedFace?: boolean;
  /** The key the attack's d20 is held under between a preview and its confirm (ADR-0012); absent, nothing is held. */
  holdKey?: string;
  /** Throw the held attack d20 again: a player's Heroic Inspiration rerolls one die, the GM throws afresh. */
  reroll?: boolean;
  /** On a preview, answer the held attack roll with one of the attacker's answers (Peerless Skill, Stroke of Luck). */
  answer?: Readonly<{ id: string; subtract?: boolean; face?: number }>;
  /** GM only: a hand-entered attack total, used verbatim vs AC. The natural die is unknown, so a crit is declared
   * via `critical` and a natural 1 via `fumble`. */
  attackTotal?: number;
  /** Explicit "this was a natural 20" (critical hit) for the hand-entered-total path. Ignored when a natural is supplied. */
  critical?: boolean;
  /** Explicit "this was a natural 1" (a miss) for the hand-entered-total path. Ignored when a natural is supplied. */
  fumble?: boolean;
  /** The skill a builtin check is made with (Influence, Search, Study, Escape a Grapple). */
  skill?: string | null;
  /** The ability a cast chooses (Hex). */
  ability?: "str" | "dex" | "con" | "int" | "wis" | "cha" | null;
  /** How this attack is made, for `attack-kind-is` riders. Melee/ranged/thrown are derived; opportunity and
   *  reaction can't be, so `reactions.ts` announces them here. */
  attackKinds?: readonly AttackKind[];
  /** Push mastery's chosen distance (0 declines); absent pushes the most the mastery allows. */
  pushFeet?: number;
  /** An Evoker's Overchannel: the spell's damage dice deal their maximum (`resolution/overchannel.ts`). */
  overchannel?: boolean;
  /** The slot a spell is cast with; absent, its own level, else the lowest above it with a slot left. */
  slotLevel?: number;
  /** The damage type picked for an action whose caster chooses one (`ActorAction.damageTypes`); absent, its first. */
  damageType?: string | null;
  /** A parked attack finishing (see `parkForAcReaction`): its economy was checked and spent when it rolled, so it is
   *  neither checked nor spent again, and its target is not offered the AC reaction a second time. */
  economyPaid?: boolean;
  /** A parked attack finishing after its target's AC reaction was answered, so it is not offered again. */
  acSettled?: boolean;
  /** A parked attack finishing after others answered its roll: who was asked already. */
  answersAsked?: readonly string[];
  /** A reaction's AC bonus against this attack only (Parry), added to the target's AC. */
  reactionAcBonus?: Readonly<{ amount: number; source: string }>;
  /** A parked attack's effect dice as they rolled (Bless's d4), which the replay reuses with no new roll. */
  attackBonusDice?: ReadonlyArray<Readonly<{ label: string; dice: string; total: number }>>;
  /** Extras to add to the hit, chosen from the preview's offers (Sneak Attack, a smite and its slot, a charge). */
  hitOptions?: readonly HitOptionChoice[];
  /** The cast's area was placed on the map as a template, whose annotation takes this command's id; a spell that
   *  leaves its area behind (Moonbeam) keeps acting there. */
  areaPlaced?: boolean;
  /** Ready the spell for later: its slot is spent and it is held with Concentration (SRD Ready). */
  ready?: boolean;
  /** Take the action's own move now and the rest of it later (`movement-grants.ts`): the cost is spent, no target. */
  moveFirst?: boolean;
  /** The rest of an action whose move was taken first: its cost was spent then, so it is neither checked nor spent. */
  owedPaid?: boolean;
  /** The spell area a cast that ends spells is aimed at (Dispel Magic on a Spirit Guardians); the GM's to name. */
  zoneId?: string;
  /** The caster stands where no sound can be made (Silence's sphere), measured on the map by the server. */
  silenced?: boolean;
  /** A parked attack finishing: the declared rider (Brutal Strike) its roll forwent Advantage for, whose hit it may
   *  still carry. */
  forgoneAdvantageBy?: string;
  /** A melee hit that drops its target to 0 leaves it at 1 Hit Point and Unconscious (SRD Knocking Out a Creature). */
  knockOut?: boolean;
  /** How the caster shapes this spell's cast (Metamagic, Sculpt Spells), checked and applied by `metamagic.ts`. */
  shaping?: readonly CastShaping[];
  /** What the user picked for an action that brings creatures (`summons.ts`): which stat blocks, a form, a creature
   *  type, damage types, and where they appear. */
  summon?: SummonChoice;
}>;

export type ResolveDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  /** Who initiated this resolve; a player's resolve attributes recorded rolls to that player. Defaults to GM. */
  initiatorRole?: "gm" | "player";
  initiatorSessionId?: string;
  now: () => string;
  /** The attacker's full definition; multiattack composition and limited-use lookups need sibling actions. */
  definition?: ActorDefinition;
  /** Map distance in feet between two combatants' tokens; null when unmeasurable. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Resolves any combatant's definition (imported over bundled), to offer the target's declared reactions. */
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog where magic-item riders live; absent means every item is mundane. GM audience. */
  catalog?: EquipmentCatalog;
  /** SRD forced movement (Push): moves a combatant straight away from another and reports the distance, or
   *  null. Built by the operation layer, which has the grid (an opportunity attack's too). */
  pushToken?: (
    input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number; toward?: boolean }>
  ) => Readonly<{ value: number; unit: string }> | null;
  /** Brings an action's creatures onto the map (`bringSummons`), built by the operation layer, which has the grid and
   *  mints ids. Absent, a summon is left for the GM to place. */
  summon?: (request: SummonRequest) => SummonOutcome;
}>;

type RollBase = Pick<
  RollRecord,
  | "commandId"
  | "initiatorSessionId"
  | "initiatorRole"
  | "initiatorLabel"
  | "label"
  | "actorId"
  | "visibility"
  | "createdAt"
>;

/** An effect a resolve ended, as the result tells it: whose it was, its name, and who caused it. */
export type EndedEffect = { actorId: string; actorName: string; name: string; source?: EffectSource };
export type EffectSource = Readonly<{ actorId: string | null; name: string | null }>;

/** An ended-effect line for `bearer`, with the effect's source. */
export const endedEffect = (
  bearer: Readonly<{ id: string; name: string }>,
  effect: Readonly<{ name: string; sourceActorId: string | null; sourceName: string | null }>
): EndedEffect => ({
  actorId: bearer.id,
  actorName: bearer.name,
  name: effect.name,
  source: { actorId: effect.sourceActorId, name: effect.sourceName }
});

/** The shared hidden check (`hiddenFrom`) for a resolve, read with its own content. `forInitiator` takes the initiating
 *  player's view, for what only that player reads (a refusal, a name in the reply); without it, or for the GM, it is
 *  the table's, for what shows in public dice and the feed. */
export function resolveHiddenCheck(
  state: GameState,
  deps: Pick<ResolveDependencies, "resolveDefinition" | "catalog" | "initiatorRole" | "initiatorSessionId">,
  forInitiator: boolean
): (actorId: string) => boolean {
  return hiddenFrom(
    state,
    {
      ...(deps.resolveDefinition ? { definition: deps.resolveDefinition } : {}),
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    },
    forInitiator && deps.initiatorRole === "player" ? deps.initiatorSessionId : undefined
  );
}

/** A rules event as a line of this resolve's table narration. A source hidden from the initiator is masked as
 *  `publishNarrations` masks one, since the line goes to the table and back in the reply; a GM-only event stays so. */
export function tableLineOf(
  ctx: Pick<ResolveContext, "state" | "hiddenFromInitiator" | "hiddenFromTable">,
  event: EffectNarration,
  kind: ActionTableNarration["kind"] = "effect"
): ActionTableNarration {
  const source = event.source;
  const masked = source !== undefined && ctx.hiddenFromInitiator(source.actorId) && !ctx.hiddenFromTable(event.actorId);
  const sourceName = source?.name ?? ctx.state.actors.find((actor) => actor.id === source?.actorId)?.name ?? null;
  return {
    kind,
    text: masked ? withoutSourceName(event.text, sourceName) : event.text,
    actorIds: [event.actorId],
    ...(event.gmOnly ? { gmOnly: true } : {})
  };
}

/** One resolve's inputs and everything its steps have decided so far. Each step reads what the earlier
 *  steps wrote and adds its own part; the result is read off the finished context. */
export type ResolveContext = {
  readonly state: GameState;
  /** The action as resolved; a builtin may rewrite it before anything rolls (Unarmed Strike). */
  action: DefinitionAction;
  readonly input: ResolveInput;
  readonly deps: ResolveDependencies;
  /** Hidden from the table (GM-only, or out of every character's sight or under the fog): what public dice and the
   *  feed must not give away. */
  readonly hiddenFromTable: (actorId: string) => boolean;
  /** Hidden from whoever initiated: that player's own view, the table's for the GM. For names in a refusal or reply. */
  readonly hiddenFromInitiator: (actorId: string) => boolean;
  readonly attacker: LiveActor;
  readonly targets: readonly LiveActor[];
  /** Targets the cast's damage passes over: killed outright by it, or saved from that by Death Ward (Power Word
   *  Kill). */
  spared?: Set<string>;
  /** The builtin's special cases; only for an action taken from the builtin catalog. */
  readonly builtin: BuiltinHandler | undefined;
  /** The attacker's equipment contribution. */
  readonly derivation: EquipmentDerivation;
  /** The effective action list, so pool limits and multiattack composition see item-derived actions. */
  readonly siblings: ReadonlyArray<DefinitionAction>;
  readonly riderItemId: string | null;
  readonly plan: EconomyPlan;
  overridden: { rule: RuleId; reason: string } | null;
  /** GM-adjudicated cover's bonus to AC and Dexterity saves (SRD Cover). */
  readonly coverBonus: number;
  /** Shared fields of every roll this resolve records; set once the action is final. */
  rollBase: RollBase;
  /** GM-only rules notes. */
  readonly warnings: string[];
  /** Narration for the whole table, for riders that changed the board; `warnings` is the GM-only channel.
   *  A sentence goes in exactly one of the two. */
  readonly tableNarration: ActionTableNarration[];
  rollMode: ActionRollMode | undefined;
  check: NonNullable<ActionResolution["check"]> | null;
  attack: ActionResolutionAttack | null;
  crit: boolean;
  /** What answers added to the attack roll, and whether one made it hit, for a replay that holds no die. */
  attackAnswerBonus?: number;
  answeredHit?: boolean;
  /** The roll-specific facts riders filter on (attack kind, target size, damage types...). */
  riderFilters: Omit<Partial<RiderContext>, "moment">;
  readonly damage: Array<{ formula: string; type: string; total: number; source?: string }>;
  /** Who each of a darts action's darts strikes, in order (`damage[i]` is dart i). Empty for any other action. */
  readonly dartTargetIds: string[];
  readonly bonusDamage: Array<{ amount: number; type: string; source: string }>;
  /** The weapon mastery in force on this swing; null unless a mastery applies to an attack that rolled. */
  masterySwing: MasterySwing | null;
  readonly effectsApplied: Array<{
    targetId: string;
    targetName: string;
    name: string;
    conditionIds: readonly string[];
  }>;
  effectGranted: ActionResolution["effectGranted"];
  /** Effects this resolve ended, each with its source so a hidden one can be masked before the result is told. */
  readonly effectsEnded: EndedEffect[];
  readonly reactionPrompts: Array<{ actorId: string; actorName: string; actionName: string; holdsDamage?: true }>;
  /** A save a builtin forced (grapple, shove); an action's own `save` is reported from the action. */
  builtinSave: ActionResolution["save"];
  healing: ActionResolution["healing"];
  /** An extra attack this swing opened (Cleave), for the result card to offer. */
  opens: ActionResolution["opens"] | null;
  /** The Concentration this cast started (a Concentration spell): what its failed saves impose is sustained by it. */
  castId: string | null;
  /** The extras this hit carries whose costs are spent after the hit's own (`spendHitOptions`). */
  readonly hitRiders: Array<{ action: DefinitionAction; slotLevel?: number; pactSlot?: number }>;
  /** The declared rider (Brutal Strike) this attack roll gave up its Advantage for, or null. */
  forgoneAdvantageBy: string | null;
  /** A chosen rider keeps the Hide action's Invisible through this attack (Supreme Sneak's Stealth Attack). */
  keepsHidden: boolean;
  /** The live effects whose damage riders this hit rolled, so a coat of poison is spent (`spendDamageUses`). */
  readonly damageEffectIds: string[];
  /** The creatures this resolve brought onto the map (`resolution/summon.ts`). */
  summoned?: ReadonlyArray<Readonly<{ actorId: string; name: string }>>;
};

/** Records one rolled formula in the shared history, attributed like every roll of this resolve; `label` names a die
 *  that is not the action's own (Bless's d4). `total` stands in for the dice's own sum where a rule changes it
 *  (Reliable Talent's 10), and `typed` marks a d20 typed from a physical die. Returns the record's id. */
export function recordRoll(
  ctx: ResolveContext,
  resolution: DiceResolution,
  purpose: RollRecord["purpose"],
  label?: string,
  extra: Readonly<{ total?: number; typed?: boolean }> = {}
): string {
  const record: RollRecord = {
    ...ctx.rollBase,
    ...(label !== undefined ? { label } : {}),
    id: ctx.deps.newRollId(),
    purpose,
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    ...rolledTerms(resolution),
    total: extra.total ?? resolution.total,
    ...(extra.typed ? { typed: true as const } : {})
  };
  recordRollInHistory(ctx.state, record);
  return record.id;
}

/** The natural face of a d20 test: the kept die under advantage or disadvantage. */
export function naturalFace(resolution: DiceResolution): number {
  const dice = resolution.terms.find((term) => term.kind === "dice")!;
  return (dice.dice.find((die) => die.kept) ?? dice.dice[0]).face;
}

type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** Ability modifier from the definition's scores; +0 when no definition is known (builtin fallback). */
export function abilityModifier(definition: ActorDefinition | undefined, ability: AbilityKey): number {
  return scoreModifier(definition?.abilityScores[ability] ?? 10);
}

const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;

/** A creature size's rank, smallest first; an unknown size counts as Medium. */
export function sizeRank(size: string | undefined): number {
  return SIZE_ORDER.indexOf((size ?? "medium") as (typeof SIZE_ORDER)[number]);
}

export function sizeAtMost(size: string | undefined, limit: string): boolean {
  return sizeRank(size) <= sizeRank(limit);
}
