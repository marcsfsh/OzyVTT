import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { resolveSpellcasting, type ActorDefinition, type ActorDerivedSheet, type ContentActionSummary, type ContentEquipmentSummary, type ContentSpellSummary, type GmActor, type GmView, type PlayerActor, type PlayerView } from "@vtt/domain";
import { Badge, Button, IconButton, Meter, Modal, SegmentedControl, Stepper } from "@vtt/ui";
import { abilityModifier as modifierOf, saveBonus, skillBonus, spellAttackBonus, spellSaveDc, weaponAbilityModifierFrom } from "@vtt/rules-5e";
import { useSkillCatalog } from "../content/catalogs";
import { ConditionEditor } from "./conditions";
import { DamageTypeField } from "./DamageTypeField";
import { manualDamagePayload, manualDamageType } from "./manual-damage";
import { EquipmentPicker, inventoryWeaponFrom } from "./equipment";
import { SpellCard, useSpellReference } from "./spells";
import { RichText } from "./RichText";
import { DicePanel } from "../dice/DicePanel";
import { useRollPreference } from "../dice/roll-preference";
import { PlayerActionRunner, summaryOfOwnAction } from "./EncounterPanel";
import { beginTargeting, setTargetingResult, useTargeting } from "./targeting";
import { usePrompt } from "../components/feedback";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { registerContentCache } from "../content/invalidate";

/** One fetch per stat block per session.
    NOT immutable any more: homebrew definitions can be republished while the sheet is
    open, so this is cleared on `homebrew:changed` (`content/invalidate.ts`). A stale
    entry here is already a known failure mode — see the note at the save path below. */
const sheetCache = new Map<string, ActorDefinition>();
registerContentCache(() => sheetCache.clear());

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

/** The required keys of an `ActorAction`, so a derived action can be handed to the targeting session
    carrying the SERVER's id and nothing invented. Every number on it is display; the resolver reads
    the id and computes the rest, riders included. */
const EMPTY_ACTION = {
  id: "", name: "", activation: "action" as const, description: "", damage: [] as Array<{ formula: string; type: string }>
};

/** One row of `actor:available-actions`. The display half is additive-optional on the wire
    (ADR-0007), so every field is read defensively — an older server simply yields an action
    with no numbers, which renders as a name and routes correctly anyway. */
type AvailabilityRow = Readonly<{
  id: string; name: string; activation: "action" | "bonus-action" | "reaction" | "other";
  available: boolean; usesRemaining: number | null; builtin?: boolean;
  description?: string; attackBonus?: number | null; reachFeet?: number | null; rangeFeet?: number | null;
  rangeNormalFeet?: number | null; attackCount?: number | null; saveAbility?: string | null; saveDc?: number | null;
  damage?: ReadonlyArray<{ formula: string; type: string }>; usesLimit?: number | null;
  usesPer?: ContentActionSummary["usesPer"]; usesPool?: string | null; requiresEffectTag?: string | null;
  multiattack?: ReadonlyArray<{ actionId: string; count: number }> | null;
  reaction?: Readonly<{ trigger: "hit-by-attack"; response: "half-damage" }> | null;
}>;

