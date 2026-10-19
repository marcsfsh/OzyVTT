import { useState } from "react";
import type { ConversionOffer, Rechoice } from "@vtt/domain";
import { Button, Select, Stepper } from "@vtt/ui";
import type { SheetEdit } from "./useSheetEdit";

/** When a conversion is used, beside its name. */
const TIMING_WORDS: Readonly<Record<ConversionOffer["timing"], string>> = {
  "no-action": "No action",
  "bonus-action": "Bonus Action",
  "magic-action": "Magic action",
  "after-short-rest": "After a Short Rest",
  "one-minute": "1 minute",
  "on-initiative": "When you roll Initiative"
};

/** What the button does, by what is picked. */
const VERBS: Readonly<Record<ConversionOffer["pick"]["kind"], string>> = {
  none: "Use",
  slot: "Spend",
  "create-slot": "Create",
  "recover-slots": "Recover",
  count: "Use"
};

type Pick = ConversionOffer["pick"];

const slotWord = (level: number, pact: boolean) => `Level ${level}${pact ? " Pact Magic" : ""}`;

/** The request a conversion's controls send, from what was picked. Null while nothing valid is picked. */
function requestOf(pick: Pick, slot: string, levels: Readonly<Record<number, number>>, count: number) {
  if (pick.kind === "none") return {};
  if (pick.kind === "count") return { count };
  if (pick.kind === "recover-slots") {
    const chosen = Object.entries(levels).flatMap(([level, amount]) => Array.from({ length: amount }, () => +level));
    return chosen.length > 0 ? { levels: chosen } : null;
  }
  const [level, pact] = slot.split(":");
  if (!level) return null;
  return { level: Number(level), ...(pact === "pact" ? { pact: true } : {}) };
}

/** One conversion: its name and line, why it can't be used now, what to pick, and the button the server checks. */
function ConversionRow({
  actorId,
  offer,
  busy,
  edit,
  onFeedback
}: Readonly<{
  actorId: string;
  offer: ConversionOffer;
  busy: boolean;
  edit: SheetEdit;
  onFeedback: (text: string) => void;
}>) {
  const { pick } = offer;
  const firstSlot =
    pick.kind === "slot"
      ? pick.options[0]
        ? `${pick.options[0].level}:${pick.options[0].pact ? "pact" : ""}`
        : ""
      : pick.kind === "create-slot"
        ? pick.options[0]
          ? `${pick.options[0].level}:`
          : ""
        : "";
  const [slot, setSlot] = useState(firstSlot);
  const [levels, setLevels] = useState<Record<number, number>>({});
  const [count, setCount] = useState(pick.kind === "count" ? pick.max : 1);
  const usedLevels = Object.entries(levels).reduce((sum, [level, amount]) => sum + Number(level) * amount, 0);
  const request = requestOf(pick, slot, levels, count);
  const usable = offer.reason === null && request !== null;
  const send = () => {
    if (!request) return;
    void edit("actor:convert", { actorId, conversionId: offer.id, ...request }).then((result) => {
      if (!result.ok) return;
      setLevels({});
      onFeedback(result.line ?? `${offer.name} is used.`);
    });
  };
  return (
    <li className="cs-use">
      <span className="cs-use-text">
        <strong className="cs-use-name">
          {offer.name}
          <span className="cs-use-cost"> · {TIMING_WORDS[offer.timing]}</span>
        </strong>
        <span className="cs-sub">{offer.line}</span>
        {offer.reason && <span className="cs-action-reason">{offer.reason}</span>}
      </span>
      {offer.reason === null && (
        <span className="cs-use-actions" role="group" aria-label={`Use ${offer.name}`}>
          {(pick.kind === "slot" || pick.kind === "create-slot") && pick.options.length > 0 && (
            <Select
              aria-label={pick.kind === "slot" ? `Spell slot ${offer.name} spends` : `Spell slot ${offer.name} makes`}
              value={slot}
              disabled={busy}
              onChange={(event) => setSlot(event.target.value)}
            >
              {pick.kind === "slot"
                ? pick.options.map((option) => (
                    <option
                      key={`${option.level}:${option.pact}`}
                      value={`${option.level}:${option.pact ? "pact" : ""}`}
                    >
                      {slotWord(option.level, option.pact)} · {option.left} left
                    </option>
                  ))
                : pick.options.map((option) => (
                    <option key={option.level} value={`${option.level}:`}>
                      Level {option.level} · {option.cost} points
                    </option>
                  ))}
            </Select>
          )}
          {pick.kind === "count" && pick.max > pick.min && (
            <Stepper
              value={Math.min(count, pick.max)}
              onChange={setCount}
              min={pick.min}
              max={pick.max}
              disabled={busy}
              aria-label={`How many ${pick.unit}`}
            />
          )}
          {pick.kind === "recover-slots" && (
            <span className="cs-recover" role="group" aria-label={`Spell slots ${offer.name} recovers`}>
              {pick.options.map((option) => (
                <Stepper
                  key={option.level}
                  label={`Level ${option.level}`}
                  value={levels[option.level] ?? 0}
                  onChange={(value) => setLevels((current) => ({ ...current, [option.level]: value }))}
                  min={0}
                  max={Math.min(
                    option.spent,
                    (levels[option.level] ?? 0) + Math.floor((pick.budget - usedLevels) / option.level)
                  )}
                  disabled={busy}
                  aria-label={`Level ${option.level} slots to recover`}
                />
              ))}
              <span className="cs-sub">
                {usedLevels} of {pick.budget} levels
              </span>
            </span>
          )}
          <Button size="sm" disabled={busy || !usable} onClick={send}>
            {VERBS[pick.kind]}
          </Button>
        </span>
      )}
    </li>
  );
}

