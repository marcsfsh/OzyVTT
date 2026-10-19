import type {
  Annotation,
  CommandedOrders,
  GameState,
  GmView,
  KnownDefences,
  PendingReaction,
  PendingRuleAsk,
  PendingSave,
  PlayerAnnotation,
  PlayerCombatView,
  PlayerEffect,
  PlayerHp,
  PlayerInitiativeEntry,
  PlayerRollCall,
  PlayerRollRecord,
  PlayerSensedCreature,
  PlayerVision,
  PlayerView,
  PresenceStatus,
  RollRecord
} from "@vtt/domain";
import { commandedBySession } from "./authorization.js";
import type { RepeatSave } from "@vtt/schemas";
import { actionPools } from "./effective-actions.js";
import { HASTED_TAG } from "./effects.js";
import { healthBandOf } from "./hit-points.js";
import { HIDDEN_SOURCE, withoutSourceName } from "./hidden-source.js";
import { OFF_PLANE_TAG } from "./off-plane.js";
import { visibleTerrain } from "./terrain.js";
import { exploredRectsOf, playerSight, tokenShown, visionOf, type AudienceSight } from "./vision/audience.js";
import { sensedBy } from "./vision/detect.js";
import { huntersLoreOf } from "./hunters-lore.js";
import type { SightContent } from "./vision/senses.js";

type PresenceLookup = (sessionId: string) => PresenceStatus | null;

/** The turn's creature has an action beyond its one ready: an Action Surge not yet used, or Haste's this turn. */
export function extraActionReady(state: GameState): boolean {
  const actorId = state.combat.turnActorId;
  const extra = state.combat.turn.extraActions?.actorId === actorId ? state.combat.turn.extraActions : undefined;
  if ((extra?.surges ?? 0) > 0) return true;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  return extra?.hasteUsed !== true && actor?.effects.some((effect) => effect.tags.includes(HASTED_TAG)) === true;
}

/** Party members stay exact for each other; monster/NPC HP reaches players only as a band. Shared with
 *  the replay projection so there is one rule. */
export function playerHp(actor: GameState["actors"][number]): PlayerHp {
  return actor.kind === "player-character"
    ? { kind: "exact", current: actor.hp.current, maximum: actor.hp.maximum, temporary: actor.hp.temporary }
    : { kind: "band", band: healthBandOf(actor.hp) };
}

/** A roll a player may see: public or their own, and never one attributed to an actor hidden from them. */
function visibleToPlayer(state: GameState, roll: RollRecord, playerSessionId?: string, sight?: AudienceSight) {
  if (roll.actorId && state.actors.some((actor) => actor.id === roll.actorId && actor.visibility !== "public"))
    return false;
  if (roll.actorId && sight?.hidden.has(roll.actorId)) return false;
  return (
    roll.visibility === "public" || (roll.visibility === "self-only" && roll.initiatorSessionId === playerSessionId)
  );
}

/** The total of the attack a reaction prompt holds, when the roll it came from is one this player may see in their
 *  dice log: the attacker's latest d20 attack roll, with the held attack's die (or, typed, its total). Null
 *  otherwise, so a roll the GM kept hidden never reaches the player through the prompt. */
function shownAttackRoll(
  state: GameState,
  pending: GameState["combat"]["pendingReactions"][number],
  playerSessionId: string | undefined,
  sight: AudienceSight
): number | null {
  const held = pending.parkedAttack;
  const total = pending.attackTotal ?? held?.attackTotal ?? null;
  if (pending.kind !== "attack-would-hit" || total === null || held === null || pending.sourceActorId === null)
    return null;
  // The attack's own roll: its d20, or a typed total with no dice. A bonus die (Bless) is a roll of its own.
  const roll = [...state.rolls]
    .reverse()
    .find(
      (candidate) =>
        candidate.purpose === "attack" &&
        candidate.free !== true &&
        candidate.actorId === pending.sourceActorId &&
        (candidate.dice.length === 0 || candidate.dice.some((die) => die.sides === 20))
    );
  if (!roll) return null;
  const keptFace = roll.dice.find((die) => die.sides === 20 && die.kept)?.face;
  const same =
    held.attackNatural !== null
      ? keptFace === held.attackNatural
      : roll.dice.length === 0 && roll.total === held.attackTotal;
  return same && visibleToPlayer(state, roll, playerSessionId, sight) ? total : null;
}

/** The only roll shape players receive. A session id is credential-shaped, so the roller's is removed. */
export function playerRoll(roll: RollRecord | PlayerRollRecord): PlayerRollRecord {
  const { initiatorSessionId: _privateSession, ...visible } = roll as RollRecord;
  return visible;
}

/** Condition badge labels ("Prone", "Exhaustion 3"): public info, safe for players and the shared screen. */
export function conditionLabels(actor: GameState["actors"][number]): readonly string[] {
  return actor.conditions.map(
    (condition) =>
      `${condition.id
        .split("-")
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join(" ")}${condition.level !== undefined ? ` ${condition.level}` : ""}`
  );
}

/** The turn order the table may see: public combatants, less any the audience can't perceive (`hidden`, from dynamic
 *  vision). */
export function projectPublicInitiative(
  state: GameState,
  hidden: ReadonlySet<string> = new Set()
): readonly PlayerInitiativeEntry[] {
  const publicActors = new Map(
    state.actors
      .filter((actor) => actor.visibility === "public" && !hidden.has(actor.id))
      .map((actor) => [actor.id, actor])
  );
  return state.combat.initiative.flatMap((entry) => {
    const actor = publicActors.get(entry.actorId);
    // Public actors only, so nothing hidden leaks through the condition dots.
    return actor
      ? [
          {
            actorId: actor.id,
            name: actor.name,
            score: entry.score,
            active: state.combat.active && state.combat.turnActorId === actor.id,
            health: healthBandOf(actor.hp),
            conditionIds: actor.conditions.map((condition) => condition.id),
            conditions: conditionLabels(actor)
          }
        ]
      : [];
  });
}

export function visibleToPlayerAnnotation(
  state: GameState,
  annotation: Annotation,
  playerSessionId: string | undefined
) {
  switch (annotation.visibility) {
    case "public":
      return true;
    case "gm-only":
      return false;
    case "owner-only":
    case "owner-gm":
      return annotation.ownerSessionId === playerSessionId;
    case "gm-actor":
      return (
        playerSessionId !== undefined &&
        state.actors.some(
          (actor) => actor.id === annotation.visibleToActorId && actor.ownerSessionId === playerSessionId
        )
      );
  }
}