/** The wire row in the shape every action surface here already speaks. */
function summaryOfAvailability(row: AvailabilityRow): ContentActionSummary {
  return {
    id: row.id, name: row.name, activation: row.activation, description: row.description ?? "",
    attackBonus: row.attackBonus ?? null, reachFeet: row.reachFeet ?? null, rangeFeet: row.rangeFeet ?? null,
    rangeNormalFeet: row.rangeNormalFeet ?? null, saveAbility: row.saveAbility ?? null, saveDc: row.saveDc ?? null,
    damage: row.damage ?? [], area: null, attackCount: row.attackCount ?? null,
    usesLimit: row.usesLimit ?? null, usesPer: row.usesPer ?? null, usesRecharge: null, usesPool: row.usesPool ?? null,
    requiresEffectTag: row.requiresEffectTag ?? null, multiattack: row.multiattack ?? null,
    grants: false, reaction: row.reaction ?? null
  };
}
const d20 = (bonus: number) => bonus === 0 ? "1d20" : `1d20 ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
const titleCase = (value: string) => value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const formatChallenge = (rating: number) => rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
/** Best-effort per-browser preference storage for the sheet's roll settings (private-mode safe). */
const readSetting = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const writeSetting = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable; setting stays in-session */ } };
const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;
/** One skill row on the sheet: which ability governs its check comes from the catalog, never code. */
type SheetSkill = Readonly<{ id: string; name: string; ability: (typeof ABILITIES)[number] | null }>;

type SrdExtension = Partial<{
  challengeRating: number; type: string; alignment: string; armorDetail: string | null;
  speeds: Partial<Record<"walk" | "swim" | "fly" | "climb" | "burrow", number | null>> & { hover?: boolean };
  senses: readonly string[]; passivePerception: number | null; languages: string | null;
  savingThrows: Partial<Record<(typeof ABILITIES)[number], number | null>>;
  damageVulnerabilities: string | null; damageResistances: string | null; damageImmunities: string | null; conditionImmunities: string | null;
  traits: ReadonlyArray<{ name: string; description: string }>;
}>;

/**
 * Compact HP tracker inside the sheet; the server enforces scope (GM anyone, player self).
 *
 * **Exported for `damage-type.test.tsx`, and that export is the fix to a real hole.** D7 gave three
 * doors one payload builder and only the token menu was joined to it by a test: a hostile review on
 * 2026-08-10 replaced this component's `manualDamageType(...)` with `undefined` and the whole client
 * suite stayed green at 65 files / 917 tests. Rendering the sheet WHOLE to reach these five controls
 * would need a definition fetch, a skill catalog and a targeting context, none of which are the thing
 * under test — so the door is exported at the same grain `SavePrompt` is.
 */
export function SheetHpControls({ actorId, allowSet, onFeedback }: Readonly<{ actorId: string; allowSet: boolean; onFeedback: (text: string) => void }>) {
  const [amount, setAmount] = useState("");
  /**
   * D7's type, on the one damage door a PLAYER can also reach.
   *
   * The decision says "the GM's damage entry", and this component renders for both roles - only the
   * extra `Set` button is GM-gated. It gets the field anyway, because the server already accepts
   * `damageType` from a player scope (`actorApplyDamage` has no GM grade; `adjustableActor` restricts
   * WHICH character, not what may be said about the damage), and because the alternative is a `Dmg`
   * button that quietly means something different depending on who taps it. A player typing "12 fire"
   * on their own sheet gets their own resistance applied, which is the correct answer and the one they
   * would otherwise have to ask the GM for.
   */
  const [damageType, setDamageType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", label: string) => {
    const value = Number(amount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) { onFeedback(`Enter a whole number (${minimum}-1000).`); return; }
    setBusy(true);
    // Only Dmg carries the type; Heal, Temp and Set share the row and none of them has one.
    const typed = event === "actor:apply-damage" ? manualDamageType(damageType) : undefined;
    const payload = event === "actor:set-hp" ? { commandId: newId(), actorId, current: value }
      : event === "actor:apply-damage" ? manualDamagePayload({ commandId: newId(), actorId, amount: value, damageType: typed })
      : { commandId: newId(), actorId, amount: value };
    socket.emit(event, payload as never, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      onFeedback(result.ok ? `${label} ${typed ? `${value} ${typed}` : value}.` : result.message ?? "The hit point change was rejected.");
      if (result.ok) setAmount("");
    });
  };
  return <div className="sheet-hp-controls" role="group" aria-label="Track hit points">
    <input type="number" min="0" max="1000" placeholder="0" aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
    <Button size="sm" variant="destructive" disabled={busy} onClick={() => send("actor:apply-damage", "Damaged")}>Dmg</Button>
    <Button size="sm" disabled={busy} onClick={() => send("actor:heal", "Healed")}>Heal</Button>
    <Button size="sm" disabled={busy} onClick={() => send("actor:set-temp-hp", "Temp set to")}>Temp</Button>
    {allowSet && <Button size="sm" disabled={busy} onClick={() => send("actor:set-hp", "HP set to")}>Set</Button>}
    <DamageTypeField value={damageType} disabled={busy} onChange={setDamageType} />
  </div>;
}

/**
 * Rest controls (v5 #5): the player takes a short or long rest on their own character straight from the
 * sheet (the GM may rest anyone whose sheet they open). Short rest also exposes the Hit-Point-Dice spend
 * (each die heals its roll + Con mod); the long rest restores HP, hit dice, spell slots, prepared spells,
 * and limited uses. The server refuses either while the character is in a running encounter.
 */
function SheetRest({ actorId, hitDice, onFeedback }: Readonly<{ actorId: string; hitDice?: Readonly<{ die: string; maximum: number; remaining: number }> | null; onFeedback: (text: string) => void }>) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = hitDice ? Math.max(1, Math.min(count, Math.max(1, hitDice.remaining))) : 1;
  const rest = (kind: "short" | "long") => {
    setBusy(true);
    socket.emit("actor:rest", { commandId: newId(), actorId, kind }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      onFeedback(result.ok ? `Completed a ${kind} rest.` : result.message ?? "The rest could not be applied.");
    });
  };
  const spendDice = () => {
    setBusy(true);
    socket.emit("actor:spend-hit-dice", { commandId: newId(), actorId, count: chosen }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      onFeedback(result.ok ? `Spent ${chosen} Hit ${chosen === 1 ? "Die" : "Dice"} - the heal is in the dice log.` : result.message ?? "The Hit Dice could not be spent.");
      if (result.ok) setCount(1);
    });
  };
  return <div className="sheet-rest">
    {hitDice && (hitDice.remaining > 0
      ? <div className="sheet-rest-dice" role="group" aria-label="Spend Hit Dice">
          <span className="sheet-rest-pool" title="Hit Point Dice - spend on a short rest; each die heals its roll plus your Constitution modifier (minimum 1).">Hit Dice {hitDice.remaining}/{hitDice.maximum} ({hitDice.die})</span>
          <Stepper value={chosen} onChange={setCount} min={1} max={hitDice.remaining} disabled={busy} aria-label="Number of Hit Dice to spend" />
          <Button size="sm" disabled={busy} onClick={spendDice}>Roll &amp; heal</Button>
        </div>
      : <span className="sheet-rest-pool empty">Hit Dice 0/{hitDice.maximum} — a long rest restores them.</span>)}
    <div className="sheet-rest-buttons" role="group" aria-label="Rest">
      <Button size="sm" disabled={busy} title="Re-arms short-rest and recharge pools; heal by spending Hit Dice above." onClick={() => rest("short")}>Short rest</Button>
      <Button size="sm" disabled={busy} title="Full HP, all spell slots and Hit Dice restored, prepared spells reset, one less Exhaustion level." onClick={() => rest("long")}>Long rest</Button>
    </div>
  </div>;
}

/**
 * The damage a spell deals when cast at `level` - the ONE place both the displayed effect helper and the
 * rolled formula come from, so they can never diverge (v6 #8). Uses the SRD upcast row for that slot if
 * there is one, else the base damage. For target-scaling (N darts/rays), the roll `formula` repeats the
 * die `targetCount` times so casting rolls the FULL amount - the old code only put "×N" in the label and
 * rolled a single instance, which is why an upcast rolled the non-upcast damage.
 */
function spellEffectAt(content: ContentSpellSummary | undefined, baseLevel: number, level: number): { label: string | null; formula: string | null } {
  const upcast = level > baseLevel ? content?.castingOptions.find((option) => option.level === level) : undefined;
  const die = upcast?.damageRoll ?? content?.damageRoll ?? null;
  const targets = upcast?.targetCount ?? null;
  if (die && targets && targets > 1) return { label: `${targets}× ${die}`, formula: Array.from({ length: targets }, () => die).join(" + ") };
  if (die) return { label: die, formula: die };
  if (targets) return { label: `${targets} targets`, formula: null };
  return { label: null, formula: null };
}

/**
 * Per-spell "Cast at" control: a slot-level dropdown (each level shows remaining/total; empty levels
 * disabled) plus a Cast button. Casting spends the chosen slot and, for a damaging spell, auto-applies
 * the SRD upcast scaling for that level (referenced from the vendored spell data) - the parent owns the
 * two-step emit so this stays a small stateful shell. Only offered for leveled spells (cantrips use no
 * slot); returns null when the character has no slot at or above the spell's level.
 */
function SpellCastControls({ spell, content, slotLevels, slotMaxByLevel, liveRemaining, busy, onCastSlot, onCastCantrip }: Readonly<{
  spell: Readonly<{ id: string; name: string; level: number }>;
  content: ContentSpellSummary | undefined;
  slotLevels: readonly number[];
  slotMaxByLevel: ReadonlyMap<number, number>;
  liveRemaining: ReadonlyMap<number, number>;
  busy: boolean;
  onCastSlot: (level: number) => void;
  onCastCantrip: () => void;
}>) {
  const isCantrip = spell.level === 0;
  const options = isCantrip ? [] : slotLevels.filter((level) => level >= spell.level);
  const [castLevel, setCastLevel] = useState(options[0] ?? spell.level);
  const level = options.includes(castLevel) ? castLevel : (options[0] ?? spell.level);
  const remainingAt = (slot: number) => liveRemaining.get(slot) ?? slotMaxByLevel.get(slot) ?? 0;
  // The effect at the selected level (base or SRD-upscaled), from the same helper the Cast button rolls,
  // so the shown "N× die"/"4d6" and the rolled damage are always the same value (v6 #8). Three uniform
  // grid cells (helper · slot · Cast) that align across every row (v5 #1/#2/#9).
  const { label: effect } = spellEffectAt(content, spell.level, level);
  const canCast = isCantrip || (options.length > 0 && remainingAt(level) > 0);
  return <>
    <span className="sheet-cast-effect" aria-hidden={effect ? undefined : true} title={effect ? `Effect at ${isCantrip ? "your level" : ordinal(level)}` : undefined}>{effect ?? ""}</span>
    {isCantrip
      ? <span className="sheet-cast-slot at-will">At will</span>
      : options.length > 0
        ? <select className="sheet-cast-select" aria-label={`Cast ${spell.name} at level`} value={level} disabled={busy} onChange={(event) => setCastLevel(Number(event.target.value))}>
            {options.map((slot) => <option key={slot} value={slot} disabled={remainingAt(slot) === 0}>{ordinal(slot)} · {remainingAt(slot)}/{slotMaxByLevel.get(slot) ?? 0}{slot > spell.level ? " ↑" : ""}</option>)}
          </select>
        : <span className="sheet-cast-slot">no slots</span>}
    <button type="button" className="sheet-cast-btn" disabled={busy || !canCast} onClick={() => (isCantrip ? onCastCantrip() : onCastSlot(level))}>Cast</button>
  </>;
}

/**
 * Read/track sheet: live actor state (hp, conditions) over the immutable stat block.
 * Track, never build - no editing of scores or actions here. The GM opens any combatant;
 * a player only ever receives their own actor (and no monster definition fetch succeeds
 * for them server-side).
 */
export function CharacterSheet({ actor, role, state, standalone = false, embedded = false, combat, onJumpToInitiative, standaloneActions, onClose }: Readonly<{ actor: GmActor | PlayerActor; role: "gm" | "player"; state?: GmView | PlayerView; standalone?: boolean; embedded?: boolean; /** Combat context for the player's OWN sheet, enabling structured attacks from the Actions section on their turn. */ combat?: { revision: number; active: boolean; myTurn: boolean; playerDamageMode: "proposal" | "direct"; targets: readonly { actorId: string; name: string }[] }; /** In "jump" sheet-attack mode, called after an attack chip starts targeting so the panel hops to the initiative view. */ onJumpToInitiative?: () => void; /** Page-level doors for the STANDALONE presentation, rendered as the frame's bottom row (§7). Only the SPA's `/characters/:id` passes any: they navigate to app addresses, which `sheet.html` — a page with no router — cannot honour, so that entry passes nothing and renders no row. */ standaloneActions?: React.ReactNode; onClose: () => void }>) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? actor.definition ?? null : null;
  // The GM fetches immutable bundled definitions into `fetched`; a player's own definition rides the
  // live actor prop (`ownDefinition`) and must WIN so that identity/proficiency edits reflect at once
  // (bugfix: a useState seeded from ownDefinition went stale after an edit).
  const [fetched, setFetched] = useState<ActorDefinition | null>(definitionId ? sheetCache.get(definitionId) ?? null : null);
  const definition = ownDefinition ?? fetched;
  // On the player's own turn in an active fight, their stat-block actions that target a creature (weapon &
  // spell attacks, save/damage spells) resolve through the shared structured flow (pick target -> roll ->
  // resolve) rather than loose dice. The live combat context is the explicit `combat` prop when the sheet is
  // embedded in the initiative panel (which can also jump there and back), otherwise it's derived from the
  // player's own view `state` so this works from ANY sheet surface - the standalone tab, the roster, the map
  // - not only the panel. Player-only; the GM acts through their own runner.
  const liveCombat = combat ?? (role === "player" && state
    ? (() => { const pv = state as PlayerView; return { revision: pv.revision, active: pv.combat.active, myTurn: pv.combat.turnActorId === actor.id, playerDamageMode: pv.combat.playerDamageMode, targets: pv.combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name })) }; })()
    : undefined);
  const structuredAttacks = liveCombat?.active === true && liveCombat.myTurn === true && actor.kind === "player-character" && definition !== null;
  const [feedback, setFeedback] = useState("");
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const ack = (result: { ok: boolean; message?: string }) => { setBusy(false); if (!result.ok) setFeedback(result.message ?? "That change was rejected."); };
  const [newItem, setNewItem] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coins, setCoins] = useState({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [editMode, setEditMode] = useState<null | "prof" | "identity">(null);
  const [profDraft, setProfDraft] = useState<{ saves: string[]; skills: Record<string, "proficient" | "expertise"> }>({ saves: [], skills: {} });
  // One draft row per class the character HAS (multiclass is decision #2 of the builder packet), not
  // just the first. `id` is sticky: a row loaded from the sheet keeps its stored class id even when
  // the name is retyped, so fixing a typo edits that class instead of minting a second one; a row the
  // user adds here has no id yet and gets one slugified from its name on save. `hitDie` rides along
  // untouched (nothing on this sheet edits it) so the multiclass Hit-Dice pool survives an identity edit.
  type ClassDraft = { key: string; id: string | null; name: string; subclass: string; level: number; hitDie?: "d4" | "d6" | "d8" | "d10" | "d12" };
  const blankClassDraft = (): ClassDraft => ({ key: newId(), id: null, name: "", subclass: "", level: 1 });
  const [idDraft, setIdDraft] = useState<{ classes: ClassDraft[]; race: string; background: string }>({ classes: [], race: "", background: "" });
  const editClassDraft = (key: string, patch: Partial<ClassDraft>) => setIdDraft((draft) => ({ ...draft, classes: draft.classes.map((row) => row.key === key ? { ...row, ...patch } : row) }));
  // Roll-entry settings (feedback #8), remembered per browser: "digital" click-to-roll vs "manual" (you
  // type a physical die), and for manual d20s whether the bonus is auto-added or already in your total.
  // The one per-browser dice-input preference, shared with every other roll surface (saves, attacks, the
  // initiative runner, the dice panel) so the sheet's toggle and those surfaces always agree.
  const { rollInput, bonusMode, sheetAttackMode, rollMode, setRollInput: chooseRollInput, setBonusMode: chooseBonusMode, setSheetAttackMode: chooseSheetAttackMode } = useRollPreference();
  // Only the embedded panel can hop to the initiative view and back; every other surface renders the picker
  // inline on the sheet, so the stored jump/inline preference only applies when a jump target actually exists.
  const effectiveAttackMode = onJumpToInitiative ? sheetAttackMode : "inline";
  // The shared dice log rides behind the header's Sheet/Dice toggle — one pane at a time on every
  // viewport — so the sheet stays clean and full-width whichever way it's opened. Default to the sheet;
  // the log is one tap away (and the map right-click / "View sheet" / initiative toggle all match).
  const hasLog = state !== undefined;
  const [mobilePane, setMobilePane] = useState<"sheet" | "log">("sheet");
  // Optional dock (opt-in, desktop only): pin the dice log beside the sheet so rolls are always visible
  // while you act, instead of behind the toggle. Off by default (clean sheet); remembered per browser.
  const [docked, setDocked] = useState<boolean>(() => readSetting("vtt.sheet.docked") === "1");
  const chooseDocked = (value: boolean) => { setDocked(value); writeSetting("vtt.sheet.docked", value ? "1" : "0"); };
  // The most recent roll made from this character, surfaced inline under the rolls bar so a tap-to-roll
  // shows its result without leaving the sheet (the pinned line hides when the log is docked/visible).
  const latestRoll = state ? [...state.rolls].reverse().find((roll) => roll.actorId === actor.id) ?? null : null;
  // Popout (feedback #9.3): "modal" is the docked main panel; "floating" detaches it into a moveable,
  // resizable in-tab panel (like the GM's viewer preview) so the player can keep it open while they play.
  const [presentation, setPresentation] = useState<"modal" | "floating">("modal");
  const [rect, setRect] = useState({ x: 48, y: 48, width: 760, height: 620 });
  const [drag, setDrag] = useState<null | { mode: "move" | "resize"; grabX: number; grabY: number; start: typeof rect }>(null);
  const beginDrag = (mode: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return; // let title-bar buttons click through
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, start: rect });
  };
  const continueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.grabX, dy = event.clientY - drag.grabY;
    if (drag.mode === "move") setRect({ ...drag.start, x: Math.max(0, drag.start.x + dx), y: Math.max(0, drag.start.y + dy) });
    else setRect({ ...drag.start, width: Math.max(340, drag.start.width + dx), height: Math.max(320, drag.start.height + dy) });
  };
  const endDrag = () => setDrag(null);
  const { prompt, dialog } = usePrompt();
  // SRD spell reference (session-cached): supplies the base/upcast damage the "cast at" control auto-applies.
  const spellRef = useSpellReference();
  // The skills the sheet lists, and the ability each check uses, come from the CATALOG (session-cached
  // like the spell reference). This replaces the hardcoded 18-skill SKILL_ABILITY table, which meant a
  // homebrew skill needed a code edit to be rollable - the named anti-pattern in architecture
  // principle 3. Ordering is by name from the data; a row whose ability the bundle never set shows no
  // bonus rather than a wrong one.
  const skillCatalog = useSkillCatalog();
  const sheetSkills: readonly SheetSkill[] = [...skillCatalog.items]
    .map((skill) => ({ id: skill.id, name: skill.name, ability: (ABILITIES as readonly string[]).includes(skill.ability ?? "") ? skill.ability as SheetSkill["ability"] : null }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const [openSpell, setOpenSpell] = useState<ContentSpellSummary | null>(null);
  // Tap-to-roll: the server already lets a player roll for their own claimed actor (GM for anyone);
  // the roll lands in the shared dice history like any other roll. Attacks roll to-hit/damage as dice;
  // the GM still applies damage (players never mutate another creature's HP).
  const emitRollFormula = (formula: string, purpose: "check" | "save" | "attack" | "damage", label: string) => {
    setRolling(true);
    // Send the specific label ("Athletics check", "DEX save", "Fireball at 3rd") so the dice log can show
    // the roll's kind, not just the coarse purpose (v6 #4). Capped to the record's 80-char limit.
    socket.emit("dice:roll", { commandId: newId(), formula, purpose, visibility: "public", label: label.slice(0, 80), actorId: actor.id }, (result: { ok: boolean; message?: string }) => {
      setRolling(false);
      setFeedback(result.ok ? `Rolled ${label} (${formula}) - see the dice log.` : result.message ?? "The roll was rejected.");
    });
  };
  // Manual roll entry (feedback #8): in "manual" input mode the player types a physical die result and
  // the sheet records it as a flat roll (the dice grammar accepts constants), so it lands in the shared
  // log exactly like a rolled one. `bonusMode` decides whether a typed d20 result gets the bonus added
  // ("auto": type 15 with a +7 → sends "15 + 7") or is already the final total ("total": type 22 → "22").
  const manualValue = async (title: string, body: string, placeholder: string): Promise<number | null> => {
    const entered = await prompt({ title, body, placeholder, confirmLabel: "Record" });
    if (entered === null) return null;
    const value = Number(entered);
    if (!Number.isInteger(value) || value < -99 || value > 999) { setFeedback("Enter a whole number for the roll."); return null; }
    return value;
  };
  const combineBonus = (die: number, bonus: number) => bonus === 0 ? String(die) : `${die} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
  /** A d20 roll (check/save/attack) with a known bonus: digital rolls 1d20+bonus; manual prompts for the die/total. */
  const rollD20 = async (bonus: number, purpose: "check" | "save" | "attack", label: string) => {
    if (rollInput === "digital") { emitRollFormula(d20(bonus), purpose, label); return; }
    const value = await manualValue(`Record ${label}`,
      bonusMode === "auto" ? `Enter your d20 result - your ${signed(bonus)} bonus is added automatically.` : `Enter your final total (your ${signed(bonus)} bonus already included).`,
      bonusMode === "auto" ? "d20 result" : "final total");
    if (value === null) return;
    emitRollFormula(bonusMode === "auto" ? combineBonus(value, bonus) : String(value), purpose, `${label} (manual)`);
  };
  /** A flat roll (damage): no separate bonus, so manual mode simply records the typed total. */
  const rollFlat = async (formula: string, purpose: "damage", label: string) => {
    if (rollInput === "digital") { emitRollFormula(formula, purpose, label); return; }
    const value = await manualValue(`Record ${label}`, `Enter your rolled total for ${formula}.`, "rolled total");
    if (value === null) return;
    emitRollFormula(String(value), purpose, `${label} (manual)`);
  };
  // Hand a stat-block action off to the shared structured flow (pick target -> roll -> resolve) instead of a
  // loose die. This is the ONE place the sheet's attack chips, equipped-weapon chips, and attack/save spells
  // all route through, so every "attack from the sheet" on your turn prompts for a creature (the user's ask).
  // "jump" hops to the initiative view (and back on commit); "inline" drives the runner in the Actions section.
  const routeAttack = (action: ActorDefinition["actions"][number]) => {
    setTargetingResult(null);
    beginTargeting(summaryOfOwnAction(action), actor.id);
    if (effectiveAttackMode === "jump") onJumpToInitiative?.();
  };
  // The player's OWN action that an equipped weapon (matched by name) or a spell (matched by its linked
  // actionId) resolves as - but only when it's actually server-resolvable (has an attack, a save, or
  // damage). null falls back to the loose quick-roll.
  //
  // `definition.actions` IS NOT THE WHOLE LIST any more. The server derives an action per equipped
  // weapon, per charged item and per item-cast spell, keyed `item-<inventory id>`, and folds the
  // standing riders into its numbers - a +1 sword's to-hit is +1 higher THERE and nowhere else. Looking
  // only in the definition returned null for exactly those items, and the caller fell back to
  // `rollD20(wa.toHit)`, which recomputes a to-hit on the CLIENT from base weapon stats with no rider
  // term. The magic sword then rolled as a mundane one and nothing on screen looked wrong. That is a
  // server-authority violation by omission (CLAUDE.md rule 2), reached through a fallback that was
  // correct before items could carry riders.
  //
  // So the server's own list is consulted too (`serverActions`, below). Only its ID travels - the whole
  // resolution, including every rider, happens server-side - so the shape handed to the targeting
  // session carries the item's printed numbers for the preview line and the SERVER's action id.
  const structuredActionFor = (opts: { actionId?: string; name?: string }): ActorDefinition["actions"][number] | null => {
    if (!definition) return null;
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const match = (opts.actionId ? definition.actions.find((candidate) => candidate.id === opts.actionId) : undefined)
      ?? (opts.name ? definition.actions.find((candidate) => norm(candidate.name) === norm(opts.name!)) : undefined);
    return match && (match.attack || match.save || match.damage.length > 0) ? match : null;
  };
  /** The SERVER's own action for this weapon, if it derived one. Name-matched, because an inventory
      row and its derived action share a name and nothing else the client can see. */
  const serverActionFor = (name: string): ContentActionSummary | null => {
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const found = serverActions.find((candidate) => norm(candidate.name) === norm(name));
    // A definition action is already reachable through `structuredActionFor`; this is only for the
    // derived ones, which no other client path can find.
    return found && !definition?.actions.some((candidate) => candidate.id === found.id) ? found : null;
  };
  // In "inline" mode the picker + result render in the runner mounted in the Actions section; when an attack is
  // tapped from another part of the sheet (an equipped weapon, a spell) bring that runner into view so the
  // prompt isn't left off-screen below.
  const runnerRef = useRef<HTMLDivElement | null>(null);
  const targetingSession = useTargeting();
  useEffect(() => {
    if (effectiveAttackMode === "inline" && targetingSession?.attackerId === actor.id) runnerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [effectiveAttackMode, targetingSession?.attackerId, targetingSession?.action.id, actor.id]);

  /**
   * The actor's EFFECTIVE action list, from the server, refreshed whenever the loadout could have
   * moved. Read-only and already role-scoped (`actor:available-actions` lets the GM ask about anyone
   * and a player only about their own claimed actor), so it adds no surface.
   *
   * This list is the ONLY place an item-derived action exists: `effectiveActions` synthesises one per
   * equipped weapon, charged item and item-cast spell, and `definition.actions` - the immutable base -
   * contains none of them. An Amulet of Message's cast is not a thing the sheet can find any other
   * way. Its numbers already carry the standing riders of what is equipped and attuned, because the
   * server read them off that same effective list.
   *
   * They are DISPLAY values. Every roll below sends the `id` and lets the server recompute
   * (CLAUDE.md rule 2), so what is previewed and what is rolled are two reads of one function.
   */
  const [serverActions, setServerActions] = useState<readonly ContentActionSummary[]>([]);
  /**
   * THE SHEET'S NUMBERS, from the server. Every chip below reads this instead of recomputing.
   *
   * It has to be re-asked on more than the loadout: `deriveEquipment` reads `actor.effects`,
   * `actor.conditions` and `actor.hp` too (a "while raging" or "while bloodied" rider), so keying
   * the refetch on inventory alone would serve a stale bonus the moment a condition changed - the
   * same stale-cache trap `deriveEquipment`'s own comment refuses to fall into.
   */
  const [derived, setDerived] = useState<ActorDerivedSheet | null>(null);
  const loadoutSignature = [
    (actor.inventory ?? []).map((item) => `${item.id}:${item.equipped ? 1 : 0}${item.attuned ? 1 : 0}:${item.quantity}`).join(","),
    (actor.conditions ?? []).map((condition) => typeof condition === "string" ? condition : condition.id).join(","),
    (actor.effects ?? []).map((effect) => effect.id).join(","),
    "kind" in actor.hp ? (actor.hp.kind === "exact" ? String(actor.hp.current) : actor.hp.kind) : String(actor.hp.current)
  ].join("|");
  useEffect(() => {
    if (!definitionId) { setServerActions([]); setDerived(null); return; }
    let live = true;
    socket.emit("actor:available-actions", { actorId: actor.id }, (result: { ok: boolean; actions?: readonly AvailabilityRow[]; derived?: ActorDerivedSheet }) => {
      // A failure is silent on purpose: every caller below already has a working fallback, and an
      // error banner for a lookup the GM did not ask for would be noise.
      if (!live || !result.ok) return;
      if (result.actions) setServerActions(result.actions.filter((row) => !row.builtin).map(summaryOfAvailability));
      // Absent only when talking to an older server; the pre-answer fallback covers that.
      if (result.derived) setDerived(result.derived);
    });
    return () => { live = false; };
  }, [actor.id, definitionId, loadoutSignature]);
  const derivedAbility = (ability: (typeof ABILITIES)[number]) => derived?.abilities.find((row) => row.ability === ability) ?? null;

  useEffect(() => {
    if (role !== "gm" || !definitionId || ownDefinition || sheetCache.has(definitionId)) return;
    socket.emit("content:monster-sheet", { definitionId }, (result) => {
      if (result.ok && result.definition) { sheetCache.set(definitionId, result.definition); setFetched(result.definition); }
      else setFeedback(result.message ?? "The stat block could not be loaded.");
    });
  }, [definitionId, role, ownDefinition]);

  const extension = (definition?.extensions["open5e.srd-2024"] ?? {}) as SrdExtension;
  const hp = actor.hp;
  const exactHp = "kind" in hp ? (hp.kind === "exact" ? hp : null) : hp;
  const speeds = extension.speeds
    ? (["walk", "swim", "fly", "climb", "burrow"] as const).flatMap((mode) => { const feet = extension.speeds?.[mode]; return feet ? [`${mode === "walk" ? "" : `${mode} `}${feet} ft.${mode === "fly" && extension.speeds?.hover ? " (hover)" : ""}`] : []; }).join(", ")
    : definition ? `${definition.speedFeet} ft.` : null;

  const character = definition?.character;
  const proficiencies = definition?.proficiencies;
  const spellcasting = definition?.spellcasting;
  const inventory = actor.inventory ?? [];
  const currency = actor.currency ?? null;
  const preparedIds = new Set<string>(actor.preparedSpellIds ?? []);
  const liveSlotRemaining = new Map<number, number>((actor.spellSlots ?? []).map((slot) => [slot.level, slot.remaining]));
  const pact = actor.pactSlots ?? null;
  // Caster numbers go through `resolveSpellcasting` - THE documented resolution order (per-class
  // entry by classId, then the lone-entry shortcut, then the top-level fields). Reading
  // `spellcasting.ability` directly, as this did, showed a Paladin/Wizard ONE save DC for both
  // spell lists. One row per casting class; a single-class or legacy sheet still renders one.
  const casterEntries = spellcasting?.classes ?? [];
  const casterRows = (definition && spellcasting
    ? (casterEntries.length > 0 ? casterEntries.map((entry) => entry.classId) : [undefined])
    : []
  ).flatMap((classId) => {
    const resolved = resolveSpellcasting(spellcasting, classId);
    if (!resolved) return [];
    const dc = resolved.saveDc ?? spellSaveDc(definition!.abilityScores[resolved.ability], definition!.proficiencyBonus);
    const attack = resolved.attackBonus ?? spellAttackBonus(definition!.abilityScores[resolved.ability], definition!.proficiencyBonus);
    const name = classId ? character?.classes?.find((entry) => entry.id === classId)?.name ?? titleCase(classId) : null;
    return [{ key: classId ?? "primary", name, ability: resolved.ability, dc, attack }];
  });
  // "Cast at" support: index the SRD spell data by id, and the character's slot pools by level.
  const spellIndex = new Map(spellRef.map((entry) => [entry.id, entry]));
  const slotMaxByLevel = new Map<number, number>((spellcasting?.slots ?? []).map((slot) => [slot.level, slot.max]));
  const slotLevels = [...slotMaxByLevel.entries()].filter(([, max]) => max > 0).map(([level]) => level).sort((a, b) => a - b);
  // Cast a leveled spell at a chosen slot level: spend that slot, then (for a damaging spell) auto-roll
  // the SRD upcast scaling for that level - one composable slot-spend + one dice roll, both server-checked.
  const castSpell = (spell: Readonly<{ id: string; name: string; level: number; actionId?: string | null }>, level: number) => {
    const max = slotMaxByLevel.get(level) ?? 0;
    const rem = liveSlotRemaining.get(level) ?? max;
    if (max <= 0 || rem <= 0) { setFeedback(`No ${ordinal(level)}-level slots remain.`); return; }
    const content = spellIndex.get(spell.id);
    // Same helper the row displays, so the rolled damage equals the shown effect (v6 #8): for target
    // scaling the formula is the die repeated N times, so an upcast rolls the full upscaled amount.
    const { formula } = spellEffectAt(content, spell.level, level);
    const types = content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : "";
    setBusy(true);
    socket.emit("character:set-slot", { commandId: newId(), actorId: actor.id, level, remaining: rem - 1 }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) { setFeedback(result.message ?? "The slot could not be spent."); return; }
      // The slot is spent; on your turn a spell that targets a creature (an attack roll, a saving throw, or
      // direct damage) hands off to the structured flow to pick the target(s) and resolve, instead of a bare
      // damage roll. Only a utility spell with no combat action stays a plain note. (An upcast leveled spell
      // resolves at its base dice here - the GM can adjust the parked damage; the loose path kept full upcast.)
      const structured = structuredAttacks ? structuredActionFor({ actionId: spell.actionId ?? undefined, name: spell.name }) : null;
      if (structured) { routeAttack(structured); return; }
      // Digital rolls the (upscaled) damage; manual mode prompts for the physical total - both land in the log.
      if (formula) void rollFlat(formula, "damage", `${spell.name} at ${ordinal(level)}${types}`);
      else setFeedback(`Cast ${spell.name} at ${ordinal(level)} - spent a ${ordinal(level)}-level slot.`);
    });
  };
  // Cantrips (v5 #9) cost no slot: cast just rolls the damage die for a damaging cantrip (Toll the Dead,
  // Sacred Flame), or notes the cast for a utility cantrip. Same helper so display == rolled.
  const castCantrip = (spell: Readonly<{ id: string; name: string; level: number; actionId?: string | null }>) => {
    // A cantrip that targets a creature (attack, save, or direct damage) routes through the structured flow
    // (pick target -> roll -> resolve) on your turn; a pure-utility cantrip keeps its quick note.
    const structured = structuredAttacks ? structuredActionFor({ actionId: spell.actionId ?? undefined, name: spell.name }) : null;
    if (structured) { routeAttack(structured); return; }
    const content = spellIndex.get(spell.id);
    const { formula } = spellEffectAt(content, spell.level, spell.level);
    if (formula) void rollFlat(formula, "damage", `${spell.name}${content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : ""}`);
    else setFeedback(`Cast ${spell.name}.`);
  };
  const identity = character ? [character.classes.map((klass) => `${klass.subclass ? `${klass.subclass.name} ` : ""}${klass.name} ${klass.level}`).join(" / "), character.race?.name, character.background?.name].filter(Boolean).join(" · ") : null;
  const hasCoins = currency ? currency.cp + currency.sp + currency.ep + currency.gp + currency.pp > 0 : false;
  const attunedCount = inventory.filter((item) => item.attuned).length;
  // Equipped weapons become rollable attack actions on the sheet (v6 #5): to-hit = ability mod + PB,
  // damage = the weapon die + ability mod. Client-derived + tap-to-roll like the other sheet actions;
  // the server-authoritative attack flow is unchanged.
  //
  // The ability comes from `weaponAbilityModifierFrom`, the same function the server derives its
  // authoritative attack with, because a preview that computes its own number is a preview that can
  // disagree with the roll it is previewing. This read `rangeFeet != null ? dex : str` under a note
  // that finesse "isn't vendored in the SRD weapon table" - accurate when written, and falsified the
  // moment the `properties` column reached the inventory row. It was then wrong twice over: it
  // missed finesse (a Rapier previewed off Strength) and it called every thrown weapon ranged (a
  // Javelin previewed off Dexterity, when throwing one is a Strength attack).
  const equippedWeaponActions = (actor.kind === "player-character" && definition)
    ? inventory.filter((item) => item.equipped && item.weapon && item.quantity > 0).map((item) => {
        const weapon = item.weapon!;
        const abilityMod = weaponAbilityModifierFrom(weapon.properties ?? [], weapon.rangeFeet, modifierOf(definition.abilityScores.str), modifierOf(definition.abilityScores.dex));
        const toHit = abilityMod + definition.proficiencyBonus;
        const damageFormula = abilityMod === 0 ? weapon.damageDice : `${weapon.damageDice} ${abilityMod > 0 ? "+" : "-"} ${Math.abs(abilityMod)}`;
        // ACTIVE, not merely magical: riders apply while equipped, and while ATTUNED as well when the
        // item asks for it. An unattuned magic weapon still swings - it just swings mundane - so its
        // printed numbers are exactly right and must not be second-guessed. Same distinction the
        // server draws; drawing a different one here is how the two get to disagree.
        const active = item.magic?.isMagic === true && (item.magic.attunementRequired !== true || item.attuned === true);
        return { id: `equip-${item.id}`, name: item.name, toHit, damageFormula, damageType: weapon.damageType, rangeFeet: weapon.rangeFeet, active };
      })
    : [];
  /** Everything the loadout added that the stat block does not have — a wand's charge, an amulet's
      cast, a magic weapon's swing. An action a player cannot see is an action they cannot use. */
  const derivedActions = serverActions.filter((row) => !definition?.actions.some((candidate) => candidate.id === row.id));
  /** The derived rows that are NOT one of the equipped-weapon entries above — a wand's charge, an
      amulet's cast, an item-granted Uncanny Dodge. Matched out by name, the same key the weapon rows
      are matched on, so one action is never drawn twice. */
  const itemActions = derivedActions.filter((row) => {
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return !equippedWeaponActions.some((wa) => norm(wa.name) === norm(row.name));
  });
  // Add-from-catalog: the server upserts by id, so incrementing an existing stack means resending the
  // whole item with quantity+1 (preserving its equipped/attuned state); a new pick starts at quantity 1
  // and carries the catalog's category/weight/description so the sheet can group and describe it.
  const ownedCounts = new Map(inventory.map((item) => [item.id, item.quantity]));
  const addFromCatalog = (item: ContentEquipmentSummary) => {
    const existing = inventory.find((entry) => entry.id === item.id);
    setBusy(true);
    socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: {
      id: item.id, name: item.name, quantity: (existing?.quantity ?? 0) + 1, category: item.category,
      ...(existing ? { equipped: existing.equipped, attuned: existing.attuned } : {}),
      ...(item.weightLb != null ? { weightEach: item.weightLb } : {}),
      ...(item.description ? { description: item.description } : {}),
      // Carry the mechanical stats so equipping has effect (v6 #5): weapon → a rollable attack; armor → AC.
      // The weapon block is NARROWED, not spread: the browse summary carries a browse-only `mastery`
      // the strict wire schema refuses. See `inventoryWeaponFrom`.
      ...(item.weapon ? { weapon: inventoryWeaponFrom(item.weapon) } : {}),
      ...(item.armor ? { armor: item.armor } : {})
    } }, ack);
  };
  // Keep the coin editor in sync with the authoritative purse (re-syncs after each accepted change).
  useEffect(() => { setCoins({ cp: currency?.cp ?? 0, sp: currency?.sp ?? 0, ep: currency?.ep ?? 0, gp: currency?.gp ?? 0, pp: currency?.pp ?? 0 }); }, [currency?.cp, currency?.sp, currency?.ep, currency?.gp, currency?.pp]);
  // Light hand-edit (owner + GM, server-enforced): edit the per-PC imported definition's identity /
  // proficiency selections; guided creation stays in the future builder.
  const openProfEditor = () => { setProfDraft({ saves: proficiencies?.saves ? [...proficiencies.saves] : [], skills: Object.fromEntries((proficiencies?.skills ?? []).map((skill) => [skill.id, skill.proficiency])) }); setEditMode("prof"); };
  // Auto-save proficiency edits like the rest of the sheet (slots, Prepare, equip all emit on each tap), so
  // there's no separate Save button to forget and no draft to lose on Done (v6 #6). Also keep the GM's
  // cached definition in step: the GM renders from `fetched`/sheetCache, which nothing else refreshes after
  // an edit, so a persisted change would otherwise not show (the player path already refreshes via
  // ownDefinition). That stale cache - not the wire - was why "Save" looked like it did nothing.
  const persistProficiencies = (draft: { saves: string[]; skills: Record<string, "proficient" | "expertise"> }) => {
    const proficiencies = { saves: draft.saves as Array<"str" | "dex" | "con" | "int" | "wis" | "cha">, skills: Object.entries(draft.skills).map(([id, proficiency]) => ({ id, proficiency })) };
    if (definitionId && definition) { const next = { ...definition, proficiencies }; sheetCache.set(definitionId, next); setFetched(next); }
    setBusy(true);
    socket.emit("character:set-proficiencies", { commandId: newId(), actorId: actor.id, proficiencies }, ack);
  };
  const toggleSave = (ability: string) => { const next = { ...profDraft, saves: profDraft.saves.includes(ability) ? profDraft.saves.filter((entry) => entry !== ability) : [...profDraft.saves, ability] }; setProfDraft(next); persistProficiencies(next); };
  const cycleSkill = (id: string) => { const current = profDraft.skills[id]; const tier = current === undefined ? "proficient" : current === "proficient" ? "expertise" : undefined; const skills = { ...profDraft.skills }; if (tier) skills[id] = tier; else delete skills[id]; const next = { ...profDraft, skills }; setProfDraft(next); persistProficiencies(next); };
  const openIdEditor = () => {
    const rows = (character?.classes ?? []).map((klass, index) => ({ key: `${klass.id}-${index}`, id: klass.id, name: klass.name, subclass: klass.subclass?.name ?? "", level: klass.level, hitDie: klass.hitDie }));
    setIdDraft({ classes: rows.length > 0 ? rows : [blankClassDraft()], race: character?.race?.name ?? "", background: character?.background?.name ?? "" });
    setEditMode("identity");
  };
  const saveIdentity = () => {
    const classes = idDraft.classes.filter((row) => row.name.trim().length > 0).map((row) => ({
      id: row.id ?? slugify(row.name), name: row.name.trim(),
      ...(row.subclass.trim() ? { subclass: { id: slugify(row.subclass), name: row.subclass.trim() } } : {}),
      level: row.level,
      ...(row.hitDie ? { hitDie: row.hitDie } : {})
    // Class id is the key the server merges rows on, so two rows that resolve to the same id (an
    // added row retyped to match an existing class) must not both ship - the first one wins.
    })).filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index);
    const next = { classes, feats: character?.feats ? [...character.feats] : [], ...(idDraft.race.trim() ? { race: { id: slugify(idDraft.race), name: idDraft.race.trim() } } : {}), ...(idDraft.background.trim() ? { background: { id: slugify(idDraft.background), name: idDraft.background.trim() } } : {}) };
    // Keep the GM's cached definition in step so the edit shows immediately (v6 #6, same staleness as
    // proficiencies). Spread over the STORED identity, not a bare replacement, so the optimistic copy
    // mirrors the server's carry-forward merge (the builder's `choices` ledger stays put locally too).
    if (definitionId && definition) { const nextDef = { ...definition, character: { ...character, ...next } }; sheetCache.set(definitionId, nextDef); setFetched(nextDef); }
    setBusy(true); socket.emit("character:set-identity", { commandId: newId(), actorId: actor.id, character: next }, (result) => { ack(result); if (result.ok) setEditMode(null); }); };

  // The sheet's own scrolling content (one column of the workspace below). Identity + roll settings now
  // live in the fixed header/rollbar; only the identity EDIT FORM stays inline in the scroll.
  const sheetScroll = (<div className="sheet-scroll">
      {editMode === "identity" && <div className="sheet-editor sheet-id-editor">
          {/* Every class the character has gets its own Class/Subclass/Level trio - a multiclass sheet
              is edited whole, so saving can never delete the classes this form didn't render. The
              labels wrap in the existing flex row, so extra classes stay usable on a phone. */}
          {idDraft.classes.map((row, index) => { const n = idDraft.classes.length > 1 ? ` ${index + 1}` : ""; return <Fragment key={row.key}>
            <label>Class{n}<input type="text" value={row.name} maxLength={60} onChange={(event) => editClassDraft(row.key, { name: event.target.value })} /></label>
            <label>Subclass{n}<input type="text" value={row.subclass} maxLength={60} onChange={(event) => editClassDraft(row.key, { subclass: event.target.value })} /></label>
            <label>Level{n}<input type="number" min="1" max="20" value={row.level} onChange={(event) => editClassDraft(row.key, { level: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))) })} /></label>
          </Fragment>; })}
          {/* The schema allows up to four classes; dropping one is a respec, which the builder owns. */}
          {idDraft.classes.length < 4 && <Button size="sm" variant="ghost" onClick={() => setIdDraft((draft) => ({ ...draft, classes: [...draft.classes, blankClassDraft()] }))}>Add a class</Button>}
          <label>Race<input type="text" value={idDraft.race} maxLength={60} onChange={(event) => setIdDraft((draft) => ({ ...draft, race: event.target.value }))} /></label>
          <label>Background<input type="text" value={idDraft.background} maxLength={60} onChange={(event) => setIdDraft((draft) => ({ ...draft, background: event.target.value }))} /></label>
          <Button size="sm" disabled={busy} onClick={saveIdentity}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditMode(null)}>Cancel</Button>
        </div>}

      <div className="sheet-vitals">
        <div className="sheet-vital sheet-vital-hp">
          <div className="sheet-vital-top"><span>HP</span><strong>{exactHp ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}` : "-"}</strong></div>
          {exactHp && <Meter className="sheet-hp-meter" tone="health" value={exactHp.current} max={exactHp.maximum} />}
          <SheetHpControls actorId={actor.id} allowSet={role === "gm"} onFeedback={setFeedback} />
        </div>
        <div className="sheet-vital" title={extension.armorDetail ?? undefined}><span>AC</span><strong>{actor.armorClass ?? "-"}</strong></div>
        <div className="sheet-vital"><span>Init</span><strong>{actor.initiative !== undefined ? signed(actor.initiative) : "-"}</strong></div>
        {speeds && <div className="sheet-vital"><span>Speed</span><strong>{speeds}</strong></div>}
      </div>
      <div className="sheet-conditions">
        <span className="sheet-section-label">Conditions</span>
        <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} />
      </div>
      {actor.kind === "player-character" && <div className="sheet-rest-block">
        <span className="sheet-section-label">Rest</span>
        <SheetRest actorId={actor.id} hitDice={"hitDice" in actor ? actor.hitDice : null} onFeedback={setFeedback} />
      </div>}

      {definition && <>
        <div className="sheet-abilities">
          {ABILITIES.map((ability) => {
            const score = definition.abilityScores[ability];
            // The server's numbers when it has answered; its own arithmetic only until then. The
            // difference is item `check-bonus` riders, which the client cannot see (rule 2).
            const row = derivedAbility(ability);
            const mod = row?.check ?? modifierOf(score);
            const withProf = row?.checkWithProficiency ?? (modifierOf(score) + definition.proficiencyBonus);
            return <div key={ability} className="sheet-ability">
              <span>{ability.toUpperCase()}</span>
              <strong>{score}</strong>
              <div className="sheet-ability-rolls">
                <button type="button" disabled={rolling} title={`Roll a ${ability.toUpperCase()} check`} onClick={() => void rollD20(mod, "check", `${ability.toUpperCase()} check`)}>{signed(mod)}</button>
                <button type="button" className="prof" disabled={rolling} title={`Roll a ${ability.toUpperCase()} check WITH proficiency (for a GM-called custom/unnamed check)`} onClick={() => void rollD20(withProf, "check", `${ability.toUpperCase()} check w/ proficiency`)}>{signed(withProf)}<em>P</em></button>
              </div>
            </div>;
          })}
        </div>
        <dl className="sheet-meta">
          {extension.senses && extension.senses.length > 0 && <div><dt>Senses</dt><dd>{extension.senses.join(", ")}{extension.passivePerception ? `; passive Perception ${extension.passivePerception}` : ""}</dd></div>}
          {!extension.senses?.length && extension.passivePerception ? <div><dt>Senses</dt><dd>passive Perception {extension.passivePerception}</dd></div> : null}
          {extension.languages && <div><dt>Languages</dt><dd>{extension.languages}</dd></div>}
          {extension.damageVulnerabilities && <div><dt>Vulnerabilities</dt><dd>{extension.damageVulnerabilities}</dd></div>}
          {extension.damageResistances && <div><dt>Resistances</dt><dd>{extension.damageResistances}</dd></div>}
          {extension.damageImmunities && <div><dt>Immunities</dt><dd>{extension.damageImmunities}</dd></div>}
          {extension.conditionImmunities && <div><dt>Condition immunities</dt><dd>{extension.conditionImmunities}</dd></div>}
          <div><dt>Proficiency</dt><dd>{signed(definition.proficiencyBonus)}</dd></div>
        </dl>
        {((proficiencies && (proficiencies.saves.length > 0 || proficiencies.skills.length > 0)) || actor.kind === "player-character") && <section className="sheet-section"><h3>Proficiencies{actor.kind === "player-character" && <Button size="sm" variant="ghost" className="sheet-section-edit" onClick={() => editMode === "prof" ? setEditMode(null) : openProfEditor()}>{editMode === "prof" ? "Done" : "Edit"}</Button>}</h3>
          {editMode === "prof"
            ? <div className="sheet-editor">
                <p className="sheet-editor-hint">Changes save as you go. Tap a save to toggle it; tap a skill to cycle proficient → expertise → none. Press <strong>Done</strong> when finished.</p>
                <div className="sheet-roll-row"><span className="sheet-roll-label">Saves</span>{ABILITIES.map((ability) => <button type="button" key={ability} className={`sheet-prepare${profDraft.saves.includes(ability) ? " is-prepared" : ""}`} disabled={busy} onClick={() => toggleSave(ability)}>{ability.toUpperCase()}</button>)}</div>
                <ul className="sheet-skill-list sheet-skill-edit">{sheetSkills.map((skill) => { const tier = profDraft.skills[skill.id]; return <li key={skill.id}><span>{skill.name}</span><button type="button" className={`sheet-prepare${tier ? " is-prepared" : ""}`} disabled={busy} onClick={() => cycleSkill(skill.id)}>{tier ?? "—"}</button></li>; })}</ul>
              </div>
            : <>
                <div className="sheet-roll-row"><span className="sheet-roll-label">Saves</span>{ABILITIES.map((ability) => { const row = derivedAbility(ability); const isProf = row?.saveProficient ?? proficiencies?.saves.includes(ability) ?? false; const bonus = row?.save ?? saveBonus(definition.abilityScores[ability], definition.proficiencyBonus, isProf); const fromItems = row?.saveFromItems ?? 0; return <button type="button" key={ability} className={`sheet-roll-chip${isProf ? " is-proficient" : ""}`} disabled={rolling} title={`Roll a ${ability.toUpperCase()} saving throw${isProf ? " (proficient)" : ""}${fromItems !== 0 ? ` - includes ${signed(fromItems)} from your equipment` : ""}`} onClick={() => void rollD20(bonus, "save", `${ability.toUpperCase()} save`)}>{ability.toUpperCase()} {signed(bonus)}</button>; })}</div>
                <ul className="sheet-skill-list sheet-skill-cols">
                  {sheetSkills.map((skill) => { const row = derived?.skills.find((entry) => entry.id === skill.id) ?? null; const baseTier = proficiencies?.skills.find((entry) => entry.id === skill.id)?.proficiency; const effective = row?.tier ?? baseTier ?? "none"; const tier = effective === "none" ? undefined : effective; const sources = row?.sources ?? []; const bonus = row ? row.bonus : (skill.ability ? skillBonus(definition.abilityScores[skill.ability], definition.proficiencyBonus, baseTier ?? "none") : null); return <li key={skill.id}>
                    {bonus === null
                      ? <span className="sheet-roll-chip" title={`${skill.name} names no governing ability, so it has no rollable bonus`}>—</span>
                      : <button type="button" className="sheet-roll-chip" disabled={rolling} title={`Roll ${skill.name}`} onClick={() => void rollD20(bonus, "check", `${skill.name} check`)}>{signed(bonus)}</button>}
                    <span className={`sheet-prof-dot${tier === "expertise" ? " expertise" : tier === "proficient" ? " proficient" : ""}`} title={`${tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient"}${sources.length > 0 ? ` (${sources.join(", ")})` : ""}`} aria-label={`${tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient"}${sources.length > 0 ? ` from ${sources.join(", ")}` : ""}`}>{tier === "expertise" ? "E" : tier === "proficient" ? "P" : ""}</span>
                    <span className="sheet-skill-name">{skill.name} {skill.ability && <em>{skill.ability.toUpperCase()}</em>}</span>
                  </li>; })}
                </ul>
              </>}
        </section>}
        {spellcasting && <section className="sheet-section"><h3>Spells</h3>
          <div className="sheet-spellcast-fields">
            {casterRows.map((row) => <Fragment key={row.key}>
              <div className="sheet-spellcast-field"><span>{row.name ? `${row.name} caster` : "Caster"}</span><strong>{row.ability.toUpperCase()}</strong></div>
              <div className="sheet-spellcast-field"><span>Save DC</span><strong>{row.dc}</strong></div>
              <div className="sheet-spellcast-field"><span>Spell atk</span><strong>{signed(row.attack)}</strong></div>
            </Fragment>)}
          </div>
          {(() => {
            type Spell = (typeof spellcasting.spells)[number];
            const groups = new Map<number, Spell[]>();
            for (const spell of spellcasting.spells) { const list = groups.get(spell.level) ?? []; list.push(spell); groups.set(spell.level, list); }
            return [...groups.keys()].sort((a, b) => a - b).map((level) => {
              const spells = [...groups.get(level)!].sort((a, b) => a.name.localeCompare(b.name));
              const max = slotMaxByLevel.get(level) ?? 0;
              const remaining = liveSlotRemaining.get(level) ?? max;
              return <div key={level} className="sheet-spell-group">
                <div className="sheet-spell-group-head">
                  <h4>{level === 0 ? "Cantrips" : `${ordinal(level)} Level`}</h4>
                  {level > 0 && max > 0 && <div className="sheet-slot-pips" role="group" aria-label={`Level ${level} spell slots (${remaining} of ${max} left)`}>
                    {Array.from({ length: max }, (_, index) => <button key={index} type="button" className={`sheet-pip${index < remaining ? " filled" : ""}`} disabled={busy} aria-label={`${index < remaining ? "Spend" : "Restore"} a level ${level} slot`} onClick={() => { setBusy(true); socket.emit("character:set-slot", { commandId: newId(), actorId: actor.id, level, remaining: index < remaining ? index : index + 1 }, ack); }} />)}
                    <span className="sheet-slot-count">{remaining}/{max}</span>
                  </div>}
                </div>
                <ul className={`sheet-spell-list${actor.kind === "player-character" ? " castable" : ""}`}>
                  {spells.map((spell) => { const isPrepared = preparedIds.has(spell.id) || spell.alwaysPrepared; const toggleable = spell.level > 0 && !spell.alwaysPrepared; return <li key={spell.id}>
                    {spell.level === 0 ? <span className="sheet-prep-tag cantrip">Cantrip</span> : toggleable
                      ? <button type="button" className={`sheet-prep-tag toggle${isPrepared ? " on" : ""}`} disabled={busy} title={isPrepared ? "Prepared - tap to unprepare" : "Not prepared - tap to prepare"} onClick={() => { setBusy(true); socket.emit("character:set-prepared", { commandId: newId(), actorId: actor.id, spellId: spell.id, prepared: !isPrepared }, ack); }}>{isPrepared ? "Prepared" : "Prepare"}</button>
                      : <span className="sheet-prep-tag always" title="Always prepared — doesn't count against your prepared limit">Always</span>}
                    {spellIndex.get(spell.id)
                      ? <button type="button" className="sheet-spell-name sheet-spell-link" title={`Show the ${spell.name} rules`} onClick={() => setOpenSpell(spellIndex.get(spell.id) ?? null)}>{spell.name}</button>
                      : <span className="sheet-spell-name">{spell.name}</span>}
                    {actor.kind === "player-character" && <SpellCastControls spell={spell} content={spellIndex.get(spell.id)} slotLevels={slotLevels} slotMaxByLevel={slotMaxByLevel} liveRemaining={liveSlotRemaining} busy={busy} onCastSlot={(castLevel) => castSpell(spell, castLevel)} onCastCantrip={() => castCantrip(spell)} />}
                  </li>; })}
                </ul>
              </div>;
            });
          })()}
          {pact ? <p className="sheet-entry">Pact Magic: {ordinal(pact.level)}-level slots, {pact.remaining} remaining.</p> : null}
        </section>}
        {actor.kind === "player-character" && <section className="sheet-section"><h3>Inventory</h3>
          <form className="sheet-add-item" onSubmit={(event) => { event.preventDefault(); const name = newItem.trim(); if (!name) return; setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { id: slugify(name), name, quantity: 1 } }, ack); setNewItem(""); }}>
            <input type="text" value={newItem} maxLength={120} placeholder="Add a custom item…" aria-label="New item name" onChange={(event) => setNewItem(event.target.value)} />
            <Button type="submit" size="sm" disabled={busy || !newItem.trim()}>Add</Button>
            <Button size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>Browse SRD gear</Button>
          </form>
          {inventory.length > 0 && <div className="sheet-inv">
            <div className="sheet-inv-row sheet-inv-head" aria-hidden="true">
              <span className="sheet-item-name">Item</span>
              <span>Qty</span><span>Equip</span><span>Attune</span><span></span>
            </div>
            {inventory.map((item) => <div key={item.id} className="sheet-inv-row">
              <span className="sheet-item-name">{item.name}{item.category ? <span className="sheet-item-cat">{item.category.split("-").map(titleCase).join(" ")}</span> : null}</span>
              <Stepper className="sheet-inv-qty" value={item.quantity} min={0} disabled={busy} aria-label={`Quantity of ${item.name}`} onChange={(quantity) => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, quantity } }, ack); }} />
              <button type="button" className={`sheet-toggle-btn${item.equipped ? " on" : ""}`} disabled={busy} aria-pressed={item.equipped} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, equipped: !item.equipped } }, ack); }}>{item.equipped ? "Equipped" : "Equip"}</button>
              <button type="button" className={`sheet-toggle-btn${item.attuned ? " on" : ""}`} disabled={busy} aria-pressed={item.attuned} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, attuned: !item.attuned } }, ack); }}>{item.attuned ? "Attuned" : "Attune"}</button>
              <IconButton label={`Remove ${item.name}`} size="sm" className="sheet-remove" disabled={busy} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, quantity: 0 } }, ack); }}>✕</IconButton>
            </div>)}
          </div>}
          {attunedCount > 0 && <p className="sheet-attunement"><Badge tone={attunedCount > 3 ? "danger" : "neutral"}>Attunement {attunedCount}/3</Badge></p>}
          {pickerOpen && <EquipmentPicker ownedCounts={ownedCounts} busy={busy} onAdd={addFromCatalog} onClose={() => setPickerOpen(false)} />}
          <div className="sheet-coins">
            {COINS.map((coin) => <label key={coin}>{coin}<input type="number" min="0" max="1000000" value={coins[coin]} onChange={(event) => setCoins((prev) => ({ ...prev, [coin]: Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0))) }))} /></label>)}
            <Button size="sm" disabled={busy} onClick={() => { setBusy(true); socket.emit("character:set-currency", { commandId: newId(), actorId: actor.id, currency: coins }, ack); }}>Save coins</Button>
          </div>
        </section>}
        {extension.traits && extension.traits.length > 0 && <section className="sheet-section"><h3>Traits</h3>
          {extension.traits.map((trait) => <p key={trait.name} className="sheet-entry"><strong>{trait.name}.</strong> <RichText text={trait.description} /></p>)}
        </section>}
        {(definition.actions.length > 0 || equippedWeaponActions.length > 0 || itemActions.length > 0) && <section className="sheet-section"><h3>Actions</h3>
          {(() => {
            type ActionT = (typeof definition.actions)[number];
            const renderAction = (action: ActionT) => { const atk = action.attack; return <div key={action.id} className="sheet-entry">
              <p><strong>{action.name}.</strong> <RichText text={action.description} /></p>
              {(atk || action.damage.length > 0) && <div className="sheet-roll-row">
                {atk && <button type="button" className="sheet-roll-chip" disabled={rolling} onClick={() => { if (structuredAttacks) routeAttack(action); else void rollD20(atk.bonus, "attack", `${action.name} to hit`); }}>{signed(atk.bonus)} to hit</button>}
                {action.damage.map((part, index) => <button type="button" key={index} className="sheet-roll-chip" disabled={rolling} onClick={() => void rollFlat(part.formula, "damage", `${action.name} damage`)}>{part.formula}</button>)}
              </div>}
            </div>; };
            // Group actions (v3 #2.9.3): weapon/other first, then spell actions grouped by the linked spell's level.
            const spellLevelByActionId = new Map<string, number>((spellcasting?.spells ?? []).filter((spell) => spell.actionId).map((spell) => [spell.actionId!, spell.level]));
            const weaponActions = definition.actions.filter((action) => !spellLevelByActionId.has(action.id));
            const spellGroups = new Map<number, ActionT[]>();
            for (const action of definition.actions) { const level = spellLevelByActionId.get(action.id); if (level !== undefined) { const list = spellGroups.get(level) ?? []; list.push(action); spellGroups.set(level, list); } }
            const hasSpellActions = spellGroups.size > 0;
            // On the player's turn with the "keep picker on the sheet" preference, the interactive runner
            // (its own action list + inline target picker + result) OWNS the server-resolvable stat-block
            // actions here; the loose weapon/spell chips below are hidden so an action isn't offered twice.
            const inlineRunner = structuredAttacks && effectiveAttackMode === "inline";
            return <>
              {inlineRunner && liveCombat && <div ref={runnerRef}><PlayerActionRunner actorId={actor.id} definition={definition} extraActions={derivedActions} revision={liveCombat.revision} rollMode={rollMode} bonusMode={bonusMode} playerDamageMode={liveCombat.playerDamageMode} targets={liveCombat.targets} /></div>}
              {(equippedWeaponActions.length > 0 || (!inlineRunner && weaponActions.length > 0)) && <div className="sheet-action-group">
                {(inlineRunner ? equippedWeaponActions.length > 0 : hasSpellActions) && <h4 className="sheet-action-head">{inlineRunner ? "Equipped weapons" : "Weapon & other"}</h4>}
                {equippedWeaponActions.map((wa) => {
                  /* THE SERVER'S numbers, not ours, whenever it has them.
                     `equippedWeaponActions` recomputes a to-hit on the CLIENT from base weapon stats
                     and an ability modifier, with no rider term anywhere in it — so a +1 sword read
                     +5 and rolled +5 while the server resolved +6, and nothing on screen looked
                     wrong. The derived row carries the folded riders in both `attackBonus` and
                     `damage[]`, so displaying it fixes the number AND the roll at once. The client
                     falls back to its own arithmetic only when the server derived nothing (no
                     definition, an unresolvable id), where the printed stats are all that exists. */
                  const srv = serverActionFor(wa.name);
                  const toHit = srv?.attackBonus ?? wa.toHit;
                  const damage = srv && srv.damage.length > 0 ? srv.damage : [{ formula: wa.damageFormula, type: wa.damageType }];
                  return <div key={wa.id} className="sheet-entry">
                    <p><strong>{wa.name}.</strong> <span className="sheet-weapon-meta">Equipped weapon · {wa.damageType}{wa.rangeFeet != null ? ` · range ${wa.rangeFeet} ft` : ""}{wa.active ? " · Magic" : ""}</span></p>
                    <div className="sheet-roll-row">
                      <button type="button" className="sheet-roll-chip" disabled={rolling} onClick={() => {
                        const structured = structuredAttacks ? structuredActionFor({ name: wa.name }) : null;
                        if (structured) { routeAttack(structured); return; }
                        // Only the ID travels; the roll, every rider and the damage are resolved server-side.
                        if (srv) { routeAttack({ ...EMPTY_ACTION, id: srv.id, name: srv.name, attack: { bonus: toHit }, damage: [...damage] }); return; }
                        void rollD20(toHit, "attack", `${wa.name} to hit`);
                      }}>{signed(toHit)} to hit</button>
                      {damage.map((part, index) => <button type="button" key={index} className="sheet-roll-chip" disabled={rolling} onClick={() => void rollFlat(part.formula, "damage", `${wa.name} damage`)}>{part.formula}</button>)}
                    </div>
                  </div>;
                })}
                {!inlineRunner && weaponActions.map(renderAction)}
              </div>}
              {/* Actions an EQUIPPED ITEM added. They exist nowhere in the stat block, so without
                  this the amulet a player attuned casts nothing they can reach. The runner owns them
                  on the player's own turn (`inlineRunner`); this is every other moment. */}
              {!inlineRunner && itemActions.length > 0 && <div className="sheet-action-group">
                <h4 className="sheet-action-head">From your items</h4>
                {itemActions.map((row) => <div key={row.id} className="sheet-entry">
                  <p><strong>{row.name}.</strong> <RichText text={row.description} />
                    {row.usesLimit !== null && <span className="sheet-weapon-meta"> · {row.usesLimit} {row.usesLimit === 1 ? "charge" : "charges"}{row.usesPer ? ` per ${row.usesPer.replace(/-/g, " ")}` : ""}</span>}
                  </p>
                  {(row.attackBonus !== null || row.damage.length > 0) && <div className="sheet-roll-row">
                    {row.attackBonus !== null && <button type="button" className="sheet-roll-chip" disabled={rolling} onClick={() => { if (structuredAttacks) routeAttack({ ...EMPTY_ACTION, id: row.id, name: row.name, attack: { bonus: row.attackBonus! }, damage: [...row.damage] }); else void rollD20(row.attackBonus!, "attack", `${row.name} to hit`); }}>{signed(row.attackBonus)} to hit</button>}
                    {row.damage.map((part, index) => <button type="button" key={index} className="sheet-roll-chip" disabled={rolling} onClick={() => void rollFlat(part.formula, "damage", `${row.name} damage`)}>{part.formula}</button>)}
                  </div>}
                </div>)}
              </div>}
              {!inlineRunner && hasSpellActions && <div className="sheet-action-group">
                <h4 className="sheet-action-head">Spell actions</h4>
                {[...spellGroups.keys()].sort((left, right) => left - right).map((level) => <div key={level} className="sheet-action-subgroup">
                  <h5 className="sheet-action-subhead">{level === 0 ? "Cantrips" : `${ordinal(level)} Level`}</h5>
                  {spellGroups.get(level)!.map(renderAction)}
                </div>)}
              </div>}
            </>;
          })()}
        </section>}
        <p className="sheet-attribution">Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.</p>
      </>}
      {!definition && role === "gm" && definitionId && !feedback && <p className="sheet-status">Loading stat block…</p>}
      {actor.kind === "player-character" && !definitionId && <p className="sheet-status">No imported sheet yet - the GM can import this character's JSON sheet from the roster.</p>}
      <p className="sheet-feedback" role="status">{feedback}</p>
  </div>);

  // The prominent identity line (feedback #4): class/level/race for a PC, or the size/CR typeline for a
  // monster stat block. Sits right under the name in the header instead of reading like a footnote.
  const identityLine = identity ?? (definition
    ? `${titleCase(definition.size)} ${extension.type ?? "being"}${extension.alignment ? `, ${extension.alignment}` : ""}${extension.challengeRating !== undefined ? ` · CR ${formatChallenge(extension.challengeRating)}` : ""}`
    : `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM-only" : ""}`);

  // One header row for every presentation (feedback #2.1/2.2): name + prominent identity on the left;
  // on the right, the log-side toggle, Pop out / New tab, and the × close (rightmost). In the floating
  // panel this same row is the drag handle (buttons opt out via beginDrag's closest("button") guard).
  const header = (draggable: boolean) => (<div className={`sheet-header${draggable ? " sheet-header--drag" : ""}`} onPointerDown={draggable ? beginDrag("move") : undefined}>
    <div className="sheet-header-id">
      <strong className="sheet-name">{actor.name}</strong>
      <div className="sheet-header-sub">
        <span className="sheet-idline">{identityLine}</span>
        {actor.kind === "player-character" && definition && editMode !== "identity" && <Button size="sm" variant="ghost" className="sheet-section-edit" onClick={openIdEditor}>Edit</Button>}
      </div>
    </div>
    <div className="sheet-header-controls">
      {hasLog && <SegmentedControl className="sheet-pane-toggle" size="sm" ariaLabel="Show sheet or dice" value={mobilePane} onChange={(pane) => setMobilePane(pane as "sheet" | "log")} options={[{ value: "sheet", label: "Sheet" }, { value: "log", label: "Dice" }]} />}
      {hasLog && !embedded && <Button size="sm" variant="ghost" className="sheet-dock-btn" title={docked ? "Collapse the dice log back behind the toggle" : "Pin the dice log beside the sheet"} onClick={() => chooseDocked(!docked)}>{docked ? "Undock dice" : "Dock dice"}</Button>}
      {!standalone && !embedded && <Button size="sm" variant="ghost" className="sheet-tool" title={presentation === "floating" ? "Dock the panel back into place" : "Pop out into a moveable panel"} onClick={() => setPresentation((current) => (current === "floating" ? "modal" : "floating"))}>{presentation === "floating" ? "Dock" : "Pop out"}</Button>}
      {!standalone && !embedded && role === "player" && <Button size="sm" variant="ghost" className="sheet-tool" title="Open this sheet in its own browser tab" onClick={() => window.open(`/sheet.html?actor=${encodeURIComponent(actor.id)}`, `vtt-sheet-${actor.id}`)}>New tab</Button>}
      <IconButton label={embedded ? "Back to initiative" : "Close"} size="sm" className="sheet-close" onClick={onClose}>✕</IconButton>
    </div>
  </div>);

  // The roll-input settings (feedback #2.6): a narrow bar pinned under the header, always visible.
  const rollbar = definition ? (<div className="sheet-rollbar" role="group" aria-label="Roll entry settings">
    <span className="sheet-settings-label">Rolls</span>
    <SegmentedControl size="sm" ariaLabel="Roll input mode" value={rollInput} onChange={(mode) => chooseRollInput(mode as "digital" | "manual")} options={[{ value: "digital", label: "Digital" }, { value: "manual", label: "Manual" }]} />
    {rollInput === "manual" && <SegmentedControl size="sm" ariaLabel="Typed bonus handling" value={bonusMode} onChange={(mode) => chooseBonusMode(mode as "auto" | "total")} options={[{ value: "auto", label: "Auto-add bonus" }, { value: "total", label: "Final total" }]} />}
    {/* Only meaningful mid-fight: where an attack tapped here resolves - inline on the sheet, or over on the initiative view (which then hops back once you confirm). */}
    {liveCombat?.active === true && actor.kind === "player-character" && onJumpToInitiative && <><span className="sheet-settings-label">Attacks</span>
      <SegmentedControl size="sm" ariaLabel="Where attacks tapped on the sheet resolve" value={sheetAttackMode} onChange={(mode) => chooseSheetAttackMode(mode as "jump" | "inline")} options={[{ value: "inline", label: "On sheet" }, { value: "jump", label: "In initiative" }]} /></>}
  </div>) : null;

  // Workspace: the sheet fills the panel; when a shared dice log is available it swaps in behind the
  // Sheet/Dice toggle (one pane at a time on every viewport), so the sheet keeps its clean full width.
  // Header + rollbar stay pinned; the active pane scrolls.
  const buildWorkspace = (draggable: boolean) => (<div className={`sheet-workspace ${hasLog ? "has-log" : "no-log"} show-${mobilePane}${docked ? " docked" : ""}`}>
    {header(draggable)}
    {rollbar}
    {latestRoll && <button type="button" className="sheet-last-roll" onClick={() => setMobilePane("log")} title="Open the dice log">
      <span className="sheet-last-roll-label">{latestRoll.label ?? latestRoll.purpose}</span>
      <span className="sheet-last-roll-readout">
        <span className="sheet-last-roll-faces">{latestRoll.dice.map((die, index) => <span key={index} className={die.kept ? "sheet-last-die" : "sheet-last-die out"}>{die.face}</span>)}</span>
        <span className="sheet-last-roll-formula">{latestRoll.formula}</span>
        <span aria-hidden="true">=</span>
        <strong className="sheet-last-roll-total">{latestRoll.total}</strong>
      </span>
    </button>}
    <div className="sheet-workspace-cols">
      {/* `.scroll-y` is the declared-region marker (§7): the sheet's pane is where this surface
          scrolls, in every one of its four presentations. */}
      <div className="sheet-workspace-pane sheet-pane scroll-y">{sheetScroll}</div>
      {hasLog && state && <div className="sheet-workspace-pane log-pane scroll-y"><DicePanel role={role} state={state} mineActorId={actor.id} /></div>}
    </div>
    {openSpell && <SpellCard spell={openSpell} onClose={() => setOpenSpell(null)} />}
  </div>);

  // Embedded inline (v4 #8): fills its container (e.g. the player's initiative panel), no modal chrome;
  // the header × returns to the initiative view. The caller omits state, so there's no dice log.
  if (embedded) return <><div className="sheet-embedded">{buildWorkspace(false)}</div>{dialog}</>;

  // Its own browser tab (feedback #9.3) or the SPA's `/characters/:id` layer: fills its box, header
  // × ends the tab / returns. Page-level doors ride the frame's bottom row when the caller has any.
  if (standalone) return <><div className="sheet-standalone">
    {buildWorkspace(false)}
    {standaloneActions && <div className="sheet-standalone-actions">{standaloneActions}</div>}
  </div>{dialog}</>;

  if (presentation === "floating") {
    return <>
      <div className={`sheet-float${hasLog ? " has-log" : ""}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag} role="dialog" aria-label={`${actor.name} character sheet`}>
        {buildWorkspace(true)}
        <div className="sheet-float-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
      </div>
      {dialog}
    </>;
  }
  return <><Modal open onClose={onClose} size="lg" className={`character-sheet${hasLog ? " has-log" : ""}${docked ? " docked" : ""}`} ariaLabel={`${actor.name} character sheet`}>{buildWorkspace(false)}</Modal>{dialog}</>;
}
