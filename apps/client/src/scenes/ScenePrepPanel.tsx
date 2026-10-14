import { useEffect, useState, type ReactNode } from "react";
import { rosterActors, type GmActor, type MutationResult } from "@vtt/domain";
import { Button, IconPlus, useToast } from "@vtt/ui";
import { MonsterBrowser } from "../encounter/MonsterBrowser";
import { MapPicker, type PickerMap } from "../maps/MapPicker";
import type { MapSelection } from "../maps/MapManager";
import { StagingTray, type StagingEntry } from "./StagingTray";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { useConfirm } from "../components/feedback";
import "./scene-prep.css";

/**
 * The shared prep panel (map line, staging tray, the two Add buttons, Recent) rendered by both the
 * table's quick-start panel and the scene-prep workspace; they differ only in `footer` and in what
 * `onAdd`/`onRemove` commit to. The tray scrolls inside its own cap so the Add buttons and the
 * primary action stay on screen; Recent sits below Add monsters, collapsed, ten deep.
 * Archived characters appear nowhere here (the server refuses them anyway).
 */

const RECENT_COUNT = 10;

const emit = (event: string, payload: Record<string, unknown>, onError: (message: string) => void, failure: string) => {
  (socket.emit as (event: string, payload: unknown, ack: (result: MutationResult) => void) => void)(event, { commandId: newId(), ...payload }, (result) => {
    if (!result.ok) onError(result.message ?? failure);
  });
};

