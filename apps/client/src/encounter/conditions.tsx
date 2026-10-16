import { useEffect, useState } from "react";
import type { Actor, ContentConditionSummary } from "@vtt/domain";
import { Button, Chip, Stepper, type ChipTone } from "@vtt/ui";
import { command, read } from "../lib/command";
import { newId } from "../lib/ids";
import { CONDITION_GLYPHS } from "../scene/tokenGlyph";
import "./conditions.css";

type ConditionInstance = Actor["conditions"][number];

/** The shared 16×16 SRD condition glyph as a chip-sized icon (inherits the chip's tone color). */
const conditionIcon = (id: string) => {
  const d = CONDITION_GLYPHS[id];
  return d ? (
    <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <path d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  ) : undefined;
};
/** SRD conditions are debuffs (harmful); invisibility is a spell-flavored effect (magical). */
const conditionTone = (id: string): ChipTone => (id === "invisible" ? "magical" : "harmful");

/**
 * One shared fetch of the 15 SRD condition names and texts. Failures are never cached, so a
 * transient miss retries on the next mount or picker open; a late success reaches every mounted
 * chip/editor via the listener set.
 */
let referenceCache: readonly ContentConditionSummary[] | null = null;
let referenceInFlight: Promise<void> | null = null;
const referenceListeners = new Set<(reference: readonly ContentConditionSummary[]) => void>();
export function requestConditionReference() {
  if (referenceCache) return;
  referenceInFlight ??= read("content:conditions", {}).then((result) => {
    referenceInFlight = null;
    if (result.ok && result.conditions && result.conditions.length > 0) {
      referenceCache = result.conditions;
      for (const listener of referenceListeners) listener(referenceCache);
    }
  });
}

export function useConditionReference(): readonly ContentConditionSummary[] {
  const [reference, setReference] = useState<readonly ContentConditionSummary[]>(referenceCache ?? []);
  useEffect(() => {
    if (referenceCache) {
      setReference(referenceCache);
      return;
    }
    referenceListeners.add(setReference);
    requestConditionReference();
    return () => {
      referenceListeners.delete(setReference);
    };
  }, []);
  return reference;
}

/** Reference-free display label for badges (the viewer uses the same shape server-side): "Prone", "Exhaustion 3". */
export const conditionBadgeLabel = (instance: ConditionInstance) =>
  `${instance.id
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")}${instance.level !== undefined ? ` ${instance.level}` : ""}`;

/** Band from whichever hp shape the audience receives (GM exact, player exact-or-band). */
export function healthBandFor(
  hp:
    | { current: number; maximum: number; temporary: number }
    | { kind: "exact"; current: number; maximum: number; temporary: number }
    | { kind: "band"; band: "healthy" | "bloodied" | "down" }
): "healthy" | "bloodied" | "down" {
  if ("kind" in hp && hp.kind === "band") return hp.band;
  const exact = hp as { current: number; maximum: number };
  return exact.current <= 0 ? "down" : exact.current * 2 <= exact.maximum ? "bloodied" : "healthy";
}

const labelFor = (instance: ConditionInstance, reference: readonly ContentConditionSummary[]) => {
  const name = reference.find((entry) => entry.id === instance.id)?.name ?? instance.id;
  return instance.id === "exhaustion" && instance.level !== undefined ? `${name} ${instance.level}` : name;
};
const descriptionFor = (id: string, reference: readonly ContentConditionSummary[]) =>
  reference.find((entry) => entry.id === id)?.description ?? "";

/** The conditions' display names ("Prone", "Exhaustion 3"), in the order the actor carries them. */
export function useConditionLabels(conditions: readonly ConditionInstance[]): string[] {
  const reference = useConditionReference();
  return conditions.map((instance) => labelFor(instance, reference));
}

