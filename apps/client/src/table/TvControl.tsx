import { useState } from "react";
import type { GmView } from "@vtt/domain";
import { useRef } from "react";
import { IconTv, Menu, MenuItem, Roll, StatusLamp, cool, cx, pop, rel, useOnChange, useToast, warm } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import { navigate, pathForGmTab } from "../router";
import { useTableMapSize } from "../scene/tableGeometry";
import { setViewerPreviewOpen, useViewerPreviewOpen } from "../viewer/preview-open";
import { PRESENTATION, tableScreenOn, usePresentation } from "./presentation";

/** The table screen's state and the actions it offers: shared by the frame's menu, the phone's More sheet and its
 *  controls page. The screen follows the live encounter by itself unless it is paused here or in its settings. */
export function useTableScreen(gmToken: string, state: GmView) {
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
  const actions: ReadonlyArray<Readonly<{ label: string; disabled: boolean; onSelect: () => void }>> = [
    ...(on
      ? [
          {
            label: "Pause the table screen",
            disabled: busy,
            onSelect: () => void send({ type: "viewer.enabled.set", enabled: false }, "The table screen is paused.")
          }
        ]
      : []),
    ...(liveMap && !showsLive
      ? [
          {
            label: "Show the live encounter",
            disabled: busy || !size,
            onSelect: () =>
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
        ]
      : []),
    {
      label: previewOpen ? "Hide the preview" : "Preview the table screen here",
      disabled: false,
      onSelect: () => setViewerPreviewOpen(!previewOpen)
    },
    { label: "Table screen settings", disabled: false, onSelect: () => navigate(pathForGmTab("viewer")) }
  ];
  return { presentation, on, status, actions };
}

/**
 * The table screen's lamp: lit while the screen shows a map, with a burst as it comes on and an afterglow as it goes
 * off, and ON or OFF rolling over like a tape counter (ADR-0045).
 */
export function TableScreenLamp({ on, known }: Readonly<{ on: boolean; known: boolean }>) {
  const lampHost = useRef<HTMLSpanElement>(null);
  useOnChange(on, (_was, now) => {
    const host = lampHost.current;
    const lamp = host?.querySelector(".nh-status-lamp");
    if (!host || !lamp) return;
    if (now) {
      warm(lamp, { dur: 200 });
      const box = rel(lamp, host);
      pop(host, { x: box.cx, y: box.cy, size: 30, tone: "cyan" });
    } else cool(lamp, "var(--lamp-on)", "var(--use-afterglow)");
  });
  return (
    <>
      <span ref={lampHost} className="app-bar-screen-lamp">
        <StatusLamp lit={on} />
      </span>
      <span className="app-bar-screen-word" aria-hidden="true">
        <Roll value={!known ? "--" : on ? "ON" : "OFF"} />
      </span>
    </>
  );
}

/**
 * The table screen lamp as a menu of its own (the table screen's controls page): on while the screen shows a map, and
 * a menu to pause it, put the live encounter back on it, preview it here, or open its settings.
 */
export function TvControl({ gmToken, state, compact }: Readonly<{ gmToken: string; state: GmView; compact: boolean }>) {
  const screen = useTableScreen(gmToken, state);
  return (
    <Menu
      className="tv-control"
      triggerClassName={cx("app-bar-screen", compact && "is-compact")}
      align="end"
      hideCaret
      label={`Table screen, ${screen.status}`}
      trigger={
        <>
          <IconTv />
          {!compact && <span className="app-bar-screen-label">Table screen</span>}
          <TableScreenLamp on={screen.on} known={screen.presentation !== null} />
        </>
      }
    >
      {screen.actions.map((action) => (
        <MenuItem key={action.label} disabled={action.disabled} onClick={action.onSelect}>
          {action.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
