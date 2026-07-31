import { Alert, Badge, Button, Combobox, Field, IconButton, IconPlay, IconPlus, IconX, Input, SaveState, Select, Switch, TagInput } from "@vtt/ui";
import { atlasApi, journalApi, type CodexAutosaveSettings, type CodexJournalEntry, type CodexMap, type CodexMarker, type CodexMarkerInput, type CodexPageSummary } from "./api";
import { useCodexAutosave } from "./autosave";
import { CodexIcon, IconPicker, EntityIcon, pinSwatchVar } from "./icons";

import { RevealSwitch, HiddenFromPlayers } from "./SecretMarkers";
import { useConfirm } from "../components/feedback";
import { socket } from "../socket";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The marker inspector: edit a pin's icon/color/label, wire its links, reveal it, or delete it. A pin can
 * link to MANY pages (open each) and MANY prepared scenes (launch each), plus one drill-down sub-map. The
 * launch/open actions live inline on each linked item - the GM taps a pin mid-prep to open a page or run
 * the fight staged there. All writes go through the atlas REST surface; the parent refreshes from the result.
 */
type MarkerScene = Readonly<{ id: string; name: string }>;
type MarkerActor = Readonly<{ id: string; name: string }>;
type MarkerInspectorProps = Readonly<{
  gmToken: string;
  marker: CodexMarker;
  pages: readonly CodexPageSummary[];
  /** D6's setting, handed down by the shell like every other editor gets it. */
  autosave: CodexAutosaveSettings;
  maps: readonly CodexMap[];
  scenes: readonly MarkerScene[];
  actors: readonly MarkerActor[];
  activeSceneId: string | null;
  onUpdated: (marker: CodexMarker) => void;
  onDeleted: (markerId: string) => void;
  /**
   * CT-7 / M12-C: the party flag moved. The caller re-reads the map's pins, because setting this one
   * cleared whichever pin held it before — and that pin may not be on the map currently open, so there
   * is no single row to patch. Optional so a caller with nothing to refresh still compiles.
   */
  onPartyChanged?: () => void | Promise<void>;
  onOpenMap: (mapId: string) => void;
  onOpenPage: (pageId: string) => void;
  onCreatePage: () => void;
  onRevealPage: (pageId: string) => void;
  /** CD-6: reveal the map this pin sits on. Optional so a caller without a map-reveal path still compiles. */
  onRevealMap?: () => void;
  onActivateScene: (sceneId: string) => void;
  /** Jump to the archived fight a combat entry came from. GM-only: archives carry GM narration. */
  onOpenReplay?: (archiveId: number) => void;
  onClose: () => void;
}>;

