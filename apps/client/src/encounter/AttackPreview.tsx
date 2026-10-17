import { useState } from "react";
import type { ActionResolution, HitOffer, HitOptionChoice } from "@vtt/domain";
import { ForceModeButtons, RerollControl, type DieMode } from "./RollControls";
import { useTargetingTyped, type ResolveOptions } from "./targeting";
import "./prompts.css";

type Attack = NonNullable<ActionResolution["attack"]>;

/** Effect dice still to roll: a preview shows "+ 1d4 Bless", and only Confirm rolls them. */
export const pendingBonusDice = (attack: Attack) => (attack.bonusDice ?? []).filter((entry) => entry.total === null);

/** Whether the shown outcome can still change: effect dice are pending and the d20 alone decides nothing. */
const outcomeOpen = (attack: Attack) =>
  pendingBonusDice(attack).length > 0 && attack.outcome !== "crit" && attack.outcome !== "fumble";

/**
 * The attack's result line: total against AC, the outcome, the natural die and the target. A player
 * never sees an AC, so an attack the server could not judge reads as a hit for them. Effect dice (Bless) show in
 * the total once rolled, or as still to roll in a preview, which then names no outcome.
 */
export function AttackOutcome({ attack, audience }: Readonly<{ attack: Attack; audience: "gm" | "player" }>) {
  const rolled = (attack.bonusDice ?? []).filter((entry) => entry.total !== null);
  const pending = pendingBonusDice(attack)
    .map((entry) => ` ${entry.dice.startsWith("-") ? "-" : "+"} ${entry.dice.replace(/^-/, "")} ${entry.label}`)
    .join("");
  const inTotal = rolled.map((entry) => `${entry.label} ${entry.total! < 0 ? "" : "+"}${entry.total}`).join(", ");
  return (
    <p className={`action-outcome outcome-${attack.outcome}`}>
      {attack.total}
      {pending}
      {inTotal !== "" ? ` (${inTotal})` : ""}
      {attack.targetAc !== null ? ` vs AC ${attack.targetAc}` : ""}
      {attack.reactionAcBonus ? ` (+${attack.reactionAcBonus.amount} ${attack.reactionAcBonus.source})` : ""}
      {outcomeOpen(attack)
        ? ""
        : ` - ${
            attack.outcome === "crit"
              ? "CRITICAL HIT"
              : attack.outcome === "fumble"
                ? "NATURAL 1"
                : attack.outcome === "unknown"
                  ? audience === "gm"
                    ? "no AC on record"
                    : "HIT"
                  : attack.outcome.toUpperCase()
          }`}
      {attack.naturalRoll >= 1 ? ` (nat ${attack.naturalRoll})` : ""} vs {attack.targetName}
    </p>
  );
}

/** How far a hit's Push shoves (SRD "up to 10 feet"): the full distance, 5 feet, or not at all. */
export function PushChoice({
  push,
  value,
  busy,
  onPick
}: Readonly<{
  push: NonNullable<ActionResolution["push"]>;
  value: number;
  busy: boolean;
  onPick: (feet: number) => void;
}>) {
  const choices = [...new Set([push.maxFeet, 5, 0])].filter((feet) => feet <= push.maxFeet);
  return (
    <div className="push-choice" role="group" aria-label={`Push ${push.targetName}`}>
      <span className="push-choice-label">Push {push.targetName}</span>
      {choices.map((feet) => (
        <button
          key={feet}
          type="button"
          className={`save-die-mode${value === feet ? " active" : ""}`}
          aria-pressed={value === feet}
          disabled={busy}
          onClick={() => onPick(feet)}
        >
          {feet === 0 ? "No push" : `${feet} ft`}
        </button>
      ))}
    </div>
  );
}

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const titled = (type: string) => (type.length > 0 ? `${type[0].toUpperCase()}${type.slice(1)}` : type);

/**
 * The extras a hit can carry (Sneak Attack, a smite, Divine Strike, a charge): each a toggle, with its type or slot
 * picked once it is on. What it costs and what the engine couldn't check are said under it.
 */