// The owner's session id is replaced by a `mine` flag for the reader.
function safeAnnotation(annotation: Annotation, playerSessionId: string | undefined): PlayerAnnotation {
  const { ownerSessionId, ...visible } = annotation;
  return { ...visible, mine: ownerSessionId === playerSessionId };
}

export function projectPlayerAnnotations(
  state: GameState,
  playerSessionId: string | undefined,
  now: number
): readonly PlayerAnnotation[] {
  return state.combat.annotations
    .filter(
      (annotation) =>
        (annotation.expiresAt === null || annotation.expiresAt > now) &&
        visibleToPlayerAnnotation(state, annotation, playerSessionId)
    )
    .map((annotation) => safeAnnotation(annotation, playerSessionId));
}

export { HIDDEN_SOURCE, withoutSourceName } from "./hidden-source.js";

type FieldAudience = "player" | "derived" | "never";
type PlayerKeys<M> = { [K in keyof M]: M[K] extends "player" ? K : never }[keyof M];

/** Copies the fields a classification map marks "player". "derived" fields are rebuilt by the caller. */
function copyPlayerFields<T extends object, const M extends Record<keyof T, FieldAudience>>(
  source: T,
  map: M
): Pick<T, PlayerKeys<M> & keyof T> {
  const picked: Partial<T> = {};
  for (const key of Object.keys(map) as (keyof T)[]) {
    if (map[key] === "player" && source[key] !== undefined) picked[key] = structuredClone(source[key]);
  }
  return picked as Pick<T, PlayerKeys<M> & keyof T>;
}

// Each map must list every field of its schema, so a new field does not compile until it is classified.
const PENDING_SAVE_FIELDS = {
  id: "player",
  targetActorId: "player",
  ability: "player",
  dc: "player",
  proposedDamage: "player",
  proposedDamageParts: "player",
  halfOnSuccess: "player",
  conditionIds: "player",
  saveBonus: "player",
  createdAt: "player",
  // A repeated save is named for its effect, which can name a hidden source.
  actionName: "derived",
  sourceName: "derived",
  onFailEffect: "derived",
  sourceActorId: "never",
  endsEffects: "never",
  // Names the effect a repeated save would end; the prompt's action name already says which.
  repeatOf: "never",
  // The call reaches the player through `rollCalls`, which carries only their own part of it.
  callId: "never",
  // What a success or a failure brings is narrated when it lands; the spell area names its caster.
  onSuccessEffect: "never",
  failureNote: "never",
  breaksConcentration: "never",
  zoneId: "never",
  touchedZone: "never",
  // Whether a hidden source's save is magical says something about it; only Magic Resistance reads it.
  magical: "never",
  // What a success earns is the stat block's text, the GM's knowledge.
  immuneOnSuccess: "never",
  // What the damage drains, and where a failure pushes, are narrated when they land.
  drain: "never",
  failurePush: "never",
  // The save's own roll mode is read when it is answered.
  advantageAtSize: "never",
  advantageFrom: "never",
  // What a failure does beyond conditions is narrated when it lands, and an automatic success when it is answered.
  failureKills: "never",
  autoSucceeds: "never",
  disadvantageFrom: "never",
  // A failure's return to a creature's true form is narrated when it lands.
  endsForm: "never",
  // What a failure does at each Hit Point band names the thresholds, the stat block's text; it is narrated as it lands.
  failureByHitPoints: "never",
  // What a failure by a margin does is the stat block's text; it is narrated as it lands.
  failureByMargin: "never",
  // Which of the target's things a failure marks is narrated when it lands.
  objectPenalty: "never",
  failureBanishes: "never",
  // What a swallower's failure lets out is narrated when it lands.
  regurgitates: "never",
  // That the GM applies the outcome is a fact of the engine, true of the spell for whoever casts it; it names nothing.
  gmApplies: "player",
  // The spell names its caster's choice and school; what answers it is offered on the save's own preview.
  spell: "never",
  // Who was asked to answer it would name them; the player is told only that it waits (`awaitingAnswer`).
  confirmed: "derived"
} as const satisfies Record<keyof PendingSave, FieldAudience>;

// How long what a failure imposes would last is the save's own text, read on the prompt by the one who owes it.
// Its ongoing damage dice are the stat block's, so they stay with the GM; the damage itself shows when it lands.
const ON_FAIL_EFFECT_FIELDS = {
  tags: "player",
  linkedConditionIds: "player",
  escapeDc: "player",
  modifiers: "player",
  duration: "player",
  // What a second failure brings, a failed repeat's damage dice and what gives the repeats Disadvantage (Heightened
  // Spell) stay with the GM (`playerRepeatSave`): each is read when the save is answered.
  repeatSave: "derived",
  endsOnDamage: "player",
  endsOnSourceSideDamage: "player",
  speedZero: "player",
  endsWhenSourceDefeated: "player",
  rangeFeet: "player",
  endsOnSpellHealing: "player",
  endsOutOfSight: "player",
  // Who may end it and the check it takes are the printed text's, read by the one who owes the save.
  endedBy: "player",
  // What a rest or a day does to its bearer is the stat block's text; its effect lands when it happens.
  atRest: "never",
  armorClassBonus: "player",
  // The light a failure sheds is the spell's own text (Faerie Fire's Dim Light).
  light: "player",
  name: "derived",
  sourceName: "derived",
  sourceActorId: "derived",
  castId: "never",
  // The level a spell was cast at is the caster's to know.
  spell: "never",
  sourceActionId: "never",
  ongoingDamage: "never",
  currentTurn: "player",
  magical: "never",
  // What holds the creature a failure restrains (a Net's AC and Hit Points) reaches players by name on the effect.
  heldBy: "never",
  // The DC of the action that ends it is the caster's number; the option it carries shows in its name.
  endAction: "never",
  optionId: "never",
  // Kept off as the landed effect keeps them off (`playerEffect`); its name says what it is.
  conditionImmunities: "never",
  suppressesConditions: "never",
  // The form a failure gives is the caster's pick, named in the effect's `name`; its stat block and terms stay the GM's.
  form: "never",
  // The size a failure changes is the spell's own text (Enlarge/Reduce).
  sizeChange: "player"
} as const satisfies Record<keyof NonNullable<PendingSave["onFailEffect"]>, FieldAudience>;

