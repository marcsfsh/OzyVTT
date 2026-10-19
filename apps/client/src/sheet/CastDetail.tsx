import { useState } from "react";
import type { CastShapingOffers, ContentActionSummary, ContentSpellSummary } from "@vtt/domain";
import type { CastShaping, DamageType } from "@vtt/schemas";
import { Button, IconChevronLeft, Select } from "@vtt/ui";
import { signed } from "../encounter/format";
import { castLabel, countNoun, shortRange, targetCountAt, type CastOption, type SheetSpellEntry } from "./spell-model";

type Offer = CastShapingOffers["options"][number];

/** What happens after the cast is chosen, in one line. */
function nextLine(
  option: CastOption,
  content: ContentSpellSummary | undefined,
  action: ContentActionSummary | null,
  aimed: boolean
): string {
  const spends =
    option.kind === "slot"
      ? ` and spends the level ${option.level} spell slot`
      : option.kind === "free"
        ? " and spends the free cast"
        : "";
  if (!aimed) return `The server rolls what it needs${spends}.`;
  const count = targetCountAt(content, option.level);
  const noun = countNoun(content);
  if (action?.area)
    return `Next you place its area on the map. The server rolls${spends.replace(" and", ",")} and applies it.`;
  if (count && count > 1)
    return `Next you choose a target for each of the ${count} ${noun}. The server rolls each one${spends}.`;
  if (action?.targeting === "none") return `It takes effect at once. The server records it${spends}.`;
  return `Next you choose its ${action?.targeting === "multi" ? "targets" : "target"}. The server rolls${spends.replace(" and", ",")} and applies it.`;
}

const points = (count: number) => `${count} Sorcery ${count === 1 ? "Point" : "Points"}`;
/** The picks that name creatures among the targets, chosen when the spell is aimed. */
const PROTECTS: ReadonlySet<string> = new Set(["careful-spell", "sculpt-spells"]);

/** The Sorcery Points the chosen picks cost: the server waives the dearest counted one when the turn's option is free. */
function costOf(chosen: readonly Offer[], free: boolean): number {
  const total = chosen.reduce((sum, offer) => sum + offer.cost, 0);
  const counted = chosen.filter((offer) => offer.counted).map((offer) => offer.cost);
  return total - (free && counted.length > 0 ? Math.max(...counted) : 0);
}

/** Why an option can't be added to the picks now, or null: the server's reason, the options one spell carries, the
 *  points left, or a choice of creatures only an aimed cast can make. */
function blockedReason(offer: Offer, chosen: readonly Offer[], offers: CastShapingOffers, aimed: boolean) {
  if (!offer.available) return offer.reason ?? "This spell can't take it.";
  if (offer.counted && chosen.filter((pick) => pick.counted).length >= offers.limit)
    return offers.limit === 1
      ? "One Metamagic option a spell."
      : "Two Metamagic options a spell while Innate Sorcery is active.";
  if (costOf([...chosen, offer], offers.free === true) > offers.points) return "Not enough Sorcery Points.";
  if (!aimed && PROTECTS.has(offer.id)) return "Aim the spell on your turn in a fight to choose who it protects.";
  return null;
}

/** What the chosen picks spend and ask for next, in a sentence or two. */
function shapingLine(chosen: readonly Offer[], offers: CastShapingOffers, aimed: boolean): string {
  const cost = costOf(chosen, offers.free === true);
  const parts = [cost > 0 ? `It spends ${points(cost)}.` : "It costs no Sorcery Points."];
  for (const offer of chosen.filter((pick) => PROTECTS.has(pick.id)))
    parts.push(`Choose who ${offer.name} protects when you aim it.`);
  if (aimed && chosen.some((pick) => pick.id === "heightened-spell"))
    parts.push("With several targets, choose Heightened Spell's one when you aim it.");
  return parts.join(" ");
}

/**
 * One spell's cast: its slot levels (each with what is left and what it buys), a free casting or a Ritual where it
 * has one, the ways its caster may shape it (Metamagic, Sculpt Spells), a line on what happens next, and one primary
 * that names the result. The sheet places it per width: in place on a phone, in the right column on a laptop, in a
 * drawer on the GM's phone.
 */
