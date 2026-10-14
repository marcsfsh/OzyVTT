import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  resolveSpellcasting,
  type ActorDefinition,
  type ActorDerivedSheet,
  type ContentActionSummary,
  type ContentEquipmentSummary,
  type ContentSpellSummary,
  type GmActor,
  type GmView,
  type PlayerActor,
  type PlayerView
} from "@vtt/domain";
import { Badge, Button, IconButton, Meter, Modal, SegmentedControl, Stepper } from "@vtt/ui";
import {
  abilityModifier as modifierOf,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDc,
  weaponAbilityModifierFrom
} from "@vtt/rules-5e";
import { useSkillCatalog } from "../content/catalogs";
import { ConditionEditor } from "./conditions";
import { DamageTypeField } from "./DamageTypeField";
import { manualDamagePayload, manualDamageType } from "./manual-damage";
import { BindItemModal, EquipmentPicker, inventoryWeaponFrom, useEquipmentReference } from "./equipment";
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

/** One fetch per stat block per session. Cleared on `homebrew:changed` (`content/invalidate.ts`),
    since homebrew definitions can be republished while the sheet is open. */
const sheetCache = new Map<string, ActorDefinition>();
registerContentCache(() => sheetCache.clear());

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

/** The required keys of an `ActorAction`, so a derived action can be handed to targeting with the
    server's id and nothing invented. The numbers are display only; the resolver reads the id. */
const EMPTY_ACTION = {
  id: "",
  name: "",
  activation: "action" as const,
  description: "",
  damage: [] as Array<{ formula: string; type: string }>
};

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
  reaction?: Readonly<{ trigger: "hit-by-attack"; response: "half-damage" }> | null;
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
const d20 = (bonus: number) => (bonus === 0 ? "1d20" : `1d20 ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`);
const titleCase = (value: string) => (value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value);
const formatChallenge = (rating: number) =>
  rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
/** Per-browser storage for the sheet's roll settings (private-mode safe). */
const readSetting = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSetting = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; setting stays in-session */
  }
};
const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;
/** One skill row: the ability governing its check comes from the catalog. */
type SheetSkill = Readonly<{ id: string; name: string; ability: (typeof ABILITIES)[number] | null }>;

type SrdExtension = Partial<{
  challengeRating: number;
  type: string;
  alignment: string;
  armorDetail: string | null;
  speeds: Partial<Record<"walk" | "swim" | "fly" | "climb" | "burrow", number | null>> & { hover?: boolean };
  senses: readonly string[];
  passivePerception: number | null;
  languages: string | null;
  savingThrows: Partial<Record<(typeof ABILITIES)[number], number | null>>;
  damageVulnerabilities: string | null;
  damageResistances: string | null;
  damageImmunities: string | null;
  conditionImmunities: string | null;
  traits: ReadonlyArray<{ name: string; description: string }>;
}>;

/**
 * Compact HP tracker inside the sheet; the server enforces scope (GM anyone, player self).
 * Exported so `damage-type.test.tsx` can test the damage-type payload without rendering the whole
 * sheet.
 */
export function SheetHpControls({
  actorId,
  allowSet,
  onFeedback
}: Readonly<{ actorId: string; allowSet: boolean; onFeedback: (text: string) => void }>) {
  const [amount, setAmount] = useState("");
  /**
   * The damage type is offered to players too (only `Set` is GM-gated): the server accepts
   * `damageType` from a player on their own character, and "12 fire" on your own sheet should apply
   * your own resistance.
   */
  const [damageType, setDamageType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", label: string) => {
    const value = Number(amount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) {
      onFeedback(`Enter a whole number (${minimum}-1000).`);
      return;
    }
    setBusy(true);
    // Only Dmg carries a type; Heal, Temp and Set share the row and have none.
    const typed = event === "actor:apply-damage" ? manualDamageType(damageType) : undefined;
    const payload =
      event === "actor:set-hp"
        ? { commandId: newId(), actorId, current: value }
        : event === "actor:apply-damage"
          ? manualDamagePayload({ commandId: newId(), actorId, amount: value, damageType: typed })
          : { commandId: newId(), actorId, amount: value };
    socket.emit(event, payload as never, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? `${label} ${typed ? `${value} ${typed}` : value}.`
          : (result.message ?? "The hit point change was rejected.")
      );
      if (result.ok) setAmount("");
    });
  };
  return (
    <div className="sheet-hp-controls" role="group" aria-label="Track hit points">
      <input
        type="number"
        min="0"
        max="1000"
        placeholder="0"
        aria-label="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => send("actor:apply-damage", "Damaged")}>
        Dmg
      </Button>
      <Button size="sm" disabled={busy} onClick={() => send("actor:heal", "Healed")}>
        Heal
      </Button>
      <Button size="sm" disabled={busy} onClick={() => send("actor:set-temp-hp", "Temp set to")}>
        Temp
      </Button>
      {allowSet && (
        <Button size="sm" disabled={busy} onClick={() => send("actor:set-hp", "HP set to")}>
          Set
        </Button>
      )}
      <DamageTypeField value={damageType} disabled={busy} onChange={setDamageType} />
    </div>
  );
}

/**
 * Short and long rest on this character (players on their own, the GM on anyone). A short rest can
 * spend Hit Dice (each heals its roll + Con mod); a long rest restores HP, hit dice, slots, prepared
 * spells and limited uses. The server refuses either during a running encounter.
 */
function SheetRest({
  actorId,
  hitDice,
  onFeedback
}: Readonly<{
  actorId: string;
  hitDice?: Readonly<{ die: string; maximum: number; remaining: number }> | null;
  onFeedback: (text: string) => void;
}>) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = hitDice ? Math.max(1, Math.min(count, Math.max(1, hitDice.remaining))) : 1;
  const rest = (kind: "short" | "long") => {
    setBusy(true);
    socket.emit("actor:rest", { commandId: newId(), actorId, kind }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      onFeedback(result.ok ? `Completed a ${kind} rest.` : (result.message ?? "The rest could not be applied."));
    });
  };
  const spendDice = () => {
    setBusy(true);
    socket.emit(
      "actor:spend-hit-dice",
      { commandId: newId(), actorId, count: chosen },
      (result: { ok: boolean; message?: string }) => {
        setBusy(false);
        onFeedback(
          result.ok
            ? `Spent ${chosen} Hit ${chosen === 1 ? "Die" : "Dice"} - the heal is in the dice log.`
            : (result.message ?? "The Hit Dice could not be spent.")
        );
        if (result.ok) setCount(1);
      }
    );
  };
  return (
    <div className="sheet-rest">
      {hitDice &&
        (hitDice.remaining > 0 ? (
          <div className="sheet-rest-dice" role="group" aria-label="Spend Hit Dice">
            <span
              className="sheet-rest-pool"
              title="Hit Point Dice - spend on a short rest; each die heals its roll plus your Constitution modifier (minimum 1)."
            >
              Hit Dice {hitDice.remaining}/{hitDice.maximum} ({hitDice.die})
            </span>
            <Stepper
              value={chosen}
              onChange={setCount}
              min={1}
              max={hitDice.remaining}
              disabled={busy}
              aria-label="Number of Hit Dice to spend"
            />
            <Button size="sm" disabled={busy} onClick={spendDice}>
              Roll &amp; heal
            </Button>
          </div>
        ) : (
          <span className="sheet-rest-pool empty">Hit Dice 0/{hitDice.maximum} — a long rest restores them.</span>
        ))}
      <div className="sheet-rest-buttons" role="group" aria-label="Rest">
        <Button
          size="sm"
          disabled={busy}
          title="Re-arms short-rest and recharge pools; heal by spending Hit Dice above."
          onClick={() => rest("short")}
        >
          Short rest
        </Button>
        <Button
          size="sm"
          disabled={busy}
          title="Full HP, all spell slots and Hit Dice restored, prepared spells reset, one less Exhaustion level."
          onClick={() => rest("long")}
        >
          Long rest
        </Button>
      </div>
    </div>
  );
}

/**
 * The damage a spell deals when cast at `level`: the single source for both the displayed effect
 * and the rolled formula. Uses the SRD upcast row for that slot if any, else the base damage. For
 * target scaling (N darts/rays) the formula repeats the die `targetCount` times so the full amount
 * is rolled.
 */
function spellEffectAt(
  content: ContentSpellSummary | undefined,
  baseLevel: number,
  level: number
): { label: string | null; formula: string | null } {
  const upcast = level > baseLevel ? content?.castingOptions.find((option) => option.level === level) : undefined;
  const die = upcast?.damageRoll ?? content?.damageRoll ?? null;
  const targets = upcast?.targetCount ?? null;
  if (die && targets && targets > 1)
    return { label: `${targets}× ${die}`, formula: Array.from({ length: targets }, () => die).join(" + ") };
  if (die) return { label: die, formula: die };
  if (targets) return { label: `${targets} targets`, formula: null };
  return { label: null, formula: null };
}

/**
 * Per-spell "Cast at" control: a slot-level dropdown (remaining/total per level; empty levels
 * disabled) and a Cast button. The parent owns the slot-spend and roll emits. Leveled spells only;
 * returns null when no slot at or above the spell's level exists.
 */