const PENDING_REACTION_FIELDS = {
  id: "player",
  kind: "player",
  actorId: "player",
  actionId: "player",
  actionName: "player",
  targetActorId: "player",
  triggerCommandId: "player",
  proposedDamage: "player",
  proposedDamageParts: "player",
  critical: "player",
  // Weighed through the reactor's own defences, and only the reactor's owner gets the prompt.
  weighed: "player",
  acBonus: "player",
  rollsAttack: "player",
  // How far the falling creature falls: its height, which is as public as the token it answers for.
  fallFeet: "player",
  // The reactor's own slots, which its owner already reads on the sheet; only the reactor's owner gets the prompt.
  slotLevels: "player",
  createdAt: "player",
  sourceName: "derived",
  sourceActorId: "never",
  // Names the attacker's action and how it rolled, which the reactor's player has no need of.
  parkedAttack: "never",
  // The cast a Counterspell decides: its action, targets and slot are the caster's, not the reactor's.
  parkedCast: "never",
  // Sent as `attackRoll`, and only when the roll it came from is in the player's dice log.
  attackTotal: "derived",
  // What set off a stat block's reaction: a hit, a turn's start or end, a move's end, damage. Public as the event was.
  cause: "player",
  // The attack's target as it stands, and the allies a Redirect Attack may hand it to: masked or left out when hidden.
  targetName: "derived",
  redirectChoices: "derived",
  // What kind of roll the reactor is asked to answer, and what its own answer does.
  rollKind: "player",
  answerDoes: "player",
  answerEither: "player",
  damageResponse: "player",
  // The save it waits on and who else was asked are the GM's bookkeeping.
  saveId: "never",
  asked: "never",
  drain: "never",
  hitKinds: "never"
} as const satisfies Record<keyof PendingReaction, FieldAudience>;

const PENDING_RULE_ASK_FIELDS = {
  id: "player",
  actorId: "player",
  rule: "player",
  family: "player",
  message: "player",
  createdAt: "player",
  // The parked payload can name target ids the asker may not know.
  command: "never"
} as const satisfies Record<keyof PendingRuleAsk, FieldAudience>;

function isHiddenSource(sourceActorId: string | null, publicActorIds: ReadonlySet<string>): boolean {
  return sourceActorId !== null && !publicActorIds.has(sourceActorId);
}

/** A vision block with what its player's characters sense unseen, as fresh arrays: the block itself may be cached. */
function withSensed(vision: PlayerVision, sensed: readonly PlayerSensedCreature[]): PlayerVision {
  if (!vision.enabled || sensed.length === 0) return vision;
  return { ...vision, sensed: sensed.map((creature) => ({ ...creature })) };
}

/** The orders a commanded creature's commander may give it, read off how it was summoned and commanded. */
function ordersFor(source: Actor): { orders?: CommandedOrders } {
  const orders: CommandedOrders = {
    ...(source.control?.commandedWith ? { command: source.control.commandedWith } : {}),
    ...(source.summon?.dismiss ? { dismiss: source.summon.dismiss } : {}),
    ...(source.summon?.sight === "bonus-action" ? { look: true as const } : {}),
    ...(source.effects.some((effect) => effect.tags.includes(OFF_PLANE_TAG)) ? { away: true as const } : {})
  };
  return Object.keys(orders).length > 0 ? { orders } : {};
}

/** A creature this player acts for: their own character, or one their character commands (a summon, a dominated
 *  creature), whose saves, reactions and asks are theirs to answer. */
function ownedBy(state: GameState, actorId: string, playerSessionId: string | undefined): boolean {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return false;
  const owner = actor.ownerSessionId;
  return (owner !== null && owner === playerSessionId) || commandedBySession(state, actor, playerSessionId);
}

/** The combat a player sees. A creature none of their characters perceive (dynamic vision) or that stands wholly under
 *  the fog is hidden from them as a GM-only one is (`AudienceSight`); a spectator (no session) sees through the whole
 *  party. */