export function ScenePrepPanel({
  heading, actors, staged, placedIds, onAdd, onRemove, mapName, mapNote, mapLocked, selectedMapId, onSelectMap,
  mapToken, mapFallback, stagingRevealed, combatActive, busy = false, footer, emptyNote, placementHint
}: Readonly<{
  /** The panel's own title. Omit when the surface already has one. */
  heading?: string;
  actors: readonly GmActor[];
  /** Who is in this fight/scene, in order. */
  staged: readonly string[];
  /** Which of them already have a token on the map. */
  placedIds?: ReadonlySet<string>;
  onAdd: (actorId: string) => void;
  onRemove: (actorId: string) => void;
  mapName: string | null;
  /** One quiet line under the map row when choosing a map does more than choose a map. */
  mapNote?: string;
  /** The map cannot be changed here (a prepared scene owns its map for life). */
  mapLocked?: boolean;
  selectedMapId: string | null;
  onSelectMap?: (map: PickerMap) => void;
  mapToken?: string | null;
  mapFallback?: readonly MapSelection[];
  /** `GameState.stagingDefaults.visibility === "public"`: the tray toggle's starting state. */
  stagingRevealed: boolean;
  combatActive: boolean;
  busy?: boolean;
  footer?: ReactNode;
  emptyNote: string;
  placementHint?: boolean;
}>) {
  const [browsing, setBrowsing] = useState(false);
  const [pickingMap, setPickingMap] = useState(false);
  const [addingCharacters, setAddingCharacters] = useState(false);
  const [revealNew, setRevealNew] = useState(stagingRevealed);
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  // The table's standing default is the source of truth; a change made in Settings lands here.
  useEffect(() => setRevealNew(stagingRevealed), [stagingRevealed]);
  const fail = (message: string) => toast(message, { tone: "error" });

  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  // `rosterActors` drops a launched replay's clones (the server deletes them when the replay ends), and
  // archived characters are out of play. Applied here so every door agrees.
  const live = rosterActors(actors).filter((actor) => !actor.archived);
  const entries: readonly StagingEntry[] = staged.flatMap((actorId) => {
    const actor = byId.get(actorId);
    return actor ? [{ actorId, name: actor.name, kind: actor.kind, placed: placedIds?.has(actorId) ?? false, revealed: actor.visibility !== "gm-only" }] : [];
  });
  const stagedSet = new Set(staged);
  const addableCharacters = live.filter((actor) => actor.kind !== "monster" && !stagedSet.has(actor.id));
  // Recency is server-stamped (`lastUsedAt`, GM-only) by starting a fight and by staging a scene.
  const recent = live
    .filter((actor) => actor.kind !== "player-character" && actor.lastUsedAt !== undefined && !stagedSet.has(actor.id))
    .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
    .slice(0, RECENT_COUNT);

  /** The tray-level choice is the table's standing default, so every door agrees. */
  const setTrayReveal = (revealed: boolean) => {
    setRevealNew(revealed);
    emit("table:set-staging-defaults", { visibility: revealed ? "public" : "gm-only" }, fail, "The staging default could not be changed.");
    // The toast repeats exactly what the control now reads.
    toast(revealed ? "Shown to players." : "Hidden from players.", { tone: "info" });
  };
  const setEntryReveal = (actorId: string, revealed: boolean) => {
    emit("actor:set-visibility", { actorId, visibility: revealed ? "public" : "gm-only" }, fail, "The token's visibility could not be changed.");
  };
  /** Remove: out of this list, still on the roster. Mid-fight it is disruptive, so it asks. */
  const removeEntry = async (entry: StagingEntry) => {
    if (combatActive && !(await confirm({ title: `Remove ${entry.name} from this fight?`, body: `${entry.name} stays on the roster.`, confirmLabel: "Remove" }))) return;
    onRemove(entry.actorId);
  };

  return <div className="scene-prep">
    {heading && <h3 className="scene-prep-heading">{heading}</h3>}

    <div className="scene-prep-map">
      <span className="scene-prep-map-name">Map: <strong>{mapName ?? "None yet"}</strong></span>
      {!mapLocked && onSelectMap && <Button variant="secondary" size="sm" aria-expanded={pickingMap} onClick={() => setPickingMap((open) => !open)}>{pickingMap ? "Done" : mapName ? "Change" : "Pick a map"}</Button>}
    </div>
    {mapNote && pickingMap && <p className="scene-prep-note">{mapNote}</p>}
    {pickingMap && !mapLocked && onSelectMap && <MapPicker
      token={mapToken} selectedId={selectedMapId} fallback={mapFallback}
      // A tile tap is a decision, so the picker folds away. After an upload it stays open, because the
      // line under it says whether the new map's grid is set.
      onSelect={(map, meta) => { onSelectMap(map); if (!meta?.fromUpload) setPickingMap(false); }}
    />}

    <StagingTray
      entries={entries} revealNew={revealNew} onRevealNewChange={setTrayReveal} onRevealEntryChange={setEntryReveal}
      onRemove={(entry) => void removeEntry(entry)} busy={busy} emptyNote={emptyNote} placementHint={placementHint}
    />

    <div className="scene-prep-adds">
      <Button variant="secondary" disabled={busy} aria-expanded={addingCharacters} onClick={() => setAddingCharacters((open) => !open)}><IconPlus /> Add characters</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setBrowsing(true)}><IconPlus /> Add monsters</Button>
    </div>
    {addingCharacters && <div className="scene-prep-picklist scroll-y" role="group" aria-label="Add characters">
      {addableCharacters.length === 0
        ? <p className="scene-prep-note">Everyone on the roster is already staged.</p>
        : addableCharacters.map((actor) => <button key={actor.id} type="button" className="scene-prep-pick" disabled={busy} onClick={() => onAdd(actor.id)}>
            <strong>{actor.name}</strong><small>{actor.kind === "player-character" ? "Character" : "NPC"}</small>
          </button>)}
    </div>}

    {/* Collapsed, below the Add button, last ten. */}
    <details className="scene-prep-recent">
      <summary>Recent{recent.length > 0 ? ` (${recent.length})` : ""}</summary>
      {recent.length === 0
        ? <p className="scene-prep-note">Monsters you have used before show up here.</p>
        : <div className="scene-prep-picklist scroll-y">{recent.map((actor) => <button key={actor.id} type="button" className="scene-prep-pick" disabled={busy} onClick={() => onAdd(actor.id)}>
            <strong>{actor.name}</strong><small>{actor.visibility === "gm-only" ? "GM only" : "Shown to players"}</small>
          </button>)}</div>}
    </details>

    {footer && <div className="scene-prep-footer">{footer}</div>}

    {browsing && <MonsterBrowser
      visibility={revealNew ? "public" : "gm-only"}
      joinEncounter={combatActive}
      onClose={() => setBrowsing(false)}
      onAdded={(actorId) => onAdd(actorId)}
    />}
    {dialog}
  </div>;
}
