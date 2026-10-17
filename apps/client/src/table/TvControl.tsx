import { useCallback, useEffect, useState } from "react";
import { IconTv, Menu, MenuItem, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import { navigate, pathForGmTab } from "../router";
import { useTableMapSize } from "../scene/tableGeometry";

type Presentation = Readonly<{
  revision: number;
  enabled: boolean;
  pausedByGm?: boolean;
  activeMap: Readonly<{ assetId: string }> | null;
}>;

const PRESENTATION = "/api/v1/viewer/presentation";

/**
 * The GM's TV control in the header bar: whether the table screen shows the live scene, and one tap to pause it or put
 * the live scene back on it. The TV follows the live scene by itself unless it is paused here or on the Shared
 * screen tab.
 */
export function TvControl({
  gmToken,
  liveMap,
  preview
}: Readonly<{
  gmToken: string;
  /** The live scene's map, or null while no scene is live. */
  liveMap: Readonly<{ assetId: string; name: string }> | null;
  /** The floating preview of what the table screen shows. */
  preview: Readonly<{ on: boolean; onToggle: () => void }>;
}>) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const size = useTableMapSize(liveMap?.assetId ?? null);
  const refresh = useCallback(async () => {
    const data = await apiRequest<{ presentation: Presentation }>(PRESENTATION, { token: gmToken });
    setPresentation(data.presentation);
  }, [gmToken]);
  useEffect(() => {
    void refresh().catch(() => {});
    const interval = window.setInterval(() => void refresh().catch(() => {}), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

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
      await refresh().catch(() => {});
      setBusy(false);
    }
  };

  const showsLive = Boolean(presentation?.enabled && liveMap && presentation.activeMap?.assetId === liveMap.assetId);
  const state = !presentation
    ? "…"
    : showsLive
      ? "Live"
      : presentation.enabled && presentation.activeMap
        ? "Another map"
        : "Paused";
  return (
    <Menu
      className="tv-control"
      triggerClassName={`tv-control-trigger${showsLive ? " is-live" : ""}`}
      align="end"
      label={`TV · ${state}`}
      trigger={
        <>
          <IconTv />
          <span className="tv-control-label">TV · {state}</span>
        </>
      }
    >
      {presentation?.enabled && presentation.activeMap ? (
        <MenuItem
          disabled={busy}
          onClick={() => void send({ type: "viewer.enabled.set", enabled: false }, "The TV is paused.")}
        >
          Pause the TV
        </MenuItem>
      ) : null}
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
              "The TV shows the live scene."
            )
          }
        >
          Show the live scene
        </MenuItem>
      )}
      <MenuItem onClick={preview.onToggle}>{preview.on ? "Hide the preview" : "Preview the TV here"}</MenuItem>
      <MenuItem onClick={() => navigate(pathForGmTab("viewer"))}>Shared screen settings</MenuItem>
    </Menu>
  );
}
