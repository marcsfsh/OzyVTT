import { useState } from "react";
import type { GmView } from "@vtt/domain";
import { IconTv, Menu, MenuItem, StatusLamp, cx, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import { navigate, pathForGmTab } from "../router";
import { useTableMapSize } from "../scene/tableGeometry";
import { setViewerPreviewOpen, useViewerPreviewOpen } from "../viewer/preview-open";
import { PRESENTATION, tableScreenOn, usePresentation } from "./presentation";

/**
 * The table screen lamp in the GM's top bar: on while the screen shows a map, and a menu to pause it, put the live
 * scene back on it, preview it here, or open its settings. The screen follows the live scene by itself unless it is
 * paused here or in its settings.
 */
export function TvControl({ gmToken, state, compact }: Readonly<{ gmToken: string; state: GmView; compact: boolean }>) {
  const { presentation, refresh } = usePresentation(gmToken);
  const previewOpen = useViewerPreviewOpen();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const scenes = state.combat.encounters ?? [];
  const live = scenes.find((scene) => scene.id === state.combat.activeEncounterId) ?? null;
  const liveMap = state.combat.mapAssetId
    ? { assetId: state.combat.mapAssetId, name: live?.name ?? "Battle map" }
    : null;
  const size = useTableMapSize(liveMap?.assetId ?? null);

  const send = async (payload: Record<string, unknown>, done: string) => {
    if (!presentation) return;
    setBusy(true);
    try {
      await apiRequest(`${PRESENTATION}/commands`, {
        token: gmToken,
        body: { id: newId(), expectedRevision: presentation.revision, payload }
      });
      toast(done, { tone: "success" });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const on = tableScreenOn(presentation);
  const showsLive = Boolean(on && liveMap && presentation?.activeMap?.assetId === liveMap.assetId);
  const status =
    presentation === null ? "status unknown" : !on ? "off" : liveMap && !showsLive ? "on, another map" : "on";
  return (
    <Menu
      className="tv-control"
      triggerClassName={cx("app-bar-screen", compact && "is-compact")}
      align="end"
      hideCaret
      label={`Table screen, ${status}`}
      trigger={
        <>
          <IconTv />
          {!compact && <span className="app-bar-screen-label">Table screen</span>}
          <StatusLamp lit={on} />
          <span className="app-bar-screen-word" aria-hidden="true">
            {presentation === null ? "--" : on ? "ON" : "OFF"}
          </span>
        </>
      }
    >
      {on && (
        <MenuItem
          disabled={busy}
          onClick={() => void send({ type: "viewer.enabled.set", enabled: false }, "The table screen is paused.")}
        >
          Pause the table screen
        </MenuItem>
      )}
      {liveMap && !showsLive && (
        <MenuItem
          disabled={busy || !size}
          onClick={() =>
            void send(
              {
                type: "viewer.presentation.begin",
                assetId: liveMap.assetId,
                altText: liveMap.name,
                camera: { center: { x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 }, zoom: 1 }
              },
              "The table screen shows the live encounter."
            )
          }
        >
          Show the live encounter
        </MenuItem>
      )}
      <MenuItem onClick={() => setViewerPreviewOpen(!previewOpen)}>
        {previewOpen ? "Hide the preview" : "Preview the table screen here"}
      </MenuItem>
      <MenuItem onClick={() => navigate(pathForGmTab("viewer"))}>Table screen settings</MenuItem>
    </Menu>
  );
}
