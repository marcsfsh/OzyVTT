import { useState } from "react";
import { armorClassInPlay, type ActorDefinition, type GmActor, type PlayerActor } from "@vtt/domain";
import { Button, Input, Meter } from "@vtt/ui";
import { command } from "../lib/command";
import { HpAdjust } from "./HpAdjust";
import { signed } from "./format";
import type { SrdExtension } from "./sheet-extension";

/** HP with its tracker, AC, initiative and speeds, the numbers read most often mid-fight. */
export function SheetVitals({
  actor,
  role,
  definition,
  extension,
  onFeedback
}: Readonly<{
  actor: GmActor | PlayerActor;
  role: "gm" | "player";
  definition: ActorDefinition | null;
  extension: SrdExtension;
  onFeedback: (text: string) => void;
}>) {
  const [editingAc, setEditingAc] = useState(false);
  const hp = actor.hp;
  const exactHp = "kind" in hp ? (hp.kind === "exact" ? hp : null) : hp;
  const speeds = extension.speeds
    ? (["walk", "swim", "fly", "climb", "burrow"] as const)
        .flatMap((mode) => {
          const feet = extension.speeds?.[mode];
          return feet
            ? [
                `${mode === "walk" ? "" : `${mode} `}${feet} ft.${mode === "fly" && extension.speeds?.hover ? " (hover)" : ""}`
              ]
            : [];
        })
        .join(", ")
    : definition
      ? `${definition.speedFeet} ft.`
      : null;
  return (
    <div className="sheet-vitals">
      <div className="sheet-vital sheet-vital-hp">
        <div className="sheet-vital-top">
          <span>HP</span>
          <strong>
            {exactHp
              ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}`
              : "-"}
          </strong>
        </div>
        {exactHp && <Meter className="sheet-hp-meter" tone="health" value={exactHp.current} max={exactHp.maximum} />}
        <HpAdjust
          actor={actor}
          controls={role === "gm" ? ["damage", "heal", "temp", "set"] : ["damage", "heal", "temp"]}
          onFeedback={onFeedback}
        />
      </div>
      {role === "gm" ? (
        <button
          type="button"
          className="sheet-vital sheet-vital-button"
          title={extension.armorDetail ?? undefined}
          aria-expanded={editingAc}
          aria-label={`Armor Class ${armorClassInPlay(actor) ?? "unknown"}. Set it by hand`}
          onClick={() => setEditingAc((open) => !open)}
        >
          <span>AC</span>
          <strong>{armorClassInPlay(actor) ?? "-"}</strong>
          {actor.armorClassOverride !== undefined && <small className="sheet-vital-note">Set by GM</small>}
        </button>
      ) : (
        <div className="sheet-vital" title={extension.armorDetail ?? undefined}>
          <span>AC</span>
          {/* A Shield up shows in the number, since that is what attacks meet. */}
          <strong>{armorClassInPlay(actor) ?? "-"}</strong>
          {actor.armorClassOverride !== undefined && <small className="sheet-vital-note">Set by GM</small>}
        </div>
      )}
      <div className="sheet-vital">
        <span>Init</span>
        <strong>{actor.initiative !== undefined ? signed(actor.initiative) : "-"}</strong>
      </div>
      {speeds && (
        <div className="sheet-vital">
          <span>Speed</span>
          <strong>{speeds}</strong>
        </div>
      )}
      {role === "gm" && editingAc && (
        <ArmorClassEditor actor={actor} onFeedback={onFeedback} onDone={() => setEditingAc(false)} />
      )}
    </div>
  );
}

/** The GM's hand-set Armor Class (Mage Armor, a natural armor the gear cannot show), or back to the worn gear. */
function ArmorClassEditor({
  actor,
  onFeedback,
  onDone
}: Readonly<{ actor: GmActor | PlayerActor; onFeedback: (text: string) => void; onDone: () => void }>) {
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
        armorClass === null ? `${actor.name}'s AC follows their gear again.` : `${actor.name}'s AC is ${armorClass}.`
      );
      onDone();
    });
  };
  const set = () => {
    const armorClass = Number(value);
    if (value === "" || !Number.isInteger(armorClass) || armorClass < 1 || armorClass > 40) {
      onFeedback("Enter a whole number (1-40).");
      return;
    }
    send(armorClass);
  };
  return (
    <div className="sheet-ac-edit" role="group" aria-label={`Set Armor Class for ${actor.name}`}>
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
      <Button size="sm" disabled={busy} onClick={set}>
        Set AC
      </Button>
      {actor.armorClassOverride !== undefined && (
        <Button size="sm" disabled={busy} onClick={() => send(null)}>
          Use worn gear
        </Button>
      )}
    </div>
  );
}
