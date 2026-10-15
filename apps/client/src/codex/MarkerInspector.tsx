import {
  Alert,
  Badge,
  Button,
  Combobox,
  Field,
  HiddenFromPlayers,
  IconButton,
  IconPlay,
  IconPlus,
  IconX,
  Input,
  RevealSwitch,
  SaveState,
  Select,
  Switch,
  TagInput
} from "@vtt/ui";
import type { CodexAutosaveSettings, CodexJournalEntry, CodexMap, CodexMarker, CodexPageSummary } from "@vtt/domain";
import { atlasApi, journalApi, type CodexMarkerInput } from "./api";
import { useCodexAutosave } from "./autosave";
import { CodexIcon, IconPicker, EntityIcon, pinSwatchVar } from "./icons";

import { useConfirm } from "../components/feedback";
import { socket } from "../socket";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The marker inspector: a pin's icon, colour, label and tags, its links (many pages, many scenes, one
 * sub-map, one actor), reveal and delete. Writes go through the atlas REST surface.
 */
type MarkerScene = Readonly<{ id: string; name: string }>;
type MarkerActor = Readonly<{ id: string; name: string }>;
type MarkerInspectorProps = Readonly<{
  gmToken: string;
  marker: CodexMarker;
  pages: readonly CodexPageSummary[];
  autosave: CodexAutosaveSettings;
  maps: readonly CodexMap[];
  scenes: readonly MarkerScene[];
  actors: readonly MarkerActor[];
  activeSceneId: string | null;
  onUpdated: (marker: CodexMarker) => void;
  onDeleted: (markerId: string) => void;
  /** The party flag changed; the caller re-reads, since the previous party pin may be on another map. */
  onPartyChanged?: () => void | Promise<void>;
  onOpenMap: (mapId: string) => void;
  onOpenPage: (pageId: string) => void;
  onCreatePage: () => void;
  onRevealPage: (pageId: string) => void;
  /** Reveal the map this pin sits on. */
  onRevealMap?: () => void;
  onActivateScene: (sceneId: string) => void;
  /** Jump to the archived fight a combat entry came from. GM-only: archives carry GM narration. */
  onOpenReplay?: (archiveId: number) => void;
  onClose: () => void;
}>;

