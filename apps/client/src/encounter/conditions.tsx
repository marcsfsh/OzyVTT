import { useEffect, useState } from "react";
import type { Actor, ContentConditionSummary } from "@vtt/domain";
import { Chip, Stepper, type ChipTone } from "@vtt/ui";
import { command, read } from "../lib/command";
import { CONDITION_GLYPHS } from "../scene/tokenGlyph";

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

/**
 * Chips plus a toggleable picker for whoever may edit this actor (the server still enforces
 * scope). Exhaustion exposes a 1-6 level stepper while active.
 */
export function ConditionEditor({
  actorId,
  conditions,
  onFeedback
}: Readonly<{ actorId: string; conditions: readonly ConditionInstance[]; onFeedback: (text: string) => void }>) {
  const reference = useConditionReference();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeById = new Map(conditions.map((instance) => [instance.id, instance]));

  const send = (conditionId: string, active: boolean, level?: number) => {
    setBusy(true);
    void command("actor:set-condition", {
      actorId,
      conditionId,
      active,
      ...(level !== undefined ? { level } : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The condition could not be updated.");
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
            pressed
            disabled={busy}
            title={`${descriptionFor(instance.id, reference)}\n\nClick to remove.`}
            onClick={() => send(instance.id, false)}
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