export function HitOfferChoices({
  offers,
  chosen,
  busy,
  onChange
}: Readonly<{
  offers: readonly HitOffer[];
  chosen: readonly HitOptionChoice[];
  busy: boolean;
  onChange: (next: HitOptionChoice[]) => void;
}>) {
  const pickOf = (id: string) => chosen.find((choice) => choice.id === id);
  const update = (id: string, change: Partial<HitOptionChoice> | null) =>
    onChange(
      change === null
        ? chosen.filter((choice) => choice.id !== id)
        : chosen.some((choice) => choice.id === id)
          ? chosen.map((choice) => (choice.id === id ? { ...choice, ...change } : choice))
          : [...chosen, { id, ...change }]
    );
  return (
    <div className="hit-offers" role="group" aria-label="Add to the hit">
      {offers.map((offer) => {
        const pick = pickOf(offer.id);
        return (
          <div key={offer.id} className="hit-offer">
            <button
              type="button"
              className={`save-die-mode${pick ? " active" : ""}`}
              aria-pressed={pick !== undefined}
              disabled={busy}
              onClick={() =>
                update(
                  offer.id,
                  pick
                    ? null
                    : {
                        ...(offer.damageTypes ? { damageType: offer.damageTypes[0] } : {}),
                        ...(offer.slotLevels ? { slotLevel: offer.slotLevels[0] } : {})
                      }
                )
              }
            >
              {offer.name} +{offer.dice}
            </button>
            {pick && offer.damageTypes && (
              <span className="hit-offer-picks" role="group" aria-label={`${offer.name} damage type`}>
                {offer.damageTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`save-die-mode${pick.damageType === type ? " active" : ""}`}
                    aria-pressed={pick.damageType === type}
                    disabled={busy}
                    onClick={() => update(offer.id, { damageType: type })}
                  >
                    {titled(type)}
                  </button>
                ))}
              </span>
            )}
            {pick && offer.slotLevels && offer.slotLevels.length > 1 && (
              <span className="hit-offer-picks" role="group" aria-label={`${offer.name} spell slot`}>
                {offer.slotLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`save-die-mode${pick.slotLevel === level ? " active" : ""}`}
                    aria-pressed={pick.slotLevel === level}
                    disabled={busy}
                    onClick={() => update(offer.id, { slotLevel: level })}
                  >
                    {ORDINALS[level] ?? level} slot
                  </button>
                ))}
              </span>
            )}
            {(offer.cost || offer.unverified) && (
              <small className="hit-offer-note">
                {[offer.cost ? `Costs ${offer.cost}.` : null, offer.unverified].filter(Boolean).join(" ")}
              </small>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * An attack previewed but not yet applied: Confirm resolves the hit for real (damage, riders, economy) with the die
 * shown, which the server holds (ADR-0012). The GM may force Advantage or Disadvantage and reroll freely; a player
 * rerolls only by spending Heroic Inspiration, typing the reroll's face when the shown die was typed. A hit that offers
 * a Push asks how far first, and a hit that can carry extras (Sneak Attack, a smite) offers them; Confirm sends those
 * choices.
 */
export function AttackPreview({
  attack,
  busy,
  viewer,
  inspired = false,
  onFeedback,
  push,
  hitOffers = [],
  resolve: resolveWith
}: Readonly<{
  attack: Attack;
  busy: boolean;
  /** The GM may force a mode and reroll freely; a player rerolls with Heroic Inspiration. */
  viewer: "gm" | "player";
  /** The attacker holds Heroic Inspiration. */
  inspired?: boolean;
  onFeedback: (text: string) => void;
  /** The push this hit's weapon mastery offers; Push is "up to", so the attacker picks the distance. */
  push?: ActionResolution["push"];
  /** The extras this hit can carry; chosen ones ride the Confirm. */
  hitOffers?: readonly HitOffer[];
  resolve: (options: ResolveOptions) => void;
}>) {
  // The shown die was typed from a physical die, so a player's reroll is typed too.
  const typed = useTargetingTyped();
  // null means the full distance, so a reroll that changes the offer never carries a stale pick.
  const [pushPick, setPushPick] = useState<number | null>(null);
  const pushFeet = push ? Math.min(pushPick ?? push.maxFeet, push.maxFeet) : undefined;
  const [extras, setExtras] = useState<HitOptionChoice[]>([]);
  // The GM's forced mode, sent with every later look at the held die so Confirm reads it the same way.
  const [forced, setForced] = useState<DieMode | undefined>(undefined);
  // A reroll can change what is offered (a miss offers nothing), so only choices still offered are sent.
  const hitOptions = extras.filter((choice) => hitOffers.some((offer) => offer.id === choice.id));
  const resolve = (options: ResolveOptions) =>
    resolveWith({
      ...options,
      ...(forced ? { rollMode: forced } : {}),
      // Only a confirming call carries the push and extras; previews ignore them.
      ...(options.commit && pushFeet !== undefined ? { pushFeet } : {}),
      ...(options.commit && hitOptions.length > 0 ? { hitOptions } : {})
    });
  return (
    <div className="action-preview">
      {push && pushFeet !== undefined && <PushChoice push={push} value={pushFeet} busy={busy} onPick={setPushPick} />}
      {hitOffers.length > 0 && (
        <HitOfferChoices offers={hitOffers} chosen={hitOptions} busy={busy} onChange={setExtras} />
      )}
      <span className="save-prompt-confirm">
        {viewer === "gm" && (
          <ForceModeButtons
            current={forced}
            disabled={busy}
            onPick={(mode) => {
              const next = mode === "normal" ? undefined : mode;
              setForced(next);
              // Sent as is: going back to the rules' count sends no mode at all.
              resolveWith({ commit: false, ...(next ? { rollMode: next } : {}) });
            }}
          />
        )}
        <button type="button" className="encounter-primary" disabled={busy} onClick={() => resolve({ commit: true })}>
          {outcomeOpen(attack)
            ? "Confirm"
            : `Confirm ${
                attack.outcome === "crit"
                  ? "crit"
                  : attack.outcome === "hit" || attack.outcome === "unknown"
                    ? "hit"
                    : "miss"
              }`}
        </button>
        {(viewer === "gm" || inspired) && (
          <RerollControl
            viewer={viewer}
            typed={typed}
            busy={busy}
            onInvalid={onFeedback}
            onReroll={(face) =>
              resolve({ commit: false, reroll: true, ...(face !== undefined ? { attackNatural: face } : {}) })
            }
          />
        )}
      </span>
    </div>
  );
}
