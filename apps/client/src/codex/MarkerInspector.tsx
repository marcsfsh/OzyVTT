import { useState } from "react";
import { Button, Field, Input, Select, Switch } from "@vtt/ui";
import { atlasApi, type CodexMap, type CodexMarker, type CodexMarkerInput, type CodexPageSummary } from "./api";
import { IconPicker } from "./icons";

/**
 * The marker inspector: edit a pin's icon/color/label, its links (a wiki page, a drill-down sub-map),
 * reveal it to players, drill into its sub-map, or delete it. All writes go through the atlas REST
 * surface; the parent refreshes from the returned marker.
 */
type MarkerInspectorProps = Readonly<{
  gmToken: string;
  marker: CodexMarker;
  pages: readonly CodexPageSummary[];
  maps: readonly CodexMap[];
  onUpdated: (marker: CodexMarker) => void;
  onDeleted: (markerId: string) => void;
  onOpenMap: (mapId: string) => void;
  onOpenPage: (pageId: string) => void;
  onClose: () => void;
}>;

export function MarkerInspector({ gmToken, marker, pages, maps, onUpdated, onDeleted, onOpenMap, onOpenPage, onClose }: MarkerInspectorProps) {
  const [label, setLabel] = useState(marker.label ?? "");
  const [busy, setBusy] = useState(false);

  const patch = async (input: CodexMarkerInput) => {
    setBusy(true);
    try { onUpdated(await atlasApi.updateMarker(gmToken, marker.id, input)); }
    finally { setBusy(false); }
  };
  const reveal = async (revealed: boolean) => { onUpdated(await atlasApi.revealMarker(gmToken, marker.id, revealed)); };
  const remove = async () => { if (confirm("Delete this marker?")) { await atlasApi.deleteMarker(gmToken, marker.id); onDeleted(marker.id); } };

  const subMaps = maps.filter((map) => map.id !== marker.mapId);

  return (
    <aside className="codex-inspector" aria-label="Marker">
      <div className="codex-inspector-head">
        <strong>Marker</strong>
        <div className="codex-inspector-head-actions">
          <Switch checked={marker.revealedToPlayers} onChange={reveal} label={marker.revealedToPlayers ? "Shown" : "Secret"} />
          <button type="button" className="codex-back" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

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
      {marker.pageId && <Button variant="secondary" size="sm" onClick={() => onOpenPage(marker.pageId!)}>Open page</Button>}

      <Field label="Drills into map" htmlFor="marker-submap">
        <Select id="marker-submap" value={marker.subMapId ?? ""} disabled={busy} onChange={(event) => patch({ subMapId: event.target.value || null })}>
          <option value="">— none —</option>
          {subMaps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
        </Select>
      </Field>
      {marker.subMapId && <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(marker.subMapId!)}>Enter map</Button>}

      <div className="codex-inspector-foot"><Button variant="ghost" size="sm" onClick={remove}>Delete marker</Button></div>
    </aside>
  );
}