export function projectPlayerCombat(
  state: GameState,
  playerSessionId?: string,
  now = Date.now(),
  content: SightContent = {},
  sight: AudienceSight = playerSight(state, playerSessionId, content)
): PlayerCombatView {
  const initiative = projectPublicInitiative(state, sight.hidden);
  const publicActorIds = new Set(
    state.actors
      .filter((actor) => actor.visibility === "public" && !sight.hidden.has(actor.id))
      .map((actor) => actor.id)
  );
  const currentIsPublic = initiative.some((entry) => entry.active);
  // The live map reaches players before a fight as on the table screen; before a fight only placed tokens are sent,
  // since who waits in the tray is the GM's.
  const showsToken = (token: GameState["combat"]["tokens"][number]) =>
    publicActorIds.has(token.actorId) &&
    tokenShown(sight, token.actorId) &&
    (state.combat.active || token.position !== null);
  return {
    active: state.combat.active,
    round: state.combat.round,
    turnActorId: currentIsPublic ? state.combat.turnActorId : null,
    mapAssetId: state.combat.mapAssetId,
    hiddenTurn: state.combat.active && state.combat.turnActorId !== null && !currentIsPublic,
    // Before a fight the order holds only who the GM staged, which is not the players' to know yet.
    initiative: state.combat.active ? initiative : [],
    tokens: state.combat.mapAssetId ? state.combat.tokens.filter(showsToken) : [],
    annotations: state.combat.mapAssetId ? projectPlayerAnnotations(state, playerSessionId, now) : [],
    // A hidden combatant's turn stays opaque: economy flags, action instance and per-turn uses (which
    // name stat-block action ids) reset to idle, so nothing narrates its activity.
    turn: currentIsPublic
      ? {
          actionUsed: state.combat.turn.actionUsed,
          bonusActionUsed: state.combat.turn.bonusActionUsed,
          actionInstance: state.combat.turn.actionInstance
            ? {
                actorId: state.combat.turn.actionInstance.actorId,
                components: { ...state.combat.turn.actionInstance.components }
              }
            : null,
          // The same public shape as the action's: who is mid-Flurry and how many strikes are left.
          bonusActionInstance: state.combat.turn.bonusActionInstance
            ? {
                actorId: state.combat.turn.bonusActionInstance.actorId,
                components: { ...state.combat.turn.bonusActionInstance.components }
              }
            : null,
          turnUses: { ...state.combat.turn.turnUses },
          movementUsedFeet: state.combat.turn.movementUsedFeet,
          // Whether Action Surge or Haste left the creature another action: the table sees both taken.
          ...(extraActionReady(state) ? { extraActionReady: true as const } : {}),
          // A dying character's save for this turn is made, so its player is not offered a second.
          ...(state.combat.turn.deathSaveRolled === true ? { deathSaveRolled: true as const } : {})
        }
      : {
          actionUsed: false,
          bonusActionUsed: false,
          actionInstance: null,
          bonusActionInstance: null,
          turnUses: {},
          movementUsedFeet: 0
        },
    rulesMode: state.combat.rulesMode,
    // Rules configuration, which is no secret: a player's sheet must know whether a tap will be blocked or warned.
    ruleExceptions: { ...state.combat.ruleExceptions },
    // The policy only (never the GM-only pendingDamage proposals), so the runner can say who applies a hit.
    playerDamageMode: state.combat.playerDamageMode,
    // Filtered to public actors; a player checks for their own id to show the "Roll initiative" prompt.
    pendingInitiative: state.combat.pendingInitiative.filter((actorId) => publicActorIds.has(actorId)),
    playerInitiativeMode: state.combat.playerInitiativeMode,
    underwater: state.combat.underwater,
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => publicActorIds.has(actorId)),
    // The fog's shapes; what lies wholly under them was already left out above (`AudienceSight.fogged`).
    fog: { enabled: state.combat.fog.enabled, shapes: state.combat.fog.shapes.map((shape) => ({ ...shape })) },
    // Only the revealed part: terrain under the fog would show the layout of ground players haven't seen.
    terrain: visibleTerrain(state.combat, sight.enabled ? exploredRectsOf(state) : undefined),
    // Where their own characters see now and what the party has seen; computed on the server whenever the map reaches
    // them, before a fight as in one.
    vision:
      sight.enabled && state.combat.mapAssetId
        ? withSensed(
            visionOf(state, sight.viewerIds, content),
            // What a player's own characters sense unseen (Divine Sense); a spectator senses through no one.
            playerSessionId === undefined
              ? []
              : sensedBy(state, sight.viewerIds, content, (actorId) => {
                  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
                  return token !== undefined && showsToken(token);
                })
          )
        : { enabled: false as const },
    // legendaryUsed is omitted: a monster's remaining legendary actions are GM knowledge.
    // While the GM reviews an earlier turn players get only the flag; turn labels can name hidden combatants.
    rewound: state.combat.historyCursor !== null,
    // Only the saves the player's own character owes; source actor id dropped, hidden source name masked.
    // Only the player's own prompts; a hidden source is masked in both its name and the effect label.
    pendingSaves: state.combat.pendingSaves
      .filter((entry) => ownedBy(state, entry.targetActorId, playerSessionId))
      .map((entry) => {
        const onFail = entry.onFailEffect;
        const onFailHidden = onFail !== undefined && isHiddenSource(onFail.sourceActorId, publicActorIds);
        const hiddenSource = isHiddenSource(entry.sourceActorId, publicActorIds);
        return {
          ...copyPlayerFields(entry, PENDING_SAVE_FIELDS),
          actionName: hiddenSource ? withoutSourceName(entry.actionName, entry.sourceName) : entry.actionName,
          sourceName: hiddenSource ? HIDDEN_SOURCE : entry.sourceName,
          ...(entry.confirmed ? { awaitingAnswer: true as const } : {}),
          ...(onFail
            ? {
                onFailEffect: {
                  ...copyPlayerFields(onFail, ON_FAIL_EFFECT_FIELDS),
                  ...(onFail.repeatSave ? { repeatSave: playerRepeatSave(onFail.repeatSave) } : {}),
                  name: onFailHidden ? withoutSourceName(onFail.name, onFail.sourceName) : onFail.name,
                  sourceName: onFailHidden ? HIDDEN_SOURCE : onFail.sourceName,
                  sourceActorId: null
                }
              }
            : {})
        };
      }),
    pendingRuleAsks: state.combat.pendingRuleAsks
      .filter((entry) => ownedBy(state, entry.actorId, playerSessionId))
      .map((entry) => copyPlayerFields(entry, PENDING_RULE_ASK_FIELDS)),
    // What happens at once as their own character's turn starts or ends, for them to order: each step's name, with a
    // hidden source left out of it, and the creature it lands on only when they can see it.
    ...(state.combat.turnSteps && ownedBy(state, state.combat.turnSteps.actorId, playerSessionId)
      ? {
          turnSteps: {
            id: state.combat.turnSteps.id,
            actorId: state.combat.turnSteps.actorId,
            boundary: state.combat.turnSteps.boundary,
            steps: state.combat.turnSteps.steps.map((step) => ({
              key: step.key,
              name:
                step.sourceActorId !== undefined && isHiddenSource(step.sourceActorId, publicActorIds)
                  ? withoutSourceName(step.name, step.sourceName ?? "")
                  : step.name,
              ...(step.targetName && step.targetActorId && publicActorIds.has(step.targetActorId)
                ? { targetName: step.targetName }
                : {})
            }))
          }
        }
      : {}),
    pendingReactions: state.combat.pendingReactions
      .filter((entry) => ownedBy(state, entry.actorId, playerSessionId))
      .map((entry) => {
        const attackRoll = shownAttackRoll(state, entry, playerSessionId, sight);
        return {
          ...copyPlayerFields(entry, PENDING_REACTION_FIELDS),
          sourceName: isHiddenSource(entry.sourceActorId, publicActorIds) ? HIDDEN_SOURCE : entry.sourceName,
          ...(entry.targetName !== undefined
            ? {
                targetName: isHiddenSource(entry.targetActorId, publicActorIds) ? HIDDEN_SOURCE : entry.targetName
              }
            : {}),
          ...(entry.redirectChoices
            ? { redirectChoices: entry.redirectChoices.filter((choice) => publicActorIds.has(choice.actorId)) }
            : {}),
          // The roll the prompt answers, only when the player already saw it in their dice log.
          ...(attackRoll !== null ? { attackRoll } : {}),
          // Whether the reactor's own reaction lasts (Shield): a fact of their own spell.
          ...(entry.parkedAttack?.untilNextTurn === true ? { lastsUntilNextTurn: true as const } : {})
        };
      })
  };
}

/** An effect as players see it: no source or cast ids, ongoing damage dice or magic mark, and a hidden source masked in both
 *  `sourceName` and `name`. `yours` marks one the viewer's own character is the source of, which they may end (their
 *  grapple, their Concentration); a hidden source is never a player's character, so the flag says nothing about one. */
