import { useEffect, useState } from "react";
import type {
  ActorDefinition,
  ActorDerivedSheet,
  ContentActionSummary,
  GmActor,
  PlayerActor,
  Rechoice
} from "@vtt/domain";
import { read } from "../lib/command";
import { registerContentCache } from "../content/invalidate";

/** One fetch per stat block per session. Cleared on `homebrew:changed` (`content/invalidate.ts`),
    since homebrew definitions can be republished while the sheet is open. */
const sheetCache = new Map<string, ActorDefinition>();
registerContentCache(() => sheetCache.clear());

/** One row of `actor:available-actions`. The display fields are additive-optional on the wire
    (ADR-0007), so every one is read defensively. */
type AvailabilityRow = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  available: boolean;
  usesRemaining: number | null;
  builtin?: boolean;
  description?: string;
  attackBonus?: number | null;
  reachFeet?: number | null;
  rangeFeet?: number | null;
  rangeNormalFeet?: number | null;
  attackCount?: number | null;
  saveAbility?: string | null;
  saveDc?: number | null;
  damage?: ReadonlyArray<{ formula: string; type: string }>;
  usesLimit?: number | null;
  usesPer?: ContentActionSummary["usesPer"];
  usesPool?: string | null;
  useCost?: number | "chosen" | null;
  requiresEffectTag?: string | null;
  multiattack?: ReadonlyArray<{ actionId: string; count: number }> | null;
  reaction?: ContentActionSummary["reaction"];
  healing?: Readonly<{ formula: string }> | null;
  targeting?: "none" | "single" | "multi" | null;
  darts?: number | null;
  damageTypes?: ContentActionSummary["damageTypes"] | null;
}>;

/** The wire row in the shape every action surface here already speaks. */
function summaryOfAvailability(row: AvailabilityRow): ContentActionSummary {
  return {
    id: row.id,
    name: row.name,
    activation: row.activation,
    description: row.description ?? "",
    attackBonus: row.attackBonus ?? null,
    reachFeet: row.reachFeet ?? null,
    rangeFeet: row.rangeFeet ?? null,
    rangeNormalFeet: row.rangeNormalFeet ?? null,
    saveAbility: row.saveAbility ?? null,
    saveDc: row.saveDc ?? null,
    damage: row.damage ?? [],
    area: null,
    attackCount: row.attackCount ?? null,
    usesLimit: row.usesLimit ?? null,
    usesPer: row.usesPer ?? null,
    usesRecharge: null,
    usesPool: row.usesPool ?? null,
    ...(row.useCost !== undefined && row.useCost !== null ? { useCost: row.useCost } : {}),
    requiresEffectTag: row.requiresEffectTag ?? null,
    multiattack: row.multiattack ?? null,
    grants: false,
    reaction: row.reaction ?? null,
    ...(row.healing ? { healing: row.healing } : {}),
    ...(row.targeting ? { targeting: row.targeting } : {}),
    // A spell an item casts picks as the spell's own cast does (Magic Missile's darts, Chromatic Orb's type).
    ...(row.darts ? { darts: row.darts } : {}),
    ...(row.damageTypes ? { damageTypes: row.damageTypes } : {})
  };
}

/**
 * What the sheet draws from: the actor's stat block, the server's action list and the server's
 * derived numbers. The GM fetches bundled definitions; a player's own definition comes on the live
 * actor and wins, so identity and proficiency edits show at once. `liveDefinition` is the GM's copy of a
 * stored sheet from the game state, which wins over the fetch the same way, so a rebuilt sheet shows at once.
 */
export function useSheetDefinition(
  actor: GmActor | PlayerActor,
  role: "gm" | "player",
  onFeedback: (text: string) => void,
  liveDefinition?: ActorDefinition | null
) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? (actor.definition ?? liveDefinition ?? null) : (liveDefinition ?? null);
  const [fetched, setFetched] = useState<ActorDefinition | null>(
    definitionId ? (sheetCache.get(definitionId) ?? null) : null
  );
  const definition = ownDefinition ?? fetched;
  /**
   * The actor's effective action list from the server, refreshed whenever the loadout could change.
   * Role-scoped server-side (players may only ask about their own actor). The only place
   * item-derived actions exist (equipped weapons, charged items, item-cast spells), with standing
   * riders folded in. Display values: rolls send the `id` and the server recomputes.
   */
  const [serverActions, setServerActions] = useState<readonly ContentActionSummary[]>([]);
  /**
   * The sheet's numbers, from the server; chips read this instead of recomputing. Refetched on
   * effects, conditions and HP as well as inventory, since riders can depend on them.
   */
  const [derived, setDerived] = useState<ActorDerivedSheet | null>(null);
  /** The picks this character may re-make on a rest (a land after a Long Rest), from the same read. */
  const [rechoices, setRechoices] = useState<readonly Rechoice[]>([]);
  const loadoutSignature = [
    (actor.inventory ?? [])
      .map(
        (item) =>
          `${item.id}:${item.equipped ? 1 : 0}${item.attuned ? 1 : 0}:${item.quantity}:${item.baseId ?? ""}:${item.spellId ?? ""}`
      )
      .join(","),
    (actor.conditions ?? []).map((condition) => (typeof condition === "string" ? condition : condition.id)).join(","),
    (actor.effects ?? []).map((effect) => effect.id).join(","),
    "kind" in actor.hp
      ? actor.hp.kind === "exact"
        ? String(actor.hp.current)
        : actor.hp.kind
      : String(actor.hp.current),
    // A pick re-made into the ledger rebuilds the sheet: its actions and re-choices are read again.
    (ownDefinition?.character?.choices ?? []).map((row) => `${row.kind}:${row.id}`).join(",")
  ].join("|");
  useEffect(() => {
    if (!definitionId) {
      setServerActions([]);
      setDerived(null);
      setRechoices([]);
      return;
    }
    let live = true;
    void read("actor:available-actions", { actorId: actor.id }).then((result) => {
      // Failures are silent: every caller has a fallback, and the user did not ask for this lookup.
      if (!live || !result.ok) return;
      const rows: readonly AvailabilityRow[] | undefined = result.actions;
      if (rows) setServerActions(rows.filter((row) => !row.builtin).map(summaryOfAvailability));
      // Absent only from an older server; the fallback covers that.
      if (result.derived) setDerived(result.derived);
      setRechoices(result.rechoices ?? []);
    });
    return () => {
      live = false;
    };
  }, [actor.id, definitionId, loadoutSignature]);

  useEffect(() => {
    if (role !== "gm" || !definitionId || ownDefinition || sheetCache.has(definitionId)) return;
    void read("content:monster-sheet", { definitionId }).then((result) => {
      if (result.ok && result.definition) {
        sheetCache.set(definitionId, result.definition);
        setFetched(result.definition);
      } else onFeedback(result.message ?? "The stat block could not be loaded.");
    });
  }, [definitionId, role, ownDefinition, onFeedback]);

  /** Shows an edit at once: the GM renders from the cache, which nothing else refreshes after an edit. */
  const showEdited = (next: ActorDefinition) => {
    if (!definitionId) return;
    sheetCache.set(definitionId, next);
    setFetched(next);
  };
  return { definitionId, definition, serverActions, derived, rechoices, showEdited };
}
