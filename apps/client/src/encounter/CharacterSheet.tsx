import { useEffect, useState } from "react";
import type { ActorDefinition, ContentEquipmentSummary, ContentSpellSummary, GmActor, GmView, PlayerActor, PlayerView } from "@vtt/domain";
import { Modal } from "@vtt/ui";
import { abilityModifier as modifierOf, saveBonus, skillBonus, spellAttackBonus, spellSaveDc } from "@vtt/rules-5e";
import { ConditionEditor } from "./conditions";
import { EquipmentPicker } from "./equipment";
import { useSpellReference } from "./spells";
import { RichText } from "./RichText";
import { DicePanel } from "../dice/DicePanel";
import { usePrompt } from "../components/feedback";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** Definitions are immutable bundled content; one fetch per stat block per session. */
const sheetCache = new Map<string, ActorDefinition>();

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
const d20 = (bonus: number) => bonus === 0 ? "1d20" : `1d20 ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
const titleCase = (value: string) => value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const formatChallenge = (rating: number) => rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const titleizeSkill = (id: string) => id.split("-").map(titleCase).join(" ");
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
/** Best-effort per-browser preference storage for the sheet's roll settings (private-mode safe). */
const readSetting = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const writeSetting = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable; setting stays in-session */ } };
const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;
/** SRD governing ability for each of the 18 skills (drives the read-only skill bonus). */
const SKILL_ABILITY: Record<string, (typeof ABILITIES)[number]> = {
  acrobatics: "dex", "animal-handling": "wis", arcana: "int", athletics: "str", deception: "cha",
  history: "int", insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis",
  nature: "int", perception: "wis", performance: "cha", persuasion: "cha", religion: "int",
  "sleight-of-hand": "dex", stealth: "dex", survival: "wis"
};
const ALL_SKILLS = Object.keys(SKILL_ABILITY).sort();

type SrdExtension = Partial<{
  challengeRating: number; type: string; alignment: string; armorDetail: string | null;
  speeds: Partial<Record<"walk" | "swim" | "fly" | "climb" | "burrow", number | null>> & { hover?: boolean };
  senses: readonly string[]; passivePerception: number | null; languages: string | null;
  savingThrows: Partial<Record<(typeof ABILITIES)[number], number | null>>;
  damageVulnerabilities: string | null; damageResistances: string | null; damageImmunities: string | null; conditionImmunities: string | null;
  traits: ReadonlyArray<{ name: string; description: string }>;
}>;

/** Compact HP tracker inside the sheet; the server enforces scope (GM anyone, player self). */
function SheetHpControls({ actorId, allowSet, onFeedback }: Readonly<{ actorId: string; allowSet: boolean; onFeedback: (text: string) => void }>) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const send = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", label: string) => {
    const value = Number(amount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) { onFeedback(`Enter a whole number (${minimum}-1000).`); return; }
    setBusy(true);
    const payload = event === "actor:set-hp" ? { commandId: newId(), actorId, current: value } : { commandId: newId(), actorId, amount: value };
    socket.emit(event, payload as never, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      onFeedback(result.ok ? `${label} ${value}.` : result.message ?? "The hit point change was rejected.");
      if (result.ok) setAmount("");
    });
  };
  return <div className="sheet-hp-controls" role="group" aria-label="Track hit points">
    <input type="number" min="0" max="1000" placeholder="0" aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
    <button type="button" disabled={busy} onClick={() => send("actor:apply-damage", "Damaged")}>Dmg</button>
    <button type="button" disabled={busy} onClick={() => send("actor:heal", "Healed")}>Heal</button>
    <button type="button" disabled={busy} onClick={() => send("actor:set-temp-hp", "Temp set to")}>Temp</button>
    {allowSet && <button type="button" disabled={busy} onClick={() => send("actor:set-hp", "HP set to")}>Set</button>}
  </div>;
}

/**
 * Per-spell "Cast at" control: a slot-level dropdown (each level shows remaining/total; empty levels
 * disabled) plus a Cast button. Casting spends the chosen slot and, for a damaging spell, auto-applies
 * the SRD upcast scaling for that level (referenced from the vendored spell data) - the parent owns the
 * two-step emit so this stays a small stateful shell. Only offered for leveled spells (cantrips use no
 * slot); returns null when the character has no slot at or above the spell's level.
 */
function SpellCastControls({ spell, content, slotLevels, slotMaxByLevel, liveRemaining, busy, onCast }: Readonly<{
  spell: Readonly<{ id: string; name: string; level: number }>;
  content: ContentSpellSummary | undefined;
  slotLevels: readonly number[];
  slotMaxByLevel: ReadonlyMap<number, number>;
  liveRemaining: ReadonlyMap<number, number>;
  busy: boolean;
  onCast: (level: number) => void;
}>) {
  const options = slotLevels.filter((level) => level >= spell.level);
  const [castLevel, setCastLevel] = useState(options[0] ?? spell.level);
  if (options.length === 0) return null;
  const level = options.includes(castLevel) ? castLevel : options[0];
  const remainingAt = (slot: number) => liveRemaining.get(slot) ?? slotMaxByLevel.get(slot) ?? 0;
  const upcast = level > spell.level ? content?.castingOptions.find((option) => option.level === level) : undefined;
  const scaled = upcast?.damageRoll ?? (upcast?.targetCount != null ? `${upcast.targetCount}×` : null);
  return <div className="sheet-cast">
    <select className="sheet-cast-select" aria-label={`Cast ${spell.name} at level`} value={level} disabled={busy} onChange={(event) => setCastLevel(Number(event.target.value))}>
      {options.map((slot) => <option key={slot} value={slot} disabled={remainingAt(slot) === 0}>{ordinal(slot)} · {remainingAt(slot)}/{slotMaxByLevel.get(slot) ?? 0}{slot > spell.level ? " ↑" : ""}</option>)}
    </select>
    <button type="button" className="sheet-cast-btn" disabled={busy || remainingAt(level) === 0} onClick={() => onCast(level)}>Cast{scaled ? ` ${scaled}` : ""}</button>
  </div>;
}

/**
 * Read/track sheet: live actor state (hp, conditions) over the immutable stat block.
 * Track, never build - no editing of scores or actions here. The GM opens any combatant;
 * a player only ever receives their own actor (and no monster definition fetch succeeds
 * for them server-side).
 */
export function CharacterSheet({ actor, role, state, onClose }: Readonly<{ actor: GmActor | PlayerActor; role: "gm" | "player"; state?: GmView | PlayerView; onClose: () => void }>) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? actor.definition ?? null : null;
  // The GM fetches immutable bundled definitions into `fetched`; a player's own definition rides the
  // live actor prop (`ownDefinition`) and must WIN so that identity/proficiency edits reflect at once
  // (bugfix: a useState seeded from ownDefinition went stale after an edit).
  const [fetched, setFetched] = useState<ActorDefinition | null>(definitionId ? sheetCache.get(definitionId) ?? null : null);
  const definition = ownDefinition ?? fetched;
  const [feedback, setFeedback] = useState("");
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const ack = (result: { ok: boolean; message?: string }) => { setBusy(false); if (!result.ok) setFeedback(result.message ?? "That change was rejected."); };
  const [newItem, setNewItem] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coins, setCoins] = useState({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [editMode, setEditMode] = useState<null | "prof" | "identity">(null);
  const [profDraft, setProfDraft] = useState<{ saves: string[]; skills: Record<string, "proficient" | "expertise"> }>({ saves: [], skills: {} });
  const [idDraft, setIdDraft] = useState({ className: "", subclass: "", level: 1, race: "", background: "" });
  // Roll-entry settings (feedback #8), remembered per browser: "digital" click-to-roll vs "manual" (you
  // type a physical die), and for manual d20s whether the bonus is auto-added or already in your total.
  const [rollInput, setRollInput] = useState<"digital" | "manual">(() => (readSetting("vtt.sheet.rollInput") === "manual" ? "manual" : "digital"));
  const [bonusMode, setBonusMode] = useState<"auto" | "total">(() => (readSetting("vtt.sheet.bonusMode") === "total" ? "total" : "auto"));
  const chooseRollInput = (mode: "digital" | "manual") => { setRollInput(mode); writeSetting("vtt.sheet.rollInput", mode); };
  const chooseBonusMode = (mode: "auto" | "total") => { setBonusMode(mode); writeSetting("vtt.sheet.bonusMode", mode); };
  // Panel layout (feedback #9): the shared dice log rides beside the sheet as a second subpanel. Its
  // side (left/right of the sheet) docks like the GM tracker and is remembered per browser; on a narrow
  // phone the two panes can't sit side by side, so a Sheet/Dice segmented control shows one at a time.
  const hasLog = state !== undefined;
  const [logSide, setLogSide] = useState<"left" | "right">(() => (readSetting("vtt.sheet.logSide") === "left" ? "left" : "right"));
  const chooseLogSide = (side: "left" | "right") => { setLogSide(side); writeSetting("vtt.sheet.logSide", side); };
  const [mobilePane, setMobilePane] = useState<"sheet" | "log">("sheet");
  const { prompt, dialog } = usePrompt();
  // SRD spell reference (session-cached): supplies the base/upcast damage the "cast at" control auto-applies.
  const spellRef = useSpellReference();
  // Tap-to-roll: the server already lets a player roll for their own claimed actor (GM for anyone);
  // the roll lands in the shared dice history like any other roll. Attacks roll to-hit/damage as dice;
  // the GM still applies damage (players never mutate another creature's HP).
  const emitRollFormula = (formula: string, purpose: "check" | "save" | "attack" | "damage", label: string) => {
    setRolling(true);
    socket.emit("dice:roll", { commandId: newId(), formula, purpose, visibility: "public", actorId: actor.id }, (result: { ok: boolean; message?: string }) => {
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
  const spellDc = spellcasting && definition ? (spellcasting.saveDc ?? spellSaveDc(definition.abilityScores[spellcasting.ability], definition.proficiencyBonus)) : null;
  const spellAtk = spellcasting && definition ? (spellcasting.attackBonus ?? spellAttackBonus(definition.abilityScores[spellcasting.ability], definition.proficiencyBonus)) : null;
  // "Cast at" support: index the SRD spell data by id, and the character's slot pools by level.
  const spellIndex = new Map(spellRef.map((entry) => [entry.id, entry]));
  const slotMaxByLevel = new Map<number, number>((spellcasting?.slots ?? []).map((slot) => [slot.level, slot.max]));
  const slotLevels = [...slotMaxByLevel.entries()].filter(([, max]) => max > 0).map(([level]) => level).sort((a, b) => a - b);
  // Cast a leveled spell at a chosen slot level: spend that slot, then (for a damaging spell) auto-roll
  // the SRD upcast scaling for that level - one composable slot-spend + one dice roll, both server-checked.
  const castSpell = (spell: Readonly<{ id: string; name: string; level: number }>, level: number) => {
    const max = slotMaxByLevel.get(level) ?? 0;
    const rem = liveSlotRemaining.get(level) ?? max;
    if (max <= 0 || rem <= 0) { setFeedback(`No ${ordinal(level)}-level slots remain.`); return; }
    const content = spellIndex.get(spell.id);
    const upcast = level > spell.level ? content?.castingOptions.find((entry) => entry.level === level) : undefined;
    const formula = upcast?.damageRoll ?? content?.damageRoll ?? null;
    const rays = upcast?.targetCount ?? null;
    const suffix = rays ? ` ×${rays}` : "";
    setBusy(true);
    socket.emit("character:set-slot", { commandId: newId(), actorId: actor.id, level, remaining: rem - 1 }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) { setFeedback(result.message ?? "The slot could not be spent."); return; }
      // Digital rolls the (upscaled) damage; manual mode prompts for the physical total - both land in the log.
      if (formula) void rollFlat(formula, "damage", `${spell.name} at ${ordinal(level)}${suffix}${content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : ""}`);
      else setFeedback(`Cast ${spell.name} at ${ordinal(level)}${suffix} - spent a ${ordinal(level)}-level slot.`);
    });
  };
  const identity = character ? [character.classes.map((klass) => `${klass.subclass ? `${klass.subclass.name} ` : ""}${klass.name} ${klass.level}`).join(" / "), character.race?.name, character.background?.name].filter(Boolean).join(" · ") : null;
  const hasCoins = currency ? currency.cp + currency.sp + currency.ep + currency.gp + currency.pp > 0 : false;
  const attunedCount = inventory.filter((item) => item.attuned).length;
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
      ...(item.description ? { description: item.description } : {})
    } }, ack);
  };
  // Keep the coin editor in sync with the authoritative purse (re-syncs after each accepted change).
  useEffect(() => { setCoins({ cp: currency?.cp ?? 0, sp: currency?.sp ?? 0, ep: currency?.ep ?? 0, gp: currency?.gp ?? 0, pp: currency?.pp ?? 0 }); }, [currency?.cp, currency?.sp, currency?.ep, currency?.gp, currency?.pp]);
  // Light hand-edit (owner + GM, server-enforced): edit the per-PC imported definition's identity /
  // proficiency selections; guided creation stays in the future builder.
  const openProfEditor = () => { setProfDraft({ saves: proficiencies?.saves ? [...proficiencies.saves] : [], skills: Object.fromEntries((proficiencies?.skills ?? []).map((skill) => [skill.id, skill.proficiency])) }); setEditMode("prof"); };
  const toggleSave = (ability: string) => setProfDraft((prev) => ({ ...prev, saves: prev.saves.includes(ability) ? prev.saves.filter((entry) => entry !== ability) : [...prev.saves, ability] }));
  const cycleSkill = (id: string) => setProfDraft((prev) => { const current = prev.skills[id]; const next = current === undefined ? "proficient" : current === "proficient" ? "expertise" : undefined; const skills = { ...prev.skills }; if (next) skills[id] = next; else delete skills[id]; return { ...prev, skills }; });
  const saveProf = () => { setBusy(true); socket.emit("character:set-proficiencies", { commandId: newId(), actorId: actor.id, proficiencies: { saves: profDraft.saves as Array<"str" | "dex" | "con" | "int" | "wis" | "cha">, skills: Object.entries(profDraft.skills).map(([id, proficiency]) => ({ id, proficiency })) } }, (result) => { ack(result); if (result.ok) setEditMode(null); }); };
  const openIdEditor = () => { const klass = character?.classes[0]; setIdDraft({ className: klass?.name ?? "", subclass: klass?.subclass?.name ?? "", level: klass?.level ?? 1, race: character?.race?.name ?? "", background: character?.background?.name ?? "" }); setEditMode("identity"); };
  const saveIdentity = () => { const name = idDraft.className.trim(); const classes = name ? [{ id: slugify(name), name, ...(idDraft.subclass.trim() ? { subclass: { id: slugify(idDraft.subclass), name: idDraft.subclass.trim() } } : {}), level: idDraft.level }] : []; const next = { classes, feats: character?.feats ? [...character.feats] : [], ...(idDraft.race.trim() ? { race: { id: slugify(idDraft.race), name: idDraft.race.trim() } } : {}), ...(idDraft.background.trim() ? { background: { id: slugify(idDraft.background), name: idDraft.background.trim() } } : {}) }; setBusy(true); socket.emit("character:set-identity", { commandId: newId(), actorId: actor.id, character: next }, (result) => { ack(result); if (result.ok) setEditMode(null); }); };

  // The sheet's own scrolling content (one column of the workspace below).
  const sheetScroll = (<div className="sheet-scroll">
      <p className="sheet-typeline">
        {definition ? `${titleCase(definition.size)} ${extension.type ?? "creature"}, ${extension.alignment ?? "unaligned"}${extension.challengeRating !== undefined ? ` - CR ${formatChallenge(extension.challengeRating)}` : ""}` : `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM-only" : ""}`}
      </p>
      {(identity || (actor.kind === "player-character" && definition)) && <div className="sheet-identity-row">
        {editMode === "identity"
          ? <div className="sheet-editor sheet-id-editor">
              <label>Class<input type="text" value={idDraft.className} maxLength={60} onChange={(event) => setIdDraft((draft) => ({ ...draft, className: event.target.value }))} /></label>
              <label>Subclass<input type="text" value={idDraft.subclass} maxLength={60} onChange={(event) => setIdDraft((draft) => ({ ...draft, subclass: event.target.value }))} /></label>
              <label>Level<input type="number" min="1" max="20" value={idDraft.level} onChange={(event) => setIdDraft((draft) => ({ ...draft, level: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))) }))} /></label>
              <label>Race<input type="text" value={idDraft.race} maxLength={60} onChange={(event) => setIdDraft((draft) => ({ ...draft, race: event.target.value }))} /></label>
              <label>Background<input type="text" value={idDraft.background} maxLength={60} onChange={(event) => setIdDraft((draft) => ({ ...draft, background: event.target.value }))} /></label>
              <button type="button" className="sheet-save-btn" disabled={busy} onClick={saveIdentity}>Save</button>
              <button type="button" className="sheet-edit-toggle" onClick={() => setEditMode(null)}>Cancel</button>
            </div>
          : <><span className="sheet-identity">{identity ?? "No class set"}</span>{actor.kind === "player-character" && definition && <button type="button" className="sheet-edit-toggle" onClick={openIdEditor}>Edit</button>}</>}
      </div>}

      <div className="sheet-vitals">
        <div className="sheet-vital"><span>HP</span><strong>{exactHp ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}` : "-"}</strong></div>
        <div className="sheet-vital"><span>AC</span><strong>{actor.armorClass ?? "-"}</strong>{extension.armorDetail ? <small>{extension.armorDetail}</small> : null}</div>
        <div className="sheet-vital"><span>Initiative</span><strong>{actor.initiative !== undefined ? signed(actor.initiative) : "-"}</strong></div>
        {speeds && <div className="sheet-vital"><span>Speed</span><strong>{speeds}</strong></div>}
      </div>
      <SheetHpControls actorId={actor.id} allowSet={role === "gm"} onFeedback={setFeedback} />
      <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} />

      {definition && <>
        <div className="sheet-settings" role="group" aria-label="Roll entry settings">
          <span className="sheet-settings-label">Rolls</span>
          <div className="sheet-seg" role="group" aria-label="Roll input mode">
            <button type="button" className={rollInput === "digital" ? "on" : ""} aria-pressed={rollInput === "digital"} title="Tap a roll to have the app roll it" onClick={() => chooseRollInput("digital")}>Digital</button>
            <button type="button" className={rollInput === "manual" ? "on" : ""} aria-pressed={rollInput === "manual"} title="Tap a roll, then type your physical die result" onClick={() => chooseRollInput("manual")}>Manual</button>
          </div>
          {rollInput === "manual" && <div className="sheet-seg" role="group" aria-label="Typed bonus handling">
            <button type="button" className={bonusMode === "auto" ? "on" : ""} aria-pressed={bonusMode === "auto"} title="Type the die result; your bonus is added for you" onClick={() => chooseBonusMode("auto")}>Auto-add bonus</button>
            <button type="button" className={bonusMode === "total" ? "on" : ""} aria-pressed={bonusMode === "total"} title="Type the final total, bonus already included" onClick={() => chooseBonusMode("total")}>Final total</button>
          </div>}
        </div>
        <div className="sheet-abilities">
          {ABILITIES.map((ability) => {
            const score = definition.abilityScores[ability];
            const mod = modifierOf(score);
            const withProf = mod + definition.proficiencyBonus;
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
        {((proficiencies && (proficiencies.saves.length > 0 || proficiencies.skills.length > 0)) || actor.kind === "player-character") && <section className="sheet-section"><h3>Proficiencies{actor.kind === "player-character" && <button type="button" className="sheet-edit-toggle" onClick={() => editMode === "prof" ? setEditMode(null) : openProfEditor()}>{editMode === "prof" ? "Done" : "Edit"}</button>}</h3>
          {editMode === "prof"
            ? <div className="sheet-editor">
                <div className="sheet-roll-row"><span className="sheet-roll-label">Saves</span>{ABILITIES.map((ability) => <button type="button" key={ability} className={`sheet-prepare${profDraft.saves.includes(ability) ? " is-prepared" : ""}`} onClick={() => toggleSave(ability)}>{ability.toUpperCase()}</button>)}</div>
                <ul className="sheet-skill-list">{ALL_SKILLS.map((id) => { const tier = profDraft.skills[id]; return <li key={id}><span>{titleizeSkill(id)}</span><button type="button" className={`sheet-prepare${tier ? " is-prepared" : ""}`} onClick={() => cycleSkill(id)}>{tier ?? "—"}</button></li>; })}</ul>
                <button type="button" className="sheet-save-btn" disabled={busy} onClick={saveProf}>Save proficiencies</button>
              </div>
            : <>
                <div className="sheet-roll-row"><span className="sheet-roll-label">Saves</span>{ABILITIES.map((ability) => { const isProf = proficiencies?.saves.includes(ability) ?? false; const bonus = saveBonus(definition.abilityScores[ability], definition.proficiencyBonus, isProf); return <button type="button" key={ability} className={`sheet-roll-chip${isProf ? " is-proficient" : ""}`} disabled={rolling} title={`Roll a ${ability.toUpperCase()} saving throw${isProf ? " (proficient)" : ""}`} onClick={() => void rollD20(bonus, "save", `${ability.toUpperCase()} save`)}>{ability.toUpperCase()} {signed(bonus)}</button>; })}</div>
                <ul className="sheet-skill-list">
                  {ALL_SKILLS.map((id) => { const ability = SKILL_ABILITY[id]; const tier = proficiencies?.skills.find((skill) => skill.id === id)?.proficiency; const bonus = skillBonus(definition.abilityScores[ability], definition.proficiencyBonus, tier ?? "none"); return <li key={id}>
                    <button type="button" className="sheet-roll-chip" disabled={rolling} title={`Roll ${titleizeSkill(id)}`} onClick={() => void rollD20(bonus, "check", `${titleizeSkill(id)} check`)}>{signed(bonus)}</button>
                    <span className={`sheet-prof-dot${tier === "expertise" ? " expertise" : tier === "proficient" ? " proficient" : ""}`} title={tier ? `${tier}` : "not proficient"} aria-hidden="true" />
                    <span className="sheet-skill-name">{titleizeSkill(id)} <em>{ability.toUpperCase()}</em></span>
                  </li>; })}
                </ul>
              </>}
        </section>}
        {spellcasting && <section className="sheet-section"><h3>Spells</h3>
          <p className="sheet-entry"><strong>{spellcasting.ability.toUpperCase()} caster.</strong> Save DC {spellDc}{spellAtk !== null ? `, ${signed(spellAtk)} to hit` : ""}.</p>
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
                <ul className="sheet-spell-list">
                  {spells.map((spell) => { const isPrepared = preparedIds.has(spell.id) || spell.alwaysPrepared; const toggleable = spell.level > 0 && !spell.alwaysPrepared; return <li key={spell.id}>
                    {spell.level === 0 ? <span className="sheet-prep-tag cantrip">Cantrip</span> : toggleable
                      ? <button type="button" className={`sheet-prep-tag toggle${isPrepared ? " on" : ""}`} disabled={busy} title={isPrepared ? "Prepared - tap to unprepare" : "Not prepared - tap to prepare"} onClick={() => { setBusy(true); socket.emit("character:set-prepared", { commandId: newId(), actorId: actor.id, spellId: spell.id, prepared: !isPrepared }, ack); }}>{isPrepared ? "Prepared" : "Prepare"}</button>
                      : <span className="sheet-prep-tag on">Always</span>}
                    <span className="sheet-spell-name">{spell.name}</span>
                    {spell.level > 0 && actor.kind === "player-character" && <SpellCastControls spell={spell} content={spellIndex.get(spell.id)} slotLevels={slotLevels} slotMaxByLevel={slotMaxByLevel} liveRemaining={liveSlotRemaining} busy={busy} onCast={(castLevel) => castSpell(spell, castLevel)} />}
                  </li>; })}
                </ul>
              </div>;
            });
          })()}
          {pact ? <p className="sheet-entry">Pact Magic: {ordinal(pact.level)}-level slots, {pact.remaining} remaining.</p> : null}
        </section>}
        {actor.kind === "player-character" && <section className="sheet-section"><h3>Inventory</h3>
          {inventory.length > 0 && <ul className="sheet-item-list sheet-item-edit">
            {inventory.map((item) => <li key={item.id}>
              <span className="sheet-item-name">{item.name}{item.category ? <span className="sheet-item-cat">{item.category.split("-").map(titleCase).join(" ")}</span> : null}</span>
              <div className="sheet-item-controls">
                <div className="sheet-slot-stepper">
                  <button type="button" disabled={busy} aria-label={`One fewer ${item.name}`} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, quantity: item.quantity - 1 } }, ack); }}>−</button>
                  <span><strong>{item.quantity}</strong></span>
                  <button type="button" disabled={busy} aria-label={`One more ${item.name}`} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, quantity: item.quantity + 1 } }, ack); }}>+</button>
                </div>
                <button type="button" className={`sheet-prepare${item.equipped ? " is-prepared" : ""}`} disabled={busy} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, equipped: !item.equipped } }, ack); }}>{item.equipped ? "equipped" : "equip"}</button>
                <button type="button" className={`sheet-prepare${item.attuned ? " is-prepared" : ""}`} disabled={busy} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, attuned: !item.attuned } }, ack); }}>{item.attuned ? "attuned" : "attune"}</button>
                <button type="button" className="sheet-remove" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => { setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { ...item, quantity: 0 } }, ack); }}>×</button>
              </div>
            </li>)}
          </ul>}
          {attunedCount > 0 && <p className={`sheet-attunement${attunedCount > 3 ? " over" : ""}`}>Attunement {attunedCount}/3</p>}
          <form className="sheet-add-item" onSubmit={(event) => { event.preventDefault(); const name = newItem.trim(); if (!name) return; setBusy(true); socket.emit("character:set-inventory", { commandId: newId(), actorId: actor.id, item: { id: slugify(name), name, quantity: 1 } }, ack); setNewItem(""); }}>
            <input type="text" value={newItem} maxLength={120} placeholder="Add a custom item…" aria-label="New item name" onChange={(event) => setNewItem(event.target.value)} />
            <button type="submit" disabled={busy || !newItem.trim()}>Add</button>
            <button type="button" className="sheet-browse-gear" disabled={busy} onClick={() => setPickerOpen(true)}>Browse SRD gear</button>
          </form>
          {pickerOpen && <EquipmentPicker ownedCounts={ownedCounts} busy={busy} onAdd={addFromCatalog} onClose={() => setPickerOpen(false)} />}
          <div className="sheet-coins">
            {COINS.map((coin) => <label key={coin}>{coin}<input type="number" min="0" max="1000000" value={coins[coin]} onChange={(event) => setCoins((prev) => ({ ...prev, [coin]: Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0))) }))} /></label>)}
            <button type="button" disabled={busy} onClick={() => { setBusy(true); socket.emit("character:set-currency", { commandId: newId(), actorId: actor.id, currency: coins }, ack); }}>Save coins</button>
          </div>
        </section>}
        {extension.traits && extension.traits.length > 0 && <section className="sheet-section"><h3>Traits</h3>
          {extension.traits.map((trait) => <p key={trait.name} className="sheet-entry"><strong>{trait.name}.</strong> <RichText text={trait.description} /></p>)}
        </section>}
        {definition.actions.length > 0 && <section className="sheet-section"><h3>Actions</h3>
          {definition.actions.map((action) => { const atk = action.attack; return <div key={action.id} className="sheet-entry">
            <p><strong>{action.name}.</strong> <RichText text={action.description} /></p>
            {(atk || action.damage.length > 0) && <div className="sheet-roll-row">
              {atk && <button type="button" className="sheet-roll-chip" disabled={rolling} onClick={() => void rollD20(atk.bonus, "attack", `${action.name} to hit`)}>{signed(atk.bonus)} to hit</button>}
              {action.damage.map((part, index) => <button type="button" key={index} className="sheet-roll-chip" disabled={rolling} onClick={() => void rollFlat(part.formula, "damage", `${action.name} damage`)}>{part.formula}</button>)}
            </div>}
          </div>; })}
        </section>}
        <p className="sheet-attribution">Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.</p>
      </>}
      {!definition && role === "gm" && definitionId && !feedback && <p className="sheet-status">Loading stat block…</p>}
      {actor.kind === "player-character" && !definitionId && <p className="sheet-status">No imported sheet yet - the GM can import this character's JSON sheet from the roster.</p>}
      <p className="sheet-feedback" role="status">{feedback}</p>
  </div>);

  // Two-subpanel workspace (feedback #9): the sheet and, when the caller supplies live state, the shared
  // dice log ride side by side on a wide screen (log docked left or right); on a phone a Sheet/Dice
  // segmented control shows one pane at a time, so a roll's result is a tap away rather than a scroll away.
  const workspace = (<div className={`sheet-workspace log-${logSide}${hasLog ? " has-log" : " no-log"} show-${mobilePane}`}>
    {hasLog && <div className="sheet-workspace-bar">
      <div className="sheet-mobile-tabs" role="tablist" aria-label="Show sheet or dice">
        <button type="button" role="tab" aria-selected={mobilePane === "sheet"} className={mobilePane === "sheet" ? "on" : ""} onClick={() => setMobilePane("sheet")}>Sheet</button>
        <button type="button" role="tab" aria-selected={mobilePane === "log"} className={mobilePane === "log" ? "on" : ""} onClick={() => setMobilePane("log")}>Dice</button>
      </div>
      <div className="sheet-dock-picker" role="group" aria-label="Dice log position">
        <span className="sheet-dock-label">Log</span>
        <button type="button" aria-pressed={logSide === "left"} aria-label="Dice log left of the sheet" title="Dice log on the left" onClick={() => chooseLogSide("left")}>◧</button>
        <button type="button" aria-pressed={logSide === "right"} aria-label="Dice log right of the sheet" title="Dice log on the right" onClick={() => chooseLogSide("right")}>◨</button>
      </div>
    </div>}
    <div className="sheet-workspace-cols">
      <div className="sheet-workspace-pane sheet-pane">{sheetScroll}</div>
      {hasLog && state && <div className="sheet-workspace-pane log-pane"><DicePanel role={role} state={state} /></div>}
    </div>
  </div>);

  return <><Modal open onClose={onClose} size="lg" className={`character-sheet${hasLog ? " has-log" : ""}`} title={actor.name} ariaLabel={`${actor.name} character sheet`}>{workspace}</Modal>{dialog}</>;
}