export function MarkerInspector({ gmToken, marker, pages, maps, scenes, actors, activeSceneId, autosave, onUpdated, onDeleted, onPartyChanged = () => {}, onOpenMap, onOpenPage, onCreatePage, onRevealPage, onRevealMap, onActivateScene, onOpenReplay, onClose }: MarkerInspectorProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [label, setLabel] = useState(marker.label ?? "");
  const [tags, setTags] = useState<readonly string[]>(marker.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // This pin's campaign history — including the battles the combat bridge auto-logs here. Mirrors
  // `PageTimeline`'s use of `journalApi.forPage`, which until now had no marker-side counterpart.
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const loadEntries = useCallback(() => { void journalApi.forMarker(gmToken, marker.id).then(setEntries).catch(() => setEntries([])); }, [gmToken, marker.id]);
  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { const onChanged = () => loadEntries(); socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [loadEntries]);

  const patch = async (input: CodexMarkerInput) => {
    setBusy(true); setError(null);
    try { onUpdated(await atlasApi.updateMarker(gmToken, marker.id, input)); }
    catch { setError("That change didn't save - try again."); }
    finally { setBusy(false); }
  };
  /**
   * D6, the arm this panel never had. The inspector wrote through on every control in BOTH modes, so a
   * GM who turned autosave off — and was told in that very panel that "editors show a Save button and
   * warn you before you leave with unsaved changes" — got the one editor that behaved the opposite way.
   *
   * Scoped to the two fields a GM TYPES. The pickers below (link a page, choose a sub-map, a scene, an
   * actor, the icon, the colour) stay immediate in both modes, which is D6's own recorded scope call:
   * choosing from a list is a discrete act, not an edit in progress, exactly like the reveal switch and
   * the party toggle. Known gap, recorded in `known-bugs.md`: selecting a DIFFERENT pin rewrites the
   * query rather than navigating, so it does not pass the router guard — an unsaved label is lost that
   * way, and the Save button and the "Unsaved changes" readout are what stand between the GM and it.
   */
  const draft = useMemo(() => ({ label: label.trim(), tags }), [label, tags]);
  const saveDetails = useCallback(async (next: { label: string; tags: readonly string[] }) => {
    onUpdated(await atlasApi.updateMarker(gmToken, marker.id, { label: next.label || null, tags: [...next.tags] }));
  }, [gmToken, marker.id, onUpdated]);
  const details = useCodexAutosave({ settings: autosave, draft, save: saveDetails });

  const reveal = async (revealed: boolean) => {
    setError(null);
    try { onUpdated(await atlasApi.revealMarker(gmToken, marker.id, revealed)); }
    catch { setError("Couldn't change who can see this pin."); }
  };
  /**
   * CT-7 / M12-C: mark this pin as the party's position. There is exactly ONE party pin for the whole
   * atlas, so setting this one clears whichever pin held it before — possibly on a different map, which
   * is why this reports through `onPartyChanged` (the caller re-reads) instead of patching one row.
   */
  const setParty = async (isParty: boolean) => {
    setBusy(true); setError(null);
    try { onUpdated(await atlasApi.setPartyMarker(gmToken, marker.id, isParty)); await onPartyChanged(); }
    catch { setError("Couldn't move the party pin."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete pin", body: "Delete this pin? This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    try { await atlasApi.deleteMarker(gmToken, marker.id); onDeleted(marker.id); }
    catch { setError("Couldn't delete the pin."); }
  };

  // Hint from the tags already in use on pages and on the atlas, so one vocabulary spans the suite.
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(),
    [pages, maps]
  );
  const subMaps = maps.filter((map) => map.id !== marker.mapId);
  // CD-6: revealing a pin does nothing if the map it sits on is still secret — players never see the
  // map, so they never see the pin. Nothing said so, so the GM believed the reveal had taken effect.
  const markerMap = maps.find((map) => map.id === marker.mapId) ?? null;
  const shownOnHiddenMap = marker.revealedToPlayers && markerMap !== null && !markerMap.revealedToPlayers;
  const linkedPages = marker.pageIds.map((id) => pages.find((page) => page.id === id)).filter((page): page is CodexPageSummary => Boolean(page));
  const unlinkedPages = pages.filter((page) => !marker.pageIds.includes(page.id));
  const linkedScenes = marker.sceneIds.map((id) => scenes.find((scene) => scene.id === id)).filter((scene): scene is MarkerScene => Boolean(scene));
  const availableScenes = scenes.filter((scene) => !marker.sceneIds.includes(scene.id));
  const danglingScenes = marker.sceneIds.filter((id) => !scenes.some((scene) => scene.id === id)).length;
  const secretLinkedPages = linkedPages.filter((page) => marker.revealedToPlayers && !page.revealedToPlayers);
  // A linked actor that has since been removed from the roster would otherwise render as "— none —"
  // while the id quietly persists on the marker — same honesty the scene links already get.
  const danglingActor = marker.actorId !== null && !actors.some((actor) => actor.id === marker.actorId);

  return (
    <aside className="codex-inspector" aria-label="Pin">
      <div className="codex-inspector-head">
        <strong>{marker.label || "Unlabelled pin"}</strong>
        <div className="codex-inspector-head-actions">
          <RevealSwitch revealed={marker.revealedToPlayers} onChange={reveal} ariaLabel="Show this pin to players" />
          <IconButton label="Close" size="sm" onClick={onClose}><IconX /></IconButton>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Label" htmlFor="marker-label">
        <Input id="marker-label" value={label} placeholder="Unnamed" disabled={busy}
          onChange={(event) => setLabel(event.target.value)} />
      </Field>

      {/* Sits with Label because both describe the pin itself, above the link wiring. Both ride the
          shared autosave hook: with it on they save shortly after the last edit, with it off they wait
          for the Save button below and say so until it is pressed. */}
      <Field label="Tags" htmlFor="marker-tags">
        <TagInput id="marker-tags" ariaLabel="Tags" placeholder="dungeon, shop" values={tags}
          onChange={setTags}
          max={24} maxReachedReason="A pin may carry at most 24 tags."
          suggestions={tagSuggestions}
          /* DEFAULT slugify — it is the server's own contract (`tags()` throws on a non-slug rather
             than cleaning it up), so normalising here is what keeps a typed "Old Mill" saveable. */ />
      </Field>

      {/* CT-7: the party's position. Sits with Label and Tags because it describes the pin itself, above
          the link wiring. `Switch` is the `@vtt/ui` primitive (R9) and carries its own 44px floor.
          The hint is R2's other half — the map draws a ring, but a ring is shape, and shape alone may
          never carry a state. It also says the two things a GM has to know: there is only one, and it
          is moved by moving the pin. There is deliberately no coordinate field and no "move the party"
          button here — a second way to move one marker is exactly what CT-7 must not grow. */}
      <div className="codex-marker-party">
        <Switch checked={marker.isParty} disabled={busy} onChange={setParty}
          aria-label="This pin is the party's position"
          label={marker.isParty ? "The party is here" : "Not the party's position"} />
        <p className="codex-inspector-hint">{marker.isParty
          ? <>Players see this pin marked as the party. Drag it to move the party — it is an ordinary pin, so its own position is the party's.</>
          : <>Only one pin in the whole atlas can be the party. Turning this on clears whichever pin held it before, wherever it was.</>}</p>
      </div>

      <Field label="Linked pages">
        <div className="codex-marker-links">
          {linkedPages.map((page) => (
            <div key={page.id} className="codex-marker-link">
              <button type="button" className="codex-marker-link-open" onClick={() => onOpenPage(page.id)}>
                <EntityIcon type={page.entityType} /> <span className="codex-list-title">{page.title}</span>
              </button>
              <IconButton label={`Unlink ${page.title}`} size="sm" onClick={() => patch({ pageIds: marker.pageIds.filter((id) => id !== page.id) })}><IconX /></IconButton>
            </div>
          ))}
          <Combobox options={unlinkedPages.map((page) => ({ id: page.id, label: page.title, icon: <EntityIcon type={page.entityType} /> }))}
            value={null} onChange={(id) => id && patch({ pageIds: [...marker.pageIds, id] })} ariaLabel="Link a page" placeholder="Link a page…" />
          {/* D7: opens the ONE quick-create dialog, prefilled with the pin's label, and links the new
              page to this pin on success — it no longer creates an untyped page behind the GM's back. */}
          <Button variant="ghost" size="sm" onClick={onCreatePage}><IconPlus /> New page{marker.label ? ` “${marker.label}”` : ""}</Button>
        </div>
      </Field>
      {shownOnHiddenMap && (
        <p className="codex-inspector-hint">This pin is shown, but the map <strong>{markerMap!.name}</strong> is still secret, so players cannot see either{onRevealMap ? <> — <button type="button" className="codex-linklike" onClick={onRevealMap}>show the map too</button>.</> : "."}</p>
      )}
      {secretLinkedPages.map((page) => (
        <p key={page.id} className="codex-inspector-hint">This pin is shown, but <strong>{page.title}</strong> is still secret — <button type="button" className="codex-linklike" onClick={() => onRevealPage(page.id)}>show it to players too</button>.</p>
      ))}

      {subMaps.length > 0 && (
        <Field label="Drills into map" htmlFor="marker-submap">
          <div className="codex-marker-submap">
            <Select id="marker-submap" value={marker.subMapId ?? ""} disabled={busy} onChange={(event) => patch({ subMapId: event.target.value || null })}>
              <option value="">— none —</option>
              {subMaps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
            </Select>
            {marker.subMapId && <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(marker.subMapId!)}>Enter</Button>}
          </div>
        </Field>
      )}

      {scenes.length > 0 && (
        <Field label="Linked scenes" help="Link the encounters prepared here, then launch any of them from this pin.">
          <div className="codex-marker-links">
            {linkedScenes.map((scene) => (
              <div key={scene.id} className="codex-marker-link">
                {activeSceneId === scene.id
                  ? <Badge tone="success"><span className="codex-dot" aria-hidden="true" /> Live</Badge>
                  : <Button variant="secondary" size="sm" onClick={() => onActivateScene(scene.id)}><IconPlay /> Go live</Button>}
                <span className="codex-marker-link-name codex-list-title">{scene.name}</span>
                <IconButton label={`Unlink ${scene.name}`} size="sm" onClick={() => patch({ sceneIds: marker.sceneIds.filter((id) => id !== scene.id) })}><IconX /></IconButton>
              </div>
            ))}
            {availableScenes.length > 0 && (
              <Select aria-label="Link a scene" value="" disabled={busy} onChange={(event) => event.target.value && patch({ sceneIds: [...marker.sceneIds, event.target.value] })}>
                <option value="">Link a scene…</option>
                {availableScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
              </Select>
            )}
          </div>
        </Field>
      )}
      {danglingScenes > 0 && <p className="codex-inspector-hint">{danglingScenes} linked scene{danglingScenes === 1 ? "" : "s"} no longer exist — <button type="button" className="codex-linklike" onClick={() => patch({ sceneIds: marker.sceneIds.filter((id) => scenes.some((scene) => scene.id === id)) })}>clear</button>.</p>}

      {actors.length > 0 && (
        <Field label="Linked actor" htmlFor="marker-actor" help="Who or what holds this place — an NPC, a monster, a creature stationed here.">
          <Select id="marker-actor" value={marker.actorId ?? ""} disabled={busy} onChange={(event) => patch({ actorId: event.target.value || null })}>
            <option value="">— none —</option>
            {actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
          </Select>
          {danglingActor && <p className="codex-inspector-hint">The linked actor no longer exists — <button type="button" className="codex-linklike" onClick={() => patch({ actorId: null })}>clear it</button>.</p>}
        </Field>
      )}

      <div className="codex-page-timeline">
        <h4 className="codex-backlinks-title">Journal</h4>
        {entries.length === 0
          ? <p className="codex-page-timeline-empty">Nothing logged at this pin yet. Battles fought here are recorded automatically.</p>
          : <ul className="codex-page-timeline-list">
              {entries.map((entry) => (
                <li key={entry.id} className="codex-page-timeline-item">
                  {entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}
                  {(entry.sessionNumber != null || entry.inWorldLabel) && <span className="codex-page-timeline-meta">{[entry.sessionNumber != null ? `S${entry.sessionNumber}` : null, entry.inWorldLabel].filter(Boolean).join(" · ")}</span>}
                  {!entry.revealedToPlayers && <HiddenFromPlayers />}
                  <span className="codex-page-timeline-text">{entry.playerText || entry.gmText}</span>
                  {entry.kind === "combat" && entry.sourceEncounterId !== null && onOpenReplay &&
                    <button type="button" className="codex-linklike" onClick={() => onOpenReplay(entry.sourceEncounterId!)}>Open replay</button>}
                </li>
              ))}
            </ul>}
      </div>

      {/* D25 / G16 — the icon-and-colour grid is ~500px tall and used to sit directly under the label,
          burying every functional control (links, sub-map, scenes, actor, journal) below the fold. It is
          the least-used half of this panel, so it moves last and starts collapsed, with the current
          icon in the summary so the GM can see what they have without opening it. */}
      <details className="codex-marker-appearance">
        <summary className="codex-marker-appearance-summary">
          <CodexIcon iconId={marker.iconId} className="codex-ent-icon" style={{ color: pinSwatchVar(marker.iconColor) }} />
          Appearance
        </summary>
        <IconPicker iconId={marker.iconId} color={marker.iconColor} onIcon={(iconId) => patch({ iconId })} onColor={(iconColor) => patch({ iconColor })} />
      </details>

      <div className="codex-inspector-foot">
        <SaveState status={details.status} />
        {!autosave.enabled && <Button variant="secondary" size="sm" disabled={!details.dirty} onClick={() => void details.flush()}>Save pin</Button>}
        <Button variant="ghost" size="sm" onClick={remove}>Delete pin</Button>
      </div>
      {confirmDialog}
    </aside>
  );
}
