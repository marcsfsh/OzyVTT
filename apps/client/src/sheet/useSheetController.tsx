import { useState } from "react";
import {
  rosterActors,
  type ActorDefinition,
  type ContentActionSummary,
  type GmActor,
  type PendingSave,
  type PlayerActor,
  type PlayerPendingSave,
  type PlayerView
} from "@vtt/domain";
import { useToast } from "@vtt/ui";
import { regainedText } from "../encounter/ActionResultHead";
import { HealTargetPicker, type LooseHeal } from "../encounter/HealTargetPicker";
import { summaryOfOwnAction } from "../encounter/PlayerActionRunner";
import { sameName } from "../encounter/sheet-names";
import { beginTargeting, setTargetingResult } from "../encounter/targeting";
import { command } from "../lib/command";
import { inRunningFight, type SheetActor, type SheetState } from "./sheet-model";
import { noteSheetRolls } from "./sheet-roll-ids";

/** The fight a player's own sheet acts in: passed by the table's panel, or read off the player's own view. */
export type SheetCombat = Readonly<{
  revision: number;
  active: boolean;
  myTurn: boolean;
  playerDamageMode: "proposal" | "direct";
  targets: readonly { actorId: string; name: string }[];
}>;

/** A creature this character's Hunter's Mark is on: its Perception and Survival checks to find it have Advantage. */
export type Quarry = Readonly<{ id: string; name: string }>;

type DefinitionAction = ActorDefinition["actions"][number];

/**
 * How the sheet acts for its character: where a tap on an attack, a cast or an item goes. On the player's own turn
 * (or with a readied spell) a server-resolvable action goes through targeting; outside the fight it goes to the
 * server's loose route, which rolls it and spends its charges or slot; a heal asks who it lands on first.
 */
