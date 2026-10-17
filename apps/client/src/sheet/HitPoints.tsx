import { useState } from "react";
import { Button, GmOnlyTag, Input, Meter } from "@vtt/ui";
import { HpAdjust } from "../encounter/HpAdjust";
import { isDeadOnSheet } from "../encounter/mortality";
import { command } from "../lib/command";
import { exactHp, isDown, type SheetActor } from "./sheet-model";

/**
 * The hit point changes a character's player and the GM share: Damage, Heal and Temp. Setting an exact value and
 * reviving the dead are the GM's, in the GM tools.
 */
export function HpControls({
  actor,
  role,
  compact = false,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  /** The phone's Vitals: Damage and Heal only; the Hit Points drawer has the type and Temp. */
  compact?: boolean;
  onFeedback: (text: string) => void;
}>) {
  if (isDeadOnSheet(actor))
    return (
      <p className="cs-note">
        {role === "gm"
          ? `Dead. Revive ${actor.name} from the GM tools.`
          : `Dead. Ask the GM: only a revival brings ${actor.name} back.`}
      </p>
    );
  return (
    <HpAdjust
      actor={actor}
      controls={compact ? ["damage", "heal"] : ["damage", "heal", "temp"]}
      typed={!compact}
      onFeedback={onFeedback}
    />
  );
}

/** The current hit points large, the maximum and temporary hit points beside them, and the bar. */
export function HpReadout({ actor }: Readonly<{ actor: SheetActor }>) {
  const hp = exactHp(actor);
  const down = isDown(actor);
  if (!hp) return null;
  return (
    <div className="cs-hp-readout">
      <span className={`cs-eyebrow${down ? " is-danger" : ""}`}>{down ? "Hit Points · Dying" : "Hit Points"}</span>
      <span className="cs-hp-row">
        <strong className="cs-hp-big">{hp.current}</strong>
        <span className="cs-hp-of">of {hp.maximum}</span>
        <span className="cs-hp-temp">Temp {hp.temporary}</span>
      </span>
      <Meter tone="health" value={hp.current} max={hp.maximum} />
    </div>
  );
}

/** The laptop's Hit Points card and the phone's Hit Points drawer: the numbers, then the controls. The drawer also
 *  holds the GM's Set, in violet with the GM only mark; on a laptop it is in the GM tools beside the card. */
export function HpCard({
  actor,
  role,
  withSet = false,
  onFeedback
}: Readonly<{ actor: SheetActor; role: "gm" | "player"; withSet?: boolean; onFeedback: (text: string) => void }>) {
  return (
    <section className={`cs-card cs-hp-card${isDown(actor) ? " is-down" : ""}`} aria-label="Hit Points">
      <HpReadout actor={actor} />
      <HpControls actor={actor} role={role} onFeedback={onFeedback} />
      {withSet && role === "gm" && !isDeadOnSheet(actor) && (
        <div className="cs-gmbox" role="group" aria-label="Set Hit Points">
          <span className="cs-section-head">
            <span className="cs-eyebrow">Set Hit Points</span>
            <GmOnlyTag />
          </span>
          <HpAdjust actor={actor} controls={["set", "max"]} onFeedback={onFeedback} />
        </div>
      )}
    </section>
  );
}

/** The GM's hand-set Armor Class (Mage Armor, a natural armor the gear cannot show), or back to the worn gear. */
export function ArmorClassEditor({
  actor,
  onFeedback,
  onDone
}: Readonly<{ actor: SheetActor; onFeedback: (text: string) => void; onDone: () => void }>) {
  const [value, setValue] = useState(String(actor.armorClassOverride ?? actor.armorClass ?? ""));
  const [busy, setBusy] = useState(false);
  const send = (armorClass: number | null) => {
    setBusy(true);
    void command("actor:set-armor-class", { actorId: actor.id, armorClass }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The Armor Class change was rejected.");
        return;
      }
      onFeedback(
        armorClass === null ? `${actor.name}'s AC follows the worn gear again.` : `${actor.name}'s AC is ${armorClass}.`
      );
      onDone();
    });
  };
  const set = () => {
    const armorClass = Number(value);
    if (value === "" || !Number.isInteger(armorClass) || armorClass < 1 || armorClass > 40) {
      onFeedback("Enter a whole number from 1 to 40.");
      return;
    }
    send(armorClass);
  };
  return (
    <div className="cs-ac-edit" role="group" aria-label={`Set Armor Class for ${actor.name}`}>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        aria-label="Armor Class"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") set();
          else if (event.key === "Escape") onDone();
        }}
      />
      <Button size="sm" className="cs-gm-control" disabled={busy} onClick={set}>
        Save AC
      </Button>
      {actor.armorClassOverride !== undefined && (
        <Button size="sm" className="cs-gm-control" disabled={busy} onClick={() => send(null)}>
          Use worn gear
        </Button>
      )}
    </div>
  );
}