/** The conversions as a list. */
export function ConversionList({
  actorId,
  offers,
  busy,
  edit,
  onFeedback
}: Readonly<{
  actorId: string;
  offers: readonly ConversionOffer[];
  busy: boolean;
  edit: SheetEdit;
  onFeedback: (text: string) => void;
}>) {
  if (offers.length === 0) return null;
  return (
    <ul className="cs-uses">
      {offers.map((offer) => (
        <ConversionRow key={offer.id} actorId={actorId} offer={offer} busy={busy} edit={edit} onFeedback={onFeedback} />
      ))}
    </ul>
  );
}

/** A pick re-made after a rest, as a select the server checks. */
function RechoiceField({
  actorId,
  choice,
  busy,
  edit,
  onFeedback
}: Readonly<{
  actorId: string;
  choice: Rechoice;
  busy: boolean;
  edit: SheetEdit;
  onFeedback: (text: string) => void;
}>) {
  return (
    <label className="cs-field">
      <span className="cs-eyebrow">{choice.label}</span>
      <Select
        aria-label={choice.label}
        value={choice.chosen ?? ""}
        disabled={busy}
        onChange={(event) => {
          const picked = choice.options.find((option) => option.id === event.target.value);
          if (!picked) return;
          void edit("actor:rechoose", { actorId, offer: choice.offer, id: picked.id }).then((result) => {
            if (result.ok) onFeedback(`${choice.label}: ${picked.name}.`);
          });
        }}
      >
        {choice.chosen === null && <option value="">None</option>}
        {choice.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * The step a finished rest opens on the Features tab: what a feature does when that rest finishes (Arcane Recovery,
 * Sorcerous Restoration) and every pick the character may re-make after it, then Done. A Long Rest offers the picks
 * either rest allows; a Short Rest only those it allows. The server checks each.
 */
export function RestStep({
  actorId,
  after,
  offers,
  rechoices,
  busy,
  edit,
  onFeedback
}: Readonly<{
  actorId: string;
  after: "short-rest" | "long-rest";
  offers: readonly ConversionOffer[];
  rechoices: readonly Rechoice[];
  busy: boolean;
  edit: SheetEdit;
  onFeedback: (text: string) => void;
}>) {
  const recoveries = after === "short-rest" ? offers.filter((offer) => offer.timing === "after-short-rest") : [];
  const picks = rechoices.filter((choice) => after === "long-rest" || choice.per === "short-rest");
  if (recoveries.length === 0 && picks.length === 0) return null;
  return (
    <section
      className="cs-card cs-caution"
      role="group"
      aria-label={after === "short-rest" ? "After the Short Rest" : "After the Long Rest"}
    >
      <strong>{after === "short-rest" ? "After the Short Rest" : "After the Long Rest"}</strong>
      <p className="cs-sub">These choices are open now that the rest is over.</p>
      <ConversionList actorId={actorId} offers={recoveries} busy={busy} edit={edit} onFeedback={onFeedback} />
      {picks.map((choice) => (
        <RechoiceField
          key={choice.offer}
          actorId={actorId}
          choice={choice}
          busy={busy}
          edit={edit}
          onFeedback={onFeedback}
        />
      ))}
      <div className="cs-chiprow">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void edit("character:finish-preparing", { actorId, rest: true })}
        >
          Done
        </Button>
      </div>
    </section>
  );
}
