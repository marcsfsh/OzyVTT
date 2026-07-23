import { useEffect, useState } from "react";
import type { ActorDefinition, GmActor, PlayerActor } from "@vtt/domain";
import { Modal } from "@vtt/ui";
import { abilityModifier as modifierOf, saveBonus, skillBonus, spellAttackBonus, spellSaveDc } from "@vtt/rules-5e";
import { ConditionEditor } from "./conditions";
import { RichText } from "./RichText";
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
/** SRD governing ability for each of the 18 skills (drives the read-only skill bonus). */
const SKILL_ABILITY: Record<string, (typeof ABILITIES)[number]> = {
  acrobatics: "dex", "animal-handling": "wis", arcana: "int", athletics: "str", deception: "cha",
  history: "int", insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis",
  nature: "int", perception: "wis", performance: "cha", persuasion: "cha", religion: "int",
  "sleight-of-hand": "dex", stealth: "dex", survival: "wis"
};

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
 * Read/track sheet: live actor state (hp, conditions) over the immutable stat block.
 * Track, never build - no editing of scores or actions here. The GM opens any combatant;
 * a player only ever receives their own actor (and no monster definition fetch succeeds
 * for them server-side).
 */
export function CharacterSheet({ actor, role, onClose }: Readonly<{ actor: GmActor | PlayerActor; role: "gm" | "player"; onClose: () => void }>) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? actor.definition ?? null : null;
  const [definition, setDefinition] = useState<ActorDefinition | null>(ownDefinition ?? (definitionId ? sheetCache.get(definitionId) ?? null : null));
  const [feedback, setFeedback] = useState("");
  const [rolling, setRolling] = useState(false);
  // Tap-to-roll: the server already lets a player roll for their own claimed actor (GM for anyone);
  // the roll lands in the shared dice history like any other roll. Attacks roll to-hit/damage as dice;
  // the GM still applies damage (players never mutate another creature's HP).
  const emitRoll = (formula: string, purpose: "check" | "save" | "attack" | "damage", label: string) => {
    setRolling(true);
    socket.emit("dice:roll", { commandId: newId(), formula, purpose, visibility: "public", actorId: actor.id }, (result: { ok: boolean; message?: string }) => {
      setRolling(false);
      setFeedback(result.ok ? `Rolled ${label} (${formula}) - see the dice log.` : result.message ?? "The roll was rejected.");
    });
  };

  useEffect(() => {
    if (role !== "gm" || !definitionId || ownDefinition || sheetCache.has(definitionId)) return;
    socket.emit("content:monster-sheet", { definitionId }, (result) => {
      if (result.ok && result.definition) { sheetCache.set(definitionId, result.definition); setDefinition(result.definition); }
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
  const identity = character ? [character.classes.map((klass) => `${klass.subclass ? `${klass.subclass.name} ` : ""}${klass.name} ${klass.level}`).join(" / "), character.race?.name, character.background?.name].filter(Boolean).join(" · ") : null;
  const hasCoins = currency ? currency.cp + currency.sp + currency.ep + currency.gp + currency.pp > 0 : false;

  // Portal to <body> so the sheet escapes any stacking context it's rendered inside - notably a
  // docked initiative panel (.encounter-map-dock, z-index 2), which would otherwise trap this
  // fixed overlay beneath the map's tool/zoom controls (z-index 3-6).
  return <Modal open onClose={onClose} size="lg" className="character-sheet" title={actor.name} ariaLabel={`${actor.name} character sheet`}>
      <p className="sheet-typeline">
        {definition ? `${titleCase(definition.size)} ${extension.type ?? "creature"}, ${extension.alignment ?? "unaligned"}${extension.challengeRating !== undefined ? ` - CR ${formatChallenge(extension.challengeRating)}` : ""}` : `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM-only" : ""}`}
      </p>
      {identity && <p className="sheet-identity">{identity}</p>}

      <div className="sheet-vitals">
        <div className="sheet-vital"><span>HP</span><strong>{exactHp ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}` : "-"}</strong></div>
        <div className="sheet-vital"><span>AC</span><strong>{actor.armorClass ?? "-"}</strong>{extension.armorDetail ? <small>{extension.armorDetail}</small> : null}</div>
        <div className="sheet-vital"><span>Initiative</span><strong>{actor.initiative !== undefined ? signed(actor.initiative) : "-"}</strong></div>
        {speeds && <div className="sheet-vital"><span>Speed</span><strong>{speeds}</strong></div>}
      </div>
      <SheetHpControls actorId={actor.id} allowSet={role === "gm"} onFeedback={setFeedback} />
      <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} />

      {definition && <>
        <div className="sheet-abilities">
          {ABILITIES.map((ability) => {
            const score = definition.abilityScores[ability];
            const save = extension.savingThrows?.[ability];
            return <button type="button" key={ability} className="sheet-ability sheet-rollable" disabled={rolling} onClick={() => emitRoll(d20(modifierOf(score)), "check", `${ability.toUpperCase()} check`)} title={`Roll ${ability.toUpperCase()} check`}>
              <span>{ability.toUpperCase()}</span>
              <strong>{score}</strong>
              <small>{signed(modifierOf(score))}{save !== null && save !== undefined ? ` / save ${signed(save)}` : ""}</small>
            </button>;
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
        {proficiencies && (proficiencies.saves.length > 0 || proficiencies.skills.length > 0) && <section className="sheet-section"><h3>Proficiencies</h3>
          {proficiencies.saves.length > 0 && <div className="sheet-roll-row"><span className="sheet-roll-label">Saves</span>{proficiencies.saves.map((ability) => { const bonus = saveBonus(definition.abilityScores[ability], definition.proficiencyBonus, true); return <button type="button" key={ability} className="sheet-roll-chip" disabled={rolling} onClick={() => emitRoll(d20(bonus), "save", `${ability.toUpperCase()} save`)}>{ability.toUpperCase()} {signed(bonus)}</button>; })}</div>}
          {proficiencies.skills.length > 0 && <ul className="sheet-skill-list">
            {proficiencies.skills.map((skill) => { const ability = SKILL_ABILITY[skill.id]; const bonus = ability ? skillBonus(definition.abilityScores[ability], definition.proficiencyBonus, skill.proficiency) : null; return <li key={skill.id}><span>{titleizeSkill(skill.id)}{skill.proficiency === "expertise" ? " (expertise)" : ""}</span>{bonus === null ? <strong>-</strong> : <button type="button" className="sheet-roll-chip" disabled={rolling} onClick={() => emitRoll(d20(bonus), "check", `${titleizeSkill(skill.id)} check`)}>{signed(bonus)}</button>}</li>; })}
          </ul>}
        </section>}
        {spellcasting && <section className="sheet-section"><h3>Spells</h3>
          <p className="sheet-entry"><strong>{spellcasting.ability.toUpperCase()} caster.</strong> Save DC {spellDc}{spellAtk !== null ? `, ${signed(spellAtk)} to hit` : ""}.</p>
          {spellcasting.slots.length > 0 && <div className="sheet-slots">{spellcasting.slots.map((slot) => <span key={slot.level} className="sheet-slot">{ordinal(slot.level)} <strong>{liveSlotRemaining.get(slot.level) ?? slot.max}/{slot.max}</strong></span>)}{pact ? <span className="sheet-slot">Pact {ordinal(pact.level)} <strong>{pact.remaining}</strong></span> : null}</div>}
          {spellcasting.spells.length > 0 && <ul className="sheet-spell-list">
            {[...spellcasting.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map((spell) => <li key={spell.id}><span>{spell.name}</span><small>{spell.level === 0 ? "Cantrip" : `${ordinal(spell.level)}${preparedIds.has(spell.id) || spell.alwaysPrepared ? " · prepared" : ""}`}</small></li>)}
          </ul>}
        </section>}
        {(inventory.length > 0 || hasCoins) && <section className="sheet-section"><h3>Inventory</h3>
          {inventory.length > 0 && <ul className="sheet-item-list">
            {inventory.map((item) => <li key={item.id}><span>{item.name}{item.quantity !== 1 ? ` ×${item.quantity}` : ""}</span>{(item.equipped || item.attuned) && <small>{[item.equipped ? "equipped" : null, item.attuned ? "attuned" : null].filter(Boolean).join(", ")}</small>}</li>)}
          </ul>}
          {hasCoins && currency && <p className="sheet-currency">{(["pp", "gp", "ep", "sp", "cp"] as const).flatMap((coin) => currency[coin] ? [`${currency[coin]} ${coin}`] : []).join(" · ")}</p>}
        </section>}
        {extension.traits && extension.traits.length > 0 && <section className="sheet-section"><h3>Traits</h3>
          {extension.traits.map((trait) => <p key={trait.name} className="sheet-entry"><strong>{trait.name}.</strong> <RichText text={trait.description} /></p>)}
        </section>}
        {definition.actions.length > 0 && <section className="sheet-section"><h3>Actions</h3>
          {definition.actions.map((action) => { const atk = action.attack; return <div key={action.id} className="sheet-entry">
            <p><strong>{action.name}.</strong> <RichText text={action.description} /></p>
            {(atk || action.damage.length > 0) && <div className="sheet-roll-row">
              {atk && <button type="button" className="sheet-roll-chip" disabled={rolling} onClick={() => emitRoll(d20(atk.bonus), "attack", `${action.name} to hit`)}>{signed(atk.bonus)} to hit</button>}
              {action.damage.map((part, index) => <button type="button" key={index} className="sheet-roll-chip" disabled={rolling} onClick={() => emitRoll(part.formula, "damage", `${action.name} damage`)}>{part.formula}</button>)}
            </div>}
          </div>; })}
        </section>}
        <p className="sheet-attribution">Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.</p>
      </>}
      {!definition && role === "gm" && definitionId && !feedback && <p className="sheet-status">Loading stat block…</p>}
      {actor.kind === "player-character" && !definitionId && <p className="sheet-status">No imported sheet yet - the GM can import this character's JSON sheet from the roster.</p>}
      <p className="sheet-feedback" role="status">{feedback}</p>
  </Modal>;
}
