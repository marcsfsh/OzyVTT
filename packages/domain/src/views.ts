import { z } from "zod";
import type { Actor, ActorDefinition, EffectInstance } from "@vtt/schemas";
import type {
  Annotation,
  BuilderPolicy,
  CheckSubject,
  CombatState,
  EncounterToken,
  GameState,
  PartyVisibility,
  PendingReaction,
  PendingRuleAsk,
  PendingSave,
  PlayerRollRecord,
  RollCall,
  RuleExceptions,
  RuleMode
} from "./state.js";

export type ClientRole = "player" | "gm";

/** Server-authoritative connection presence for a claimed character's owning session. Never carries a session ID, token, socket ID, or address across the wire. */
export const PresenceStatusSchema = z.enum(["online", "reconnecting", "offline"]);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

/** Coarse health signal safe for any audience; "bloodied" is the 2024 rules' at-or-below-half state. */
export type HealthBand = "healthy" | "bloodied" | "down";
/** Player characters stay exact for the whole party; monsters/NPCs reach players only as a band so the GM keeps exact numbers. */
export type PlayerHp =
  { kind: "exact"; current: number; maximum: number; temporary: number } | { kind: "band"; band: HealthBand };
/** An effect as players see it: source ids never cross the wire, and a hidden source's name is masked server-side
 * (viewer safety). Its ongoing damage stays with the GM, since the dice are the stat block's, and so does its magic
 * mark, which only Magic Resistance reads, the amounts and immunities a spell's level or caster set, and a long casting's
 * targets and slot. `yours` marks one the
 * viewing player's own character is the source of (their grapple, their Concentration), which they may end. */
export type PlayerEffect = Omit<
  EffectInstance,
  | "sourceActorId"
  | "sourceActionId"
  | "castId"
  | "ongoingDamage"
  | "spell"
  | "magical"
  | "hitPointMaximumLoss"
  | "hitPointMaximumGain"
  | "temporaryHitPointsEachTurn"
  | "conditionImmunities"
  | "endsWhenUnaffected"
  | "longCast"
  | "struck"
  | "light"
  | "findDc"
  | "detects"
> & {
  yours?: true;
};
/** A creature as one player sees it. Their own claimed character gets everything; another player's is limited by
 * `GameState.partyVisibility` (see apps/server/src/projections.ts). */
/** Actor fields every player receives for every visible actor (apps/server/src/projections.ts). */
export type PlayerActorTableField =
  "id" | "name" | "kind" | "visibility" | "size" | "sizeCells" | "tokenAssetId" | "conditions" | "deathSaves";
/** Actor fields players receive only on player characters; a monster's stats are GM knowledge. */
export type PlayerActorPartyField = "armorClass" | "armorClassOverride" | "initiative" | "speedFeet" | "definitionId";
export type PlayerActor = Pick<Actor, PlayerActorTableField> &
  Partial<Pick<Actor, PlayerActorPartyField>> & {
    replaySceneId?: string;
    hp: PlayerHp;
    effects: PlayerEffect[];
    claimStatus: "available" | "mine" | "claimed";
    presence: PresenceStatus | null;
    /** "Fighter 5 / Rogue 2", derived server-side; on another player's claimed character (the party tier decides),
     *  and on an unclaimed character for the claim picker. */ classLine?: string;
    /** "Dwarf", for the claim picker; only on an unclaimed character, which any player could claim and read in full. */ species?: string;
    /** The imported sheet. Your own claimed character always; another player's only at `partyVisibility` `full-sheet` or `sheet-and-resources`. */ definition?: ActorDefinition;
    /** Spent limited-use counts. Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ actionUses?: Record<
      string,
      number
    >;
    /** Whether the character holds Heroic Inspiration. Same gate as `actionUses`. */ heroicInspiration?: boolean;
    /** A second Heroic Inspiration your own character gained, to give to a player character who lacks one or let go.
     *  Your own claimed character only. */ heroicInspirationToGive?: boolean;
    /** The character's Experience Points, once the GM has awarded any. Same gate as `actionUses`. */ experiencePoints?: number;
    /** Picks re-made on a rest, keyed by offer key (Circle of the Land's land type). Same gate as `actionUses`. */ choiceOverrides?: Record<
      string,
      { id: string; per: "short-rest" | "long-rest" }
    >;
    /** Limits for the `actionUses` counts, same keys (`uses.pool ?? action.id`). Derived, never stored; same gate as `actionUses`. */ pools?: Array<{
      id: string;
      name: string;
      limit: number;
      per: string;
    }>;
    /** Hit Point Dice pool (per-die `entries` plus the derived total summary). Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ hitDice?: NonNullable<
      Actor["hitDice"]
    >;
    /** Sheet resources (spell slots, prepared spells, inventory, currency). Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ spellSlots?: Actor["spellSlots"];
    pactSlots?: Actor["pactSlots"];
    preparedSpellIds?: Actor["preparedSpellIds"];
    /** A Wizard's spellbook beyond its sheet. Same gate as `preparedSpellIds`. */ spellbook?: Actor["spellbook"];
    preparation?: Actor["preparation"];
    inventory?: Actor["inventory"];
    currency?: Actor["currency"];
    /** The options pinned to the sheet's turn card and how often each option resolved. Your own claimed character
     *  only, at every `partyVisibility` tier. */ favouriteOptionIds?: Actor["favouriteOptionIds"];
    optionUseCounts?: Actor["optionUseCounts"];
    /** The resolved token health indicator, present only when the table shows a bar/ring/aura to everyone (audience "all"); the client derives the fill from `hp` (exact for the owner, coarse band otherwise). */ healthDisplay?: Readonly<{
      style: "bar" | "ring" | "aura";
    }>;
  };