export function useSheetController({
  actor,
  role,
  state,
  combat,
  definition,
  serverActions,
  attackMode,
  onJumpToInitiative
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  state: SheetState | undefined;
  combat: SheetCombat | undefined;
  definition: ActorDefinition | null;
  serverActions: readonly ContentActionSummary[];
  /** "jump": an attack tapped on the sheet is aimed on the table's Turn tab; "inline": on the sheet. */
  attackMode: "jump" | "inline";
  onJumpToInitiative?: () => void;
}>) {
  const { toast } = useToast();
  const liveCombat: SheetCombat | undefined =
    combat ??
    (role === "player" && state
      ? (() => {
          const view = state as PlayerView;
          return {
            revision: view.revision,
            active: view.combat.active,
            myTurn: view.combat.turnActorId === actor.id,
            playerDamageMode: view.combat.playerDamageMode,
            targets: view.combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name }))
          };
        })()
      : undefined);
  // Readied, a character acts off its turn with its Reaction (a readied spell is released by casting it).
  const readied = actor.effects.some((effect) => effect.tags.includes("readied"));
  const structuredAttacks =
    liveCombat?.active === true &&
    (liveCombat.myTurn || readied) &&
    actor.kind === "player-character" &&
    definition !== null;
  // A cast past an empty slot is stopped here only while the fight enforces spell slots; otherwise the server warns
  // or lets it through, and outside a fight it decides from the table's policy.
  const slotsPoliced =
    state?.combat.active === true && (state.combat.ruleExceptions?.slots ?? state.combat.rulesMode) === "strict";
  const inFight = state ? inRunningFight(state, actor.id) : liveCombat?.active === true;

  const sendLoose = (actionId: string, extra: Readonly<Record<string, unknown>>, failure: string) =>
    void command("action:use", { actorId: actor.id, actionId, ...extra }).then((response) => {
      noteSheetRolls(...(response.rollIds ?? []));
      if (!response.ok) toast(response.message ?? failure, { tone: "error" });
      // A heal says who regained what.
      else if (response.healing && response.healing.targets.length > 0) toast(regainedText(response.healing.targets));
    });

  // Who a heal outside a fight may land on, as the server allows: this character, then the party (for the GM, anyone
  // on the roster).
  const healCandidates = [
    { id: actor.id, name: actor.name },
    ...rosterActors<GmActor | PlayerActor>(state?.actors ?? [])
      .filter(
        (other) =>
          other.id !== actor.id &&
          !("archived" in other && other.archived) &&
          (role === "gm" || other.kind === "player-character")
      )
      .sort((left, right) => Number(right.kind === "player-character") - Number(left.kind === "player-character"))
      .map((other) => ({ id: other.id, name: other.name }))
  ];
  // Whom a spell cast outside a fight may target, as the server allows: this character, the party and the creatures
  // the player can see (for the GM, anyone on the roster).
  const castCandidates = [
    { id: actor.id, name: actor.name },
    ...rosterActors<GmActor | PlayerActor>(state?.actors ?? [])
      .filter((other) => other.id !== actor.id && !("archived" in other && other.archived))
      .sort((left, right) => Number(right.kind === "player-character") - Number(left.kind === "player-character"))
      .map((other) => ({ id: other.id, name: other.name }))
  ];
  const [looseHeal, setLooseHeal] = useState<LooseHeal | null>(null);
  /** A spell cast outside a fight at creatures it helps or makes save (Aid, Hold Person) asks whom it targets, so the
   *  server resolves it as it would in a fight. An attack or a save-less blast rolls loose as before. */
  const looseCastOf = (actionId: string, slotLevel?: number): LooseHeal | null => {
    const row = serverActions.find((candidate) => candidate.id === actionId);
    if (!row || row.healing || (row.targeting !== "single" && row.targeting !== "multi")) return null;
    if (row.attackBonus !== null || (row.saveAbility === null && row.damage.length > 0)) return null;
    return {
      actionId,
      name: row.name,
      most: row.targeting === "single" ? 1 : castCandidates.length,
      spendUpTo: null,
      purpose: "cast",
      ...(slotLevel !== undefined ? { slotLevel } : {}),
      includeDamage: true
    };
  };
  // A heal outside a fight asks who regains the hit points, unless it only heals its user (Second Wind).
  const looseHealOf = (actionId: string, slotLevel?: number, includeDamage?: boolean): LooseHeal | null => {
    const own = definition?.actions.find((candidate) => candidate.id === actionId);
    const row = serverActions.find((candidate) => candidate.id === actionId);
    if (!(own?.healing ?? row?.healing) || own?.healing?.self || (!own && row?.targeting === "none")) return null;
    const limit = row?.usesLimit ?? own?.uses?.limit ?? null;
    const spent = actor.actionUses?.[row?.usesPool ?? own?.uses?.pool ?? actionId] ?? 0;
    return {
      actionId,
      name: own?.name ?? row?.name ?? "Heal",
      most: own?.healing?.divided ? healCandidates.length : (row?.healTargets ?? 1),
      spendUpTo: (own?.useCost ?? row?.useCost) === "chosen" && limit !== null ? Math.max(1, limit - spent) : null,
      ...(slotLevel !== undefined ? { slotLevel } : {}),
      ...(includeDamage ? { includeDamage } : {})
    };
  };
  /** An action used through the server's loose route, which rolls it and spends what it costs (a heal asks who it
   *  lands on first). In a fight the server refuses it off the creature's turn and says why. */
  const sendThroughServer = (actionId: string, extra: Readonly<{ includeDamage?: boolean }> = {}) => {
    const heal = inFight ? null : looseHealOf(actionId, undefined, extra.includeDamage);
    if (heal) setLooseHeal(heal);
    else sendLoose(actionId, extra, "That could not be used.");
  };
  /** Outside the fight, an action is used through the server. */
  const looseAction = inFight ? null : sendThroughServer;
  const healDialog = looseHeal ? (
    <HealTargetPicker
      heal={looseHeal}
      candidates={looseHeal.purpose === "cast" ? castCandidates : healCandidates}
      defaultId={actor.id}
      onClose={() => setLooseHeal(null)}
      onConfirm={(targetIds, spend) => {
        setLooseHeal(null);
        sendLoose(
          looseHeal.actionId,
          {
            targetIds,
            ...(spend !== null ? { spend } : {}),
            ...(looseHeal.slotLevel !== undefined ? { slotLevel: looseHeal.slotLevel } : {}),
            ...(looseHeal.includeDamage ? { includeDamage: true } : {})
          },
          looseHeal.purpose === "cast" ? "The spell could not be cast." : "That could not be used."
        );
      }}
    />
  ) : null;

  /** Hands a stat-block action to targeting (pick target, roll, resolve), with the slot a spell is cast at. */
  const routeAttack = (action: DefinitionAction, slotLevel?: number) => {
    setTargetingResult(null);
    // Magic Missile makes one more dart for each slot level above its own; the server counts them again.
    const darts =
      action.darts !== undefined && slotLevel !== undefined && action.spellSlot
        ? action.darts + Math.max(0, slotLevel - action.spellSlot.level)
        : undefined;
    // A cast with nothing to aim at (Spirit Guardians' Emanation) picks no targets, as the server says.
    const own = summaryOfOwnAction(action);
    const aimless =
      own.targeting === undefined && serverActions.some((row) => row.id === action.id && row.targeting === "none");
    beginTargeting(aimless ? { ...own, targeting: "none" } : own, actor.id, slotLevel, darts);
    if (attackMode === "jump") onJumpToInitiative?.();
  };
  /** A server-derived action (an item's) handed to targeting by its id; the numbers are for display only. */
  const routeSummary = (row: ContentActionSummary) => {
    setTargetingResult(null);
    beginTargeting(row, actor.id);
    if (attackMode === "jump") onJumpToInitiative?.();
  };
  /** An item's own action from its detail: aimed on the character's turn, rolled by the server outside a fight. */
  const itemAction = (row: ContentActionSummary) => {
    if (structuredAttacks && role === "player") routeSummary(row);
    else sendThroughServer(row.id, row.damage.length > 0 ? { includeDamage: true } : {});
  };
  /** Why an item's action waits: off the character's turn in a fight, only a reaction can be used. */
  const itemBlocked =
    role === "player" && inFight && liveCombat?.active === true && !structuredAttacks ? "It isn't your turn." : null;
  // A smite is added to a hit in a fight, and the server refuses it alone, so a tap on it says where to find it.
  const hitExtraNote = (actionId: string | null | undefined): string | null => {
    const row = inFight && actionId ? serverActions.find((candidate) => candidate.id === actionId) : undefined;
    return row?.ridesAHit
      ? `${row.name} is added to a hit. Choose it on the attack's result, before you confirm.`
      : null;
  };
  /** The player's own server-resolvable action (an attack, a save or damage) by id or by name. */
  const structuredActionFor = (opts: { actionId?: string; name?: string }): DefinitionAction | null => {
    if (!definition) return null;
    const match =
      (opts.actionId ? definition.actions.find((candidate) => candidate.id === opts.actionId) : undefined) ??
      (opts.name ? definition.actions.find((candidate) => sameName(candidate.name, opts.name!)) : undefined);
    return match && (match.attack || match.save || match.damage.length > 0) ? match : null;
  };
  /**
   * A spell's cast through its action: on the player's turn it goes through targeting with its slot; otherwise the
   * server routes it, spending the slot and rolling its dice outside a fight, or refusing off turn.
   */
  const castSpellAction = (actionId: string, slotLevel?: number) => {
    const note = hitExtraNote(actionId);
    if (note) {
      toast(note);
      return;
    }
    const structured = structuredAttacks ? definition?.actions.find((action) => action.id === actionId) : undefined;
    if (structured) {
      routeAttack(structured, slotLevel);
      return;
    }
    const heal = inFight ? null : (looseHealOf(actionId, slotLevel, true) ?? looseCastOf(actionId, slotLevel));
    if (heal) {
      setLooseHeal(heal);
      return;
    }
    sendLoose(
      actionId,
      { includeDamage: true, ...(slotLevel !== undefined ? { slotLevel } : {}) },
      "The spell could not be cast."
    );
  };

  // The creatures this character's Hunter's Mark is on.
  const quarry: Quarry[] = (state?.actors ?? []).flatMap((other: GmActor | PlayerActor) =>
    other.id !== actor.id &&
    other.effects.some(
      (effect) =>
        effect.tags.includes("hunters-mark") &&
        (("yours" in effect && effect.yours === true) ||
          ("sourceActorId" in effect && effect.sourceActorId === actor.id))
    )
      ? [{ id: other.id, name: other.name }]
      : []
  );
  // A save the GM called for is answered on the player's call card, so the sheet does not prompt it twice.
  const calledSaveIds = new Set(
    role === "player"
      ? (state?.rollCalls ?? []).flatMap((call) =>
          call.entries.flatMap((entry) => (entry.saveId ? [entry.saveId] : []))
        )
      : []
  );
  const savesOwed: ReadonlyArray<PendingSave | PlayerPendingSave> = (state?.combat.pendingSaves ?? []).filter(
    (save) => save.targetActorId === actor.id && !calledSaveIds.has(save.id)
  );

  return {
    liveCombat,
    structuredAttacks,
    slotsPoliced,
    inFight,
    looseAction,
    sendThroughServer,
    itemAction,
    itemBlocked,
    healDialog,
    routeAttack,
    routeSummary,
    hitExtraNote,
    structuredActionFor,
    castSpellAction,
    quarry,
    savesOwed
  };
}

export type SheetController = ReturnType<typeof useSheetController>;
