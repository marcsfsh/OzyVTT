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
  PlayerRollRecord,
  PlayerView,
  PresenceStatus,
  RollRecord
} from "@vtt/domain";
import { actionPools } from "./effective-actions.js";
import { healthBandOf } from "./hit-points.js";
import { visibleTerrain } from "./terrain.js";

type PresenceLookup = (sessionId: string) => PresenceStatus | null;

/** Party members stay exact for each other; monster/NPC HP reaches players only as a band. Shared with
 *  the replay projection so there is one rule. */
export function playerHp(actor: GameState["actors"][number]): PlayerHp {
  return actor.kind === "player-character"
    ? { kind: "exact", current: actor.hp.current, maximum: actor.hp.maximum, temporary: actor.hp.temporary }
    : { kind: "band", band: healthBandOf(actor.hp) };
}

/** A roll a player may see: public or their own, and never one attributed to an actor hidden from them. */
function visibleToPlayer(state: GameState, roll: RollRecord, playerSessionId?: string) {
  if (roll.actorId && state.actors.some((actor) => actor.id === roll.actorId && actor.visibility !== "public"))
    return false;
  return (
    roll.visibility === "public" || (roll.visibility === "self-only" && roll.initiatorSessionId === playerSessionId)
  );
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

export function projectPublicInitiative(state: GameState): readonly PlayerInitiativeEntry[] {
  const publicActors = new Map(
    state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor])
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

// The one mask a hidden source's identity collapses to; shared so adjacent fields never disagree.
export const HIDDEN_SOURCE = "A hidden threat";

/** Scrubs a hidden source's name out of a free-form label ("Grappled by Vashkar") at the security
 *  boundary, since resolvers interpolate it and blanking would leave an empty chip. Word-boundary match;
 *  it can't catch other spellings, so resolvers must only interpolate the source's own `sourceName`. */
export function withoutSourceName(text: string, sourceName: string | null): string {
  const needle = sourceName?.trim() ?? "";
  if (needle.length === 0) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), HIDDEN_SOURCE);
}

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
  repeatOf: "never"
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
  speedZero: "player",
  endsWhenSourceDefeated: "player",
  rangeFeet: "player",
  name: "derived",
  sourceName: "derived",
  sourceActorId: "derived",
  castId: "never",
  sourceActionId: "never",
  ongoingDamage: "never"
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
  createdAt: "player",
  sourceName: "derived",
  sourceActorId: "never",
  // Names the attacker's action and how it rolled, which the reactor's player has no need of.
  parkedAttack: "never"
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

export function projectPlayerCombat(state: GameState, playerSessionId?: string, now = Date.now()): PlayerCombatView {
  const initiative = projectPublicInitiative(state);
  const publicActorIds = new Set(
    state.actors.filter((actor) => actor.visibility === "public").map((actor) => actor.id)
  );
  const currentIsPublic = initiative.some((entry) => entry.active);
  return {
    active: state.combat.active,
    round: state.combat.round,
    turnActorId: currentIsPublic ? state.combat.turnActorId : null,
    mapAssetId: state.combat.active ? state.combat.mapAssetId : null,
    hiddenTurn: state.combat.active && state.combat.turnActorId !== null && !currentIsPublic,
    initiative,
    tokens: state.combat.active ? state.combat.tokens.filter((token) => publicActorIds.has(token.actorId)) : [],
    annotations: state.combat.active ? projectPlayerAnnotations(state, playerSessionId, now) : [],
    // A hidden combatant's turn stays opaque: economy flags, action instance and per-turn uses (which
    // name stat-block action ids) reset to idle rather than narrate its activity.
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
          movementUsedFeet: state.combat.turn.movementUsedFeet
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
    // Rules configuration, not secrets: a player's sheet must know whether a tap will be blocked or warned.
    ruleExceptions: { ...state.combat.ruleExceptions },
    // The policy only (never the GM-only pendingDamage proposals), so the runner can say who applies a hit.
    playerDamageMode: state.combat.playerDamageMode,
    // Filtered to public actors; a player checks for their own id to show the "Roll initiative" prompt.
    pendingInitiative: state.combat.pendingInitiative.filter((actorId) => publicActorIds.has(actorId)),
    playerInitiativeMode: state.combat.playerInitiativeMode,
    underwater: state.combat.underwater,
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => publicActorIds.has(actorId)),
    // Fog carries geometry only and is never the security boundary; hidden actors are stripped regardless.
    fog: { enabled: state.combat.fog.enabled, shapes: state.combat.fog.shapes.map((shape) => ({ ...shape })) },
    // Only the revealed part: terrain under the fog would show the layout of ground players haven't seen.
    terrain: visibleTerrain(state.combat),
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
      .map((entry) => ({
        ...copyPlayerFields(entry, PENDING_REACTION_FIELDS),
        sourceName: isHiddenSource(entry.sourceActorId, publicActorIds) ? HIDDEN_SOURCE : entry.sourceName
      }))
  };
}

