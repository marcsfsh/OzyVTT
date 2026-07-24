import { useState } from "react";
import { Badge, Button, Field, IconButton, Input, Select, Switch } from "@vtt/ui";
import { atlasApi, type CodexMap, type CodexMarker, type CodexMarkerInput, type CodexPageSummary } from "./api";
import { IconPicker } from "./icons";

/**
 * The marker inspector: launch/navigate from a pin, edit its icon/color/label, wire its links (a wiki
 * page, a drill-down sub-map, a prepared Scene), reveal it to players, or delete it. The "go" actions
 * lead - during prep a GM taps a placed pin to open its page or to *run the fight staged there* - with
 * editing below. All writes go through the atlas REST surface; the parent refreshes from the result.
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
    if (!confirm("Delete this marker?")) return;
    try { await atlasApi.deleteMarker(gmToken, marker.id); onDeleted(marker.id); }
    catch { setError("Couldn't delete the marker."); }
  };

  const subMaps = maps.filter((map) => map.id !== marker.mapId);
  const linkedPage = pages.find((page) => page.id === marker.pageId) ?? null;
  const linkedScene = scenes.find((scene) => scene.id === marker.sceneId) ?? null;
  const hasGo = Boolean(marker.pageId || marker.subMapId || marker.sceneId);

  return (
    <aside className="codex-inspector" aria-label="Marker">
      <div className="codex-inspector-head">
        <strong>{marker.label || "Marker"}</strong>
        <div className="codex-inspector-head-actions">
          <Switch checked={marker.revealedToPlayers} onChange={reveal} label={marker.revealedToPlayers ? "Shown" : "Secret"} />
          <IconButton label="Close" size="sm" onClick={onClose}>✕</IconButton>
        </div>
      </div>

      {error && <p className="codex-inspector-hint" role="alert">{error}</p>}

      {hasGo && (
        <div className="codex-inspector-go">
          {marker.sceneId && (activeSceneId === marker.sceneId
            ? <Badge tone="success">● Live now</Badge>
            : <Button variant="primary" size="sm" onClick={() => onActivateScene(marker.sceneId!)}>▶ Go live here</Button>)}
          {marker.subMapId && <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(marker.subMapId!)}>Enter map</Button>}
          {marker.pageId && <Button variant="secondary" size="sm" onClick={() => onOpenPage(marker.pageId!)}>Open page</Button>}
        </div>
      )}

      <Field label="Label" htmlFor="marker-label">
        <Input id="marker-label" value={label} placeholder="Unnamed" disabled={busy}
          onChange={(event) => setLabel(event.target.value)} onBlur={() => label !== (marker.label ?? "") && patch({ label: label.trim() || null })} />
      </Field>

      <IconPicker iconId={marker.iconId} color={marker.iconColor} onIcon={(iconId) => patch({ iconId })} onColor={(iconColor) => patch({ iconColor })} />

      <Field label="Links to page" htmlFor="marker-page">
        <Select id="marker-page" value={marker.pageId ?? ""} disabled={busy} onChange={(event) => patch({ pageId: event.target.value || null })}>
          <option value="">— none —</option>
          {pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
        </Select>
      </Field>
      {!marker.pageId && <Button variant="ghost" size="sm" onClick={onCreatePage}>＋ New page{marker.label ? ` “${marker.label}”` : ""}</Button>}
      {linkedPage && marker.revealedToPlayers && !linkedPage.revealedToPlayers && (
        <p className="codex-inspector-hint">This pin is shown, but its page is still secret — <button type="button" className="codex-linklike" onClick={() => onRevealPage(linkedPage.id)}>reveal the page too</button>.</p>
      )}

      <Field label="Drills into map" htmlFor="marker-submap">
        <Select id="marker-submap" value={marker.subMapId ?? ""} disabled={busy} onChange={(event) => patch({ subMapId: event.target.value || null })}>
          <option value="">— none —</option>
          {subMaps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
        </Select>
      </Field>

      {scenes.length > 0 && (
        <Field label="Runs scene" htmlFor="marker-scene" help="Link the encounter you prepared here, then launch it from this pin.">
          <Select id="marker-scene" value={marker.sceneId ?? ""} disabled={busy} onChange={(event) => patch({ sceneId: event.target.value || null })}>
            <option value="">— none —</option>
            {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
          </Select>
        </Field>
      )}
      {marker.sceneId && !linkedScene && <p className="codex-inspector-hint">The linked scene was removed. Pick another, or clear it.</p>}

      <div className="codex-inspector-foot"><Button variant="ghost" size="sm" onClick={remove}>Delete marker</Button></div>
    </aside>
  );
}
