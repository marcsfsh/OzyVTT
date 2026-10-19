import { useEffect, useState } from "react";
import type {
  ActorDefinition,
  ActorDerivedSheet,
  ContentActionSummary,
  GmActor,
  PlayerActor,
  Rechoice,
  SpellChoices
} from "@vtt/domain";
import { read } from "../lib/command";
import { registerContentCache } from "../content/invalidate";

/** One fetch per stat block per session. Cleared on `homebrew:changed` (`content/invalidate.ts`),
    since homebrew definitions can be republished while the sheet is open. */
const sheetCache = new Map<string, ActorDefinition>();
registerContentCache(() => sheetCache.clear());

/** One row of `actor:available-actions`. The display fields are additive-optional on the wire
    (ADR-0007), so every one is read defensively. */
export type AvailabilityRow = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  available: boolean;
  /** Why it isn't available now, rule by rule. */
  violations?: ReadonlyArray<{ rule: string; message: string }>;
  usesRemaining: number | null;
  builtin?: boolean;
  ridesAHit?: true;
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
  healTargets?: number | null;
  targeting?: "none" | "single" | "multi" | null;
  darts?: number | null;
  damageTypes?: ContentActionSummary["damageTypes"] | null;
  checkSkills?: ContentActionSummary["checkSkills"];
  /** An option, one for each target, or the carried weapon it asks for as it resolves. */
  choices?: ContentActionSummary["choices"];
  /** Why it can't be used now, in one plain sentence; present exactly when it isn't available. */
  reason?: string;
  /** A row that never goes on the turn list: a rider chosen with a roll, a rest's feature, or one the server runs. */
  passive?: "rider" | "rest" | "automatic";
  /** The Weapon Mastery property this character applies with the swing. */
  mastery?: Readonly<{ id: string; name: string }>;
}>;

/** What the server says of one row now: whether it can be used, why not, and what a weapon's swing masters. */
export type RowFacts = Readonly<{
  available: boolean;
  reason: string | null;
  passive: AvailabilityRow["passive"] | null;
  mastery: string | null;
}>;

/** The row's facts, with the first rule's message for an older server that sends no reason. */
export const factsOf = (row: AvailabilityRow): RowFacts => ({
  available: row.available,
  reason: row.available ? null : (row.reason ?? row.violations?.[0]?.message ?? null),
  passive: row.passive ?? null,
  mastery: row.mastery?.name ?? null
});

/** A spell's later action whose spell isn't up on its caster (Spiritual Weapon's attack before the cast), which
 *  isn't offered until it is. */
export const awaitsItsSpell = (row: AvailabilityRow) =>
  /^spell-.+-then-/.test(row.id) &&
  (row.violations ?? []).some((violation) => violation.rule === "feature.requires-effect");

/** The wire row in the shape every action surface here already speaks. */
export function summaryOfAvailability(row: AvailabilityRow): ContentActionSummary {
  return {
    ...(row.builtin ? { builtin: true, targeting: row.targeting ?? "none" } : {}),
    ...(row.ridesAHit ? { ridesAHit: true as const } : {}),
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
    ...(row.healTargets ? { healTargets: row.healTargets } : {}),
    ...(row.targeting ? { targeting: row.targeting } : {}),
    // A spell an item casts picks as the spell's own cast does (Magic Missile's darts, Chromatic Orb's type).
    ...(row.darts ? { darts: row.darts } : {}),
    ...(row.damageTypes ? { damageTypes: row.damageTypes } : {}),
    // Search, Study and the like pick the skill they are made with.
    ...(row.checkSkills ? { checkSkills: row.checkSkills } : {}),
    // Fire Shield's warm or chill, Bestow Curse's curse, the weapon Magic Weapon is cast on.
    ...(row.choices ? { choices: row.choices } : {})
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
  /** The server's word on each row and its generic actions (Dash, Hide), from the same read. */
  const [facts, setFacts] = useState<ReadonlyMap<string, RowFacts>>(new Map());
  const [common, setCommon] = useState<readonly ContentActionSummary[]>([]);
  /**
   * The sheet's numbers, from the server, which the chips read as they are. Refetched on
   * effects, conditions and HP as well as inventory, since riders can depend on them.
   */
  const [derived, setDerived] = useState<ActorDerivedSheet | null>(null);
  /** The picks this character may re-make on a rest (a land after a Long Rest), from the same read. */
  const [rechoices, setRechoices] = useState<readonly Rechoice[]>([]);
  /** What a prepared caster may swap in after a Long Rest, and a Wizard's spellbook, from the same read. */
  const [spellChoices, setSpellChoices] = useState<SpellChoices | null>(null);
  const loadoutSignature = [
    (actor.inventory ?? [])
      .map(
        (item) =>
          `${item.id}:${item.equipped ? 1 : 0}${item.attuned ? 1 : 0}:${item.quantity}:${item.baseId ?? ""}:${item.spellId ?? ""}`
      )
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
      : String(actor.hp.current),
    // A pick re-made into the ledger rebuilds the sheet: its actions and re-choices are read again.
    (ownDefinition?.character?.choices ?? []).map((row) => `${row.kind}:${row.id}`).join(","),
    // A spell added to a Wizard's spellbook changes what can be prepared from it.
    (actor.spellbook ?? []).map((entry) => entry.id).join(",")
  ].join("|");
  useEffect(() => {
    if (!definitionId) {
      setServerActions([]);
      setFacts(new Map());
      setCommon([]);
      setDerived(null);
      setRechoices([]);
      setSpellChoices(null);
      return;
    }
    let live = true;
    void read("actor:available-actions", { actorId: actor.id }).then((result) => {
      // Failures are silent: every caller has a fallback, and the user did not ask for this lookup.
      if (!live || !result.ok) return;
      const rows: readonly AvailabilityRow[] | undefined = result.actions;
      if (rows) {
        setServerActions(rows.filter((row) => !row.builtin).map(summaryOfAvailability));
        setFacts(new Map(rows.map((row) => [row.id, factsOf(row)])));
        setCommon(rows.filter((row) => row.builtin).map(summaryOfAvailability));
      }
      // Absent only from an older server; the fallback covers that.
      if (result.derived) setDerived(result.derived);
      setRechoices(result.rechoices ?? []);
      setSpellChoices(result.spellChoices ?? null);
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
  return { definitionId, definition, serverActions, facts, common, derived, rechoices, spellChoices, showEdited };
}