/** A condition's rules text as the bundle prints it: an opening line, then "* Name. Rule." bullets. */
export function ConditionText({ text }: Readonly<{ text: string }>) {
  const [lead, ...rest] = text.split(/\n\s*\*\s*/);
  return (
    <div className="condition-text">
      {lead.trim() && <p>{lead.trim()}</p>}
      {rest.length > 0 && (
        <ul>
          {rest.map((line) => {
            const split = line.trim().match(/^([^.]{1,40}\.)\s*(.*)$/s);
            return (
              <li key={line}>
                {split ? (
                  <>
                    <strong>{split[1]}</strong> {split[2]}
                  </>
                ) : (
                  line.trim()
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** What links a condition: the effect holding it, when one does (its name says where it came from). */
type LinkingEffect = Readonly<{ name: string; linkedConditionIds: readonly string[]; escapeDc: number | null }>;

/**
 * Chips plus a toggleable picker for whoever may edit this actor (the server still enforces scope).
 * Tapping a chip opens its rules text, where it came from and an explicit way to end it, so a tap on a
 * phone never removes anything by itself. A player may take off what they put on; anything imposed is the
 * GM's to end (or an Escape, or its own duration), so it offers "Ask the GM" instead. Standing from Prone is
 * the server's call (your own turn, half your Speed). Exhaustion exposes a 1-6 level stepper while active.
 */
export function ConditionEditor({
  actorId,
  conditions,
  effects = [],
  viewer,
  canAsk = false,
  onFeedback
}: Readonly<{
  actorId: string;
  conditions: readonly ConditionInstance[];
  /** The actor's effects, so a linked condition can say what holds it. */
  effects?: readonly LinkingEffect[];
  viewer: "gm" | "player";
  /** A player can ask the GM in a live fight, where the GM's question queue is. */
  canAsk?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const reference = useConditionReference();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const activeById = new Map(conditions.map((instance) => [instance.id, instance]));
  const shownInstance = shown === null ? undefined : activeById.get(shown);

  const send = (conditionId: string, active: boolean, level?: number) => {
    setBusy(true);
    const payload = { actorId, conditionId, active, ...(level !== undefined ? { level } : {}) };
    void command("actor:set-condition", payload).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The condition could not be updated.");
        return;
      }
      if (!active && conditionId === shown) setShown(null);
    });
  };
  const ask = (conditionId: string) => {
    setBusy(true);
    void command("rules:ask", {
      type: "actor.set-condition",
      payload: { commandId: newId(), actorId, conditionId, active: false }
    }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "That question could not be sent.");
      else onFeedback(result.ran ? "Done - no question needed." : "Asked the GM. Waiting for their call.");
    });
  };

  return (
    <div className="condition-editor">
      <span className="condition-chips">
        {conditions.map((instance) => (
          <Chip
            key={instance.id}
            tone={conditionTone(instance.id)}
            icon={conditionIcon(instance.id)}
            pressed={shown === instance.id}
            aria-expanded={shown === instance.id}
            disabled={busy}
            title={descriptionFor(instance.id, reference)}
            onClick={() => {
              requestConditionReference();
              setShown((current) => (current === instance.id ? null : instance.id));
            }}
          >
            {labelFor(instance, reference)}
          </Chip>
        ))}
        <Chip
          className="condition-add"
          pressed={open}
          disabled={busy}
          aria-expanded={open}
          aria-label="Edit conditions"
          title="Add or remove conditions"
          onClick={() => {
            requestConditionReference();
            setOpen((current) => !current);
          }}
        >
          {open ? "Done" : "+ Add"}
        </Chip>
      </span>
      {shownInstance && (
        <ConditionDetail
          instance={shownInstance}
          label={labelFor(shownInstance, reference)}
          text={descriptionFor(shownInstance.id, reference)}
          holder={effects.find((effect) => effect.linkedConditionIds.includes(shownInstance.id))}
          viewer={viewer}
          canAsk={canAsk}
          busy={busy}
          onRemove={() => send(shownInstance.id, false)}
          onAsk={() => ask(shownInstance.id)}
          onClose={() => setShown(null)}
        />
      )}
      {open && (
        <div className="condition-picker" role="group" aria-label="Conditions">
          {reference.map((entry) => {
            const instance = activeById.get(entry.id);
            return (
              <span key={entry.id} className="condition-option">
                <Chip
                  tone={conditionTone(entry.id)}
                  icon={conditionIcon(entry.id)}
                  pressed={instance !== undefined}
                  disabled={busy}
                  title={entry.description}
                  onClick={() => send(entry.id, instance === undefined, undefined)}
                >
                  {entry.name}
                </Chip>
                {entry.id === "exhaustion" && instance && (
                  <Stepper
                    value={instance.level ?? 1}
                    min={1}
                    max={6}
                    disabled={busy}
                    aria-label="Exhaustion level"
                    onChange={(level) => send("exhaustion", true, level)}
                  />
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One condition opened from its chip: what it does, what holds it, and the way to end it this viewer has. */
function ConditionDetail({
  instance,
  label,
  text,
  holder,
  viewer,
  canAsk,
  busy,
  onRemove,
  onAsk,
  onClose
}: Readonly<{
  instance: ConditionInstance;
  label: string;
  text: string;
  holder: LinkingEffect | undefined;
  viewer: "gm" | "player";
  canAsk: boolean;
  busy: boolean;
  onRemove: () => void;
  onAsk: () => void;
  onClose: () => void;
}>) {
  const prone = instance.id === "prone";
  const own = instance.selfApplied === true && holder === undefined;
  const removable = viewer === "gm" || own || prone;
  const origin = holder
    ? `From ${holder.name}${holder.escapeDc !== null ? ` · escape DC ${holder.escapeDc}` : ""}.`
    : own && viewer === "player"
      ? "You marked this yourself."
      : null;
  return (
    <div className="condition-detail" role="region" aria-label={`${label} rules`}>
      <p className="condition-detail-name">{label}</p>
      {text ? <ConditionText text={text} /> : <p className="condition-detail-muted">Loading the rules text.</p>}
      {origin && <p className="condition-detail-origin">{origin}</p>}
      <div className="condition-detail-actions">
        {removable ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onRemove}>
            {prone && viewer === "player" ? "Stand up" : `Remove ${label}`}
          </Button>
        ) : canAsk ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onAsk}>
            Ask the GM to end it
          </Button>
        ) : (
          <p className="condition-detail-muted">It ends by its own rules or when the GM ends it.</p>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
