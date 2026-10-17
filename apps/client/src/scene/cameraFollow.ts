import { useEffect, useEffectEvent, useRef } from "react";
import type { MapView, Point } from "./useMapView";

/** What the camera keeps in view: one creature in the middle, or several framed together. */
export type CameraFocus = Readonly<{ kind: "centre" | "frame"; actorIds: readonly string[] }> | null;

/**
 * Where the camera goes, from what this viewer already has. Choosing targets frames the attacker and the chosen
 * targets. A reaction prompt frames the reacting creature and the creature it answers. In a fight the creature whose
 * turn it is goes in the middle. Otherwise a player's own token does. Only tokens in this view count, so a creature
 * hidden from this viewer never moves the camera.
 */
export function cameraFocus({
  role,
  ownActorId,
  turnActorId,
  targeting,
  reaction,
  placed
}: Readonly<{
  role: "gm" | "player";
  ownActorId: string | null;
  turnActorId: string | null;
  targeting: Readonly<{ attackerId: string; selected: readonly string[] }> | null;
  /** The reaction waiting on an answer. A player's has no source, so the creature whose turn it is stands in. */
  reaction: Readonly<{ actorId: string; sourceActorId?: string | null }> | null;
  placed: (actorId: string) => boolean;
}>): CameraFocus {
  const shown = (ids: ReadonlyArray<string | null | undefined>) => [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && placed(id)))
  ];
  if (targeting) {
    const ids = shown([targeting.attackerId, ...targeting.selected]);
    if (ids.length > 0) return { kind: "frame", actorIds: ids };
  }
  if (reaction) {
    const ids = shown([reaction.actorId, reaction.sourceActorId ?? turnActorId]);
    if (ids.length > 0) return { kind: "frame", actorIds: ids };
  }
  if (turnActorId && placed(turnActorId)) return { kind: "centre", actorIds: [turnActorId] };
  if (role === "player" && ownActorId && placed(ownActorId)) return { kind: "centre", actorIds: [ownActorId] };
  return null;
}

/**
 * Moves the camera when the focus changes: once when the map opens, then each time the focus names someone else. A
 * focused token that moves is kept in view with the smallest pan, so a person's own panning is left alone otherwise.
 */
export function useCameraFollow({
  view,
  focus,
  positionOf,
  openKey,
  pad,
  settled
}: Readonly<{
  view: MapView;
  focus: CameraFocus;
  positionOf: (actorId: string) => Point | null;
  /** Changes when a different map opens, which starts the camera over. */
  openKey: string;
  /** Room round each focused token, in image pixels. */
  pad: number;
  /** False while what sets the opening zoom (the map's grid) is still loading. */
  settled: boolean;
}>) {
  const points = focus ? focus.actorIds.flatMap((id) => positionOf(id) ?? []) : [];
  const focusKey = focus ? `${focus.kind}:${focus.actorIds.join(",")}` : "none";
  const pointsKey = points.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(";");
  const opened = useRef<string | null>(null);
  const followed = useRef<string | null>(null);
  const move = useEffectEvent(() => {
    const centre =
      points.length > 0
        ? {
            x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
            y: points.reduce((sum, point) => sum + point.y, 0) / points.length
          }
        : null;
    if (opened.current !== openKey) {
      opened.current = openKey;
      followed.current = focusKey;
      view.open(centre);
      if (focus?.kind === "frame") view.frame(points, pad);
      return;
    }
    if (!focus || points.length === 0) {
      followed.current = focusKey;
      return;
    }
    if (followed.current !== focusKey) {
      followed.current = focusKey;
      if (focus.kind === "centre" && centre) view.centreOn(centre);
      else view.frame(points, pad);
      return;
    }
    view.frame(points, pad);
  });
  useEffect(() => {
    if (view.ready && settled) move();
  }, [view.ready, settled, openKey, focusKey, pointsKey]);
}