export function MarkerInspector({
  gmToken,
  marker,
  pages,
  maps,
  scenes,
  actors,
  activeSceneId,
  autosave,
  onUpdated,
  onDeleted,
  onPartyChanged = () => {},
  onOpenMap,
  onOpenPage,
  onCreatePage,
  onRevealPage,
  onRevealMap,
  onActivateScene,
  onOpenReplay,
  onClose
}: MarkerInspectorProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [label, setLabel] = useState(marker.label ?? "");
  const [tags, setTags] = useState<readonly string[]>(marker.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // This pin's journal history, including auto-logged battles.
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const loadEntries = useCallback(() => {
    void journalApi
      .forMarker(gmToken, marker.id)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [gmToken, marker.id]);
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);
  useEffect(() => {
    const onChanged = () => loadEntries();
    socket.on("codex:changed", onChanged);
    return () => {
      socket.off("codex:changed", onChanged);
    };
  }, [loadEntries]);

  const patch = async (input: CodexMarkerInput) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await atlasApi.updateMarker(gmToken, marker.id, input));
    } catch {
      setError("That change didn't save - try again.");
    } finally {
      setBusy(false);
    }
  };
  /**
   * The typed fields (label, tags) follow the autosave setting. Pickers stay immediate in both modes, like
   * reveal and the party toggle. Selecting another pin navigates, so the guard protects this draft.
   */
  const draft = useMemo(() => ({ label: label.trim(), tags }), [label, tags]);
  const saveDetails = useCallback(
    async (next: { label: string; tags: readonly string[] }) => {
      onUpdated(await atlasApi.updateMarker(gmToken, marker.id, { label: next.label || null, tags: [...next.tags] }));
    },
    [gmToken, marker.id, onUpdated]
  );
  const details = useCodexAutosave({ settings: autosave, draft, save: saveDetails });

  const reveal = async (revealed: boolean) => {
    setError(null);
    try {
      onUpdated(await atlasApi.revealMarker(gmToken, marker.id, revealed));
    } catch {
      setError("Couldn't change who can see this pin.");
    }
  };
  /** One party pin per atlas; setting this clears the previous one, possibly on another map, so the caller re-reads. */
  const setParty = async (isParty: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await atlasApi.setPartyMarker(gmToken, marker.id, isParty));
      await onPartyChanged();
    } catch {
      setError("Couldn't move the party pin.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: "Delete pin",
        body: "Delete this pin? This cannot be undone.",
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return;
    try {
      await atlasApi.deleteMarker(gmToken, marker.id);
      onDeleted(marker.id);
    } catch {
      setError("Couldn't delete the pin.");
    }
  };

  // Suggest tags already in use on pages and the atlas.
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(),
    [pages, maps]
  );
  const subMaps = maps.filter((map) => map.id !== marker.mapId);
  // A revealed pin on a hidden map is still invisible to players, so the inspector says so.
  const markerMap = maps.find((map) => map.id === marker.mapId) ?? null;
  const shownOnHiddenMap = marker.revealedToPlayers && markerMap !== null && !markerMap.revealedToPlayers;
  const linkedPages = marker.pageIds
    .map((id) => pages.find((page) => page.id === id))
    .filter((page): page is CodexPageSummary => Boolean(page));
  const unlinkedPages = pages.filter((page) => !marker.pageIds.includes(page.id));
  const linkedScenes = marker.sceneIds
    .map((id) => scenes.find((scene) => scene.id === id))
    .filter((scene): scene is MarkerScene => Boolean(scene));
  const availableScenes = scenes.filter((scene) => !marker.sceneIds.includes(scene.id));
  const danglingScenes = marker.sceneIds.filter((id) => !scenes.some((scene) => scene.id === id)).length;
  const secretLinkedPages = linkedPages.filter((page) => marker.revealedToPlayers && !page.revealedToPlayers);
  // A linked actor removed from the roster would otherwise show "None" while the id persists.
  const danglingActor = marker.actorId !== null && !actors.some((actor) => actor.id === marker.actorId);

  return (
    <aside className="codex-inspector scroll-y" aria-label="Pin">
      <div className="codex-inspector-head">
        <strong>{marker.label || "Unlabelled pin"}</strong>
        <div className="codex-inspector-head-actions">
          <RevealSwitch revealed={marker.revealedToPlayers} onChange={reveal} ariaLabel="Show this pin to players" />
          <IconButton label="Close" size="sm" onClick={onClose}>
            <IconX />
          </IconButton>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Label" htmlFor="marker-label">
        <Input
          id="marker-label"
          value={label}
          placeholder="Unnamed"
          disabled={busy}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      {/* Label and tags follow the autosave setting. */}
      <Field label="Tags" htmlFor="marker-tags">
        <TagInput
          id="marker-tags"
          ariaLabel="Tags"
          placeholder="dungeon, shop"
          values={tags}
          onChange={setTags}
          max={24}
          maxReachedReason="A pin may carry at most 24 tags."
          suggestions={tagSuggestions}
          /* Default slugify matches the server's tag rule. */
        />
      </Field>

      {/* The party flag. The hint says there is only one and that it moves with the pin; there is
          deliberately no second way to move it. */}
      <div className="codex-marker-party">
        <Switch
          checked={marker.isParty}
          disabled={busy}
          onChange={setParty}
          aria-label="This pin is the party's position"
          label={marker.isParty ? "The party is here" : "Not the party's position"}
        />
        <p className="codex-inspector-hint">
          {marker.isParty ? (
            <>Players see this pin marked as the party. Drag the pin to move the party.</>
          ) : (
            <>Only one pin in the atlas can be the party. Turning this on clears the pin that held it before.</>
          )}
        </p>
      </div>

      <Field label="Linked pages">
        <div className="codex-marker-links">
          {linkedPages.map((page) => (
            <div key={page.id} className="codex-marker-link">
              <button type="button" className="codex-marker-link-open" onClick={() => onOpenPage(page.id)}>
                <EntityIcon type={page.entityType} /> <span className="codex-list-title">{page.title}</span>
              </button>
              <IconButton
                label={`Unlink ${page.title}`}
                size="sm"
                onClick={() => patch({ pageIds: marker.pageIds.filter((id) => id !== page.id) })}
              >
                <IconX />
              </IconButton>
            </div>
          ))}
          <Combobox
            options={unlinkedPages.map((page) => ({
              id: page.id,
              label: page.title,
              icon: <EntityIcon type={page.entityType} />
            }))}
            value={null}
            onChange={(id) => id && patch({ pageIds: [...marker.pageIds, id] })}
            ariaLabel="Link a page"
            placeholder="Link a page"
          />
          {/* Opens quick-create prefilled with the pin's label, and links the new page on success. */}
          <Button variant="ghost" size="sm" onClick={onCreatePage}>
            <IconPlus /> New page{marker.label ? ` “${marker.label}”` : ""}
          </Button>
        </div>
      </Field>
      {shownOnHiddenMap && (
        <p className="codex-inspector-hint">
          This pin is shown to players, but the map <strong>{markerMap!.name}</strong> is hidden from them. Players
          cannot see either.
          {onRevealMap ? (
            <>
              {" "}
              <button type="button" className="codex-linklike" onClick={onRevealMap}>
                Show the map too
              </button>
              .
            </>
          ) : null}
        </p>
      )}
      {secretLinkedPages.map((page) => (
        <p key={page.id} className="codex-inspector-hint">
          This pin is shown to players, but <strong>{page.title}</strong> is hidden from them.{" "}
          <button type="button" className="codex-linklike" onClick={() => onRevealPage(page.id)}>
            Show it to players too
          </button>
          .
        </p>
      ))}

      {subMaps.length > 0 && (
        <Field label="Drills into map" htmlFor="marker-submap">
          <div className="codex-marker-submap">
            <Select
              id="marker-submap"
              value={marker.subMapId ?? ""}
              disabled={busy}
              onChange={(event) => patch({ subMapId: event.target.value || null })}
            >
              <option value="">None</option>
              {subMaps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </Select>
            {marker.subMapId && (
              <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(marker.subMapId!)}>
                Enter
              </Button>
            )}
          </div>
        </Field>
      )}

      {scenes.length > 0 && (
        <Field label="Linked scenes" help="Link the encounters prepared here, then launch any of them from this pin.">
          <div className="codex-marker-links">
            {linkedScenes.map((scene) => (
              <div key={scene.id} className="codex-marker-link">
                {activeSceneId === scene.id ? (
                  <Badge tone="success">
                    <span className="codex-dot" aria-hidden="true" /> Live
                  </Badge>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => onActivateScene(scene.id)}>
                    <IconPlay /> Go live
                  </Button>
                )}
                <span className="codex-marker-link-name codex-list-title">{scene.name}</span>
                <IconButton
                  label={`Unlink ${scene.name}`}
                  size="sm"
                  onClick={() => patch({ sceneIds: marker.sceneIds.filter((id) => id !== scene.id) })}
                >
                  <IconX />
                </IconButton>
              </div>
            ))}
            {availableScenes.length > 0 && (
              <Select
                aria-label="Link a scene"
                value=""
                disabled={busy}
                onChange={(event) =>
                  event.target.value && patch({ sceneIds: [...marker.sceneIds, event.target.value] })
                }
              >
                <option value="">Link a scene</option>
                {availableScenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Field>
      )}
      {danglingScenes > 0 && (
        <p className="codex-inspector-hint">
          {danglingScenes} linked scene{danglingScenes === 1 ? "" : "s"} no longer exist.{" "}
          <button
            type="button"
            className="codex-linklike"
            onClick={() => patch({ sceneIds: marker.sceneIds.filter((id) => scenes.some((scene) => scene.id === id)) })}
          >
            Clear them
          </button>
          .
        </p>
      )}

      {actors.length > 0 && (
        <Field label="Linked actor" htmlFor="marker-actor" help="An actor from the combat roster.">
          <Select
            id="marker-actor"
            value={marker.actorId ?? ""}
            disabled={busy}
            onChange={(event) => patch({ actorId: event.target.value || null })}
          >
            <option value="">None</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
          {danglingActor && (
            <p className="codex-inspector-hint">
              The linked actor no longer exists.{" "}
              <button type="button" className="codex-linklike" onClick={() => patch({ actorId: null })}>
                Clear it
              </button>
              .
            </p>
          )}
        </Field>
      )}

      <div className="codex-page-timeline">
        <h4 className="codex-backlinks-title">Journal</h4>
        {entries.length === 0 ? (
          <p className="codex-page-timeline-empty">
            Nothing logged at this pin yet. Battles fought here are recorded automatically.
          </p>
        ) : (
          <ul className="codex-page-timeline-list">
            {entries.map((entry) => (
              <li key={entry.id} className="codex-page-timeline-item">
                {entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}
                {(entry.sessionNumber != null || entry.inWorldLabel) && (
                  <span className="codex-page-timeline-meta">
                    {[entry.sessionNumber != null ? `S${entry.sessionNumber}` : null, entry.inWorldLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                {!entry.revealedToPlayers && <HiddenFromPlayers />}
                <span className="codex-page-timeline-text">{entry.playerText || entry.gmText}</span>
                {entry.kind === "combat" && entry.sourceEncounterId !== null && onOpenReplay && (
                  <button
                    type="button"
                    className="codex-linklike"
                    onClick={() => onOpenReplay(entry.sourceEncounterId!)}
                  >
                    Open replay
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The icon and colour grid is tall and least used, so it comes last and starts collapsed. */}
      <details className="codex-marker-appearance">
        <summary className="codex-marker-appearance-summary">
          <CodexIcon
            iconId={marker.iconId}
            className="codex-ent-icon"
            style={{ color: pinSwatchVar(marker.iconColor) }}
          />
          Appearance
        </summary>
        <IconPicker
          iconId={marker.iconId}
          color={marker.iconColor}
          onIcon={(iconId) => patch({ iconId })}
          onColor={(iconColor) => patch({ iconColor })}
        />
      </details>

      <div className="codex-inspector-foot">
        <SaveState status={details.status} />
        {!autosave.enabled && (
          <Button variant="secondary" size="sm" disabled={!details.dirty} onClick={() => void details.flush()}>
            Save pin
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={remove}>
          Delete pin
        </Button>
      </div>
      {confirmDialog}
    </aside>
  );
}
