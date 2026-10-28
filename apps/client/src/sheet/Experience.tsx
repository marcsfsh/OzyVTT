import { useRef, useState } from "react";
import { experienceForNextLevel } from "@vtt/rules-5e";
import { Button, IconLevelUp, Stepper, countUp, useOnChange } from "@vtt/ui";
import { command } from "../lib/command";
import type { SheetActor } from "./sheet-model";

/** The character's Experience Points as this viewer received them; undefined before the GM awards any. */
export function experienceOf(actor: SheetActor): number | undefined {
  return "experiencePoints" in actor && typeof actor.experiencePoints === "number" ? actor.experiencePoints : undefined;
}

/**
 * SRD Character Advancement: the XP total and where the next level starts. A total that reaches it says so and, for
 * a viewer who may level the character, offers the level up; a table that levels by milestone never needs XP.
 */
export function ExperienceLine({
  points,
  level,
  onLevelUp
}: Readonly<{ points: number; level: number; onLevelUp?: (() => void) | undefined }>) {
  const next = experienceForNextLevel(level);
  // The total counts up to its new value as experience is awarded (ADR-0045).
  const total = useRef<HTMLElement>(null);
  useOnChange(points, (before, now) => {
    if (total.current && now > before)
      void countUp(total.current, before, now, { format: (value) => `${value.toLocaleString("en")} XP` });
  });
  const ready = next !== null && points >= next;
  return (
    <section className="cs-group" aria-label="Experience Points">
      <span className="cs-eyebrow">Experience Points</span>
      <p className={`cs-xp${ready ? " is-ready" : ""}`}>
        <strong ref={total} className="cs-xp-total">
          {points.toLocaleString("en")} XP
        </strong>
        <span className="cs-sub">
          {next === null
            ? "Level 20 is the last level."
            : ready
              ? `Enough for level ${level + 1}, which starts at ${next.toLocaleString("en")} XP.`
              : `Level ${level + 1} at ${next.toLocaleString("en")} XP.`}
        </span>
      </p>
      {ready && onLevelUp && (
        <Button size="sm" variant="primary" onClick={onLevelUp}>
          <IconLevelUp /> Level up to {level + 1}
        </Button>
      )}
    </section>
  );
}

/** The GM's award of XP to one character: an amount, taken back when negative. */
export function AwardExperience({
  actorId,
  name,
  onFeedback
}: Readonly<{ actorId: string; name: string; onFeedback: (text: string) => void }>) {
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const award = () => {
    setBusy(true);
    void command("actor:award-experience", { actorIds: [actorId], amount }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The XP was not awarded.");
      else
        onFeedback(
          result.ready && result.ready.length > 0
            ? `${name} has the XP to reach level ${result.ready[0]!.level}.`
            : `${name} ${amount < 0 ? "loses" : "gains"} ${Math.abs(amount).toLocaleString("en")} XP.`
        );
    });
  };
  return (
    <div className="cs-chiprow" role="group" aria-label={`Award XP to ${name}`}>
      <Stepper
        label="XP"
        value={amount}
        onChange={setAmount}
        min={-100000}
        max={100000}
        step={50}
        disabled={busy}
        aria-label={`XP to award ${name}`}
      />
      <Button size="sm" className="cs-gm-control" disabled={busy || amount === 0} onClick={award}>
        Award XP
      </Button>
    </div>
  );
}