function playerEffect(
  effect: GameState["actors"][number]["effects"][number],
  publicActorIds: ReadonlySet<string>,
  yourActorIds: ReadonlySet<string> = new Set()
): PlayerEffect {
  const {
    sourceActorId,
    sourceActionId: _sourceActionId,
    castId: _castId,
    ongoingDamage: _ongoingDamage,
    // The level a spell was cast or readied at is the caster's to know; the effect's name says which spell. A spell
    // the viewer's own character holds readied reaches them, so their sheet can release it.
    spell: _spell,
    readiedSpell,
    magical: _magical,
    // A monster's lower Hit Point maximum is the GM's to know; a character's shows on its own sheet. So are the
    // amounts a spell's level or its caster's modifier set (Aid's gain, Heroism's Temporary Hit Points), and what
    // the effect makes its bearer immune to.
    hitPointMaximumLoss: _hitPointMaximumLoss,
    hitPointMaximumGain: _hitPointMaximumGain,
    temporaryHitPointsEachTurn: _temporaryHitPointsEachTurn,
    conditionImmunities: _conditionImmunities,
    // A granted move names the turn it belongs to and the creature it must flee, which can be hidden; its own
    // character's grant reaches a player through `actor:movement`.
    grantedMove: _grantedMove,
    grantedTeleport: _grantedTeleport,
    // Whether a Concentration spell ends once no creature keeps it is the engine's bookkeeping.
    endsWhenUnaffected: _endsWhenUnaffected,
    // A long casting's targets and slot are the caster's plan; its name says what is being cast.
    longCast: _longCast,
    // What a spell's level, its caster's numbers or its choice set, and the engine's bookkeeping: the hit points it
    // restores each turn, the kinds of creature it wards against, the conditions it holds off, the carried row it is
    // bound to and how that row swings, the actions it gives (their DCs and damage types), its once-a-turn and
    // shrinking marks, and how its bearer's Unarmed Strike lands. Its name says what it is; the owner's sheet reads its
    // actions from the available-actions read.
    hitPointsEachTurn: _hitPointsEachTurn,
    conditionWards: _conditionWards,
    suppressedConditions: _suppressedConditions,
    itemId: _itemId,
    weapon: _weapon,
    optionId: _optionId,
    bonusActions: _bonusActions,
    grantedSpellAction: _grantedSpellAction,
    endAction: _endAction,
    usedOnTurn: _usedOnTurn,
    shrinksEachLongRest: _shrinksEachLongRest,
    unarmedStrike: _unarmedStrike,
    // What a hit on the bearer costs its attacker names a save's DC; the server applies it.
    struck: _struck,
    // What a rest or a day does to its bearer names dice and a DC; it lands when it happens.
    atRest: _atRest,
    // The light it sheds reaches players only as the lit ground in their own sight, which the server draws.
    light: _light,
    findDc: _findDc,
    detects: _detects,
    // What holds the creature reaches players by name, so anyone can attack it; its Armor Class and the Hit Points
    // it has left are the GM's.
    heldBy,
    // A form's stat block, the definition it replaced and its terms are the GM's; its name reaches the table, as the
    // effect's own name says it. What size the bearer has is on the actor.
    form,
    sizeChange: _sizeChange,
    ownSize: _ownSize,
    ...rest
  } = effect;
  const visible = {
    ...rest,
    ...(heldBy ? { heldBy: { name: heldBy.name } } : {}),
    ...(form ? { form: { name: form.name } } : {})
  };
  const mine = sourceActorId !== null && yourActorIds.has(sourceActorId);
  // A readied spell's Metamagic picks are the engine's to apply at its release.
  const held = readiedSpell ? (({ shaping: _shaping, ...kept }) => kept)(readiedSpell) : undefined;
  const yours = mine ? { yours: true as const, ...(held ? { readiedSpell: held } : {}) } : {};
  const repeat = visible.repeatSave ? { repeatSave: playerRepeatSave(visible.repeatSave) } : {};
  if (!isHiddenSource(sourceActorId, publicActorIds)) return { ...visible, ...repeat, ...yours };
  return {
    ...visible,
    ...repeat,
    name: withoutSourceName(visible.name, effect.sourceName),
    sourceName: HIDDEN_SOURCE
  };
}

/** A repeat save as a player reads it: the save, when it comes and the count so far. What a failed one turns the effect
 *  into, the dice it deals and what gives it Disadvantage stay with the GM. */
function playerRepeatSave(repeat: RepeatSave): RepeatSave {
  const { next: _next, failureDamage: _failureDamage, disadvantageFrom: _disadvantageFrom, ...shown } = repeat;
  return structuredClone(shown);
}

/** The GM's calls for a roll as one player sees them: only the calls naming their own characters, only those
 *  characters' entries, and a blind call without its DC or results. */
export function projectPlayerRollCalls(state: GameState, playerSessionId: string | undefined): PlayerRollCall[] {
  if (playerSessionId === undefined) return [];
  const mine = new Set(
    state.actors
      .filter((actor) => actor.ownerSessionId === playerSessionId && actor.visibility === "public" && !actor.archived)
      .map((actor) => actor.id)
  );
  return state.rollCalls.flatMap((call) => {
    // An answered entry is done for its player: the call ends for them, and stays open only for the GM to close.
    const entries = call.entries.filter((entry) => mine.has(entry.actorId) && entry.result === undefined);
    if (entries.length === 0) return [];
    return [
      {
        id: call.id,
        kind: call.kind,
        subject: { ...call.subject },
        dc: call.blind ? null : call.dc,
        blind: call.blind,
        entries: entries.map((entry) => ({
          actorId: entry.actorId,
          ...(entry.saveId !== undefined ? { saveId: entry.saveId } : {}),
          // Their own character's gear, which their sheet already lists.
          ...(entry.situations ? { situations: entry.situations.map((one) => ({ ...one })) } : {}),
          answered: entry.result !== undefined,
          ...(entry.result !== undefined && !call.blind ? { result: { ...entry.result } } : {})
        })),
        createdAt: call.createdAt
      }
    ];
  });
}

/** Resting as one player sees it: their own characters' requests, and the party's Short and Long Rests only when one of
 *  their characters is in them, cut down to those characters. Who else rests, and the game clock, stay with the GM. */
function playerRest(state: GameState, yourActorIds: ReadonlySet<string>): PlayerView["rest"] {
  const shortRest = state.rest.shortRest;
  const members = shortRest?.actorIds.filter((id) => yourActorIds.has(id)) ?? [];
  // The Long Rest's own members only: neither when it started nor who else rests reaches a player.
  const yours = (state.rest.longRest?.members ?? []).filter((member) => yourActorIds.has(member.actorId));
  return {
    requests: state.rest.requests.filter((id) => yourActorIds.has(id)),
    shortRest:
      shortRest && members.length > 0
        ? { actorIds: members, done: shortRest.done.filter((id) => yourActorIds.has(id)) }
        : null,
    longRest:
      yours.length > 0
        ? {
            actorIds: yours.map((member) => member.actorId),
            interrupted: yours.filter((member) => member.interrupted).map((member) => member.actorId),
            shortRestEarned: yours.filter((member) => member.shortRestEarned).map((member) => member.actorId)
          }
        : null
  };
}

