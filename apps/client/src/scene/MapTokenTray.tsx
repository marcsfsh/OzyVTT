import type { RefObject } from "react";
import type { EncounterToken, GmActor, PlayerActor } from "@vtt/domain";
import { initialsOf } from "./tokenGlyph";

/**
 * The staging tray, map side: everything added lands here and is not on the map until dragged out,
 * or tapped (dropped at the centre: the touch and keyboard route). Shown only while it has tokens to
 * place or a drag could drop one back in.
 */
export function MapTokenTray({
  trayRef,
  unplaced,
  actorsById,
  dragging,
  busy,
  placeAtCenter
}: Readonly<{
  trayRef: RefObject<HTMLDivElement | null>;
  unplaced: readonly EncounterToken[];
  actorsById: ReadonlyMap<string, GmActor | PlayerActor>;
  /** A token drag is in progress, so the tray takes a drop. */
  dragging: boolean;
  busy: boolean;
  placeAtCenter: (actorId: string) => void;
}>) {
  return (
    <div className={`encounter-token-tray${dragging ? " receiving" : ""}`} ref={trayRef} aria-label="Staging tray">
      <div>
        <strong>Staging tray</strong>
        <span>
          {unplaced.length
            ? "Drag one onto the map, or tap it to drop it at the centre."
            : "Drag a token here to take it off the map."}
        </span>
      </div>
      <div className="encounter-token-tray-list">
        {unplaced.map((encounterToken) => {
          const actor = actorsById.get(encounterToken.actorId);
          if (!actor) return null;
          const gmOnly = actor.visibility === "gm-only";
          /* `onClick` is the keyboard route only (Enter/Space); pointer taps are handled in `finishGesture`
           because pointer capture retargets the click. Both end in `placeAtCenter`. */
          return (
            <button
              key={encounterToken.actorId}
              data-token-id={encounterToken.actorId}
              className={`tray-token ${actor.kind}${gmOnly ? " hidden" : ""}`}
              disabled={busy}
              title={gmOnly ? `${actor.name} · GM only` : `${actor.name} · Shown to players`}
              onClick={() => placeAtCenter(encounterToken.actorId)}
            >
              <span>{initialsOf(actor.name)}</span>
              <strong>{actor.name}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
