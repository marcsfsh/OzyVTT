import { useState } from "react";
import type { GmActor, GmView, PresenceStatus } from "@vtt/domain";
import { Avatar, Badge, Button, type AvatarPresence } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** Domain presence → Avatar's dot vocabulary (reconnecting reads as "away"). */
function presenceDot(presence: PresenceStatus): AvatarPresence { return presence === "online" ? "online" : presence === "reconnecting" ? "away" : "offline"; }

/**
 * GM Character Roster tab (v4 #10, v5 #4): every player character as a card in one gallery grid, like the
 * Scenes tab. The GM can open any sheet or archive a character - archived characters are hidden from
 * players (projection) and left out of the encounter builder / party. The server rejects archiving a
 * character that's in the running encounter.
 */
export function PartyRosterTab({ state }: Readonly<{ state: GmView }>) {
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const pcs = state.actors.filter((actor) => actor.kind === "player-character");
  const active = pcs.filter((actor) => !actor.archived);
  const archived = pcs.filter((actor) => actor.archived);
  const sheetActor = sheetActorId ? pcs.find((actor) => actor.id === sheetActorId) ?? null : null;

  const setArchived = (actorId: string, next: boolean) => {
    setBusy(true);
    socket.emit("actor:set-archived", { commandId: newId(), actorId, archived: next }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      setFeedback(result.ok ? (next ? "Character archived — hidden from players and the encounter builder." : "Character restored.") : result.message ?? "That change was rejected.");
    });
  };

  const card = (actor: GmActor, isArchived: boolean) => <li key={actor.id} className={`nh-card party-card${isArchived ? " is-archived" : ""}`}>
    <div className="nh-card-thumb party-card-thumb"><Avatar name={actor.name} size="lg" presence={actor.presence ? presenceDot(actor.presence) : undefined} /></div>
    {isArchived && <span className="nh-card-status"><Badge>Archived</Badge></span>}
    <div className="nh-card-body">
      <h3 className="nh-card-title">{actor.name}</h3>
      <span className="nh-card-meta">{actor.ownerSessionId ? "Claimed" : "Unclaimed"} · HP {actor.hp.current}/{actor.hp.maximum} · AC {actor.armorClass ?? "—"}</span>
    </div>
    <div className="nh-card-actions">
      <Button variant="secondary" disabled={busy} onClick={() => setSheetActorId(actor.id)}>View sheet</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setArchived(actor.id, !isArchived)}>{isArchived ? "Restore" : "Archive"}</Button>
    </div>
  </li>;

  return <section className="party-roster">
    <div className="party-heading">
      <span className="eyebrow">CHARACTER ROSTER</span>
      <h2>The party</h2>
      <p>Every player character on the table. Archived characters are hidden from players and left out of the encounter builder.</p>
    </div>
    {pcs.length === 0
      ? <div className="nh-empty"><span className="nh-empty-icon" aria-hidden="true">🎭</span><span className="nh-empty-title">No characters yet</span><span className="nh-empty-text">Import a character sheet from the roster on the Encounter tab.</span></div>
      : <>
        <ul className="nh-gallery party-gallery">{active.map((actor) => card(actor, false))}</ul>
        {archived.length > 0 && <><h3 className="party-archived-head">Archived ({archived.length})</h3><ul className="nh-gallery party-gallery">{archived.map((actor) => card(actor, true))}</ul></>}
      </>}
    {feedback && <p className="party-feedback" role="status">{feedback}</p>}
    {sheetActor && <CharacterSheet actor={sheetActor} role="gm" state={state} onClose={() => setSheetActorId(null)} />}
  </section>;
}
