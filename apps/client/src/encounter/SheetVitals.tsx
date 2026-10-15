import { useState } from "react";
import type { ActorDefinition, GmActor, PlayerActor } from "@vtt/domain";
import { Button, Meter } from "@vtt/ui";
import { command } from "../lib/command";
import { DamageTypeField } from "./DamageTypeField";
import { manualDamagePayload, manualDamageType } from "./manual-damage";
import { signed } from "./format";
import type { SrdExtension } from "./sheet-extension";

/**
 * Compact HP tracker inside the sheet; the server enforces scope (GM anyone, player self).
 * Exported so `damage-type.test.tsx` can test the damage-type payload without rendering the whole
 * sheet.
 */
export function SheetHpControls({
  actorId,
  allowSet,
  onFeedback
}: Readonly<{ actorId: string; allowSet: boolean; onFeedback: (text: string) => void }>) {
  const [amount, setAmount] = useState("");
  /**
   * The damage type is offered to players too (only `Set` is GM-gated): the server accepts
   * `damageType` from a player on their own character, and "12 fire" on your own sheet should apply
   * your own resistance.
   */
  const [damageType, setDamageType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", label: string) => {
    const value = Number(amount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) {
      onFeedback(`Enter a whole number (${minimum}-1000).`);
      return;
    }
    setBusy(true);
    // Only Dmg carries a type; Heal, Temp and Set share the row and have none.
    const typed = event === "actor:apply-damage" ? manualDamageType(damageType) : undefined;
    const sent =
      event === "actor:set-hp"
        ? command(event, { actorId, current: value })
        : event === "actor:apply-damage"
          ? command(event, manualDamagePayload({ actorId, amount: value, damageType: typed }))
          : command(event, { actorId, amount: value });
    void sent.then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? `${label} ${typed ? `${value} ${typed}` : value}.`
          : (result.message ?? "The hit point change was rejected.")
      );
      if (result.ok) setAmount("");
    });
  };
  return (
    <div className="sheet-hp-controls" role="group" aria-label="Track hit points">
      <input
        type="number"
        min="0"
        max="1000"
        placeholder="0"
        aria-label="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => send("actor:apply-damage", "Damaged")}>
        Dmg
      </Button>
      <Button size="sm" disabled={busy} onClick={() => send("actor:heal", "Healed")}>
        Heal
      </Button>
      <Button size="sm" disabled={busy} onClick={() => send("actor:set-temp-hp", "Temp set to")}>
        Temp
      </Button>
      {allowSet && (
        <Button size="sm" disabled={busy} onClick={() => send("actor:set-hp", "HP set to")}>
          Set
        </Button>
      )}
      <DamageTypeField value={damageType} disabled={busy} onChange={setDamageType} />
    </div>
  );
}

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
        <SheetHpControls actorId={actor.id} allowSet={role === "gm"} onFeedback={onFeedback} />
      </div>
      <div className="sheet-vital" title={extension.armorDetail ?? undefined}>
        <span>AC</span>
        <strong>{actor.armorClass ?? "-"}</strong>
      </div>
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
    </div>
  );
}