/** The party's crafting projects as a player sees them, from an allow-list: those of their own characters and of the
 *  visible party characters, so a character can offer to help. What a project cost stays with its crafter's player (a
 *  purse is owner-only), and when one started and a scroll's numbers stay with the GM. A helper is named only when it
 *  is one of theirs or a visible party character. */
function playerCrafting(state: GameState, yourActorIds: ReadonlySet<string>): PlayerView["crafting"] {
  const named = (actorId: string) =>
    yourActorIds.has(actorId) ||
    state.actors.some(
      (actor) =>
        actor.id === actorId && actor.kind === "player-character" && actor.visibility === "public" && !actor.archived
    );
  return state.crafting.projects
    .filter((project) => named(project.crafterId))
    .map((project) => ({
      id: project.id,
      crafterId: project.crafterId,
      itemId: project.itemId,
      itemName: project.itemName,
      kind: project.kind,
      toolId: project.toolId,
      ...(project.spellId !== undefined ? { spellId: project.spellId } : {}),
      helperIds: project.helperIds.filter(named),
      workMinutes: project.workMinutes,
      doneMinutes: project.doneMinutes,
      ...(yourActorIds.has(project.crafterId) ? { paidCp: project.paidCp } : {})
    }));
}

/** "Fighter 5 / Rogue 2" for the identity card; null (field omitted) when the sheet records no class. */
function classLineOf(definition: GameState["definitions"][number]["definition"] | undefined): string | null {
  const classes = definition?.character?.classes ?? [];
  return classes.length === 0 ? null : classes.map((entry) => `${entry.name} ${entry.level}`).join(" / ");
}

type Actor = GameState["actors"][number];

/**
 * Who may see each actor field in the player view. Every field must be listed, so adding one to the
 * actor schema fails to compile until someone decides its audience.
 * - table: every player, for every visible actor
 * - party: every player, but only on player characters (monster stats are GM knowledge)
 * - derived: never copied directly; projectPlayerView builds a masked or gated version
 * - never: GM only
 */
const PLAYER_ACTOR_FIELDS = {
  id: "table",
  name: "table",
  kind: "table",
  visibility: "table",
  size: "table",
  sizeCells: "table",
  tokenAssetId: "table",
  conditions: "table",
  deathSaves: "table",
  // When it died and how, which the revival rules read: the GM's.
  death: "never",
  armorClass: "party",
  // Only says the GM set the character's AC by hand; the number is `armorClass`, which the party already sees.
  armorClassOverride: "party",
  initiative: "party",
  speedFeet: "party",
  definitionId: "party",
  hp: "derived",
  effects: "derived",
  ownerSessionId: "derived",
  healthDisplay: "derived",
  replaySceneId: "derived",
  actionUses: "derived",
  readyAt: "derived",
  heroicInspiration: "derived",
  heroicInspirationToGive: "derived",
  experiencePoints: "derived",
  choiceOverrides: "derived",
  hitDice: "derived",
  nourishment: "derived",
  lastLongRestAt: "never",
  spellSlots: "derived",
  pactSlots: "derived",
  preparedSpellIds: "derived",
  spellbook: "derived",
  knownForms: "derived",
  preparation: "derived",
  restStep: "derived",
  inventory: "derived",
  currency: "derived",
  notes: "never",
  conditionImmunities: "never",
  // A creature's attitude is the GM's: players learn it from how the GM has them roll.
  attitude: "never",
  // What the GM chose where a stat block leaves a choice (a half-dragon's damage type) is the GM's until it shows.
  statBlockPicks: "never",
  legendary: "never",
  lastUsedAt: "never",
  firstClaimedAt: "never",
  sample: "never",
  archived: "never",
  sheetPreview: "never",
  // Who summoned a creature and what keeps it is the GM's; its commander's player is told only that it commands it.
  summon: "never",
  control: "derived",
  // The owner's own turn-card pins and use counts: never another player's, whatever the party tier.
  favouriteOptionIds: "derived",
  optionUseCounts: "derived"
} as const satisfies Record<keyof Actor, "table" | "party" | "derived" | "never">;

type FieldsFor<Audience> = {
  [K in keyof typeof PLAYER_ACTOR_FIELDS]: (typeof PLAYER_ACTOR_FIELDS)[K] extends Audience ? K : never;
}[keyof typeof PLAYER_ACTOR_FIELDS];
const TABLE_FIELDS = (Object.keys(PLAYER_ACTOR_FIELDS) as (keyof Actor)[]).filter(
  (key) => PLAYER_ACTOR_FIELDS[key] === "table"
) as FieldsFor<"table">[];
const PARTY_FIELDS = (Object.keys(PLAYER_ACTOR_FIELDS) as (keyof Actor)[]).filter(
  (key) => PLAYER_ACTOR_FIELDS[key] === "table" || PLAYER_ACTOR_FIELDS[key] === "party"
) as FieldsFor<"table" | "party">[];

/** Copies the listed fields. Optional ones that are unset are left out. */
/** A carried row for a player. The GM's pick of a resistance type stays the GM's until the bearer attunes, when
 *  the item's properties are learned (and the resistance starts to apply); so does which kind an item that needs
 *  attunement is (an Ioun Stone's). */
function playerInventoryRow(item: Actor["inventory"][number]): Actor["inventory"][number] {
  const { chosenDamageType, variantId, ...row } = item;
  const learned = item.attuned || item.magic?.attunementRequired !== true;
  return {
    ...row,
    ...(chosenDamageType !== undefined && item.attuned ? { chosenDamageType } : {}),
    ...(variantId !== undefined && learned ? { variantId } : {})
  };
}

function pickFields<K extends keyof Actor>(source: Actor, keys: readonly K[]): Pick<Actor, K> {
  const picked: Partial<Pick<Actor, K>> = {};
  for (const key of keys) if (source[key] !== undefined) picked[key] = structuredClone(source[key]);
  return picked as Pick<Actor, K>;
}