function SpellCastControls({
  spell,
  content,
  slotLevels,
  slotMaxByLevel,
  liveRemaining,
  busy,
  onCastSlot,
  onCastCantrip
}: Readonly<{
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
  // The effect at the selected level, from the same helper the Cast button rolls. Three grid cells
  // (helper · slot · Cast) that align across rows.
  const { label: effect } = spellEffectAt(content, spell.level, level);
  const canCast = isCantrip || (options.length > 0 && remainingAt(level) > 0);
  return (
    <>
      <span
        className="sheet-cast-effect"
        aria-hidden={effect ? undefined : true}
        title={effect ? `Effect at ${isCantrip ? "your level" : ordinal(level)}` : undefined}
      >
        {effect ?? ""}
      </span>
      {isCantrip ? (
        <span className="sheet-cast-slot at-will">At will</span>
      ) : options.length > 0 ? (
        <select
          className="sheet-cast-select"
          aria-label={`Cast ${spell.name} at level`}
          value={level}
          disabled={busy}
          onChange={(event) => setCastLevel(Number(event.target.value))}
        >
          {options.map((slot) => (
            <option key={slot} value={slot} disabled={remainingAt(slot) === 0}>
              {ordinal(slot)} · {remainingAt(slot)}/{slotMaxByLevel.get(slot) ?? 0}
              {slot > spell.level ? " ↑" : ""}
            </option>
          ))}
        </select>
      ) : (
        <span className="sheet-cast-slot">no slots</span>
      )}
      <button
        type="button"
        className="sheet-cast-btn"
        disabled={busy || !canCast}
        onClick={() => (isCantrip ? onCastCantrip() : onCastSlot(level))}
      >
        Cast
      </button>
    </>
  );
}

/**
 * Read/track sheet: live actor state (hp, conditions) over the immutable stat block; no editing of
 * scores or actions. The GM opens any combatant; a player only ever receives their own actor.
 */
export function CharacterSheet({
  actor,
  role,
  state,
  standalone = false,
  embedded = false,
  combat,
  onJumpToInitiative,
  standaloneActions,
  onClose
}: Readonly<{
  actor: GmActor | PlayerActor;
  role: "gm" | "player";
  state?: GmView | PlayerView;
  standalone?: boolean;
  embedded?: boolean;
  /** Combat context for the player's OWN sheet, enabling structured attacks from the Actions section on their turn. */ combat?: {
    revision: number;
    active: boolean;
    myTurn: boolean;
    playerDamageMode: "proposal" | "direct";
    targets: readonly { actorId: string; name: string }[];
  };
  /** In "jump" sheet-attack mode, called after an attack chip starts targeting so the panel hops to the initiative view. */ onJumpToInitiative?: () => void;
  /** Page-level doors for the standalone presentation, shown as the frame's bottom row. Only the SPA's `/characters/:id` passes any; `sheet.html` has no router. */ standaloneActions?: React.ReactNode;
  onClose: () => void;
}>) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? (actor.definition ?? null) : null;
  // The GM fetches bundled definitions into `fetched`; a player's own definition comes on the live
  // actor (`ownDefinition`) and must win, so identity/proficiency edits show at once.
  const [fetched, setFetched] = useState<ActorDefinition | null>(
    definitionId ? (sheetCache.get(definitionId) ?? null) : null
  );
  const definition = ownDefinition ?? fetched;
  // On the player's own turn, targeted stat-block actions resolve through the shared structured flow
  // (pick target -> roll -> resolve). Combat context is the `combat` prop when embedded in the
  // initiative panel, else derived from the player's `state`, so it works from any sheet surface.
  // Player-only; the GM uses their own runner.
  const liveCombat =
    combat ??
    (role === "player" && state
      ? (() => {
          const pv = state as PlayerView;
          return {
            revision: pv.revision,
            active: pv.combat.active,
            myTurn: pv.combat.turnActorId === actor.id,
            playerDamageMode: pv.combat.playerDamageMode,
            targets: pv.combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name }))
          };
        })()
      : undefined);
  const structuredAttacks =
    liveCombat?.active === true &&
    liveCombat.myTurn === true &&
    actor.kind === "player-character" &&
    definition !== null;
  const [feedback, setFeedback] = useState("");
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const ack = (result: { ok: boolean; message?: string }) => {
    setBusy(false);
    if (!result.ok) setFeedback(result.message ?? "That change was rejected.");
  };
  const [newItem, setNewItem] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which unbound template row (a magic weapon/armor with no base picked) has its chooser open, and
  // the catalog its detail resolves against.
  const [bindingRowId, setBindingRowId] = useState<string | null>(null);
  const { catalog: equipmentCatalog } = useEquipmentReference();
  const [coins, setCoins] = useState({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [editMode, setEditMode] = useState<null | "prof" | "identity">(null);
  const [profDraft, setProfDraft] = useState<{ saves: string[]; skills: Record<string, "proficient" | "expertise"> }>({
    saves: [],
    skills: {}
  });
  // One draft row per class the character has. `id` is sticky: retyping a loaded row's name edits
  // that class rather than minting another; a new row gets an id slugified from its name on save.
  // `hitDie` is carried untouched so the multiclass Hit Dice pool survives an identity edit.
  type ClassDraft = {
    key: string;
    id: string | null;
    name: string;
    subclass: string;
    level: number;
    hitDie?: "d4" | "d6" | "d8" | "d10" | "d12";
  };
  const blankClassDraft = (): ClassDraft => ({ key: newId(), id: null, name: "", subclass: "", level: 1 });
  const [idDraft, setIdDraft] = useState<{ classes: ClassDraft[]; race: string; background: string }>({
    classes: [],
    race: "",
    background: ""
  });
  const editClassDraft = (key: string, patch: Partial<ClassDraft>) =>
    setIdDraft((draft) => ({
      ...draft,
      classes: draft.classes.map((row) => (row.key === key ? { ...row, ...patch } : row))
    }));
  // The shared per-browser dice-input preference: digital vs manual entry, and whether a typed d20
  // gets its bonus added.
  const {
    rollInput,
    bonusMode,
    sheetAttackMode,
    rollMode,
    setRollInput: chooseRollInput,
    setBonusMode: chooseBonusMode,
    setSheetAttackMode: chooseSheetAttackMode
  } = useRollPreference();
  // Only the embedded panel can jump to the initiative view and back, so elsewhere the picker is
  // always inline.
  const effectiveAttackMode = onJumpToInitiative ? sheetAttackMode : "inline";
  // The dice log sits behind the header's Sheet/Dice toggle, one pane at a time. Defaults to the sheet.
  const hasLog = state !== undefined;
  const [mobilePane, setMobilePane] = useState<"sheet" | "log">("sheet");
  // Optional desktop dock: pin the dice log beside the sheet. Off by default; remembered per browser.
  const [docked, setDocked] = useState<boolean>(() => readSetting("vtt.sheet.docked") === "1");
  const chooseDocked = (value: boolean) => {
    setDocked(value);
    writeSetting("vtt.sheet.docked", value ? "1" : "0");
  };
  // The latest roll from this character, shown under the rolls bar (hidden when the log is visible).
  const latestRoll = state ? ([...state.rolls].reverse().find((roll) => roll.actorId === actor.id) ?? null) : null;
  // "modal" is the docked main panel; "floating" detaches it into a movable, resizable in-tab panel.
  const [presentation, setPresentation] = useState<"modal" | "floating">("modal");
  const [rect, setRect] = useState({ x: 48, y: 48, width: 760, height: 620 });
  const [drag, setDrag] = useState<null | {
    mode: "move" | "resize";
    grabX: number;
    grabY: number;
    start: typeof rect;
  }>(null);
  const beginDrag = (mode: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return; // let title-bar buttons click through
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, start: rect });
  };
  const continueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.grabX,
      dy = event.clientY - drag.grabY;
    if (drag.mode === "move")
      setRect({ ...drag.start, x: Math.max(0, drag.start.x + dx), y: Math.max(0, drag.start.y + dy) });
    else
      setRect({
        ...drag.start,
        width: Math.max(340, drag.start.width + dx),
        height: Math.max(320, drag.start.height + dy)
      });
  };
  const endDrag = () => setDrag(null);
  const { prompt, dialog } = usePrompt();
  // SRD spell reference (session-cached): base and upcast damage for the "Cast at" control.
  const spellRef = useSpellReference();
  // Skills and the ability each check uses come from the catalog, ordered by name. A row whose
  // ability the bundle never set shows no bonus rather than a wrong one.
  const skillCatalog = useSkillCatalog();
  const sheetSkills: readonly SheetSkill[] = [...skillCatalog.items]
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      ability: (ABILITIES as readonly string[]).includes(skill.ability ?? "")
        ? (skill.ability as SheetSkill["ability"])
        : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const [openSpell, setOpenSpell] = useState<ContentSpellSummary | null>(null);
  // Tap-to-roll into the shared dice history; the server allows a player to roll for their own
  // claimed actor. Players never apply damage to another creature; the GM does.
  const emitRollFormula = (formula: string, purpose: "check" | "save" | "attack" | "damage", label: string) => {
    setRolling(true);
    // The specific label ("Athletics check", "Fireball at 3rd") lets the log show the roll's kind.
    // Capped to the record's 80-char limit.
    socket.emit(
      "dice:roll",
      { commandId: newId(), formula, purpose, visibility: "public", label: label.slice(0, 80), actorId: actor.id },
      (result: { ok: boolean; message?: string }) => {
        setRolling(false);
        setFeedback(
          result.ok ? `Rolled ${label} (${formula}) - see the dice log.` : (result.message ?? "The roll was rejected.")
        );
      }
    );
  };
  // Manual entry: the typed die result is recorded as a flat roll (constants are valid dice), so it
  // lands in the log like any roll. `bonusMode` "auto" adds the bonus ("15 + 7"); "total" sends it as is.
  const manualValue = async (title: string, body: string, placeholder: string): Promise<number | null> => {
    const entered = await prompt({ title, body, placeholder, confirmLabel: "Record" });
    if (entered === null) return null;
    const value = Number(entered);
    if (!Number.isInteger(value) || value < -99 || value > 999) {
      setFeedback("Enter a whole number for the roll.");
      return null;
    }
    return value;
  };
  const combineBonus = (die: number, bonus: number) =>
    bonus === 0 ? String(die) : `${die} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
  /** A d20 roll with a known bonus: digital rolls 1d20+bonus; manual prompts for the die or total. */
  const rollD20 = async (bonus: number, purpose: "check" | "save" | "attack", label: string) => {
    if (rollInput === "digital") {
      emitRollFormula(d20(bonus), purpose, label);
      return;
    }
    const value = await manualValue(
      `Record ${label}`,
      bonusMode === "auto"
        ? `Enter your d20 result - your ${signed(bonus)} bonus is added automatically.`
        : `Enter your final total (your ${signed(bonus)} bonus already included).`,
      bonusMode === "auto" ? "d20 result" : "final total"
    );
    if (value === null) return;
    emitRollFormula(bonusMode === "auto" ? combineBonus(value, bonus) : String(value), purpose, `${label} (manual)`);
  };
  /** A flat roll (damage): manual mode records the typed total. */
  const rollFlat = async (formula: string, purpose: "damage", label: string) => {
    if (rollInput === "digital") {
      emitRollFormula(formula, purpose, label);
      return;
    }
    const value = await manualValue(`Record ${label}`, `Enter your rolled total for ${formula}.`, "rolled total");
    if (value === null) return;
    emitRollFormula(String(value), purpose, `${label} (manual)`);
  };
  // Hands a stat-block action to the structured flow (pick target -> roll -> resolve). Every attack
  // from the sheet routes through here. "jump" goes to the initiative view and back on commit;
  // "inline" drives the runner in the Actions section.
  const routeAttack = (action: ActorDefinition["actions"][number]) => {
    setTargetingResult(null);
    beginTargeting(summaryOfOwnAction(action), actor.id);
    if (effectiveAttackMode === "jump") onJumpToInitiative?.();
  };
  // The player's own server-resolvable action (has an attack, a save or damage) for an equipped
  // weapon (by name) or a spell (by linked actionId); null falls back to the quick roll.
  // Item-derived actions (`item-<inventory id>`) exist only in the server's list (`serverActions`),
  // with riders folded into their numbers, so that list is consulted too. Only the id is sent.
  const structuredActionFor = (opts: {
    actionId?: string;
    name?: string;
  }): ActorDefinition["actions"][number] | null => {
    if (!definition) return null;
    const norm = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const match =
      (opts.actionId ? definition.actions.find((candidate) => candidate.id === opts.actionId) : undefined) ??
      (opts.name ? definition.actions.find((candidate) => norm(candidate.name) === norm(opts.name!)) : undefined);
    return match && (match.attack || match.save || match.damage.length > 0) ? match : null;
  };
  /** The server's own derived action for this weapon, matched by name (the only key an inventory
      row and its derived action share). */
  const serverActionFor = (name: string): ContentActionSummary | null => {
    const norm = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const found = serverActions.find((candidate) => norm(candidate.name) === norm(name));
    // Only the derived ones; definition actions are found by `structuredActionFor`.
    return found && !definition?.actions.some((candidate) => candidate.id === found.id) ? found : null;
  };
  // In "inline" mode the picker and result render in the Actions-section runner; an attack tapped
  // elsewhere on the sheet scrolls that runner into view.
  const runnerRef = useRef<HTMLDivElement | null>(null);
  const targetingSession = useTargeting();
  useEffect(() => {
    if (effectiveAttackMode === "inline" && targetingSession?.attackerId === actor.id)
      runnerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [effectiveAttackMode, targetingSession?.attackerId, targetingSession?.action.id, actor.id]);

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
    (actor.conditions ?? []).map((condition) => (typeof condition === "string" ? condition : condition.id)).join(","),
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
    socket.emit(
      "actor:available-actions",
      { actorId: actor.id },
      (result: { ok: boolean; actions?: readonly AvailabilityRow[]; derived?: ActorDerivedSheet }) => {
        // Failures are silent: every caller has a fallback, and the user did not ask for this lookup.
        if (!live || !result.ok) return;
        if (result.actions) setServerActions(result.actions.filter((row) => !row.builtin).map(summaryOfAvailability));
        // Absent only from an older server; the fallback covers that.
        if (result.derived) setDerived(result.derived);
      }
    );
    return () => {
      live = false;
    };
  }, [actor.id, definitionId, loadoutSignature]);
  const derivedAbility = (ability: (typeof ABILITIES)[number]) =>
    derived?.abilities.find((row) => row.ability === ability) ?? null;

  useEffect(() => {
    if (role !== "gm" || !definitionId || ownDefinition || sheetCache.has(definitionId)) return;
    socket.emit("content:monster-sheet", { definitionId }, (result) => {
      if (result.ok && result.definition) {
        sheetCache.set(definitionId, result.definition);
        setFetched(result.definition);
      } else setFeedback(result.message ?? "The stat block could not be loaded.");
    });
  }, [definitionId, role, ownDefinition]);

  const extension = (definition?.extensions["open5e.srd-2024"] ?? {}) as SrdExtension;
  const hp = actor.hp;
  const exactHp = "kind" in hp ? (hp.kind === "exact" ? hp : null) : hp;
  const speeds = extension.speeds
    ? (["walk", "swim", "fly", "climb", "burrow"] as const)
        .flatMap((mode) => {
          const feet = extension.speeds?.[mode];
          return feet
            ? [
                `${mode === "walk" ? "" : `${mode} `}${feet} ft.${mode === "fly" && extension.speeds?.hover ? " (hover)" : ""}`
              ]
            : [];
        })
        .join(", ")
    : definition
      ? `${definition.speedFeet} ft.`
      : null;

  const character = definition?.character;
  const proficiencies = definition?.proficiencies;
  const spellcasting = definition?.spellcasting;
  const inventory = actor.inventory ?? [];
  const currency = actor.currency ?? null;
  const preparedIds = new Set<string>(actor.preparedSpellIds ?? []);
  const liveSlotRemaining = new Map<number, number>(
    (actor.spellSlots ?? []).map((slot) => [slot.level, slot.remaining])
  );
  const pact = actor.pactSlots ?? null;
  // `resolveSpellcasting` applies the resolution order (per-class entry by classId, the lone-entry
  // shortcut, then top-level fields), so a multiclass caster gets one row per casting class.
  const casterEntries = spellcasting?.classes ?? [];
  const casterRows = (
    definition && spellcasting
      ? casterEntries.length > 0
        ? casterEntries.map((entry) => entry.classId)
        : [undefined]
      : []
  ).flatMap((classId) => {
    const resolved = resolveSpellcasting(spellcasting, classId);
    if (!resolved) return [];
    const dc =
      resolved.saveDc ?? spellSaveDc(definition!.abilityScores[resolved.ability], definition!.proficiencyBonus);
    const attack =
      resolved.attackBonus ??
      spellAttackBonus(definition!.abilityScores[resolved.ability], definition!.proficiencyBonus);
    const name = classId
      ? (character?.classes?.find((entry) => entry.id === classId)?.name ?? titleCase(classId))
      : null;
    return [{ key: classId ?? "primary", name, ability: resolved.ability, dc, attack }];
  });
  // "Cast at" support: SRD spells by id, and the character's slot pools by level.
  const spellIndex = new Map(spellRef.map((entry) => [entry.id, entry]));
  const slotMaxByLevel = new Map<number, number>((spellcasting?.slots ?? []).map((slot) => [slot.level, slot.max]));
  const slotLevels = [...slotMaxByLevel.entries()]
    .filter(([, max]) => max > 0)
    .map(([level]) => level)
    .sort((a, b) => a - b);
  // Cast a leveled spell at a chosen level: spend the slot, then roll the SRD upcast damage for a
  // damaging spell. Both are server-checked.
  const castSpell = (
    spell: Readonly<{ id: string; name: string; level: number; actionId?: string | null }>,
    level: number
  ) => {
    const max = slotMaxByLevel.get(level) ?? 0;
    const rem = liveSlotRemaining.get(level) ?? max;
    if (max <= 0 || rem <= 0) {
      setFeedback(`No ${ordinal(level)}-level slots remain.`);
      return;
    }
    const content = spellIndex.get(spell.id);
    // Same helper as the displayed effect, so the roll matches what is shown.
    const { formula } = spellEffectAt(content, spell.level, level);
    const types = content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : "";
    setBusy(true);
    socket.emit(
      "character:set-slot",
      { commandId: newId(), actorId: actor.id, level, remaining: rem - 1 },
      (result: { ok: boolean; message?: string }) => {
        setBusy(false);
        if (!result.ok) {
          setFeedback(result.message ?? "The slot could not be spent.");
          return;
        }
        // The slot is spent; on your turn a spell that targets a creature goes through the structured flow.
        // A utility spell stays a plain note. Known limitation: an upcast spell resolves at its base dice
        // here; the GM can adjust the parked damage.
        const structured = structuredAttacks
          ? structuredActionFor({ actionId: spell.actionId ?? undefined, name: spell.name })
          : null;
        if (structured) {
          routeAttack(structured);
          return;
        }
        // Digital rolls the damage; manual prompts for the physical total.
        if (formula) void rollFlat(formula, "damage", `${spell.name} at ${ordinal(level)}${types}`);
        else setFeedback(`Cast ${spell.name} at ${ordinal(level)} - spent a ${ordinal(level)}-level slot.`);
      }
    );
  };
  // Cantrips cost no slot: roll a damaging cantrip's die, or note a utility cast.
  const castCantrip = (spell: Readonly<{ id: string; name: string; level: number; actionId?: string | null }>) => {
    // A cantrip that targets a creature routes through the structured flow on your turn.
    const structured = structuredAttacks
      ? structuredActionFor({ actionId: spell.actionId ?? undefined, name: spell.name })
      : null;
    if (structured) {
      routeAttack(structured);
      return;
    }
    const content = spellIndex.get(spell.id);
    const { formula } = spellEffectAt(content, spell.level, spell.level);
    if (formula)
      void rollFlat(
        formula,
        "damage",
        `${spell.name}${content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : ""}`
      );
    else setFeedback(`Cast ${spell.name}.`);
  };
  const identity = character
    ? [
        character.classes
          .map((klass) => `${klass.subclass ? `${klass.subclass.name} ` : ""}${klass.name} ${klass.level}`)
          .join(" / "),
        character.race?.name,
        character.background?.name
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const attunedCount = inventory.filter((item) => item.attuned).length;
  // Equipped weapons become rollable attacks on the sheet: to-hit = ability mod + PB, damage = weapon
  // die + ability mod. The ability comes from `weaponAbilityModifierFrom`, the server's own function
  // (finesse, and thrown weapons using Strength), so the preview matches the roll.
  const equippedWeaponActions =
    actor.kind === "player-character" && definition
      ? inventory
          .filter((item) => item.equipped && item.weapon && item.quantity > 0)
          .map((item) => {
            const weapon = item.weapon!;
            const abilityMod = weaponAbilityModifierFrom(
              weapon.properties ?? [],
              weapon.rangeFeet,
              modifierOf(definition.abilityScores.str),
              modifierOf(definition.abilityScores.dex)
            );
            const toHit = abilityMod + definition.proficiencyBonus;
            const damageFormula =
              abilityMod === 0
                ? weapon.damageDice
                : `${weapon.damageDice} ${abilityMod > 0 ? "+" : "-"} ${Math.abs(abilityMod)}`;
            // Riders apply only while active: equipped, and attuned when the item requires it. An unattuned
            // magic weapon swings as mundane. Same rule as the server.
            const active =
              item.magic?.isMagic === true && (item.magic.attunementRequired !== true || item.attuned === true);
            return {
              id: `equip-${item.id}`,
              name: item.name,
              toHit,
              damageFormula,
              damageType: weapon.damageType,
              rangeFeet: weapon.rangeFeet,
              active
            };
          })
      : [];
  /** Actions the loadout adds beyond the stat block (a wand's charge, an amulet's cast). */
  const derivedActions = serverActions.filter(
    (row) => !definition?.actions.some((candidate) => candidate.id === row.id)
  );
  /** Derived rows that are not equipped-weapon entries, matched out by name so no action is drawn
      twice. */
  const itemActions = derivedActions.filter((row) => {
    const norm = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    return !equippedWeaponActions.some((wa) => norm(wa.name) === norm(row.name));
  });
  // The server upserts by id, so adding to an existing stack resends the whole item with quantity+1
  // (keeping equipped/attuned); a new pick starts at 1 with the catalog's category, weight and text.
  const ownedCounts = new Map(inventory.map((item) => [item.id, item.quantity]));
  const addFromCatalog = (item: ContentEquipmentSummary, baseId?: string) => {
    const existing = inventory.find((entry) => entry.id === item.id);
    setBusy(true);
    socket.emit(
      "character:set-inventory",
      {
        commandId: newId(),
        actorId: actor.id,
        item: {
          id: item.id,
          name: item.name,
          quantity: (existing?.quantity ?? 0) + 1,
          category: item.category,
          ...(existing ? { equipped: existing.equipped, attuned: existing.attuned } : {}),
          // The template pick from the chooser, or the one the owned row already has (a re-add must not
          // unbind it). The server validates the pick and copies the base's stats.
          ...(baseId ? { baseId } : existing?.baseId ? { baseId: existing.baseId } : {}),
          ...(item.weightLb != null ? { weightEach: item.weightLb } : {}),
          ...(item.description ? { description: item.description } : {}),
          // Carry the weapon/armor stats so equipping matters. The weapon block is narrowed, not spread: the
          // browse summary's `mastery` is refused by the strict wire schema (see `inventoryWeaponFrom`).
          ...(item.weapon ? { weapon: inventoryWeaponFrom(item.weapon) } : {}),
          ...(item.armor ? { armor: item.armor } : {})
        }
      },
      ack
    );
  };
  // Keep the coin editor in sync with the authoritative purse.
  useEffect(() => {
    setCoins({
      cp: currency?.cp ?? 0,
      sp: currency?.sp ?? 0,
      ep: currency?.ep ?? 0,
      gp: currency?.gp ?? 0,
      pp: currency?.pp ?? 0
    });
  }, [currency?.cp, currency?.sp, currency?.ep, currency?.gp, currency?.pp]);
  // Light hand-edit of identity/proficiencies (owner and GM, server-enforced).
  const openProfEditor = () => {
    setProfDraft({
      saves: proficiencies?.saves ? [...proficiencies.saves] : [],
      skills: Object.fromEntries((proficiencies?.skills ?? []).map((skill) => [skill.id, skill.proficiency]))
    });
    setEditMode("prof");
  };
  // Proficiency edits auto-save like the rest of the sheet. Also update the GM's cached definition:
  // the GM renders from `fetched`/sheetCache, which nothing else refreshes after an edit.
  const persistProficiencies = (draft: { saves: string[]; skills: Record<string, "proficient" | "expertise"> }) => {
    const proficiencies = {
      saves: draft.saves as Array<"str" | "dex" | "con" | "int" | "wis" | "cha">,
      skills: Object.entries(draft.skills).map(([id, proficiency]) => ({ id, proficiency }))
    };
    if (definitionId && definition) {
      const next = { ...definition, proficiencies };
      sheetCache.set(definitionId, next);
      setFetched(next);
    }
    setBusy(true);
    socket.emit("character:set-proficiencies", { commandId: newId(), actorId: actor.id, proficiencies }, ack);
  };
  const toggleSave = (ability: string) => {
    const next = {
      ...profDraft,
      saves: profDraft.saves.includes(ability)
        ? profDraft.saves.filter((entry) => entry !== ability)
        : [...profDraft.saves, ability]
    };
    setProfDraft(next);
    persistProficiencies(next);
  };
  const cycleSkill = (id: string) => {
    const current = profDraft.skills[id];
    const tier = current === undefined ? "proficient" : current === "proficient" ? "expertise" : undefined;
    const skills = { ...profDraft.skills };
    if (tier) skills[id] = tier;
    else delete skills[id];
    const next = { ...profDraft, skills };
    setProfDraft(next);
    persistProficiencies(next);
  };
  const openIdEditor = () => {
    const rows = (character?.classes ?? []).map((klass, index) => ({
      key: `${klass.id}-${index}`,
      id: klass.id,
      name: klass.name,
      subclass: klass.subclass?.name ?? "",
      level: klass.level,
      hitDie: klass.hitDie
    }));
    setIdDraft({
      classes: rows.length > 0 ? rows : [blankClassDraft()],
      race: character?.race?.name ?? "",
      background: character?.background?.name ?? ""
    });
    setEditMode("identity");
  };
  const saveIdentity = () => {
    const classes = idDraft.classes
      .filter((row) => row.name.trim().length > 0)
      .map((row) => ({
        id: row.id ?? slugify(row.name),
        name: row.name.trim(),
        ...(row.subclass.trim() ? { subclass: { id: slugify(row.subclass), name: row.subclass.trim() } } : {}),
        level: row.level,
        ...(row.hitDie ? { hitDie: row.hitDie } : {})
        // The server merges rows by class id, so of two rows resolving to the same id only the first ships.
      }))
      .filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index);
    const next = {
      classes,
      feats: character?.feats ? [...character.feats] : [],
      ...(idDraft.race.trim() ? { race: { id: slugify(idDraft.race), name: idDraft.race.trim() } } : {}),
      ...(idDraft.background.trim()
        ? { background: { id: slugify(idDraft.background), name: idDraft.background.trim() } }
        : {})
    };
    // Update the GM's cached definition so the edit shows immediately. Spread over the stored
    // identity to mirror the server's carry-forward merge (the `choices` ledger stays).
    if (definitionId && definition) {
      const nextDef = { ...definition, character: { ...character, ...next } };
      sheetCache.set(definitionId, nextDef);
      setFetched(nextDef);
    }
    setBusy(true);
    socket.emit("character:set-identity", { commandId: newId(), actorId: actor.id, character: next }, (result) => {
      ack(result);
      if (result.ok) setEditMode(null);
    });
  };

  // The sheet's scrolling content. Identity and roll settings live in the fixed header and rollbar;
  // only the identity edit form scrolls.
  const sheetScroll = (
    <div className="sheet-scroll">
      {editMode === "identity" && (
        <div className="sheet-editor sheet-id-editor">
          {/* Every class gets its own Class/Subclass/Level trio, so saving never drops a class the form
              did not render. */}
          {idDraft.classes.map((row, index) => {
            const n = idDraft.classes.length > 1 ? ` ${index + 1}` : "";
            return (
              <Fragment key={row.key}>
                <label>
                  Class{n}
                  <input
                    type="text"
                    value={row.name}
                    maxLength={60}
                    onChange={(event) => editClassDraft(row.key, { name: event.target.value })}
                  />
                </label>
                <label>
                  Subclass{n}
                  <input
                    type="text"
                    value={row.subclass}
                    maxLength={60}
                    onChange={(event) => editClassDraft(row.key, { subclass: event.target.value })}
                  />
                </label>
                <label>
                  Level{n}
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={row.level}
                    onChange={(event) =>
                      editClassDraft(row.key, {
                        level: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1)))
                      })
                    }
                  />
                </label>
              </Fragment>
            );
          })}
          {/* The schema allows up to four classes; removing one is a respec, which the builder owns. */}
          {idDraft.classes.length < 4 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIdDraft((draft) => ({ ...draft, classes: [...draft.classes, blankClassDraft()] }))}
            >
              Add a class
            </Button>
          )}
          <label>
            Race
            <input
              type="text"
              value={idDraft.race}
              maxLength={60}
              onChange={(event) => setIdDraft((draft) => ({ ...draft, race: event.target.value }))}
            />
          </label>
          <label>
            Background
            <input
              type="text"
              value={idDraft.background}
              maxLength={60}
              onChange={(event) => setIdDraft((draft) => ({ ...draft, background: event.target.value }))}
            />
          </label>
          <Button size="sm" disabled={busy} onClick={saveIdentity}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditMode(null)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="sheet-vitals">
        <div className="sheet-vital sheet-vital-hp">
          <div className="sheet-vital-top">
            <span>HP</span>
            <strong>
              {exactHp
                ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}`
                : "-"}
            </strong>
          </div>
          {exactHp && <Meter className="sheet-hp-meter" tone="health" value={exactHp.current} max={exactHp.maximum} />}
          <SheetHpControls actorId={actor.id} allowSet={role === "gm"} onFeedback={setFeedback} />
        </div>
        <div className="sheet-vital" title={extension.armorDetail ?? undefined}>
          <span>AC</span>
          <strong>{actor.armorClass ?? "-"}</strong>
        </div>
        <div className="sheet-vital">
          <span>Init</span>
          <strong>{actor.initiative !== undefined ? signed(actor.initiative) : "-"}</strong>
        </div>
        {speeds && (
          <div className="sheet-vital">
            <span>Speed</span>
            <strong>{speeds}</strong>
          </div>
        )}
      </div>
      <div className="sheet-conditions">
        <span className="sheet-section-label">Conditions</span>
        <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} />
      </div>
      {actor.kind === "player-character" && (
        <div className="sheet-rest-block">
          <span className="sheet-section-label">Rest</span>
          <SheetRest actorId={actor.id} hitDice={"hitDice" in actor ? actor.hitDice : null} onFeedback={setFeedback} />
        </div>
      )}

      {definition && (
        <>
          <div className="sheet-abilities">
            {ABILITIES.map((ability) => {
              const score = definition.abilityScores[ability];
              // The server's numbers when it has answered; its own arithmetic only until then. The
              // difference is item `check-bonus` riders, which the client cannot see (rule 2).
              const row = derivedAbility(ability);
              const mod = row?.check ?? modifierOf(score);
              const withProf = row?.checkWithProficiency ?? modifierOf(score) + definition.proficiencyBonus;
              return (
                <div key={ability} className="sheet-ability">
                  <span>{ability.toUpperCase()}</span>
                  <strong>{score}</strong>
                  <div className="sheet-ability-rolls">
                    <button
                      type="button"
                      disabled={rolling}
                      title={`Roll a ${ability.toUpperCase()} check`}
                      onClick={() => void rollD20(mod, "check", `${ability.toUpperCase()} check`)}
                    >
                      {signed(mod)}
                    </button>
                    <button
                      type="button"
                      className="prof"
                      disabled={rolling}
                      title={`Roll a ${ability.toUpperCase()} check WITH proficiency (for a GM-called custom/unnamed check)`}
                      onClick={() => void rollD20(withProf, "check", `${ability.toUpperCase()} check w/ proficiency`)}
                    >
                      {signed(withProf)}
                      <em>P</em>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <dl className="sheet-meta">
            {extension.senses && extension.senses.length > 0 && (
              <div>
                <dt>Senses</dt>
                <dd>
                  {extension.senses.join(", ")}
                  {extension.passivePerception ? `; passive Perception ${extension.passivePerception}` : ""}
                </dd>
              </div>
            )}
            {!extension.senses?.length && extension.passivePerception ? (
              <div>
                <dt>Senses</dt>
                <dd>passive Perception {extension.passivePerception}</dd>
              </div>
            ) : null}
            {extension.languages && (
              <div>
                <dt>Languages</dt>
                <dd>{extension.languages}</dd>
              </div>
            )}
            {extension.damageVulnerabilities && (
              <div>
                <dt>Vulnerabilities</dt>
                <dd>{extension.damageVulnerabilities}</dd>
              </div>
            )}
            {extension.damageResistances && (
              <div>
                <dt>Resistances</dt>
                <dd>{extension.damageResistances}</dd>
              </div>
            )}
            {extension.damageImmunities && (
              <div>
                <dt>Immunities</dt>
                <dd>{extension.damageImmunities}</dd>
              </div>
            )}
            {extension.conditionImmunities && (
              <div>
                <dt>Condition immunities</dt>
                <dd>{extension.conditionImmunities}</dd>
              </div>
            )}
            <div>
              <dt>Proficiency</dt>
              <dd>{signed(definition.proficiencyBonus)}</dd>
            </div>
          </dl>
          {((proficiencies && (proficiencies.saves.length > 0 || proficiencies.skills.length > 0)) ||
            actor.kind === "player-character") && (
            <section className="sheet-section">
              <h3>
                Proficiencies
                {actor.kind === "player-character" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="sheet-section-edit"
                    onClick={() => (editMode === "prof" ? setEditMode(null) : openProfEditor())}
                  >
                    {editMode === "prof" ? "Done" : "Edit"}
                  </Button>
                )}
              </h3>
              {editMode === "prof" ? (
                <div className="sheet-editor">
                  <p className="sheet-editor-hint">
                    Changes save as you go. Tap a save to toggle it; tap a skill to cycle proficient → expertise → none.
                    Press <strong>Done</strong> when finished.
                  </p>
                  <div className="sheet-roll-row">
                    <span className="sheet-roll-label">Saves</span>
                    {ABILITIES.map((ability) => (
                      <button
                        type="button"
                        key={ability}
                        className={`sheet-prepare${profDraft.saves.includes(ability) ? " is-prepared" : ""}`}
                        disabled={busy}
                        onClick={() => toggleSave(ability)}
                      >
                        {ability.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <ul className="sheet-skill-list sheet-skill-edit">
                    {sheetSkills.map((skill) => {
                      const tier = profDraft.skills[skill.id];
                      return (
                        <li key={skill.id}>
                          <span>{skill.name}</span>
                          <button
                            type="button"
                            className={`sheet-prepare${tier ? " is-prepared" : ""}`}
                            disabled={busy}
                            onClick={() => cycleSkill(skill.id)}
                          >
                            {tier ?? "—"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="sheet-roll-row">
                    <span className="sheet-roll-label">Saves</span>
                    {ABILITIES.map((ability) => {
                      const row = derivedAbility(ability);
                      const isProf = row?.saveProficient ?? proficiencies?.saves.includes(ability) ?? false;
                      const bonus =
                        row?.save ?? saveBonus(definition.abilityScores[ability], definition.proficiencyBonus, isProf);
                      const fromItems = row?.saveFromItems ?? 0;
                      return (
                        <button
                          type="button"
                          key={ability}
                          className={`sheet-roll-chip${isProf ? " is-proficient" : ""}`}
                          disabled={rolling}
                          title={`Roll a ${ability.toUpperCase()} saving throw${isProf ? " (proficient)" : ""}${fromItems !== 0 ? ` - includes ${signed(fromItems)} from your equipment` : ""}`}
                          onClick={() => void rollD20(bonus, "save", `${ability.toUpperCase()} save`)}
                        >
                          {ability.toUpperCase()} {signed(bonus)}
                        </button>
                      );
                    })}
                  </div>
                  <ul className="sheet-skill-list sheet-skill-cols">
                    {sheetSkills.map((skill) => {
                      const row = derived?.skills.find((entry) => entry.id === skill.id) ?? null;
                      const baseTier = proficiencies?.skills.find((entry) => entry.id === skill.id)?.proficiency;
                      const effective = row?.tier ?? baseTier ?? "none";
                      const tier = effective === "none" ? undefined : effective;
                      const sources = row?.sources ?? [];
                      const bonus = row
                        ? row.bonus
                        : skill.ability
                          ? skillBonus(
                              definition.abilityScores[skill.ability],
                              definition.proficiencyBonus,
                              baseTier ?? "none"
                            )
                          : null;
                      return (
                        <li key={skill.id}>
                          {bonus === null ? (
                            <span
                              className="sheet-roll-chip"
                              title={`${skill.name} names no governing ability, so it has no rollable bonus`}
                            >
                              —
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="sheet-roll-chip"
                              disabled={rolling}
                              title={`Roll ${skill.name}`}
                              onClick={() => void rollD20(bonus, "check", `${skill.name} check`)}
                            >
                              {signed(bonus)}
                            </button>
                          )}
                          <span
                            className={`sheet-prof-dot${tier === "expertise" ? " expertise" : tier === "proficient" ? " proficient" : ""}`}
                            title={`${tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient"}${sources.length > 0 ? ` (${sources.join(", ")})` : ""}`}
                            aria-label={`${tier === "expertise" ? "Expertise" : tier === "proficient" ? "Proficient" : "Not proficient"}${sources.length > 0 ? ` from ${sources.join(", ")}` : ""}`}
                          >
                            {tier === "expertise" ? "E" : tier === "proficient" ? "P" : ""}
                          </span>
                          <span className="sheet-skill-name">
                            {skill.name} {skill.ability && <em>{skill.ability.toUpperCase()}</em>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          )}
          {spellcasting && (
            <section className="sheet-section">
              <h3>Spells</h3>
              <div className="sheet-spellcast-fields">
                {casterRows.map((row) => (
                  <Fragment key={row.key}>
                    <div className="sheet-spellcast-field">
                      <span>{row.name ? `${row.name} caster` : "Caster"}</span>
                      <strong>{row.ability.toUpperCase()}</strong>
                    </div>
                    <div className="sheet-spellcast-field">
                      <span>Save DC</span>
                      <strong>{row.dc}</strong>
                    </div>
                    <div className="sheet-spellcast-field">
                      <span>Spell atk</span>
                      <strong>{signed(row.attack)}</strong>
                    </div>
                  </Fragment>
                ))}
              </div>
              {(() => {
                type Spell = (typeof spellcasting.spells)[number];
                const groups = new Map<number, Spell[]>();
                for (const spell of spellcasting.spells) {
                  const list = groups.get(spell.level) ?? [];
                  list.push(spell);
                  groups.set(spell.level, list);
                }
                return [...groups.keys()]
                  .sort((a, b) => a - b)
                  .map((level) => {
                    const spells = [...groups.get(level)!].sort((a, b) => a.name.localeCompare(b.name));
                    const max = slotMaxByLevel.get(level) ?? 0;
                    const remaining = liveSlotRemaining.get(level) ?? max;
                    return (
                      <div key={level} className="sheet-spell-group">
                        <div className="sheet-spell-group-head">
                          <h4>{level === 0 ? "Cantrips" : `${ordinal(level)} Level`}</h4>
                          {level > 0 && max > 0 && (
                            <div
                              className="sheet-slot-pips"
                              role="group"
                              aria-label={`Level ${level} spell slots (${remaining} of ${max} left)`}
                            >
                              {Array.from({ length: max }, (_, index) => (
                                <button
                                  key={index}
                                  type="button"
                                  className={`sheet-pip${index < remaining ? " filled" : ""}`}
                                  disabled={busy}
                                  aria-label={`${index < remaining ? "Spend" : "Restore"} a level ${level} slot`}
                                  onClick={() => {
                                    setBusy(true);
                                    socket.emit(
                                      "character:set-slot",
                                      {
                                        commandId: newId(),
                                        actorId: actor.id,
                                        level,
                                        remaining: index < remaining ? index : index + 1
                                      },
                                      ack
                                    );
                                  }}
                                />
                              ))}
                              <span className="sheet-slot-count">
                                {remaining}/{max}
                              </span>
                            </div>
                          )}
                        </div>
                        <ul className={`sheet-spell-list${actor.kind === "player-character" ? " castable" : ""}`}>
                          {spells.map((spell) => {
                            const isPrepared = preparedIds.has(spell.id) || spell.alwaysPrepared;
                            const toggleable = spell.level > 0 && !spell.alwaysPrepared;
                            return (
                              <li key={spell.id}>
                                {spell.level === 0 ? (
                                  <span className="sheet-prep-tag cantrip">Cantrip</span>
                                ) : toggleable ? (
                                  <button
                                    type="button"
                                    className={`sheet-prep-tag toggle${isPrepared ? " on" : ""}`}
                                    disabled={busy}
                                    title={isPrepared ? "Prepared - tap to unprepare" : "Not prepared - tap to prepare"}
                                    onClick={() => {
                                      setBusy(true);
                                      socket.emit(
                                        "character:set-prepared",
                                        {
                                          commandId: newId(),
                                          actorId: actor.id,
                                          spellId: spell.id,
                                          prepared: !isPrepared
                                        },
                                        ack
                                      );
                                    }}
                                  >
                                    {isPrepared ? "Prepared" : "Prepare"}
                                  </button>
                                ) : (
                                  <span
                                    className="sheet-prep-tag always"
                                    title="Always prepared — doesn't count against your prepared limit"
                                  >
                                    Always
                                  </span>
                                )}
                                {spellIndex.get(spell.id) ? (
                                  <button
                                    type="button"
                                    className="sheet-spell-name sheet-spell-link"
                                    title={`Show the ${spell.name} rules`}
                                    onClick={() => setOpenSpell(spellIndex.get(spell.id) ?? null)}
                                  >
                                    {spell.name}
                                  </button>
                                ) : (
                                  <span className="sheet-spell-name">{spell.name}</span>
                                )}
                                {actor.kind === "player-character" && (
                                  <SpellCastControls
                                    spell={spell}
                                    content={spellIndex.get(spell.id)}
                                    slotLevels={slotLevels}
                                    slotMaxByLevel={slotMaxByLevel}
                                    liveRemaining={liveSlotRemaining}
                                    busy={busy}
                                    onCastSlot={(castLevel) => castSpell(spell, castLevel)}
                                    onCastCantrip={() => castCantrip(spell)}
                                  />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  });
              })()}
              {pact ? (
                <p className="sheet-entry">
                  Pact Magic: {ordinal(pact.level)}-level slots, {pact.remaining} remaining.
                </p>
              ) : null}
            </section>
          )}
          {actor.kind === "player-character" && (
            <section className="sheet-section">
              <h3>Inventory</h3>
              <form
                className="sheet-add-item"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newItem.trim();
                  if (!name) return;
                  setBusy(true);
                  socket.emit(
                    "character:set-inventory",
                    { commandId: newId(), actorId: actor.id, item: { id: slugify(name), name, quantity: 1 } },
                    ack
                  );
                  setNewItem("");
                }}
              >
                <input
                  type="text"
                  value={newItem}
                  maxLength={120}
                  placeholder="Add a custom item…"
                  aria-label="New item name"
                  onChange={(event) => setNewItem(event.target.value)}
                />
                <Button type="submit" size="sm" disabled={busy || !newItem.trim()}>
                  Add
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>
                  Browse SRD gear
                </Button>
              </form>
              {inventory.length > 0 && (
                <div className="sheet-inv">
                  <div className="sheet-inv-row sheet-inv-head" aria-hidden="true">
                    <span className="sheet-item-name">Item</span>
                    <span>Qty</span>
                    <span>Equip</span>
                    <span>Attune</span>
                    <span></span>
                  </div>
                  {inventory.map((item) => (
                    <div key={item.id} className="sheet-inv-row">
                      {/* The row's own description is the only place rarity or attunement requirements appear on
                  the sheet. Clamped to two lines so long entries cannot push the controls off a phone. */}
                      {/* A bound template names its base in the row ("Dwarven Thrower (Warhammer)"), from the
                  recorded pick. An unbound template row keeps the item and offers the base chooser. */}
                      <span className="sheet-item-name">
                        {item.name}
                        {item.baseId ? (
                          <span className="sheet-item-cat">({item.baseId.split("-").map(titleCase).join(" ")})</span>
                        ) : null}
                        {item.category ? (
                          <span className="sheet-item-cat">{item.category.split("-").map(titleCase).join(" ")}</span>
                        ) : null}
                        {(() => {
                          const summary = equipmentCatalog.find((entry) => entry.id === item.id);
                          return !item.baseId && summary?.appliesTo && summary.appliesTo.baseIds.length > 0 ? (
                            <button
                              type="button"
                              className="sheet-toggle-btn tap-target"
                              disabled={busy}
                              onClick={() => setBindingRowId(item.id)}
                            >
                              Choose what it is
                            </button>
                          ) : null;
                        })()}
                        {item.description ? <span className="sheet-item-desc">{item.description}</span> : null}
                      </span>
                      <Stepper
                        className="sheet-inv-qty"
                        value={item.quantity}
                        min={0}
                        disabled={busy}
                        aria-label={`Quantity of ${item.name}`}
                        onChange={(quantity) => {
                          setBusy(true);
                          socket.emit(
                            "character:set-inventory",
                            { commandId: newId(), actorId: actor.id, item: { ...item, quantity } },
                            ack
                          );
                        }}
                      />
                      <button
                        type="button"
                        className={`sheet-toggle-btn${item.equipped ? " on" : ""}`}
                        disabled={busy}
                        aria-pressed={item.equipped}
                        onClick={() => {
                          setBusy(true);
                          socket.emit(
                            "character:set-inventory",
                            { commandId: newId(), actorId: actor.id, item: { ...item, equipped: !item.equipped } },
                            ack
                          );
                        }}
                      >
                        {item.equipped ? "Equipped" : "Equip"}
                      </button>
                      <button
                        type="button"
                        className={`sheet-toggle-btn${item.attuned ? " on" : ""}`}
                        disabled={busy}
                        aria-pressed={item.attuned}
                        onClick={() => {
                          setBusy(true);
                          socket.emit(
                            "character:set-inventory",
                            { commandId: newId(), actorId: actor.id, item: { ...item, attuned: !item.attuned } },
                            ack
                          );
                        }}
                      >
                        {item.attuned ? "Attuned" : "Attune"}
                      </button>
                      <IconButton
                        label={`Remove ${item.name}`}
                        size="sm"
                        className="sheet-remove"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          socket.emit(
                            "character:set-inventory",
                            { commandId: newId(), actorId: actor.id, item: { ...item, quantity: 0 } },
                            ack
                          );
                        }}
                      >
                        ✕
                      </IconButton>
                    </div>
                  ))}
                </div>
              )}
              {attunedCount > 0 && (
                <p className="sheet-attunement">
                  <Badge tone={attunedCount > 3 ? "danger" : "neutral"}>Attunement {attunedCount}/3</Badge>
                </p>
              )}
              {pickerOpen && (
                <EquipmentPicker
                  ownedCounts={ownedCounts}
                  busy={busy}
                  onAdd={addFromCatalog}
                  onClose={() => setPickerOpen(false)}
                />
              )}
              {(() => {
                if (!bindingRowId) return null;
                const rowItem = inventory.find((entry) => entry.id === bindingRowId);
                const summary = equipmentCatalog.find((entry) => entry.id === bindingRowId);
                if (!rowItem || !summary) return null;
                // Binding resends the existing row plus the pick; the server validates and copies the base's stats.
                return (
                  <BindItemModal
                    template={summary}
                    busy={busy}
                    onClose={() => setBindingRowId(null)}
                    onPick={(baseId) => {
                      setBusy(true);
                      socket.emit(
                        "character:set-inventory",
                        { commandId: newId(), actorId: actor.id, item: { ...rowItem, baseId } },
                        ack
                      );
                      setBindingRowId(null);
                    }}
                  />
                );
              })()}
              <div className="sheet-coins">
                {COINS.map((coin) => (
                  <label key={coin}>
                    {coin}
                    <input
                      type="number"
                      min="0"
                      max="1000000"
                      value={coins[coin]}
                      onChange={(event) =>
                        setCoins((prev) => ({
                          ...prev,
                          [coin]: Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0)))
                        }))
                      }
                    />
                  </label>
                ))}
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    socket.emit(
                      "character:set-currency",
                      { commandId: newId(), actorId: actor.id, currency: coins },
                      ack
                    );
                  }}
                >
                  Save coins
                </Button>
              </div>
            </section>
          )}
          {extension.traits && extension.traits.length > 0 && (
            <section className="sheet-section">
              <h3>Traits</h3>
              {extension.traits.map((trait) => (
                <p key={trait.name} className="sheet-entry">
                  <strong>{trait.name}.</strong> <RichText text={trait.description} />
                </p>
              ))}
            </section>
          )}
          {(definition.actions.length > 0 || equippedWeaponActions.length > 0 || itemActions.length > 0) && (
            <section className="sheet-section">
              <h3>Actions</h3>
              {(() => {
                type ActionT = (typeof definition.actions)[number];
                const renderAction = (action: ActionT) => {
                  const atk = action.attack;
                  return (
                    <div key={action.id} className="sheet-entry">
                      <p>
                        <strong>{action.name}.</strong> <RichText text={action.description} />
                      </p>
                      {(atk || action.damage.length > 0) && (
                        <div className="sheet-roll-row">
                          {atk && (
                            <button
                              type="button"
                              className="sheet-roll-chip"
                              disabled={rolling}
                              onClick={() => {
                                if (structuredAttacks) routeAttack(action);
                                else void rollD20(atk.bonus, "attack", `${action.name} to hit`);
                              }}
                            >
                              {signed(atk.bonus)} to hit
                            </button>
                          )}
                          {action.damage.map((part, index) => (
                            <button
                              type="button"
                              key={index}
                              className="sheet-roll-chip"
                              disabled={rolling}
                              onClick={() => void rollFlat(part.formula, "damage", `${action.name} damage`)}
                            >
                              {part.formula}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                };
                // Weapon/other actions first, then spell actions grouped by the linked spell's level.
                const spellLevelByActionId = new Map<string, number>(
                  (spellcasting?.spells ?? [])
                    .filter((spell) => spell.actionId)
                    .map((spell) => [spell.actionId!, spell.level])
                );
                const weaponActions = definition.actions.filter((action) => !spellLevelByActionId.has(action.id));
                const spellGroups = new Map<number, ActionT[]>();
                for (const action of definition.actions) {
                  const level = spellLevelByActionId.get(action.id);
                  if (level !== undefined) {
                    const list = spellGroups.get(level) ?? [];
                    list.push(action);
                    spellGroups.set(level, list);
                  }
                }
                const hasSpellActions = spellGroups.size > 0;
                // With the inline-picker preference on the player's turn, the runner owns the server-resolvable
                // actions here, so the loose chips below are hidden to avoid offering an action twice.
                const inlineRunner = structuredAttacks && effectiveAttackMode === "inline";
                return (
                  <>
                    {inlineRunner && liveCombat && (
                      <div ref={runnerRef}>
                        <PlayerActionRunner
                          actorId={actor.id}
                          definition={definition}
                          extraActions={derivedActions}
                          revision={liveCombat.revision}
                          rollMode={rollMode}
                          bonusMode={bonusMode}
                          playerDamageMode={liveCombat.playerDamageMode}
                          targets={liveCombat.targets}
                        />
                      </div>
                    )}
                    {(equippedWeaponActions.length > 0 || (!inlineRunner && weaponActions.length > 0)) && (
                      <div className="sheet-action-group">
                        {(inlineRunner ? equippedWeaponActions.length > 0 : hasSpellActions) && (
                          <h4 className="sheet-action-head">{inlineRunner ? "Equipped weapons" : "Weapon & other"}</h4>
                        )}
                        {equippedWeaponActions.map((wa) => {
                          /* Prefer the server's derived numbers, which include item riders in `attackBonus` and
                     `damage[]`. The client's own arithmetic is only a fallback when the server derived nothing. */
                          const srv = serverActionFor(wa.name);
                          const toHit = srv?.attackBonus ?? wa.toHit;
                          const damage =
                            srv && srv.damage.length > 0
                              ? srv.damage
                              : [{ formula: wa.damageFormula, type: wa.damageType }];
                          return (
                            <div key={wa.id} className="sheet-entry">
                              <p>
                                <strong>{wa.name}.</strong>{" "}
                                <span className="sheet-weapon-meta">
                                  Equipped weapon · {wa.damageType}
                                  {wa.rangeFeet != null ? ` · range ${wa.rangeFeet} ft` : ""}
                                  {wa.active ? " · Magic" : ""}
                                </span>
                              </p>
                              <div className="sheet-roll-row">
                                <button
                                  type="button"
                                  className="sheet-roll-chip"
                                  disabled={rolling}
                                  onClick={() => {
                                    const structured = structuredAttacks
                                      ? structuredActionFor({ name: wa.name })
                                      : null;
                                    if (structured) {
                                      routeAttack(structured);
                                      return;
                                    }
                                    // Only the id travels; the roll, riders and damage are resolved server-side.
                                    if (srv) {
                                      routeAttack({
                                        ...EMPTY_ACTION,
                                        id: srv.id,
                                        name: srv.name,
                                        attack: { bonus: toHit },
                                        damage: [...damage]
                                      });
                                      return;
                                    }
                                    void rollD20(toHit, "attack", `${wa.name} to hit`);
                                  }}
                                >
                                  {signed(toHit)} to hit
                                </button>
                                {damage.map((part, index) => (
                                  <button
                                    type="button"
                                    key={index}
                                    className="sheet-roll-chip"
                                    disabled={rolling}
                                    onClick={() => void rollFlat(part.formula, "damage", `${wa.name} damage`)}
                                  >
                                    {part.formula}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {!inlineRunner && weaponActions.map(renderAction)}
                      </div>
                    )}
                    {/* Actions an equipped item added, which exist nowhere in the stat block. On the player's own
                  turn the runner owns them (`inlineRunner`). */}
                    {!inlineRunner && itemActions.length > 0 && (
                      <div className="sheet-action-group">
                        <h4 className="sheet-action-head">From your items</h4>
                        {itemActions.map((row) => (
                          <div key={row.id} className="sheet-entry">
                            <p>
                              <strong>{row.name}.</strong> <RichText text={row.description} />
                              {row.usesLimit !== null && (
                                <span className="sheet-weapon-meta">
                                  {" "}
                                  · {row.usesLimit} {row.usesLimit === 1 ? "charge" : "charges"}
                                  {row.usesPer ? ` per ${row.usesPer.replace(/-/g, " ")}` : ""}
                                </span>
                              )}
                            </p>
                            {(row.attackBonus !== null || row.damage.length > 0) && (
                              <div className="sheet-roll-row">
                                {row.attackBonus !== null && (
                                  <button
                                    type="button"
                                    className="sheet-roll-chip"
                                    disabled={rolling}
                                    onClick={() => {
                                      if (structuredAttacks)
                                        routeAttack({
                                          ...EMPTY_ACTION,
                                          id: row.id,
                                          name: row.name,
                                          attack: { bonus: row.attackBonus! },
                                          damage: [...row.damage]
                                        });
                                      else void rollD20(row.attackBonus!, "attack", `${row.name} to hit`);
                                    }}
                                  >
                                    {signed(row.attackBonus)} to hit
                                  </button>
                                )}
                                {row.damage.map((part, index) => (
                                  <button
                                    type="button"
                                    key={index}
                                    className="sheet-roll-chip"
                                    disabled={rolling}
                                    onClick={() => void rollFlat(part.formula, "damage", `${row.name} damage`)}
                                  >
                                    {part.formula}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!inlineRunner && hasSpellActions && (
                      <div className="sheet-action-group">
                        <h4 className="sheet-action-head">Spell actions</h4>
                        {[...spellGroups.keys()]
                          .sort((left, right) => left - right)
                          .map((level) => (
                            <div key={level} className="sheet-action-subgroup">
                              <h5 className="sheet-action-subhead">
                                {level === 0 ? "Cantrips" : `${ordinal(level)} Level`}
                              </h5>
                              {spellGroups.get(level)!.map(renderAction)}
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </section>
          )}
          <p className="sheet-attribution">
            Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.
          </p>
        </>
      )}
      {!definition && role === "gm" && definitionId && !feedback && <p className="sheet-status">Loading stat block…</p>}
      {actor.kind === "player-character" && !definitionId && (
        <p className="sheet-status">
          No imported sheet yet - the GM can import this character's JSON sheet from the roster.
        </p>
      )}
      <p className="sheet-feedback" role="status">
        {feedback}
      </p>
    </div>
  );

  // Identity line under the name: class/level/race for a PC, size/CR typeline for a monster.
  const identityLine =
    identity ??
    (definition
      ? `${titleCase(definition.size)} ${extension.type ?? "being"}${extension.alignment ? `, ${extension.alignment}` : ""}${extension.challengeRating !== undefined ? ` · CR ${formatChallenge(extension.challengeRating)}` : ""}`
      : `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM-only" : ""}`);

  // One header row for every presentation: name and identity on the left; the log toggle, Pop out /
  // New tab and × on the right. In the floating panel it is the drag handle (buttons opt out).
  const header = (draggable: boolean) => (
    <div
      className={`sheet-header${draggable ? " sheet-header--drag" : ""}`}
      onPointerDown={draggable ? beginDrag("move") : undefined}
    >
      <div className="sheet-header-id">
        <strong className="sheet-name">{actor.name}</strong>
        <div className="sheet-header-sub">
          <span className="sheet-idline">{identityLine}</span>
          {actor.kind === "player-character" && definition && editMode !== "identity" && (
            <Button size="sm" variant="ghost" className="sheet-section-edit" onClick={openIdEditor}>
              Edit
            </Button>
          )}
        </div>
      </div>
      <div className="sheet-header-controls">
        {hasLog && (
          <SegmentedControl
            className="sheet-pane-toggle"
            size="sm"
            ariaLabel="Show sheet or dice"
            value={mobilePane}
            onChange={(pane) => setMobilePane(pane as "sheet" | "log")}
            options={[
              { value: "sheet", label: "Sheet" },
              { value: "log", label: "Dice" }
            ]}
          />
        )}
        {hasLog && !embedded && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-dock-btn"
            title={docked ? "Collapse the dice log back behind the toggle" : "Pin the dice log beside the sheet"}
            onClick={() => chooseDocked(!docked)}
          >
            {docked ? "Undock dice" : "Dock dice"}
          </Button>
        )}
        {!standalone && !embedded && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-tool"
            title={presentation === "floating" ? "Dock the panel back into place" : "Pop out into a moveable panel"}
            onClick={() => setPresentation((current) => (current === "floating" ? "modal" : "floating"))}
          >
            {presentation === "floating" ? "Dock" : "Pop out"}
          </Button>
        )}
        {!standalone && !embedded && role === "player" && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-tool"
            title="Open this sheet in its own browser tab"
            onClick={() => window.open(`/sheet.html?actor=${encodeURIComponent(actor.id)}`, `vtt-sheet-${actor.id}`)}
          >
            New tab
          </Button>
        )}
        <IconButton
          label={embedded ? "Back to initiative" : "Close"}
          size="sm"
          className="sheet-close"
          onClick={onClose}
        >
          ✕
        </IconButton>
      </div>
    </div>
  );

  // Roll-input settings: a narrow bar pinned under the header.
  const rollbar = definition ? (
    <div className="sheet-rollbar" role="group" aria-label="Roll entry settings">
      <span className="sheet-settings-label">Rolls</span>
      <SegmentedControl
        size="sm"
        ariaLabel="Roll input mode"
        value={rollInput}
        onChange={(mode) => chooseRollInput(mode as "digital" | "manual")}
        options={[
          { value: "digital", label: "Digital" },
          { value: "manual", label: "Manual" }
        ]}
      />
      {rollInput === "manual" && (
        <SegmentedControl
          size="sm"
          ariaLabel="Typed bonus handling"
          value={bonusMode}
          onChange={(mode) => chooseBonusMode(mode as "auto" | "total")}
          options={[
            { value: "auto", label: "Auto-add bonus" },
            { value: "total", label: "Final total" }
          ]}
        />
      )}
      {/* Mid-fight only: whether an attack tapped here resolves inline or on the initiative view. */}
      {liveCombat?.active === true && actor.kind === "player-character" && onJumpToInitiative && (
        <>
          <span className="sheet-settings-label">Attacks</span>
          <SegmentedControl
            size="sm"
            ariaLabel="Where attacks tapped on the sheet resolve"
            value={sheetAttackMode}
            onChange={(mode) => chooseSheetAttackMode(mode as "jump" | "inline")}
            options={[
              { value: "inline", label: "On sheet" },
              { value: "jump", label: "In initiative" }
            ]}
          />
        </>
      )}
    </div>
  ) : null;

  // The sheet fills the panel; the dice log swaps in behind the Sheet/Dice toggle. Header and
  // rollbar stay pinned; the active pane scrolls.
  const buildWorkspace = (draggable: boolean) => (
    <div className={`sheet-workspace ${hasLog ? "has-log" : "no-log"} show-${mobilePane}${docked ? " docked" : ""}`}>
      {header(draggable)}
      {rollbar}
      {latestRoll && (
        <button
          type="button"
          className="sheet-last-roll"
          onClick={() => setMobilePane("log")}
          title="Open the dice log"
        >
          <span className="sheet-last-roll-label">{latestRoll.label ?? latestRoll.purpose}</span>
          <span className="sheet-last-roll-readout">
            <span className="sheet-last-roll-faces">
              {latestRoll.dice.map((die, index) => (
                <span key={index} className={die.kept ? "sheet-last-die" : "sheet-last-die out"}>
                  {die.face}
                </span>
              ))}
            </span>
            <span className="sheet-last-roll-formula">{latestRoll.formula}</span>
            <span aria-hidden="true">=</span>
            <strong className="sheet-last-roll-total">{latestRoll.total}</strong>
          </span>
        </button>
      )}
      <div className="sheet-workspace-cols">
        {/* The sheet's pane is the declared scroll region in all four presentations. */}
        <div className="sheet-workspace-pane sheet-pane scroll-y">{sheetScroll}</div>
        {hasLog && state && (
          <div className="sheet-workspace-pane log-pane scroll-y">
            <DicePanel role={role} state={state} mineActorId={actor.id} />
          </div>
        )}
      </div>
      {openSpell && <SpellCard spell={openSpell} onClose={() => setOpenSpell(null)} />}
    </div>
  );

  // Embedded (e.g. the player's initiative panel): fills its container, no modal chrome, and × goes
  // back to the initiative view. No state is passed, so no dice log.
  if (embedded)
    return (
      <>
        <div className="sheet-embedded">{buildWorkspace(false)}</div>
        {dialog}
      </>
    );

  // Its own browser tab, or the SPA's `/characters/:id` layer: fills its box, and × closes or goes
  // back. Page-level doors use the frame's bottom row when supplied.
  if (standalone)
    return (
      <>
        <div className="sheet-standalone">
          {buildWorkspace(false)}
          {standaloneActions && <div className="sheet-standalone-actions">{standaloneActions}</div>}
        </div>
        {dialog}
      </>
    );

  if (presentation === "floating") {
    return (
      <>
        <div
          className={`sheet-float${hasLog ? " has-log" : ""}`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="dialog"
          aria-label={`${actor.name} character sheet`}
        >
          {buildWorkspace(true)}
          <div className="sheet-float-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
        </div>
        {dialog}
      </>
    );
  }
  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        className={`character-sheet${hasLog ? " has-log" : ""}${docked ? " docked" : ""}`}
        ariaLabel={`${actor.name} character sheet`}
      >
        {buildWorkspace(false)}
      </Modal>
      {dialog}
    </>
  );
}
