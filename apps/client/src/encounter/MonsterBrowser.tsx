import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
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

export function MonsterBrowser({ onClose }: Readonly<{ onClose: () => void }>) {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[] | null>(null);
  const [attribution, setAttribution] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

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
    setBusyId(monster.id);
    socket.emit("actor:add-from-definition", { commandId: newId(), definitionId: monster.id, visibility: hidden ? "gm-only" : "public" }, (result) => {
      setBusyId(null);
      setFeedback(result.ok ? `Added ${monster.name}${hidden ? " (GM-only)" : ""} to the roster.` : result.message ?? "The monster could not be added.");
    });
  };

  return <div className="confirm-overlay" role="presentation" onClick={onClose}>
    <div className="monster-browser" role="dialog" aria-modal="true" aria-labelledby="monster-browser-title" onClick={(event) => event.stopPropagation()}>
      <div className="monster-browser-head">
        <div><span className="eyebrow">SRD 5.2.1 BESTIARY</span><h2 id="monster-browser-title">Add monsters</h2></div>
        <button type="button" className="secondary monster-browser-close" onClick={onClose} aria-label="Close the monster browser">✕</button>
      </div>
      <div className="monster-browser-controls">
        <input type="search" placeholder="Search by name or type…" aria-label="Search monsters" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
        <label className="monster-browser-hidden"><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />Add as GM-only (hidden from players)</label>
      </div>
      {error && <p className="monster-browser-status" role="alert">{error}</p>}
      {!error && !monsters && <p className="monster-browser-status">Loading the bestiary…</p>}
      {monsters && <ol className="monster-browser-list">
        {shown.map((monster) => <li key={monster.id}>
          <div className="monster-browser-name"><strong>{monster.name}</strong><small>CR {formatChallenge(monster.challengeRating)} · {titleCase(monster.size)} {monster.type} · AC {monster.armorClass} · HP {monster.hitPoints}</small></div>
          <button type="button" className="monster-browser-add" disabled={busyId !== null} onClick={() => add(monster)}>{busyId === monster.id ? "Adding…" : "Add"}</button>
        </li>)}
        {shown.length === 0 && <li className="monster-browser-none">No monsters match "{search}".</li>}
      </ol>}
      <p className="monster-browser-feedback" role="status">{feedback}</p>
      {attribution && <p className="monster-browser-attribution">{attribution}</p>}
    </div>
  </div>;
}
