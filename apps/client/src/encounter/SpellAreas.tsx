import type { GmView, MutationResult } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";
import { areaWords } from "./action-summary";
import { beginZonePlacement, clearTargeting, resolveTargeting, useTargeting, useTargetingBusy } from "./targeting";
import "./prompts.css";

/**
 * The GM's list of spell areas still acting on the map (Moonbeam, Spirit Guardians, a wall of fire): the server raises
 * their saves and deals their damage as creatures enter them or start or end their turns there. One a player cast
 * waits to be placed; any can be ended (webs burned away, a guardian dismissed). Placing one happens here alone: the
 * row says how, and holds Cancel and Set it here while the area is dragged on the map. Placing rolls nothing.
 */
export function SpellAreas({
  state,
  busy,
  run,
  onFeedback = () => {}
}: Readonly<{
  state: GmView;
  busy: boolean;
  run: (operation: () => Promise<MutationResult>, success: string) => void;
  /** Says why a placement was refused. */
  onFeedback?: (text: string) => void;
}>) {
  const zones = state.combat.spellZones ?? [];
  const session = useTargeting();
  const placing = useTargetingBusy();
  if (zones.length === 0) return null;
  const nameOf = (actorId: string) => state.actors.find((actor) => actor.id === actorId)?.name ?? "Unknown";
  return (
    <section className="spell-areas" aria-label="Spell areas">
      <h3 className="spell-areas-head">Spell areas</h3>
      <ul className="spell-areas-list">
        {zones.map((zone) => {
          const placed =
            zone.annotationId !== null && state.combat.annotations.some((shape) => shape.id === zone.annotationId);
          const where = zone.area === null ? "around its caster" : placed ? "on the map" : "not placed yet";
          const aiming = session?.placeZoneId === zone.id ? session : null;
          if (aiming && zone.area)
            return (
              <li key={zone.id} className="spell-area-row is-placing">
                <span className="spell-area-text" role="status">
                  <strong>{zone.name}</strong> ·{" "}
                  {/* The area keeps the spell's own size: the drag only places and points it. */}
                  {aiming.template?.placed
                    ? "Drag again to move it, or set it here."
                    : `Drag on the map to place the ${areaWords(zone.area)}.`}
                </span>
                <span className="spell-area-buttons">
                  <Button variant="secondary" disabled={placing} onClick={() => clearTargeting()}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={placing || !aiming.template?.placed}
                    onClick={() =>
                      resolveTargeting(state.revision, (ok, message) => {
                        onFeedback(ok ? `${zone.name} is placed.` : (message ?? "The area could not be placed."));
                      })
                    }
                  >
                    Set it here
                  </Button>
                </span>
              </li>
            );
          return (
            <li key={zone.id} className={`spell-area-row${zone.area !== null && !placed ? " unplaced" : ""}`}>
              <span className="spell-area-text">
                <strong>{zone.name}</strong> · {nameOf(zone.casterId)} · {where}
              </span>
              <span className="spell-area-buttons">
                {zone.area !== null && !placed && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      beginZonePlacement({ id: zone.id, name: zone.name, casterId: zone.casterId, area: zone.area })
                    }
                  >
                    Place
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => command("spell-zone:end", { zoneId: zone.id, expectedRevision: state.revision }),
                      `${zone.name} ended.`
                    )
                  }
                >
                  End
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
