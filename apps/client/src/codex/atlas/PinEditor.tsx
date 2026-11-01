import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Combobox,
  Field,
  IconButton,
  IconPlay,
  IconPlus,
  IconX,
  Input,
  SaveState,
  Select,
  Switch,
  Tabs,
  TagInput,
  FieldAudienceToggle
} from "@vtt/ui";
import type { CodexAutosaveSettings, CodexMap, CodexMarker, CodexPageSummary } from "@vtt/domain";
import { atlasApi, type CodexMarkerInput } from "../api";
import { useCodexAutosave } from "../autosave";
import { EntityIcon, IconPicker } from "../icons";
import { useConfirm } from "../../components/feedback";

type EditorScene = Readonly<{ id: string; name: string }>;
type EditorActor = Readonly<{ id: string; name: string }>;
/** The editor's tabs, one at a time (F3 atlas spec 2.3): Look, Links, Encounters and Who sees it. */
type EditorTab = "look" | "links" | "encounters" | "who";

/**
 * Editing one pin in tabs: Look (its label, icon and colour), Links (pages and the map it opens), Encounters (the scenes
 * and the actor) and Who sees it (players, the party's pin, tags), with Delete pin and Done as the Cup. The typed fields
 * follow the autosave setting; pickers and switches save at once. Done goes back to the pin's view.
 */