/** An effect as players see it: no source or cast ids or ongoing damage dice, and a hidden source masked in both
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
    ...visible
  } = effect;
  const yours = sourceActorId !== null && yourActorIds.has(sourceActorId) ? { yours: true as const } : {};
  if (!isHiddenSource(sourceActorId, publicActorIds)) return { ...visible, ...yours };
  return { ...visible, name: withoutSourceName(visible.name, effect.sourceName), sourceName: HIDDEN_SOURCE };
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
  choiceOverrides: "derived",
  hitDice: "derived",
  spellSlots: "derived",
  pactSlots: "derived",
  preparedSpellIds: "derived",
  preparation: "derived",
  inventory: "derived",
  currency: "derived",
  notes: "never",
  conditionImmunities: "never",
  legendary: "never",
  lastUsedAt: "never",
  archived: "never",
  sheetPreview: "never"
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

/** Copies the listed fields, leaving out optional ones that are unset. */
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
 * | definition (the imported sheet)         |  Y   |  -  |       -        |     Y      |          Y          |
 * | actionUses, hitDice                     |  Y   |  -  |       -        |     -      |          Y          |
 * | spellSlots, pactSlots, preparedSpellIds |  Y   |  -  |       -        |     -      |          Y          |
 * | preparation (Long Rest prepare step)    |  Y   |  -  |       -        |     -      |          Y          |
 * | inventory, currency                     |  Y   |  -  |       -        |     -      |          Y          |
 * | notes, ownerSessionId, conditionImmunities, legendary, lastUsedAt, archived, sheetPreview: never, at any tier. |
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
  now = Date.now()
): PlayerView {
  // Archived characters are hidden from players entirely, like gm-only actors.
  const publicActorIds = new Set(
    state.actors.filter((actor) => actor.visibility === "public" && !actor.archived).map((actor) => actor.id)
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
    combat: projectPlayerCombat(state, playerSessionId, now),
    // Tiers subtract fields, never entries; only gm-only visibility and archiving remove an actor.
    actors: state.actors
      .filter((actor) => actor.visibility === "public" && !actor.archived)
      .map((source) => {
        const {
          ownerSessionId,
          actionUses,
          choiceOverrides,
          hitDice,
          spellSlots,
          pactSlots,
          preparedSpellIds,
          preparation,
          inventory,
          currency,
          replaySceneId
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
        // At `off` another player's sheet is not even looked up.
        const storedSheet =
          cardVisible && source.definitionId
            ? state.definitions.find((entry) => entry.id === source.definitionId)?.definition
            : undefined;
        const classLine = theirs && cardVisible ? classLineOf(storedSheet) : null;
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
          ...(sheetVisible && storedSheet ? { definition: storedSheet } : {}),
          ...(resourcesVisible ? { actionUses: { ...actionUses } } : {}),
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
                preparation: preparation === null ? null : { ...preparation },
                inventory: inventory.map(playerInventoryRow),
                currency: { ...currency }
              }
            : {}),
          ...(sharedDisplayStyle ? { healthDisplay: { style: sharedDisplayStyle } } : {})
        };
      }),
    rolls: state.rolls.filter((roll) => visibleToPlayer(state, roll, playerSessionId)).map(playerRoll)
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