/**
 * Player projection. `state.partyVisibility` governs only what a player receives about another
 * player's claimed character, and it is enforced here; a client-side filter would still leak on the wire.
 * Monsters, NPCs and unclaimed characters are unaffected by the tier.
 *
 * | Field                                   | mine | off | name-and-class | full-sheet | sheet-and-resources |
 * | --------------------------------------- | ---- | --- | -------------- | ---------- | ------------------- |
 * | (the actor entry exists at all)         |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | id, name, kind, visibility              |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | armorClass(Override), initiative, speed |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | size, sizeCells, tokenAssetId           |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | definitionId, conditions, deathSaves    |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | hp (exact for a PC), effects (masked)   |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | claimStatus, presence, healthDisplay    |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | classLine                               |  -   |  -  |       Y        |     Y      |          Y          |
 * An unclaimed character is not another player's, so no tier applies: it carries `classLine` and `species` for
 * the claim picker, and nothing more of its sheet.
 * | definition (the imported sheet)         |  Y   |  -  |       -        |     Y      |          Y          |
 * | actionUses, hitDice, heroicInspiration  |  Y   |  -  |       -        |     -      |          Y          |
 * | readyAt (a timed pool's return)         |  Y   |  -  |       -        |     -      |          Y          |
 * | experiencePoints                        |  Y   |  -  |       -        |     -      |          Y          |
 * | heroicInspirationToGive (a gift to make)|  Y   |  -  |       -        |     -      |          -          |
 * | spellSlots, pactSlots, preparedSpellIds |  Y   |  -  |       -        |     -      |          Y          |
 * | preparation (Long Rest prepare step)    |  Y   |  -  |       -        |     -      |          Y          |
 * | restStep (what a finished rest opened)  |  Y   |  -  |       -        |     -      |          Y          |
 * | spellbook (a Wizard's beyond the sheet) |  Y   |  -  |       -        |     -      |          Y          |
 * | inventory, currency                     |  Y   |  -  |       -        |     -      |          Y          |
 * | favouriteOptionIds, optionUseCounts     |  Y   |  -  |       -        |     -      |          -          |
 * | notes, ownerSessionId, conditionImmunities, legendary, lastUsedAt, firstClaimedAt, sample, archived,          |
 * | sheetPreview, lastLongRestAt: never, at any tier.                                                              |
 *
 * `off` keeps the base entry: initiative and tokens still reference the ally, and the map renders
 * nothing for a token whose actor is missing. Rules for new fields: never gate `mine` on the tier;
 * a field sits above the `off` line only if the map, tokens or turn order need it; otherwise pick the
 * strictest tier that works (adding a field here is a viewer-safety change).
 */