export function PinEditor({
  gmToken,
  marker,
  pages,
  maps,
  scenes,
  actors,
  activeEncounterId,
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
  onDone
}: Readonly<{
  gmToken: string;
  marker: CodexMarker;
  pages: readonly CodexPageSummary[];
  maps: readonly CodexMap[];
  scenes: readonly EditorScene[];
  actors: readonly EditorActor[];
  activeEncounterId: string | null;
  autosave: CodexAutosaveSettings;
  onUpdated: (marker: CodexMarker) => void;
  onDeleted: (markerId: string) => void;
  /** The party flag changed; the caller reads the pins again, since the old party pin may sit on another map. */
  onPartyChanged?: () => void | Promise<void>;
  onOpenMap: (mapId: string) => void;
  onOpenPage: (pageId: string) => void;
  onCreatePage: () => void;
  onRevealPage: (pageId: string) => void;
  /** Shows the map this pin sits on to players. */
  onRevealMap?: () => void;
  onActivateScene: (encounterId: string) => void;
  onDone: () => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [label, setLabel] = useState(marker.label ?? "");
  const [tags, setTags] = useState<readonly string[]>(marker.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (input: CodexMarkerInput) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await atlasApi.updateMarker(gmToken, marker.id, input));
    } catch {
      setError("That change didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
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
  /** One party pin in the atlas: turning this on clears the one before, maybe on another map. */
  const setParty = async (isParty: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await atlasApi.setPartyMarker(gmToken, marker.id, isParty));
      await onPartyChanged();
    } catch {
      setError("Couldn't change the party pin.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: "Delete this pin?",
        body: "This cannot be undone.",
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

  const [tab, setTab] = useState<EditorTab>("look");
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(),
    [pages, maps]
  );
  const subMaps = maps.filter((map) => map.id !== marker.mapId);
  // A revealed pin on a hidden map is still out of players' sight, so the editor says so.
  const markerMap = maps.find((map) => map.id === marker.mapId) ?? null;
  const shownOnHiddenMap = marker.revealedToPlayers && markerMap !== null && !markerMap.revealedToPlayers;
  const linkedPages = marker.pageIds
    .map((id) => pages.find((page) => page.id === id))
    .filter((page): page is CodexPageSummary => Boolean(page));
  const unlinkedPages = pages.filter((page) => !marker.pageIds.includes(page.id));
  const linkedScenes = marker.encounterIds
    .map((id) => scenes.find((scene) => scene.id === id))
    .filter((scene): scene is EditorScene => Boolean(scene));
  const availableScenes = scenes.filter((scene) => !marker.encounterIds.includes(scene.id));
  const danglingScenes = marker.encounterIds.filter((id) => !scenes.some((scene) => scene.id === id)).length;
  const hiddenLinkedPages = linkedPages.filter((page) => marker.revealedToPlayers && !page.revealedToPlayers);
  const danglingActor = marker.actorId !== null && !actors.some((actor) => actor.id === marker.actorId);

  const name = marker.label?.trim() || "Unlabelled pin";
  return (
    <section className="atlas-pineditor" aria-label="Edit pin">
      {/* Back and EDIT PIN · {name} with the lamp that says it saved (F3 atlas spec 2.3). */}
      <header className="atlas-pinview-head">
        <h3 className="atlas-pinview-title">{`Edit pin · ${name}`}</h3>
        <SaveState status={details.status} />
      </header>

      {error && <Alert tone="danger">{error}</Alert>}
      {/* What players cannot see, whichever tab is open. */}
      {shownOnHiddenMap && (
        <p className="atlas-hint">
          This pin is shown to players, but the map <strong>{markerMap!.name}</strong> is hidden from them. Players
          cannot see either.
          {onRevealMap ? (
            <>
              {" "}
              <button type="button" className="atlas-linkbutton" onClick={onRevealMap}>
                Show the map too
              </button>
              .
            </>
          ) : null}
        </p>
      )}
      {hiddenLinkedPages.map((page) => (
        <p key={page.id} className="atlas-hint">
          This pin is shown to players, but <strong>{page.title}</strong> is hidden from them.{" "}
          <button type="button" className="atlas-linkbutton" onClick={() => onRevealPage(page.id)}>
            Show it to players too
          </button>
          .
        </p>
      ))}

      <Tabs
        ariaLabel="Pin settings"
        idBase="pin-editor"
        activeId={tab}
        onChange={(next) => setTab(next as EditorTab)}
        tabs={[
          { id: "look", label: "Look" },
          { id: "links", label: "Links" },
          { id: "encounters", label: "Encounters" },
          { id: "who", label: "Who sees it" }
        ]}
      />
      <div
        className="atlas-pineditor-tab"
        role="tabpanel"
        id={`pin-editor-panel-${tab}`}
        aria-labelledby={`pin-editor-tab-${tab}`}
      >
        {tab === "look" && (
          <>
            <div className="atlas-field-inline">
              <Field label="Label" htmlFor="pin-label">
                <Input
                  id="pin-label"
                  value={label}
                  placeholder="Unnamed"
                  disabled={busy}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
            </div>
            {!autosave.enabled && (
              <Button variant="secondary" size="sm" disabled={!details.dirty} onClick={() => void details.flush()}>
                Save pin
              </Button>
            )}

            <div className="atlas-appearance is-open">
              <IconPicker
                iconId={marker.iconId}
                color={marker.iconColor}
                onIcon={(iconId) => patch({ iconId })}
                onColor={(iconColor) => patch({ iconColor })}
              />
            </div>
          </>
        )}
        {tab === "links" && (
          <>
            <Field label="Linked pages">
              <div className="atlas-links">
                {linkedPages.map((page) => (
                  <div key={page.id} className="atlas-link">
                    <button type="button" className="atlas-link-open" onClick={() => onOpenPage(page.id)}>
                      <EntityIcon type={page.entityType} /> <span className="atlas-ellipsis">{page.title}</span>
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
                <Button size="sm" onClick={onCreatePage}>
                  <IconPlus /> New page{marker.label ? ` "${marker.label}"` : ""}
                </Button>
              </div>
            </Field>
            {subMaps.length > 0 && (
              <Field label="Opens a map" htmlFor="pin-submap">
                <div className="atlas-submap">
                  <Select
                    id="pin-submap"
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
          </>
        )}
        {tab === "encounters" && (
          <>
            {scenes.length > 0 && (
              <Field
                label="Encounters staged here"
                help="Link the encounters prepared here, then make any of them live."
              >
                <div className="atlas-links">
                  {linkedScenes.map((scene) => (
                    <div key={scene.id} className="atlas-link">
                      {activeEncounterId === scene.id ? (
                        <Badge tone="success">Live</Badge>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={() => onActivateScene(scene.id)}>
                          <IconPlay /> Go live
                        </Button>
                      )}
                      <span className="atlas-ellipsis atlas-link-name">{scene.name}</span>
                      <IconButton
                        label={`Unlink ${scene.name}`}
                        size="sm"
                        onClick={() => patch({ encounterIds: marker.encounterIds.filter((id) => id !== scene.id) })}
                      >
                        <IconX />
                      </IconButton>
                    </div>
                  ))}
                  {availableScenes.length > 0 && (
                    <Select
                      aria-label="Link an encounter"
                      value=""
                      disabled={busy}
                      onChange={(event) =>
                        event.target.value && patch({ encounterIds: [...marker.encounterIds, event.target.value] })
                      }
                    >
                      <option value="">Link an encounter</option>
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
              <p className="atlas-hint">
                {danglingScenes} linked scene{danglingScenes === 1 ? "" : "s"} no longer exist.{" "}
                <button
                  type="button"
                  className="atlas-linkbutton"
                  onClick={() =>
                    patch({ encounterIds: marker.encounterIds.filter((id) => scenes.some((scene) => scene.id === id)) })
                  }
                >
                  Clear them
                </button>
                .
              </p>
            )}

            {actors.length > 0 && (
              <Field label="Linked actor" htmlFor="pin-actor" help="An actor from the combat roster.">
                <Select
                  id="pin-actor"
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
                  <p className="atlas-hint">
                    The linked actor no longer exists.{" "}
                    <button type="button" className="atlas-linkbutton" onClick={() => patch({ actorId: null })}>
                      Clear it
                    </button>
                    .
                  </p>
                )}
              </Field>
            )}
          </>
        )}
        {tab === "who" && (
          <>
            <div className="atlas-field-inline">
              <FieldAudienceToggle
                field="this pin"
                hidden={!marker.revealedToPlayers}
                onChange={(hidden) => void reveal(!hidden)}
              />
            </div>
            <div className="atlas-partyflag">
              <Switch
                checked={marker.isParty}
                disabled={busy}
                onChange={setParty}
                aria-label="This pin marks the party"
                label={marker.isParty ? "This pin marks the party" : "Not the party's pin"}
              />
              <p className="atlas-hint">
                {marker.isParty
                  ? "Set party position moves this pin. Turn this off to keep the pin where it is."
                  : "Turning this on makes this pin the party's and clears the pin that held it before."}
              </p>
            </div>

            <Field label="Tags" htmlFor="pin-tags">
              <TagInput
                id="pin-tags"
                ariaLabel="Tags"
                placeholder="dungeon, shop"
                values={tags}
                onChange={setTags}
                max={24}
                maxReachedReason="A pin may carry at most 24 tags."
                suggestions={tagSuggestions}
              />
            </Field>
          </>
        )}
      </div>

      <div className="atlas-pineditor-foot">
        <Button variant="destructive" size="sm" onClick={remove}>
          Delete pin
        </Button>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
      {confirmDialog}
    </section>
  );
}