export type PlayerInitiativeEntry = Readonly<{
  actorId: string;
  name: string;
  score: number;
  active: boolean;
  health: HealthBand;
  /** Active condition ids + parallel display labels ("Prone", "Exhaustion 3"): public info, so players and the shared screen render the same dots from one source. */ conditionIds: readonly string[];
  conditions: readonly string[];
}>;
export type PlayerAnnotation = Omit<Annotation, "ownerSessionId"> & { mine: boolean };
/** A player's own pending saves only; source actor ids, effect references and the call a save answers never cross the
 *  wire (the call reaches the player through `rollCalls`), and a hidden source's name is masked server-side. */
export type PlayerPendingSave = Omit<
  PendingSave,
  | "sourceActorId"
  | "endsEffects"
  | "repeatOf"
  | "onFailEffect"
  | "callId"
  | "onSuccessEffect"
  | "failureNote"
  | "breaksConcentration"
  | "zoneId"
  | "magical"
  | "immuneOnSuccess"
  | "drain"
  | "failurePush"
  | "advantageAtSize"
  | "spell"
  | "confirmed"
> & {
  onFailEffect?: Omit<
    NonNullable<PendingSave["onFailEffect"]>,
    "castId" | "sourceActionId" | "ongoingDamage" | "magical"
  >;
  /** Confirmed, and waiting on another creature's answer to the roll; who may answer stays unnamed. */
  awaitingAnswer?: true;
};
/** A player's own pending reaction prompts only, masked like saves; the parked attack stays with the GM, since it names
 *  the attacker's action and how it was rolled. `attackRoll` is the held attack's total, present only when that roll
 *  is in the player's own dice log; `lastsUntilNextTurn` says the reactor's reaction lasts (Shield). */
export type PlayerPendingReaction = Omit<
  PendingReaction,
  "sourceActorId" | "parkedAttack" | "parkedCast" | "saveId" | "asked" | "drain" | "hitKinds"
> & {
  attackRoll?: number;
  lastsUntilNextTurn?: true;
};
/** A player's view of their own parked ask. `command` is omitted: its payload can name ids the player may not know. */
export type PlayerPendingRuleAsk = Omit<PendingRuleAsk, "command">;
/** A polygon in image pixels as flat pairs: `[x0, y0, x1, y1, ...]`. */
export type VisionPolygon = readonly number[];
export type VisionRect = Readonly<{ x: number; y: number; width: number; height: number }>;
/** A wall, door or window the party has seen. A door carries `open` only while one of your characters sees it, so a
 *  door opened out of sight tells you nothing. */
export type PlayerVisionWall = Readonly<{
  id: string;
  kind: "wall" | "door" | "window";
  a: Readonly<{ x: number; y: number }>;
  b: Readonly<{ x: number; y: number }>;
  open?: boolean;
}>;
/** Dynamic vision as one player gets it (ADR-0023): where their own characters see now, what the party has seen in
 *  this scene, and the walls in it. Everything else on the map is dark. `bright`, when present, is the part of what
 *  they see that lies in Bright Light; the rest of it is dim, or dark seen by Darkvision. Absent, all of it is bright. */
/** A creature one of the player's characters senses without seeing it (Divine Sense): where it stands and its
 *  creature type, nothing else. */
export type PlayerSensedCreature = Readonly<{ x: number; y: number; creatureType: string }>;
export type PlayerVision =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      visible: readonly VisionPolygon[];
      bright?: readonly VisionPolygon[];
      explored: readonly VisionRect[];
      walls: readonly PlayerVisionWall[];
      /** Only in a player's own projection, never the table's. */
      sensed?: readonly PlayerSensedCreature[];
    }>;
