import { useEffect, useState } from "react";
import type { ActorDefinition, ActorDerivedSheet, ContentActionSummary, GmActor, PlayerActor } from "@vtt/domain";
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
  requiresEffectTag?: string | null;
  multiattack?: ReadonlyArray<{ actionId: string; count: number }> | null;
  reaction?: ContentActionSummary["reaction"];
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
    requiresEffectTag: row.requiresEffectTag ?? null,
    multiattack: row.multiattack ?? null,
    grants: false,
    reaction: row.reaction ?? null
  };
}

/**
 * What the sheet draws from: the actor's stat block, the server's action list and the server's
 * derived numbers. The GM fetches bundled definitions; a player's own definition comes on the live
 * actor and wins, so identity and proficiency edits show at once.
 */
export function useSheetDefinition(
  actor: GmActor | PlayerActor,
  role: "gm" | "player",
  onFeedback: (text: string) => void
) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? (actor.definition ?? null) : null;
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
  const loadoutSignature = [
    (actor.inventory ?? [])
      .map((item) => `${item.id}:${item.equipped ? 1 : 0}${item.attuned ? 1 : 0}:${item.quantity}`)
      .join(","),
    // Exhaustion's level changes the numbers too.
    (actor.conditions ?? [])
      .map((condition) => (typeof condition === "string" ? condition : `${condition.id}${condition.level ?? ""}`))
      .join(","),
    (actor.effects ?? []).map((effect) => effect.id).join(","),
    "kind" in actor.hp
      ? actor.hp.kind === "exact"
        ? String(actor.hp.current)
        : actor.hp.kind
      : String(actor.hp.current)
  ].join("|");
  useEffect(() => {
    if (!definitionId) {
      setServerActions([]);
      setDerived(null);
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
  return { definitionId, definition, serverActions, derived, showEdited };
}
