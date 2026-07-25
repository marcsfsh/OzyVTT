import { Badge, Button, Field, IconButton, Input, Select } from "@vtt/ui";
import { atlasApi, type CodexMap, type CodexMarker, type CodexMarkerInput, type CodexPageSummary } from "./api";
import { IconPicker, EntityIcon } from "./icons";
import { EntityPicker } from "./EntityPicker";
import { RevealSwitch } from "./SecretMarkers";
import { useConfirm } from "../components/feedback";
import { useState } from "react";

/**
 * The marker inspector: edit a pin's icon/color/label, wire its links, reveal it, or delete it. A pin can
 * link to MANY pages (open each) and MANY prepared scenes (launch each), plus one drill-down sub-map. The
 * launch/open actions live inline on each linked item - the GM taps a pin mid-prep to open a page or run
 * the fight staged there. All writes go through the atlas REST surface; the parent refreshes from the result.
 */
type MarkerScene = Readonly<{ id: string; name: string }>;
type MarkerInspectorProps = Readonly<{
  gmToken: string;
  marker: CodexMarker;
  pages: readonly CodexPageSummary[];
  maps: readonly CodexMap[];
  scenes: readonly MarkerScene[];
  activeSceneId: string | null;
  onUpdated: (marker: CodexMarker) => void;
  onDeleted: (markerId: string) => void;
  onOpenMap: (mapId: string) => void;
  onOpenPage: (pageId: string) => void;
  onCreatePage: () => void;
  onRevealPage: (pageId: string) => void;
  onActivateScene: (sceneId: string) => void;
  onClose: () => void;
}>;

export function MarkerInspector({ gmToken, marker, pages, maps, scenes, activeSceneId, onUpdated, onDeleted, onOpenMap, onOpenPage, onCreatePage, onRevealPage, onActivateScene, onClose }: MarkerInspectorProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [label, setLabel] = useState(marker.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (input: CodexMarkerInput) => {
    setBusy(true); setError(null);
    try { onUpdated(await atlasApi.updateMarker(gmToken, marker.id, input)); }
    catch { setError("That change didn't save - try again."); }
    finally { setBusy(false); }
  };
  const reveal = async (revealed: boolean) => {
    setError(null);
    try { onUpdated(await atlasApi.revealMarker(gmToken, marker.id, revealed)); }
    catch { setError("Couldn't change who can see this pin."); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete marker", body: "Delete this marker? This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    try { await atlasApi.deleteMarker(gmToken, marker.id); onDeleted(marker.id); }
    catch { setError("Couldn't delete the marker."); }
  };

  const subMaps = maps.filter((map) => map.id !== marker.mapId);
  const linkedPages = marker.pageIds.map((id) => pages.find((page) => page.id === id)).filter((page): page is CodexPageSummary => Boolean(page));
  const unlinkedPages = pages.filter((page) => !marker.pageIds.includes(page.id));
  const linkedScenes = marker.sceneIds.map((id) => scenes.find((scene) => scene.id === id)).filter((scene): scene is MarkerScene => Boolean(scene));
  const availableScenes = scenes.filter((scene) => !marker.sceneIds.includes(scene.id));
  const danglingScenes = marker.sceneIds.filter((id) => !scenes.some((scene) => scene.id === id)).length;
  const secretLinkedPages = linkedPages.filter((page) => marker.revealedToPlayers && !page.revealedToPlayers);

  return (
    <aside className="codex-inspector" aria-label="Marker">
      <div className="codex-inspector-head">
        <strong>{marker.label || "Marker"}</strong>
        <div className="codex-inspector-head-actions">
          <RevealSwitch revealed={marker.revealedToPlayers} onChange={reveal} ariaLabel="Show this marker to players" />
          <IconButton label="Close" size="sm" onClick={onClose}>✕</IconButton>
        </div>
      </div>

      {error && <p className="codex-inspector-hint" role="alert">{error}</p>}

      <Field label="Label" htmlFor="marker-label">
        <Input id="marker-label" value={label} placeholder="Unnamed" disabled={busy}
          onChange={(event) => setLabel(event.target.value)} onBlur={() => label !== (marker.label ?? "") && patch({ label: label.trim() || null })} />
      </Field>

      <IconPicker iconId={marker.iconId} color={marker.iconColor} onIcon={(iconId) => patch({ iconId })} onColor={(iconColor) => patch({ iconColor })} />

      <Field label="Linked pages">
        <div className="codex-marker-links">
          {linkedPages.map((page) => (
            <div key={page.id} className="codex-marker-link">
              <button type="button" className="codex-marker-link-open" onClick={() => onOpenPage(page.id)}>
                <EntityIcon type={page.entityType} /> <span className="codex-list-title">{page.title}</span>
              </button>
              <button type="button" className="codex-marker-link-x" aria-label={`Unlink ${page.title}`} disabled={busy} onClick={() => patch({ pageIds: marker.pageIds.filter((id) => id !== page.id) })}>✕</button>
            </div>
          ))}
          <EntityPicker pages={unlinkedPages} value={null} onChange={(id) => id && patch({ pageIds: [...marker.pageIds, id] })} ariaLabel="Link a page" placeholder="Link a page…" />
          <Button variant="ghost" size="sm" onClick={onCreatePage}>＋ New page{marker.label ? ` “${marker.label}”` : ""}</Button>
        </div>
      </Field>
      {secretLinkedPages.map((page) => (
        <p key={page.id} className="codex-inspector-hint">This pin is shown, but <strong>{page.title}</strong> is still secret — <button type="button" className="codex-linklike" onClick={() => onRevealPage(page.id)}>reveal it too</button>.</p>
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
                  ? <Badge tone="success">● Live</Badge>
                  : <Button variant="primary" size="sm" onClick={() => onActivateScene(scene.id)}>▶ Go live</Button>}
                <span className="codex-marker-link-name codex-list-title">{scene.name}</span>
                <button type="button" className="codex-marker-link-x" aria-label={`Unlink ${scene.name}`} disabled={busy} onClick={() => patch({ sceneIds: marker.sceneIds.filter((id) => id !== scene.id) })}>✕</button>
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

      <div className="codex-inspector-foot"><Button variant="ghost" size="sm" onClick={remove}>Delete marker</Button></div>
      {confirmDialog}
    </aside>
  );
}