export type PlayerCombatView = Readonly<{
  active: boolean;
  round: number;
  turnActorId: string | null;
  mapAssetId: string | null;
  hiddenTurn: boolean;
  initiative: readonly PlayerInitiativeEntry[];
  tokens: readonly EncounterToken[];
  annotations: readonly PlayerAnnotation[];
  turn: {
    actionUsed: boolean;
    bonusActionUsed: boolean;
    actionInstance: { actorId: string; components: Record<string, number> } | null;
    bonusActionInstance: { actorId: string; components: Record<string, number> } | null;
    turnUses: Record<string, number>;
    movementUsedFeet: number;
    /** The creature has an action beyond its one ready (Action Surge, Haste). */
    extraActionReady?: true;
    /** The dying character whose turn it is has made this turn's death save. */
    deathSaveRolled?: true;
  };
  rulesMode: RuleMode;
  /** Per-family overrides of `rulesMode`; no secrets, and the player's sheet needs it to anticipate blocks. */ ruleExceptions: RuleExceptions;
  /** Lets the player runner label a hit "handed to the GM" or "applied"; the proposals themselves stay GM-only. */ playerDamageMode:
    "proposal" | "direct";
  /** Claimed-PC actorIds still owing an initiative roll; a player looks for their own id. */ pendingInitiative: readonly string[];
  /** Whether the table waits for all players' initiative rolls before turns begin (see CombatState.playerInitiativeMode). */ playerInitiativeMode:
    "immediate" | "wait";
  underwater: boolean;
  reactionsUsed: readonly string[];
  /** The fog mask verbatim (geometry only; hidden things are stripped by their own filters). */ fog: CombatState["fog"];
  /** Difficult terrain, clipped to what the fog reveals so unrevealed ground keeps its layout. */ terrain: CombatState["terrain"];
  /** Dynamic vision: with it on, `tokens` holds only the creatures your characters perceive. */ vision: PlayerVision;
  pendingSaves: readonly PlayerPendingSave[];
  pendingReactions: readonly PlayerPendingReaction[];
  /** The player's own parked Ask-the-GM questions only. */ pendingRuleAsks: readonly PlayerPendingRuleAsk[];
  /** True while the GM has the table viewing an earlier turn (no labels, since those can name hidden combatants). */ rewound: boolean;
}>;
/** An archived, public character the GM shared for preview: id and name only. */
export type PlayerArchivedCharacter = Readonly<{ id: string; name: string }>;
/** One of the GM's calls for a roll as a player who must answer it sees it: only their own characters' entries, and a
 *  blind call carries neither its DC nor its results. */
export type PlayerRollCall = Readonly<{
  id: string;
  kind: RollCall["kind"];
  subject: CheckSubject;
  dc: number | null;
  blind: boolean;
  entries: ReadonlyArray<
    Readonly<{
      actorId: string;
      saveId?: string;
      answered: boolean;
      result?: NonNullable<RollCall["entries"][number]["result"]>;
    }>
  >;
  createdAt: number;
}>;
/** The player's own characters' part of resting: which of them asked for a Long Rest, and the party's Short Rest when
 *  one of them is in it, cut down to them. The game clock stays with the GM; a refused rest explains the wait. */
export type PlayerRestView = Readonly<{
  requests: readonly string[];
  shortRest: Readonly<{ actorIds: readonly string[]; done: readonly string[] }> | null;
}>;
export type PlayerView = Pick<GameState, "revision"> & {
  combat: PlayerCombatView;
  actors: PlayerActor[];
  rolls: PlayerRollRecord[];
  /** The GM's builder policy, verbatim (GM-set and player-read: a player's wizard offers exactly these methods). */ builderPolicy: BuilderPolicy;
  /** Archived characters the GM shared for preview (see PlayerArchivedCharacter). Empty by default. */ archivedCharacters: readonly PlayerArchivedCharacter[];
  /** The GM's open calls for a roll that name this player's characters (see PlayerRollCall). */ rollCalls: readonly PlayerRollCall[];
  /** The tier the server applied, so the client renders the shape it was given ("no definition" and "definition withheld" look the same otherwise). Descriptive only. */ partyVisibility: PartyVisibility;
  /** Long Rest requests and the party's Short Rest, for the player's own characters only. */ rest: PlayerRestView;
};
export type GmActor = Actor & { presence: PresenceStatus | null };
/** One recorded turn boundary on the time-travel timeline. GM-only (labels can name hidden combatants); the server attaches the list to GM views at emission. */
export type TurnHistoryEntry = Readonly<{
  index: number;
  kind: "turn" | "return";
  label: string;
  revision: number;
  at: string;
}>;
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[]; turnHistory?: readonly TurnHistoryEntry[] };
/** One line of the table feed. Players get only gmOnly=false entries; a `self-only` roll reaches the roller and
 * the GM. `kind: "roll"` rows share `RollRecord.id` with `GameState.rolls`, so dedupe on it. */
export type CombatLogEntry = Readonly<{
  id: number;
  at: string;
  kind:
    | "damage"
    | "heal"
    | "save"
    | "action"
    | "condition"
    | "reaction"
    | "turn"
    | "encounter"
    | "scene"
    | "history"
    | "roll"
    | "movement"
    | "effect"
    | "death-save"
    | "override";
  text: string;
  gmOnly: boolean;
  revision: number;
  /** Which character or monster this line is about; drives the feed's "just mine" filter. Absent on table-wide lines. */
  actorId?: string | null;
  /** The roll behind a `kind: "roll"` row; `initiatorSessionId` is stripped for every recipient, GM included. */
  roll?: PlayerRollRecord;
  /** True only on a `self-only` roll the recipient rolled. Computed per recipient; never stored. */
  private?: boolean;
}>;
