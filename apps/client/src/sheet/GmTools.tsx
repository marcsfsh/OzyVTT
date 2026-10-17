import { useState } from "react";
import type { GmView } from "@vtt/domain";
import { Button, GmOnlyTag, IconEye } from "@vtt/ui";
import { useRollPreference, rollModeOf } from "../dice/roll-preference";
import { DyingTracker } from "../encounter/DyingTracker";
import { HpAdjust } from "../encounter/HpAdjust";
import { isDeadOnSheet } from "../encounter/mortality";
import { isKnockedOut, partyHelpers, StabilizeControl } from "../encounter/StabilizeControl";
import { command } from "../lib/command";
import { ArmorClassEditor } from "./HitPoints";
import { GmLongRest } from "./PlayTab";
import { heroicInspirationOf, type SheetActor, type SheetState } from "./sheet-model";

/**
 * The GM's tools for this character, in violet with the GM only mark: set Hit Points or bring the dead back, set
 * the Armor Class by hand, give or take back Heroic Inspiration, a Long Rest, and while it is dying, Stabilize and a
 * Death Saving Throw rolled for it. Uses are given back on each use's row.
 */
export function GmTools({
  actor,
  state,
  onFeedback
}: Readonly<{ actor: SheetActor; state: SheetState | undefined; onFeedback: (text: string) => void }>) {
  const [open, setOpen] = useState<null | "hp" | "ac">(null);
  const [busy, setBusy] = useState(false);
  const { rollInput } = useRollPreference();
  const inspired = heroicInspirationOf(actor) === true;
  const dead = isDeadOnSheet(actor);
  const gmState = state && "definitions" in state ? (state as GmView) : null;
  const toggleInspiration = () => {
    setBusy(true);
    void command("actor:set-heroic-inspiration", { actorId: actor.id, has: !inspired }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "Heroic Inspiration could not be changed.");
      else
        onFeedback(
          inspired ? `${actor.name} no longer has Heroic Inspiration.` : `${actor.name} has Heroic Inspiration.`
        );
    });
  };
  const dying = actor.deathSaves !== null && actor.deathSaves !== undefined;
  return (
    <section className="cs-gmbox" aria-label="GM tools">
      <span className="cs-section-head">
        <span className="cs-eyebrow">
          <IconEye /> GM tools
        </span>
        <GmOnlyTag />
      </span>
      <div className="cs-chiprow">
        {!dead && (
          <Button
            size="sm"
            className="cs-gm-control"
            aria-expanded={open === "hp"}
            onClick={() => setOpen((current) => (current === "hp" ? null : "hp"))}
          >
            Set HP
          </Button>
        )}
        <Button
          size="sm"
          className="cs-gm-control"
          aria-expanded={open === "ac"}
          onClick={() => setOpen((current) => (current === "ac" ? null : "ac"))}
        >
          Set AC
        </Button>
        {actor.kind === "player-character" && (
          <Button
            size="sm"
            className="cs-gm-control"
            disabled={busy}
            aria-label={inspired ? "Take back Heroic Inspiration" : "Give Heroic Inspiration"}
            onClick={toggleInspiration}
          >
            {inspired ? "Take back Heroic Inspiration" : "Give Heroic Inspiration"}
          </Button>
        )}
        {state?.combat.active !== true && <GmLongRest actorId={actor.id} onFeedback={onFeedback} />}
      </div>
      {/* Only a revival brings the dead back, so it waits here without a tap to open it. */}
      {dead ? (
        <HpAdjust actor={actor} controls={["revive"]} onFeedback={onFeedback} />
      ) : (
        open === "hp" && (
          <HpAdjust
            actor={actor}
            controls={["set", "max"]}
            autoFocus
            onEscape={() => setOpen(null)}
            onFeedback={onFeedback}
          />
        )
      )}
      {open === "ac" && <ArmorClassEditor actor={actor} onFeedback={onFeedback} onDone={() => setOpen(null)} />}
      {actor.armorClassOverride !== undefined && <p className="cs-sub">The AC is set by hand.</p>}
      {(dying || isKnockedOut(actor)) && gmState && (
        <div className="cs-group" role="group" aria-label={`${actor.name} is ${dying ? "dying" : "knocked out"}`}>
          <span className="cs-eyebrow">
            {actor.name} is {dying ? "dying" : "knocked out"}
          </span>
          <StabilizeControl
            targetId={actor.id}
            targetName={actor.name}
            helpers={partyHelpers(gmState, actor.id)}
            gm
            knockedOut={!dying}
            onFeedback={onFeedback}
          />
          {dying && actor.deathSaves && (
            <DyingTracker
              actorId={actor.id}
              name={actor.name}
              deathSaves={actor.deathSaves}
              canRoll
              showPips={false}
              onFeedback={onFeedback}
              rollMode={rollModeOf(rollInput)}
              isActingTurn={false}
              viewer="gm"
              rollLabel={`Roll for ${actor.name}`}
            />
          )}
        </div>
      )}
    </section>
  );
}
