import type {
  Annotation,
  GameState,
  GmView,
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
  PlayerView,
  PresenceStatus,
  RollRecord
} from "@vtt/domain";
import { actionPools } from "./effective-actions.js";
import { HASTED_TAG } from "./effects.js";
import { healthBandOf } from "./hit-points.js";
import { HIDDEN_SOURCE, withoutSourceName } from "./hidden-source.js";
import { visibleTerrain } from "./terrain.js";
import { exploredRectsOf, playerSight, tokenShown, visionOf, type AudienceSight } from "./vision/audience.js";
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

function visibleToPlayerAnnotation(state: GameState, annotation: Annotation, playerSessionId: string | undefined) {
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
  // Whether a hidden source's save is magical says something about it; only Magic Resistance reads it.
  magical: "never",
  // What a success earns is the stat block's text, the GM's knowledge.
  immuneOnSuccess: "never",
  // What the damage drains, and where a failure pushes, are narrated when they land.
  drain: "never",
  failurePush: "never",
  // The save's own roll mode is read when it is answered.
  advantageAtSize: "never",
  // That the GM applies the outcome is a fact of the engine, true of the spell for whoever casts it; it names nothing.
  gmApplies: "player"
} as const satisfies Record<keyof PendingSave, FieldAudience>;

// How long what a failure imposes would last is the save's own text, read on the prompt by the one who owes it.
// Its ongoing damage dice are the stat block's, so they stay with the GM; the damage itself shows when it lands.
const ON_FAIL_EFFECT_FIELDS = {
  tags: "player",
  linkedConditionIds: "player",
  escapeDc: "player",
  modifiers: "player",
  duration: "player",
  repeatSave: "player",
  endsOnDamage: "player",
  endsOnSourceSideDamage: "player",
  speedZero: "player",
  endsWhenSourceDefeated: "player",
  rangeFeet: "player",
  endsOnSpellHealing: "player",
  armorClassBonus: "player",
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
  // The DC of the action that ends it is the caster's number; the option it carries shows in its name.
  endAction: "never",
  optionId: "never",
  // Kept off as the landed effect keeps them off (`playerEffect`); its name says what it is.
  conditionImmunities: "never",
  suppressesConditions: "never"
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
  attackTotal: "derived"
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

function ownedBy(state: GameState, actorId: string, playerSessionId: string | undefined): boolean {
  const owner = state.actors.find((actor) => actor.id === actorId)?.ownerSessionId ?? null;
  return owner !== null && owner === playerSessionId;
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
        ? visionOf(state, sight.viewerIds, content)
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
          ...(onFail
            ? {
                onFailEffect: {
                  ...copyPlayerFields(onFail, ON_FAIL_EFFECT_FIELDS),
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
    pendingReactions: state.combat.pendingReactions
      .filter((entry) => ownedBy(state, entry.actorId, playerSessionId))
      .map((entry) => {
        const attackRoll = shownAttackRoll(state, entry, playerSessionId, sight);
        return {
          ...copyPlayerFields(entry, PENDING_REACTION_FIELDS),
          sourceName: isHiddenSource(entry.sourceActorId, publicActorIds) ? HIDDEN_SOURCE : entry.sourceName,
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
    // Whether a Concentration spell ends once no creature keeps it is the engine's bookkeeping.
    endsWhenUnaffected: _endsWhenUnaffected,
    // A long casting's targets and slot are the caster's plan; its name says what is being cast.
    longCast: _longCast,
    // What a spell's level, its caster's numbers or its choice set, and the engine's bookkeeping: the hit points it
    // restores each turn, the kinds of creature it wards against, the conditions it holds off, the carried row it is
    // bound to and how that row swings, the actions it gives (their DCs and damage types), and its once-a-turn and
    // shrinking marks, the damage it deals a creature that hits its bearer, and how its bearer's Unarmed Strike lands. Its name says what it is; the owner's
    // sheet reads its actions from the available-actions read.
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
    meleeHitDamage: _meleeHitDamage,
    unarmedStrike: _unarmedStrike,
    ...visible
  } = effect;
  const mine = sourceActorId !== null && yourActorIds.has(sourceActorId);
  const yours = mine ? { yours: true as const, ...(readiedSpell ? { readiedSpell: { ...readiedSpell } } : {}) } : {};
  if (!isHiddenSource(sourceActorId, publicActorIds)) return { ...visible, ...yours };
  return { ...visible, name: withoutSourceName(visible.name, effect.sourceName), sourceName: HIDDEN_SOURCE };
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
          answered: entry.result !== undefined,
          ...(entry.result !== undefined && !call.blind ? { result: { ...entry.result } } : {})
        })),
        createdAt: call.createdAt
      }
    ];
  });
}

