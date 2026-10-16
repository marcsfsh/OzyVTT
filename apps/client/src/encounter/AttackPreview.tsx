import { useState } from "react";
import type { ActionResolution, HitOffer, HitOptionChoice } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { DieModeButtons, type DieMode } from "./RollControls";
import type { ResolveOptions } from "./targeting";
import "./prompts.css";

type Attack = NonNullable<ActionResolution["attack"]>;

/**
 * The attack's result line: total against AC, the outcome, the natural die and the target. A player
 * never sees an AC, so an attack the server could not judge reads as a hit for them.
 */
export function AttackOutcome({ attack, audience }: Readonly<{ attack: Attack; audience: "gm" | "player" }>) {
  return (
    <p className={`action-outcome outcome-${attack.outcome}`}>
      {attack.total}
      {attack.targetAc !== null ? ` vs AC ${attack.targetAc}` : ""}
      {attack.reactionAcBonus ? ` (+${attack.reactionAcBonus.amount} ${attack.reactionAcBonus.source})` : ""} -{" "}
      {attack.outcome === "crit"
        ? "CRITICAL HIT"
        : attack.outcome === "fumble"
          ? "NATURAL 1"
          : attack.outcome === "unknown"
            ? audience === "gm"
              ? "no AC on record"
              : "HIT"
            : attack.outcome.toUpperCase()}
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
 * An attack previewed but not yet applied: Adv/Disadv and Re-roll roll the d20 again, Confirm resolves
 * the hit for real (damage, riders, economy). In manual roll mode a second zone takes a typed d20, or
 * the final total with a Natural 20 box when typed bonuses are not added for you. A hit that offers a
 * Push asks how far first, and a hit that can carry extras (Sneak Attack, a smite) offers them; Confirm sends
 * those choices.
 */
export function AttackPreview({
  attack,
  mode,
  busy,
  rollMode,
  bonusMode,
  onFeedback,
  push,
  hitOffers = [],
  resolve: resolveWith
}: Readonly<{
  attack: Attack;
  /** The die mode the shown roll used. */
  mode?: DieMode;
  busy: boolean;
  rollMode: "auto" | "manual";
  /** "total": the typed number is the final total, so a crit must be declared. */
  bonusMode: "auto" | "total";
  onFeedback: (text: string) => void;
  /** The push this hit's weapon mastery offers; Push is "up to", so the attacker picks the distance. */
  push?: ActionResolution["push"];
  /** The extras this hit can carry; chosen ones ride the Confirm. */
  hitOffers?: readonly HitOffer[];
  resolve: (options: ResolveOptions) => void;
}>) {
  // null means the full distance, so a re-roll that changes the offer never carries a stale pick.
  const [pushPick, setPushPick] = useState<number | null>(null);
  const pushFeet = push ? Math.min(pushPick ?? push.maxFeet, push.maxFeet) : undefined;
  const [extras, setExtras] = useState<HitOptionChoice[]>([]);
  // A re-roll can change what is offered (a miss offers nothing), so only choices still offered are sent.
  const hitOptions = extras.filter((choice) => hitOffers.some((offer) => offer.id === choice.id));
  // Only a confirming call carries the push and extras; previews ignore them.
  const resolve = (options: ResolveOptions) =>
    resolveWith(
      options.commit
        ? {
            ...options,
            ...(pushFeet !== undefined ? { pushFeet } : {}),
            ...(hitOptions.length > 0 ? { hitOptions } : {})
          }
        : options
    );
  const [entry, setEntry] = useState("");
  // Whether the typed roll has been submitted: drives "Use roll" → Confirm/Re-roll.
  const [submitted, setSubmitted] = useState(false);
  // In "final total" mode a natural 20 cannot be read off the number, so it is declared here.
  const [natural20, setNatural20] = useState(false);
  // Whether the shown preview came from a typed total, so Confirm re-sends the inputs that made it.
  const [fromTotal, setFromTotal] = useState(false);
  const manualEntry = rollMode === "manual";
  const totalMode = bonusMode === "total";
  // Any auto control abandons a pending manual entry.
  const autoPreview = (options: ResolveOptions) => {
    setFromTotal(false);
    setSubmitted(false);
    resolve(options);
  };
  const submitEntry = () => {
    const value = Number(entry.trim());
    if (
      totalMode
        ? !Number.isInteger(value) || value < -50 || value > 100
        : !Number.isInteger(value) || value < 1 || value > 20
    ) {
      onFeedback(totalMode ? "Enter your final attack total." : "Enter the attack d20 (1-20).");
      return;
    }
    setFromTotal(totalMode);
    setSubmitted(true);
    resolve(
      totalMode ? { commit: false, attackTotal: value, critical: natural20 } : { commit: false, attackNatural: value }
    );
  };
  const confirmEntry = () =>
    resolve(
      totalMode
        ? { commit: true, attackTotal: Number(entry.trim()), critical: natural20 }
        : { commit: true, attackNatural: Number(entry.trim()) }
    );
  // Confirm the shown preview with the inputs that produced it.
  const confirmShown = () =>
    fromTotal
      ? resolve({ commit: true, attackTotal: Number(entry.trim()), critical: natural20 })
      : resolve({ commit: true, attackNatural: attack.naturalRoll });
  return (
    <div className="action-preview">
      {push && pushFeet !== undefined && <PushChoice push={push} value={pushFeet} busy={busy} onPick={setPushPick} />}
      {hitOffers.length > 0 && (
        <HitOfferChoices offers={hitOffers} chosen={hitOptions} busy={busy} onChange={setExtras} />
      )}
      <div className="roll-zone">
        <span className="save-prompt-confirm">
          <DieModeButtons
            current={mode}
            disabled={busy}
            onPick={(picked) => autoPreview({ commit: false, rollMode: picked })}
          />
          <button type="button" className="encounter-primary" disabled={busy} onClick={confirmShown}>
            Confirm{" "}
            {attack.outcome === "crit"
              ? "crit"
              : attack.outcome === "hit" || attack.outcome === "unknown"
                ? "hit"
                : "miss"}
          </button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            title="Roll the attack again"
            onClick={() => autoPreview({ commit: false })}
          >
            Re-roll
          </Button>
        </span>
        {manualEntry && <span className="roll-zone-caption">auto-roll</span>}
      </div>
      {manualEntry && (
        <>
          <div className="roll-or">
            <span>or</span>
          </div>
          <div className="roll-zone">
            <span className="roll-zone-caption">manual entry</span>
            <span className="save-prompt-manual">
              <input
                type="text"
                inputMode="numeric"
                pattern={totalMode ? undefined : "[0-9]*"}
                placeholder={totalMode ? "type your total" : "type the d20"}
                aria-label={totalMode ? "Attack total" : "Attack d20"}
                value={entry}
                disabled={submitted}
                onChange={(event) => setEntry(event.target.value.replace(totalMode ? /[^0-9-]/g : /[^0-9]/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submitted && entry.trim() !== "") submitEntry();
                }}
              />
              {totalMode && (
                <label className="manual-nat20">
                  <input
                    type="checkbox"
                    checked={natural20}
                    disabled={submitted}
                    onChange={(event) => setNatural20(event.target.checked)}
                  />{" "}
                  Natural 20
                </label>
              )}
              {/* "Use roll" sits on its own row under the field; once used it becomes Confirm/Re-roll. */}
              <span className="manual-actions">
                {submitted ? (
                  <>
                    <button type="button" className="encounter-primary" disabled={busy} onClick={confirmEntry}>
                      Confirm roll
                    </button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      title={totalMode ? "Enter a different total" : "Enter a different d20"}
                      onClick={() => {
                        setEntry("");
                        setSubmitted(false);
                        setNatural20(false);
                      }}
                    >
                      Re-roll
                    </Button>
                  </>
                ) : (
                  <button type="button" disabled={busy || entry.trim() === ""} onClick={submitEntry}>
                    Use roll
                  </button>
                )}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
