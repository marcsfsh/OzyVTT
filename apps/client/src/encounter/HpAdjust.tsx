import { useState } from "react";
import { Input } from "@vtt/ui";
import { command } from "../lib/command";
import { DamageTypeField } from "./DamageTypeField";
import { manualDamagePayload, manualDamageType } from "./manual-damage";

/** The hit point changes a door offers: damage, a nonlethal knock-out, heal, temporary HP, and an exact value. */
export type HpControl = "damage" | "nonlethal" | "heal" | "temp" | "set";

const LABELS: Record<HpControl, { label: string; title?: string }> = {
  damage: { label: "Dmg", title: "Apply as damage (or press Enter)" },
  nonlethal: {
    label: "KO",
    title: "Nonlethal damage - a drop to 0 knocks out (Unconscious and stable) instead of dying"
  },
  heal: { label: "Heal" },
  temp: { label: "Temp", title: "Set temporary hit points" },
  set: { label: "Set", title: "Set current hit points" }
};

/**
 * A typed number and the hit point changes to apply it as, with the damage type beside it. One control
 * for every hand-entry door: the turn-order row's tools, the character sheet and the token menu. The
 * server enforces scope (the GM on anyone, a player on their own character).
 */
export function HpAdjust({
  actor,
  controls,
  revision,
  damageType,
  onDamageTypeChange,
  autoFocus = false,
  onEscape,
  onFeedback
}: Readonly<{
  actor: Readonly<{ id: string; name: string }>;
  controls: readonly HpControl[];
  /** Guards the change against a stale view where the caller has one. */
  revision?: number;
  /** A caller that keeps the type across doors (one fireball, several tokens) passes it in. */
  damageType?: string | null;
  onDamageTypeChange?: (type: string | null) => void;
  autoFocus?: boolean;
  onEscape?: () => void;
  onFeedback: (text: string) => void;
}>) {
  const [amount, setAmount] = useState("");
  const [ownType, setOwnType] = useState<string | null>(null);
  const chosenType = onDamageTypeChange ? (damageType ?? null) : ownType;
  const chooseType = onDamageTypeChange ?? setOwnType;
  const [busy, setBusy] = useState(false);

  const adjust = (control: HpControl) => {
    const value = Number(amount.trim());
    const minimum = control === "temp" || control === "set" ? 0 : 1;
    if (amount.trim() === "" || !Number.isInteger(value) || value < minimum || value > 1000) {
      onFeedback(`Enter a whole number (${minimum}-1000).`);
      return;
    }
    // The type rides only on damage; a leftover "fire" must not travel with Heal, Temp or Set.
    const typed = control === "damage" || control === "nonlethal" ? manualDamageType(chosenType) : undefined;
    const guard = revision !== undefined ? { expectedRevision: revision } : {};
    const sent =
      control === "set"
        ? command("actor:set-hp", { actorId: actor.id, current: value, ...guard })
        : control === "heal"
          ? command("actor:heal", { actorId: actor.id, amount: value, ...guard })
          : control === "temp"
            ? command("actor:set-temp-hp", { actorId: actor.id, amount: value, ...guard })
            : command(
                "actor:apply-damage",
                manualDamagePayload({
                  actorId: actor.id,
                  amount: value,
                  damageType: typed,
                  nonlethal: control === "nonlethal",
                  expectedRevision: revision
                })
              );
    const type = typed ? ` ${typed}` : "";
    const done = {
      damage: `${actor.name} took ${value}${type} damage.`,
      nonlethal: `${actor.name} took ${value} nonlethal${type} damage.`,
      heal: `${actor.name} healed ${value}.`,
      temp: `${actor.name} has ${value} temporary HP.`,
      set: `${actor.name} set to ${value} HP.`
    }[control];
    setBusy(true);
    void sent.then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The hit point change was rejected.");
        return;
      }
      setAmount("");
      onFeedback(done);
    });
  };

  return (
    <div className="hp-editor" role="group" aria-label={`Adjust hit points for ${actor.name}`}>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        maxLength={4}
        autoFocus={autoFocus}
        aria-label="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && controls.includes("damage")) adjust("damage");
          else if (event.key === "Escape") onEscape?.();
        }}
      />
      {controls.map((control) => (
        <button
          key={control}
          type="button"
          disabled={busy}
          title={LABELS[control].title}
          onClick={() => adjust(control)}
        >
          {LABELS[control].label}
        </button>
      ))}
      {/* Below the buttons, which already fill this row at 375px: `DamageTypeField` takes its own line. */}
      <DamageTypeField value={chosenType} disabled={busy} onChange={chooseType} />
    </div>
  );
}