/** Resting as one player sees it: their own characters' requests, and the party's Short Rest only when one of their
 *  characters is in it, cut down to those characters. Who else rests, and the game clock, stay with the GM. */
function playerRest(state: GameState, yourActorIds: ReadonlySet<string>): PlayerView["rest"] {
  const shortRest = state.rest.shortRest;
  const members = shortRest?.actorIds.filter((id) => yourActorIds.has(id)) ?? [];
  return {
    requests: state.rest.requests.filter((id) => yourActorIds.has(id)),
    shortRest:
      shortRest && members.length > 0
        ? { actorIds: members, done: shortRest.done.filter((id) => yourActorIds.has(id)) }
        : null
  };
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
  heroicInspiration: "derived",
  choiceOverrides: "derived",
  hitDice: "derived",
  lastLongRestAt: "never",
  spellSlots: "derived",
  pactSlots: "derived",
  preparedSpellIds: "derived",
  spellbook: "derived",
  preparation: "derived",
  inventory: "derived",
  currency: "derived",
  notes: "never",
  conditionImmunities: "never",
  legendary: "never",
  lastUsedAt: "never",
  firstClaimedAt: "never",
  sample: "never",
  archived: "never",
  sheetPreview: "never",
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
 *  the item's properties are learned (and the resistance starts to apply). */
function playerInventoryRow(item: Actor["inventory"][number]): Actor["inventory"][number] {
  const { chosenDamageType, ...row } = item;
  return chosenDamageType !== undefined && item.attuned ? { ...row, chosenDamageType } : row;
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
 * | spellSlots, pactSlots, preparedSpellIds |  Y   |  -  |       -        |     -      |          Y          |
 * | preparation (Long Rest prepare step)    |  Y   |  -  |       -        |     -      |          Y          |
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
    // Tiers subtract fields. An actor is removed only by gm-only visibility, archiving or sight.
    actors: state.actors
      .filter((actor) => actor.visibility === "public" && !actor.archived && !sight.hidden.has(actor.id))
      .map((source) => {
        const {
          ownerSessionId,
          actionUses,
          heroicInspiration,
          choiceOverrides,
          hitDice,
          spellSlots,
          pactSlots,
          preparedSpellIds,
          spellbook,
          preparation,
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
        return {
          ...pickFields(source, source.kind === "player-character" ? PARTY_FIELDS : TABLE_FIELDS),
          hp: playerHp(source),
          effects: source.effects.map((effect) => playerEffect(effect, publicActorIds, yourActorIds)),
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
          // Sheet resources reach the owner always and another player only at the top tier.
          ...(resourcesVisible
            ? {
                spellSlots: spellSlots === null ? null : spellSlots.map((slot) => ({ ...slot })),
                pactSlots: pactSlots === null ? null : { ...pactSlots },
                preparedSpellIds: [...preparedSpellIds],
                spellbook: spellbook.map((entry) => ({ ...entry })),
                preparation: preparation === null ? null : { ...preparation },
                inventory: inventory.map(playerInventoryRow),
                currency: { ...currency }
              }
            : {}),
          // The turn card's pins and counts are the owner's alone, so even the top party tier leaves them out.
          ...(mine && favouriteOptionIds ? { favouriteOptionIds: [...favouriteOptionIds] } : {}),
          ...(mine && optionUseCounts ? { optionUseCounts: { ...optionUseCounts } } : {}),
          ...(sharedDisplayStyle ? { healthDisplay: { style: sharedDisplayStyle } } : {})
        };
      }),
    rolls: state.rolls.filter((roll) => visibleToPlayer(state, roll, playerSessionId, sight)).map(playerRoll)
  };
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
