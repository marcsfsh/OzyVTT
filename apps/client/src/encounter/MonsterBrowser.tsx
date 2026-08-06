import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
import { Modal, Input } from "@vtt/ui";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** CR display matches the books: fractional ratings render as 1/8, 1/4, 1/2. */
const formatChallenge = (rating: number) => {
  if (rating === 0.125) return "1/8";
  if (rating === 0.25) return "1/4";
  if (rating === 0.5) return "1/2";
  return String(rating);
};
const titleCase = (value: string) => value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

/**
 * The bestiary browser. It adds; it does not decide who sees what.
 *
 * It used to carry its own "Add as GM-only" checkbox — a visibility decision made inside a modal,
 * away from the list it applied to, and available on no other add path. The staging tray owns that
 * decision now (D2/D28) and passes it in, so every add — browser, Recent, party — obeys one control.
 * `joinEncounter` is the other half: mid-fight, the roster add and the fight join are ONE command,
 * closing the two-step trap where this button promised a reinforcement it did not deliver.
 */
export function MonsterBrowser({ onClose, onAdded, visibility = "public", joinEncounter = false }: Readonly<{
  onClose: () => void;
  onAdded?: (actorId: string) => void;
  /** The staging tray's current "New tokens" state. */
  visibility?: "public" | "gm-only";
  /** True while a fight is running: the new monster lands in the roster AND in the turn order. */
  joinEncounter?: boolean;
}>) {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[] | null>(null);
  const [attribution, setAttribution] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  /**
   * A SET, not one id. A single in-flight marker meant `disabled={busyId !== null}` greyed all 330
   * Add buttons for one row's round trip, and a second click overwrote the first row's marker.
   * Concurrency is what a GM staging four monsters wants, and it is safe: every
   * `actor:add-from-definition` creates a new actor and carries its own `commandId`.
   */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * What has landed during THIS dialog session. The confirmation line says which monster went in;
   * this says which ROWS have, which is the half that stops a distracted GM adding the same monster
   * three times before noticing the first one worked. It resets with the dialog, because the
   * component unmounts when it closes.
   *
   * Deliberately not named `setMessage`/`setFeedback`: this is a per-row mark, not a second feedback
   * channel, and the one-channel check collides with those two names on purpose.
   */
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    socket.emit("content:monsters", {}, (result) => {
      if (!result.ok || !result.monsters) { setError(result.message ?? "The bundled bestiary could not be loaded."); return; }
      setMonsters(result.monsters);
      setAttribution(result.attribution ?? "");
    });
  }, []);

  const shown = useMemo(() => {
    if (!monsters) return [];
    const query = search.trim().toLowerCase();
    if (!query) return monsters;
    return monsters.filter((monster) => monster.name.toLowerCase().includes(query) || monster.type.toLowerCase().includes(query));
  }, [monsters, search]);

  const add = (monster: ContentMonsterSummary) => {
    setBusyIds((current) => new Set(current).add(monster.id));
    socket.emit("actor:add-from-definition", { commandId: newId(), definitionId: monster.id, visibility, ...(joinEncounter ? { joinEncounter: true } : {}) }, (result) => {
      setBusyIds((current) => { const next = new Set(current); next.delete(monster.id); return next; });
      if (result.ok && result.actorId) { setAddedIds((current) => new Set(current).add(monster.id)); onAdded?.(result.actorId); }
      setFeedback(result.ok
        ? `${monster.name} is in the staging tray${visibility === "gm-only" ? ", GM only" : ""}.`
        : result.message ?? "The monster could not be added.");
    });
  };

  return <Modal open onClose={onClose} size="lg" className="monster-browser" title="Add monsters" ariaLabel="Add monsters from the SRD bestiary">
    <div className="monster-browser-controls">
      <Input type="search" placeholder="Search by name or type…" aria-label="Search monsters" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
      <p className="monster-browser-target">Adds land in the staging tray · <strong>{visibility === "gm-only" ? "GM only" : "Shown to players"}</strong></p>
    </div>
    {error && <p className="monster-browser-status" role="alert">{error}</p>}
    {!error && !monsters && <p className="monster-browser-status">Loading the bestiary…</p>}
    {monsters && <ol className="monster-browser-list scroll-y">
      {shown.map((monster) => <li key={monster.id}>
        <div className="monster-browser-name"><strong>{monster.name}{addedIds.has(monster.id) && <span className="monster-browser-added">Added</span>}</strong><small>CR {formatChallenge(monster.challengeRating)} · {titleCase(monster.size)} {monster.type} · AC {monster.armorClass} · HP {monster.hitPoints}</small></div>
        <button type="button" className="monster-browser-add" disabled={busyIds.has(monster.id)} onClick={() => add(monster)}>{busyIds.has(monster.id) ? "Adding…" : "Add"}</button>
      </li>)}
      {shown.length === 0 && <li className="monster-browser-none">No monsters match "{search}".</li>}
    </ol>}
    <p className="monster-browser-feedback" role="status">{feedback}</p>
    {attribution && <p className="monster-browser-attribution">{attribution}</p>}
  </Modal>;
}
