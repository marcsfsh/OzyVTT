import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ActorDefinition, GmActor, PlayerActor } from "@vtt/domain";
import { ConditionEditor } from "./conditions";
import { RichText } from "./RichText";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** Definitions are immutable bundled content; one fetch per stat block per session. */
const sheetCache = new Map<string, ActorDefinition>();

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const modifierOf = (score: number) => Math.floor((score - 10) / 2);
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
const titleCase = (value: string) => value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const formatChallenge = (rating: number) => rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : String(rating);

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
 * Track, never build — no editing of scores or actions here. The GM opens any combatant;
 * a player only ever receives their own actor (and no monster definition fetch succeeds
 * for them server-side).
 */
export function CharacterSheet({ actor, role, onClose }: Readonly<{ actor: GmActor | PlayerActor; role: "gm" | "player"; onClose: () => void }>) {
  const definitionId = "definitionId" in actor ? actor.definitionId : undefined;
  const ownDefinition = "definition" in actor ? actor.definition ?? null : null;
  const [definition, setDefinition] = useState<ActorDefinition | null>(ownDefinition ?? (definitionId ? sheetCache.get(definitionId) ?? null : null));
  const [feedback, setFeedback] = useState("");

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

  // Portal to <body> so the sheet escapes any stacking context it's rendered inside — notably a
  // docked initiative panel (.encounter-map-dock, z-index 2), which would otherwise trap this
  // fixed overlay beneath the map's tool/zoom controls (z-index 3-6).
  return createPortal(<div className="confirm-overlay" role="presentation" onClick={onClose}>
    <div className="character-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-head">
        <div>
          <h2 id="sheet-title">{actor.name}</h2>
          <p className="sheet-typeline">
            {definition ? `${titleCase(definition.size)} ${extension.type ?? "creature"}, ${extension.alignment ?? "unaligned"}${extension.challengeRating !== undefined ? ` — CR ${formatChallenge(extension.challengeRating)}` : ""}` : `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM-only" : ""}`}
          </p>
        </div>
        <button type="button" className="secondary sheet-close" aria-label="Close the sheet" onClick={onClose}>✕</button>
      </div>

      <div className="sheet-vitals">
        <div className="sheet-vital"><span>HP</span><strong>{exactHp ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}` : "—"}</strong></div>
        <div className="sheet-vital"><span>AC</span><strong>{actor.armorClass ?? "—"}</strong>{extension.armorDetail ? <small>{extension.armorDetail}</small> : null}</div>
        <div className="sheet-vital"><span>Initiative</span><strong>{actor.initiative !== undefined ? signed(actor.initiative) : "—"}</strong></div>
        {speeds && <div className="sheet-vital"><span>Speed</span><strong>{speeds}</strong></div>}
      </div>
      <SheetHpControls actorId={actor.id} allowSet={role === "gm"} onFeedback={setFeedback} />
      <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} />

      {definition && <>
        <div className="sheet-abilities">
          {ABILITIES.map((ability) => {
            const score = definition.abilityScores[ability];
            const save = extension.savingThrows?.[ability];
            return <div key={ability} className="sheet-ability">
              <span>{ability.toUpperCase()}</span>
              <strong>{score}</strong>
              <small>{signed(modifierOf(score))}{save !== null && save !== undefined ? ` / save ${signed(save)}` : ""}</small>
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
        {extension.traits && extension.traits.length > 0 && <section className="sheet-section"><h3>Traits</h3>
          {extension.traits.map((trait) => <p key={trait.name} className="sheet-entry"><strong>{trait.name}.</strong> <RichText text={trait.description} /></p>)}
        </section>}
        {definition.actions.length > 0 && <section className="sheet-section"><h3>Actions</h3>
          {definition.actions.map((action) => <p key={action.id} className="sheet-entry"><strong>{action.name}.</strong> <RichText text={action.description} /></p>)}
        </section>}
        <p className="sheet-attribution">Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.</p>
      </>}
      {!definition && role === "gm" && definitionId && !feedback && <p className="sheet-status">Loading stat block…</p>}
      {actor.kind === "player-character" && !definitionId && <p className="sheet-status">No imported sheet yet — the GM can import this character's JSON sheet from the roster.</p>}
      <p className="sheet-feedback" role="status">{feedback}</p>
    </div>
  </div>, document.fullscreenElement ?? document.body);
}
