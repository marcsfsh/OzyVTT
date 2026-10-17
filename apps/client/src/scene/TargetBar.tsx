import type { GmActor, PlayerActor } from "@vtt/domain";
import { Button, IconArrow } from "@vtt/ui";
import {
  clearTargeting,
  resolveTargeting,
  targetingReady,
  useTargetingBusy,
  type TargetingSession
} from "../encounter/targeting";
import "./target-bar.css";

/**
 * The confirm bar over the map while the GM picks targets for an action: who is targeted (or how to
 * place the area), Cancel, and Roll. Clicking tokens picks them; the server resolves the roll.
 */
export function TargetBar({
  activeTargeting,
  actorsById,
  revision,
  onFeedback
}: Readonly<{
  activeTargeting: TargetingSession;
  actorsById: ReadonlyMap<string, GmActor | PlayerActor>;
  revision: number;
  onFeedback: (text: string) => void;
}>) {
  const targetingBusy = useTargetingBusy();
  const isTemplate = activeTargeting.mode === "template";
  const placingZone = activeTargeting.placeZoneId !== undefined;
  const names = activeTargeting.selected.map((id) => actorsById.get(id)?.name ?? "?");
  const label = isTemplate
    ? activeTargeting.template?.placed
      ? placingZone
        ? " - placed; Place to set it there"
        : " - placed; Roll to catch everyone under it"
      : ` - drag the ${activeTargeting.action.area?.sizeFeet}-ft ${activeTargeting.action.area?.shape} on the map`
    : activeTargeting.mode === "none"
      ? " - choose the skill in the turn order, then Roll"
      : names.length
        ? null
        : activeTargeting.mode === "single"
          ? " - click a token to target it"
          : " - click tokens to target them";
  const ready = targetingReady(activeTargeting);
  return (
    <div className="encounter-target-bar" role="group" aria-label={`Targets for ${activeTargeting.action.name}`}>
      {/* The arrow is an icon, never a character. */}
      <span>
        <strong>{activeTargeting.action.name}</strong>
        {label ?? (
          <>
            {" "}
            <span className="encounter-target-arrow" aria-hidden="true">
              <IconArrow />
            </span>{" "}
            {names.join(", ")}
          </>
        )}
      </span>
      <span className="encounter-target-bar-buttons">
        <Button variant="secondary" disabled={targetingBusy} onClick={() => clearTargeting()}>
          Cancel
        </Button>
        <button
          type="button"
          className="encounter-primary"
          disabled={targetingBusy || !ready}
          onClick={() =>
            resolveTargeting(revision, (ok, resultMessage) =>
              onFeedback(ok || resultMessage === undefined ? "" : resultMessage)
            )
          }
        >
          {placingZone ? "Place" : `Roll ${activeTargeting.action.name}`}
        </button>
      </span>
    </div>
  );
}