export function projectPlayerView(
  state: GameState,
  playerSessionId: string | undefined,
  presenceFor: PresenceLookup,
  now = Date.now(),
  content: SightContent = {}
): PlayerView {
  // The creatures this player's characters don't perceive, or that stand wholly under the fog, are hidden like gm-only.
  const sight = playerSight(state, playerSessionId, content);
  // Archived characters are hidden from players entirely, like gm-only actors.
  const publicActorIds = new Set(
    state.actors
      .filter((actor) => actor.visibility === "public" && !actor.archived && !sight.hidden.has(actor.id))
      .map((actor) => actor.id)
  );
  const tier = state.partyVisibility;
  // The viewer's own characters, so the effects they are the source of are marked theirs to end.
  const yourActorIds = new Set(
    state.actors
      .filter((actor) => playerSessionId !== undefined && actor.ownerSessionId === playerSessionId)
      .map((actor) => actor.id)
  );
  // The creatures their characters command (a summoned spirit, a dominated ogre): theirs to act for, so they get its
  // stat block, exact Hit Points and uses, and the effects it holds on others are theirs to end.
  const commandedIds = new Set(
    state.actors.filter((actor) => commandedBySession(state, actor, playerSessionId)).map((actor) => actor.id)
  );
  const actsFor = new Set([...yourActorIds, ...commandedIds]);
  return {
    revision: state.revision,
    // The tier actually applied, so the client can tell "no sheet" from "sheet withheld".
    partyVisibility: tier,
    // Builder policy holds no secrets. Copied field by field, never spread, so a new policy field
    // reaches players only when someone adds it here.
    builderPolicy: {
      allowedAbilityMethods: [...state.builderPolicy.allowedAbilityMethods],
      customFormula: state.builderPolicy.customFormula,
      maxLevel: state.builderPolicy.maxLevel,
      playerBuilder: state.builderPolicy.playerBuilder,
      playerRandom: state.builderPolicy.playerRandom,
      // Players need both to know whether they may type their dice and how a rolled level counts.
      typedRolls: state.builderPolicy.typedRolls,
      hitPointRollFloor: state.builderPolicy.hitPointRollFloor
    },
    // Archived characters the GM shared: id + name only, and only ones that were public.
    archivedCharacters: state.actors
      .filter((actor) => actor.archived && actor.sheetPreview && actor.visibility === "public")
      .map((actor) => ({ id: actor.id, name: actor.name })),
    rollCalls: projectPlayerRollCalls(state, playerSessionId),
    combat: projectPlayerCombat(state, playerSessionId, now, content, sight),
    rest: playerRest(state, yourActorIds),
    crafting: playerCrafting(state, yourActorIds),
    // Tiers subtract fields. An actor is removed only by gm-only visibility, archiving or sight.
    actors: state.actors
      .filter((actor) => actor.visibility === "public" && !actor.archived && !sight.hidden.has(actor.id))
      .map((source) => {
        const {
          ownerSessionId,
          actionUses,
          readyAt,
          heroicInspiration,
          heroicInspirationToGive,
          experiencePoints,
          choiceOverrides,
          hitDice,
          nourishment,
          spellSlots,
          pactSlots,
          preparedSpellIds,
          spellbook,
          knownForms,
          preparation,
          restStep,
          inventory,
          currency,
          replaySceneId,
          favouriteOptionIds,
          optionUseCounts
        } = source;
        const mine = ownerSessionId !== null && ownerSessionId === playerSessionId;
        // Another player's claimed character: the only thing `partyVisibility` governs.
        const theirs = !mine && source.kind === "player-character" && ownerSessionId !== null;
        // `mine` is never gated by the tier; at `off` all three are false.
        const cardVisible = mine || (theirs && tier !== "off");
        const sheetVisible = mine || (theirs && (tier === "full-sheet" || tier === "sheet-and-resources"));
        const resourcesVisible = mine || (theirs && tier === "sheet-and-resources");
        // Bar/ring styles reach players only when the GM targets everyone; only the style crosses and the
        // client derives the fill from `hp`, so exact HP never leaks for someone else's token.
        const effectiveDisplay = source.healthDisplay ?? state.combat.healthDisplay;
        const sharedDisplayStyle =
          effectiveDisplay.audience === "all" && effectiveDisplay.style !== "band" ? effectiveDisplay.style : null;
        // An unclaimed character is one any player may claim, which hands over its whole sheet, so its species and
        // class line for the claim picker tell no one anything they couldn't read by claiming it.
        const available = source.kind === "player-character" && ownerSessionId === null;
        // At `off` another player's sheet is not even looked up.
        const storedSheet =
          (cardVisible || available) && source.definitionId
            ? state.definitions.find((entry) => entry.id === source.definitionId)?.definition
            : undefined;
        const classLine = (theirs && cardVisible) || available ? classLineOf(storedSheet) : null;
        const species = available ? (storedSheet?.character?.race?.name ?? null) : null;
        const commanded = commandedIds.has(source.id);
        // The stat block of a creature this player commands: a bundled one, or the scaled copy a summon stored.
        const commandedSheet =
          commanded && source.definitionId
            ? (state.definitions.find((entry) => entry.id === source.definitionId)?.definition ??
              content.definition?.(source.definitionId))
            : undefined;
        if (commanded)
          return {
            ...pickFields(source, PARTY_FIELDS),
            hp: {
              kind: "exact" as const,
              current: source.hp.current,
              maximum: source.hp.maximum,
              temporary: source.hp.temporary
            },
            effects: source.effects.map((effect) => playerEffect(effect, publicActorIds, actsFor)),
            // A commanded creature is never a player character, so no one claims it.
            claimStatus: "available" as const,
            presence: null,
            commanded: true as const,
            ...ordersFor(source),
            ...(commandedSheet ? { definition: commandedSheet, pools: actionPools(commandedSheet.actions) } : {}),
            actionUses: { ...actionUses },
            ...(sharedDisplayStyle ? { healthDisplay: { style: sharedDisplayStyle } } : {})
          };
        return {
          ...pickFields(source, source.kind === "player-character" ? PARTY_FIELDS : TABLE_FIELDS),
          hp: playerHp(source),
          effects: source.effects.map((effect) => playerEffect(effect, publicActorIds, actsFor)),
          claimStatus:
            ownerSessionId === null ? ("available" as const) : mine ? ("mine" as const) : ("claimed" as const),
          presence: ownerSessionId === null ? null : presenceFor(ownerSessionId),
          // Replay clone marker, copied explicitly. An opaque scene id that keeps clones out of the party strip
          // and claim screen; the entry stays so the map still renders the clone's token.
          ...(replaySceneId !== undefined ? { replaySceneId } : {}),
          ...(classLine !== null ? { classLine } : {}),
          ...(species !== null ? { species } : {}),
          ...(sheetVisible && storedSheet ? { definition: storedSheet } : {}),
          ...(resourcesVisible ? { actionUses: { ...actionUses }, heroicInspiration } : {}),
          // When a pool spent for a time comes back: the owner's own sheet resource, as its spent count is.
          ...(resourcesVisible
            ? { readyAt: Object.fromEntries(Object.entries(readyAt).map(([key, value]) => [key, { ...value }])) }
            : {}),
          // XP is a sheet resource, gated like the uses.
          ...(resourcesVisible && experiencePoints !== undefined ? { experiencePoints } : {}),
          // A gift to make is the owner's decision alone.
          ...(mine && heroicInspirationToGive ? { heroicInspirationToGive } : {}),
          // Same gate as actionUses: a private sheet resource. Copied, never a live reference into GameState.
          ...(resourcesVisible
            ? {
                choiceOverrides: Object.fromEntries(
                  Object.entries(choiceOverrides).map(([key, value]) => [key, { ...value }])
                )
              }
            : {}),
          // Pool ceilings derived from the sheet already sent; `resourcesVisible` is narrower than `sheetVisible`,
          // so this reveals nothing the recipient cannot already read off the definition.
          ...(resourcesVisible && storedSheet ? { pools: actionPools(storedSheet.actions) } : {}),
          // Deep-copied: a player projection never hands out a live reference into GameState.
          ...(resourcesVisible && hitDice
            ? { hitDice: { ...hitDice, entries: hitDice.entries.map((entry) => ({ ...entry })) } }
            : {}),
          // Today's food and water is a sheet resource, gated like the Hit Point Dice.
          ...(resourcesVisible && nourishment ? { nourishment: { ...nourishment } } : {}),
          // Sheet resources reach the owner always and another player only at the top tier.
          ...(resourcesVisible
            ? {
                spellSlots: spellSlots === null ? null : spellSlots.map((slot) => ({ ...slot })),
                pactSlots: pactSlots === null ? null : { ...pactSlots },
                preparedSpellIds: [...preparedSpellIds],
                spellbook: spellbook.map((entry) => ({ ...entry })),
                ...(knownForms ? { knownForms: { ids: [...knownForms.ids], swapOpen: knownForms.swapOpen } } : {}),
                preparation: preparation === null ? null : { ...preparation },
                restStep:
                  restStep === null
                    ? null
                    : { after: restStep.after, ...(restStep.swaps ? { swaps: { ...restStep.swaps } } : {}) },
                inventory: inventory.map(playerInventoryRow),
                currency: { ...currency }
              }
            : {}),
          // The turn card's pins and counts are the owner's alone, so even the top party tier leaves them out.
          ...(mine && favouriteOptionIds ? { favouriteOptionIds: [...favouriteOptionIds] } : {}),
          ...(mine && optionUseCounts ? { optionUseCounts: { ...optionUseCounts } } : {}),
          ...(sharedDisplayStyle ? { healthDisplay: { style: sharedDisplayStyle } } : {}),
          // Hunter's Lore: what this player's own Hunter knows of the creature its Hunter's Mark marks, for this player
          // alone and while the mark lasts. A creature they can't perceive was left out above.
          ...knownDefencesFor(state, source, yourActorIds, content)
        };
      }),
    rolls: state.rolls.filter((roll) => visibleToPlayer(state, roll, playerSessionId, sight)).map(playerRoll)
  };
}

/** The `knownDefences` field for one player's read of a creature, built from an explicit list in `hunters-lore.ts`. */
function knownDefencesFor(
  state: GameState,
  source: Actor,
  yourActorIds: ReadonlySet<string>,
  content: SightContent
): { knownDefences?: KnownDefences } {
  if (yourActorIds.size === 0 || source.kind === "player-character") return {};
  const known = huntersLoreOf(state, source, yourActorIds, content);
  return known ? { knownDefences: known } : {};
}

export function projectGmView(state: GameState, presenceFor: PresenceLookup, now = Date.now()): GmView {
  return {
    ...state,
    // Expired ephemeral annotations must drop off the GM's screen too; the expiry re-broadcast relies on this.
    combat: {
      ...state.combat,
      annotations: state.combat.annotations.filter(
        (annotation) => annotation.expiresAt === null || annotation.expiresAt > now
      )
    },
    actors: state.actors.map((actor) => ({
      ...actor,
      presence: actor.ownerSessionId === null ? null : presenceFor(actor.ownerSessionId)
    }))
  };
}
