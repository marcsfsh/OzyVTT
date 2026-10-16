import { z } from "zod";
import type { Actor, ActorDefinition, EffectInstance } from "@vtt/schemas";
import type {
  Annotation,
  BuilderPolicy,
  CombatState,
  EncounterToken,
  GameState,
  PartyVisibility,
  PendingReaction,
  PendingRuleAsk,
  PendingSave,
  PlayerRollRecord,
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
 * (viewer safety). Its ongoing damage stays with the GM, since the dice are the stat block's. `yours` marks one the
 * viewing player's own character is the source of (their grapple, their Concentration), which they may end. */
export type PlayerEffect = Omit<EffectInstance, "sourceActorId" | "sourceActionId" | "castId" | "ongoingDamage"> & {
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
    /** "Fighter 5 / Rogue 2", derived server-side; only on another player's claimed character. */ classLine?: string;
    /** The imported sheet. Your own claimed character always; another player's only at `partyVisibility` `full-sheet` or `sheet-and-resources`. */ definition?: ActorDefinition;
    /** Spent limited-use counts. Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ actionUses?: Record<
      string,
      number
    >;
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
    inventory?: Actor["inventory"];
    currency?: Actor["currency"];
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
/** A player's own pending saves only; source actor ids and effect references never cross the wire, and a hidden source's name is masked server-side. */
export type PlayerPendingSave = Omit<PendingSave, "sourceActorId" | "endsEffects" | "repeatOf" | "onFailEffect"> & {
  onFailEffect?: Omit<NonNullable<PendingSave["onFailEffect"]>, "castId" | "sourceActionId" | "ongoingDamage">;
};
/** A player's own pending reaction prompts only, masked like saves; the parked attack stays with the GM, since it names
 *  the attacker's action and how it was rolled. */
export type PlayerPendingReaction = Omit<PendingReaction, "sourceActorId" | "parkedAttack">;
/** A player's view of their own parked ask. `command` is omitted: its payload can name ids the player may not know. */
export type PlayerPendingRuleAsk = Omit<PendingRuleAsk, "command">;
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
  /** The fog mask verbatim (geometry only - hidden things are stripped by their own filters). */ fog: CombatState["fog"];
  /** Difficult terrain, clipped to what the fog reveals so unrevealed ground keeps its layout. */ terrain: CombatState["terrain"];
  pendingSaves: readonly PlayerPendingSave[];
  pendingReactions: readonly PlayerPendingReaction[];
  /** The player's own parked Ask-the-GM questions only. */ pendingRuleAsks: readonly PlayerPendingRuleAsk[];
  /** True while the GM has the table viewing an earlier turn (no labels - those can name hidden combatants). */ rewound: boolean;
}>;
/** An archived, public character the GM shared for preview: id and name only. */
export type PlayerArchivedCharacter = Readonly<{ id: string; name: string }>;
export type PlayerView = Pick<GameState, "revision"> & {
  combat: PlayerCombatView;
  actors: PlayerActor[];
  rolls: PlayerRollRecord[];
  /** The GM's builder policy, verbatim (GM-set, player-read - a player's wizard offers exactly these methods). */ builderPolicy: BuilderPolicy;
  /** Archived characters the GM shared for preview (see PlayerArchivedCharacter). Empty by default. */ archivedCharacters: readonly PlayerArchivedCharacter[];
  /** The tier the server applied, so the client renders the shape it was given ("no definition" and "definition withheld" look the same otherwise). Descriptive only. */ partyVisibility: PartyVisibility;
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
