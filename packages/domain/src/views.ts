import { z } from "zod";
import type { Actor, ActorDefinition, EffectInstance } from "@vtt/schemas";
import type {
  DamageRoll,
  Annotation,
  BuilderPolicy,
  PlayerDice,
  CheckSubject,
  CraftingProject,
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
 * mark, which only Magic Resistance reads, the amounts and immunities a spell's level or caster set, a long casting's
 * targets and slot, and what an effect gives or wards and the row it is bound to. `yours` marks one the
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
  | "grantedMove"
  | "grantedTeleport"
  | "endsWhenUnaffected"
  | "longCast"
  | "hitPointsEachTurn"
  | "conditionWards"
  | "suppressedConditions"
  | "itemId"
  | "weapon"
  | "optionId"
  | "bonusActions"
  | "grantedSpellAction"
  | "storedCast"
  | "storeAwaits"
  | "endAction"
  | "usedOnTurn"
  | "refundsUses"
  | "shrinksEachLongRest"
  | "unarmedStrike"
  | "struck"
  | "light"
  | "findDc"
  | "detects"
  | "heldBy"
  | "form"
  | "sizeChange"
  | "ownSize"
> & {
  yours?: true;
  /** What holds the creature (a Net), by name: the object any creature can attack to free it. */
  heldBy?: Readonly<{ name: string }>;
  /** The form its bearer has taken, by name alone (the effect's name says it too). */
  form?: Readonly<{ name: string }>;
};
/** A creature as one player sees it. Their own claimed character gets everything; another player's is limited by
 * `GameState.partyVisibility` (see apps/server/src/projections.ts). */
/** Actor fields every player receives for every visible actor (apps/server/src/projections.ts). */
export type PlayerActorTableField =
  "id" | "name" | "kind" | "visibility" | "size" | "sizeCells" | "tokenAssetId" | "conditions" | "deathSaves";
/** Actor fields players receive only on player characters; a monster's stats are GM knowledge. */
export type PlayerActorPartyField = "armorClass" | "armorClassOverride" | "initiative" | "speedFeet" | "definitionId";
/** What a player may order a creature their character commands to do (`summon:*`), and the action each takes. */
export type CommandedOrders = Readonly<{
  /** Commanding it takes the commander's Bonus Action or a Magic action (`summon:command`). */
  command?: "bonus-action" | "action";
  /** The commander dismisses it with this (`summon:dismiss`). */
  dismiss?: "bonus-action" | "action";
  /** The commander may look through its eyes with a Bonus Action (`summon:look`) and send it to its pocket
   *  dimension. */
  look?: true;
  /** It waits in its pocket dimension until called back with a Magic action (`summon:recall`). */
  away?: true;
}>;

export type PlayerActor = Pick<Actor, PlayerActorTableField> &
  Partial<Pick<Actor, PlayerActorPartyField>> & {
    replayEncounterId?: string;
    hp: PlayerHp;
    effects: PlayerEffect[];
    claimStatus: "available" | "mine" | "claimed";
    presence: PresenceStatus | null;
    /** A creature your own character commands (a summoned spirit, a dominated ogre): you act for it, and get its stat
     *  block (`definition`), exact `hp`, `actionUses` and `pools`. Never on another player's. */ commanded?: true;
    /** On a creature you command: the orders you may give it and what each costs your character. */ orders?: CommandedOrders;
    /** "Fighter 5 / Rogue 2", derived server-side; on another player's claimed character (the party tier decides),
     *  and on an unclaimed character for the claim picker. */ classLine?: string;
    /** "Dwarf", for the claim picker; only on an unclaimed character, which any player could claim and read in full. */ species?: string;
    /** The imported sheet. Your own claimed character always; another player's only at `partyVisibility` `full-sheet` or `sheet-and-resources`. */ definition?: ActorDefinition;
    /** Spent limited-use counts. Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ actionUses?: Record<
      string,
      number
    >;
    /** Whether the character holds Heroic Inspiration. Same gate as `actionUses`. */ heroicInspiration?: boolean;
    /** When each pool spent for a time comes back (game-clock minute). Same gate as `actionUses`. */ readyAt?: Actor["readyAt"];
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
    /** What the character ate and drank today, while the table tracks food and water. Same gate as `hitDice`. */ nourishment?: NonNullable<
      Actor["nourishment"]
    >;
    /** Sheet resources (spell slots, prepared spells, inventory, currency). Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ spellSlots?: Actor["spellSlots"];
    pactSlots?: Actor["pactSlots"];
    preparedSpellIds?: Actor["preparedSpellIds"];
    /** A Wizard's spellbook beyond its sheet. Same gate as `preparedSpellIds`. */ spellbook?: Actor["spellbook"];
    /** A Druid's known Wild Shape forms. Same gate as `preparedSpellIds`. */ knownForms?: Actor["knownForms"];
    preparation?: Actor["preparation"];
    /** The step a finished rest opened (recoveries and re-choices). Same gate as `preparation`. */ restStep?: Actor["restStep"];
    inventory?: Actor["inventory"];
    currency?: Actor["currency"];
    /** The options pinned to the sheet's turn card and how often each option resolved. Your own claimed character
     *  only, at every `partyVisibility` tier. */ favouriteOptionIds?: Actor["favouriteOptionIds"];
    optionUseCounts?: Actor["optionUseCounts"];
    /** The resolved token health indicator, present only when the table shows a bar/ring/aura to everyone (audience "all"); the client derives the fill from `hp` (exact for the owner, coarse band otherwise). */ healthDisplay?: Readonly<{
      style: "bar" | "ring" | "aura";
    }>;
    /** What this player's Hunter knows of the creature its Hunter's Mark marks (Hunter's Lore), while the mark lasts.
     *  Only in that player's own projection. */ knownDefences?: KnownDefences;
  };
/** A creature's damage Immunities, Resistances and Vulnerabilities and its condition Immunities, by id. */
export type KnownDefences = Readonly<{
  damageImmunities: readonly string[];
  damageResistances: readonly string[];
  damageVulnerabilities: readonly string[];
  conditionImmunities: readonly string[];
}>;
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
  | "successEndsSpell"
  | "dropsRowId"
  | "zoneId"
  | "magical"
  | "immuneOnSuccess"
  | "immuneMinutes"
  | "drain"
  | "failurePush"
  | "successPush"
  | "successMovesOut"
  | "failureMovesTo"
  | "unseats"
  | "advantageAtSize"
  | "disadvantageTypes"
  | "spell"
  | "confirmed"
  | "damageRollId"
  | "spendsOnKill"
  | "damageSource"
> & {
  onFailEffect?: Omit<
    NonNullable<PendingSave["onFailEffect"]>,
    "castId" | "sourceActionId" | "ongoingDamage" | "magical"
  >;
  /** Confirmed, and waiting on another creature's answer to the roll; who may answer stays unnamed. */
  awaitingAnswer?: true;
  /** Its damage waits for the caster's player to type their roll (ADR-0043); it can't be confirmed until then. */
  awaitingDamage?: true;
};
/** A player's own pending reaction prompts only, masked like saves; the parked attack stays with the GM, since it names
 *  the attacker's action and how it was rolled. `attackRoll` is the held attack's total, present only when that roll
 *  is in the player's own dice log; `lastsUntilNextTurn` says the reactor's reaction lasts (Shield). */
export type PlayerPendingReaction = Omit<
  PendingReaction,
  "sourceActorId" | "parkedAttack" | "parkedCast" | "saveId" | "asked" | "drain" | "hitKinds" | "damageSource"
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
/** A creature a player's character senses: where it stands and its creature type, or what the sense finds there (`sense`:
 *  "magic: Evocation", "a venomous beast", "a mind"); a direction-only sense names a point one cell toward it. */
export type PlayerSensedCreature = Readonly<{ x: number; y: number; creatureType: string; sense?: string }>;
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
/** A damage roll as its own player receives it: what to roll and how to enter it, and nothing of what waits on it. */
export type PlayerDamageRoll = Pick<
  DamageRoll,
  "id" | "sourceActorId" | "actionName" | "formula" | "dice" | "fixed" | "mode"
>;

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
  /** This player's own characters' damage waiting for the number their dice came to (ADR-0043). */ damageRolls?: readonly PlayerDamageRoll[];
  /** Whether the table waits for all players' initiative rolls before turns begin (see CombatState.playerInitiativeMode). */ playerInitiativeMode:
    "immediate" | "wait";
  underwater: boolean;
  reactionsUsed: readonly string[];
  /** The fog mask verbatim (geometry only; hidden things are stripped by their own filters). */ fog: CombatState["fog"];
  /** Painted ground (difficult terrain, water, ice), clipped to what the fog reveals so unrevealed ground keeps its layout. */ terrain: CombatState["terrain"];
  /** The traps the party has found: each one's name, area and whether it is still dangerous. Never a DC, a band of
   *  levels or a trap no one has found. */ traps: readonly PlayerTrap[];
  /** Dynamic vision: with it on, `tokens` holds only the creatures your characters perceive. */ vision: PlayerVision;
  pendingSaves: readonly PlayerPendingSave[];
  pendingReactions: readonly PlayerPendingReaction[];
  /** The player's own parked Ask-the-GM questions only. */ pendingRuleAsks: readonly PlayerPendingRuleAsk[];
  /** What happens at once as their own character's turn starts or ends, waiting for them to order it. */ turnSteps?: PlayerTurnSteps | null;
  /** Alert's Initiative Swap offers their own characters are in: made by them, or waiting for them to take. */ initiativeSwapOffers?: ReadonlyArray<
    Readonly<{ actorId: string; withActorId: string }>
  >;
  /** True while the GM has the table viewing an earlier turn (no labels, since those can name hidden combatants). */ rewound: boolean;
}>;
/** A trap the party has found, as players and the table screen see it. */
export type PlayerTrap = Readonly<{
  id: string;
  name: string;
  area: Readonly<{ x: number; y: number; width: number; height: number }>;
  state: "armed" | "sprung" | "disarmed";
  /** While it is armed, the ways its text gives to make it safe, by name (`trap:disarm`'s `disarmId`). */
  ways: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;
/** The steps of a turn's start or end a player orders: each named, with the creature it lands on when they see it. */
export type PlayerTurnSteps = Readonly<{
  id: string;
  actorId: string;
  boundary: "start" | "end";
  steps: ReadonlyArray<Readonly<{ key: string; name: string; targetName?: string }>>;
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
      /** The situations their own character's gear names that fit the check, to toggle on the card. */
      situations?: NonNullable<RollCall["entries"][number]["situations"]>;
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
  /** The party's Long Rest when one of their characters is in it, cut down to them: who was interrupted and waits to
   *  resume, and who of those has a Short Rest's benefits to spend Hit Point Dice in. */
  longRest: Readonly<{
    actorIds: readonly string[];
    interrupted: readonly string[];
    shortRestEarned: readonly string[];
  }> | null;
}>;
/** A party crafting project as a player sees it (their own characters' and the visible party's): what it makes, with
 *  what, and how far it has come. When it started and the scroll's numbers stay with the GM; helpers are named only
 *  among the party's visible characters. */
export type PlayerCraftingProject = Readonly<{
  id: string;
  crafterId: string;
  itemId: string;
  itemName: string;
  kind: CraftingProject["kind"];
  toolId: string;
  spellId?: string;
  helperIds: readonly string[];
  workMinutes: number;
  doneMinutes: number;
  /** What its raw materials cost, in copper: only on the player's own characters' projects. */
  paidCp?: number;
}>;
export type PlayerView = Pick<GameState, "revision"> & {
  combat: PlayerCombatView;
  actors: PlayerActor[];
  rolls: PlayerRollRecord[];
  /** The GM's builder policy, verbatim (GM-set and player-read: a player's wizard offers exactly these methods). */ builderPolicy: BuilderPolicy;
  /** How this player's dice are entered now: the live encounter's modes over the table's (ADR-0043). */ playerDice: PlayerDice;
  /** Archived characters the GM shared for preview (see PlayerArchivedCharacter). Empty by default. */ archivedCharacters: readonly PlayerArchivedCharacter[];
  /** The GM's open calls for a roll that name this player's characters (see PlayerRollCall). */ rollCalls: readonly PlayerRollCall[];
  /** The tier the server applied, so the client renders the shape it was given ("no definition" and "definition withheld" look the same otherwise). Descriptive only. */ partyVisibility: PartyVisibility;
  /** Long Rest requests and the party's Short Rest, for the player's own characters only. */ rest: PlayerRestView;
  /** The party's crafting projects: their own characters' and the visible party's. */ crafting: readonly PlayerCraftingProject[];
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
    | "override"
    | "chat";
  text: string;
  gmOnly: boolean;
  revision: number;
  /** Which character or monster this line is about; drives the feed's "just mine" filter. Absent on table-wide lines. */
  actorId?: string | null;
  /** The roll behind a `kind: "roll"` row; `initiatorSessionId` is stripped for every recipient, GM included. */
  roll?: PlayerRollRecord;
  /** True only on a `self-only` roll the recipient rolled. Computed per recipient; never stored. */
  private?: boolean;
  /** Who said a `kind: "chat"` line: the GM, or a player as the character named (ADR-0038). */
  author?: ChatAuthor;
  /** A chat line whispered between the GM and this party character. It reaches only the GM and that character's
   *  player. */
  whisper?: Readonly<{ characterId: string; name: string }>;
}>;
export type ChatAuthor = Readonly<{ name: string; role: "gm" | "player"; actorId?: string }>;