export function CastDetail({
  spell,
  action,
  content,
  options,
  aimed,
  busy,
  onCast,
  onBack
}: Readonly<{
  spell: SheetSpellEntry;
  /** The action the cast resolves through, with the server's numbers and the ways it may be shaped. */
  action: ContentActionSummary | null;
  content: ContentSpellSummary | undefined;
  options: readonly CastOption[];
  /** The cast goes on to targeting (the character's turn in a fight); otherwise the server rolls it at once. */
  aimed: boolean;
  busy: boolean;
  onCast: (option: CastOption, shaping: readonly CastShaping[]) => void;
  onBack: () => void;
}>) {
  const first = options.find((option) => option.available) ?? options[0] ?? null;
  const [picked, setPicked] = useState<string | null>(first?.key ?? null);
  const [shaping, setShaping] = useState<readonly CastShaping[]>([]);
  const chosen = options.find((option) => option.key === picked) ?? first;
  const offers = action?.shaping;
  const chosenOffers = (offers?.options ?? []).filter((offer) => shaping.some((entry) => entry.id === offer.id));
  const toggle = (offer: Offer) =>
    setShaping((current) =>
      current.some((entry) => entry.id === offer.id)
        ? current.filter((entry) => entry.id !== offer.id)
        : [
            ...current,
            {
              id: offer.id,
              ...(offer.damageTypes && offer.damageTypes.length > 0 ? { damageType: offer.damageTypes[0] } : {})
            }
          ]
    );
  const setType = (type: DamageType) =>
    setShaping((current) =>
      current.map((entry) => (entry.id === "transmuted-spell" ? { ...entry, damageType: type } : entry))
    );
  const transmuted = shaping.find((entry) => entry.id === "transmuted-spell");
  const transmutedTypes = offers?.options.find((offer) => offer.id === "transmuted-spell")?.damageTypes ?? [];
  const line = [
    content?.castingTime,
    shortRange(content?.rangeText),
    action?.attackBonus !== null && action?.attackBonus !== undefined ? `${signed(action.attackBonus)} to hit` : null,
    action?.saveAbility ? `DC ${action.saveDc} ${action.saveAbility.toUpperCase()} save` : null,
    action && action.damage.length > 0 ? action.damage.map((part) => `${part.formula} ${part.type}`).join(" + ") : null
  ]
    .filter(Boolean)
    .join(" · ");
  const metamagic = (offers?.options ?? []).some((offer) => offer.id !== "sculpt-spells");
  return (
    <section className="cs-cast" aria-label={`Cast ${spell.name}`}>
      <div className="cs-cast-head">
        <button type="button" className="cs-back interactive" aria-label="Back" onClick={onBack}>
          <IconChevronLeft />
        </button>
        <span className="cs-cast-title">
          <strong className="cs-cast-name">{spell.name}</strong>
          {line && <span className="cs-sub">{line}</span>}
        </span>
      </div>
      {options.some((option) => option.kind === "slot") && <span className="cs-eyebrow">Spell slot</span>}
      <div className="cs-cast-options" role="group" aria-label="How to cast it">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`cs-cast-option${option.key === chosen?.key ? " is-on" : ""}${option.available ? "" : " is-off"}`}
            aria-pressed={option.key === chosen?.key}
            disabled={!option.available}
            onClick={() => setPicked(option.key)}
          >
            <strong>{option.title}</strong>
            <span>{option.detail}</span>
            {!option.available && option.reason && <span className="cs-cast-reason">{option.reason}</span>}
          </button>
        ))}
      </div>
      {offers && offers.options.length > 0 && (
        <>
          <span className="cs-eyebrow">
            {metamagic
              ? `Metamagic · ${points(offers.points)} left${offers.free ? " · one option free this turn" : ""}`
              : "Sculpt Spells"}
          </span>
          <div className="cs-cast-options" role="group" aria-label="Shape the spell">
            {offers.options.map((offer) => {
              const on = shaping.some((entry) => entry.id === offer.id);
              const blocked = on ? null : blockedReason(offer, chosenOffers, offers, aimed);
              return (
                <button
                  key={offer.id}
                  type="button"
                  className={`cs-cast-option${on ? " is-on" : ""}${blocked ? " is-off" : ""}`}
                  aria-pressed={on}
                  disabled={blocked !== null}
                  onClick={() => toggle(offer)}
                >
                  <strong>{offer.name}</strong>
                  <span>{offer.cost > 0 ? points(offer.cost) : "No cost"}</span>
                  {blocked && <span className="cs-cast-reason">{blocked}</span>}
                </button>
              );
            })}
          </div>
          {transmuted && transmutedTypes.length > 0 && (
            <label className="cs-cast-type">
              <span>Change its damage to</span>
              <Select
                value={transmuted.damageType ?? transmutedTypes[0]}
                onChange={(event) => setType(event.target.value as DamageType)}
              >
                {transmutedTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {chosenOffers.length > 0 && <p className="cs-sub">{shapingLine(chosenOffers, offers, aimed)}</p>}
        </>
      )}
      {chosen && <p className="cs-sub">{nextLine(chosen, content, action, aimed)}</p>}
      <Button
        variant="primary"
        block
        disabled={busy || !chosen || !chosen.available}
        onClick={() => chosen && onCast(chosen, shaping)}
      >
        {chosen ? castLabel(chosen) : "Cast"}
      </Button>
    </section>
  );
}
