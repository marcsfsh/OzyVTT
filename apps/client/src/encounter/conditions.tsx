import { useEffect, useState } from "react";
import type { Actor, ContentConditionSummary } from "@vtt/domain";
import { newId } from "../lib/ids";
import { socket } from "../socket";

type ConditionInstance = Actor["conditions"][number];

/**
 * One shared fetch of the 15 SRD condition names/texts. Failures are never cached - a
 * transient miss (e.g. an ack racing the join) retries on the next mount or picker open,
 * and a late success propagates to every mounted chip/editor via the listener set.
 */
let referenceCache: readonly ContentConditionSummary[] | null = null;
let referenceInFlight: Promise<void> | null = null;
const referenceListeners = new Set<(reference: readonly ContentConditionSummary[]) => void>();
export function requestConditionReference() {
  if (referenceCache) return;
  referenceInFlight ??= new Promise((resolve) => {
    socket.emit("content:conditions", {}, (result) => {
      referenceInFlight = null;
      if (result.ok && result.conditions && result.conditions.length > 0) {
        referenceCache = result.conditions;
        for (const listener of referenceListeners) listener(referenceCache);
      }
      resolve();
    });
  });
}

export function useConditionReference(): readonly ContentConditionSummary[] {
  const [reference, setReference] = useState<readonly ContentConditionSummary[]>(referenceCache ?? []);
  useEffect(() => {
    if (referenceCache) { setReference(referenceCache); return; }
    referenceListeners.add(setReference);
    requestConditionReference();
    return () => { referenceListeners.delete(setReference); };
  }, []);
  return reference;
}

/** Reference-free display label for badges (the viewer uses the same shape server-side): "Prone", "Exhaustion 3". */
export const conditionBadgeLabel = (instance: ConditionInstance) =>
  `${instance.id.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")}${instance.level !== undefined ? ` ${instance.level}` : ""}`;

/** Band from whichever hp shape the audience receives (GM exact, player exact-or-band). */
export function healthBandFor(hp: { current: number; maximum: number; temporary: number } | { kind: "exact"; current: number; maximum: number; temporary: number } | { kind: "band"; band: "healthy" | "bloodied" | "down" }): "healthy" | "bloodied" | "down" {
  if ("kind" in hp && hp.kind === "band") return hp.band;
  const exact = hp as { current: number; maximum: number };
  return exact.current <= 0 ? "down" : exact.current * 2 <= exact.maximum ? "bloodied" : "healthy";
}

const labelFor = (instance: ConditionInstance, reference: readonly ContentConditionSummary[]) => {
  const name = reference.find((entry) => entry.id === instance.id)?.name ?? instance.id;
  return instance.id === "exhaustion" && instance.level !== undefined ? `${name} ${instance.level}` : name;
};
const descriptionFor = (id: string, reference: readonly ContentConditionSummary[]) => reference.find((entry) => entry.id === id)?.description ?? "";

/** Ultra-compact condition presence for dense list rows: dots with tooltips (full names one tap away in the row's tools). */
export function ConditionDots({ conditions }: Readonly<{ conditions: readonly ConditionInstance[] }>) {
  const reference = useConditionReference();
  if (conditions.length === 0) return null;
  const shown = conditions.slice(0, 4);
  return <span className="condition-dots" role="img" aria-label={conditions.map((instance) => labelFor(instance, reference)).join(", ")}>
    {shown.map((instance) => <span key={instance.id} className="condition-dot" title={labelFor(instance, reference)} />)}
    {conditions.length > shown.length && <span className="condition-dot-more">+{conditions.length - shown.length}</span>}
  </span>;
}

/** Read-only condition chips with rules-text tooltips. */
export function ConditionChips({ conditions }: Readonly<{ conditions: readonly ConditionInstance[] }>) {
  const reference = useConditionReference();
  if (conditions.length === 0) return null;
  return <span className="condition-chips">{conditions.map((instance) => (
    <span key={instance.id} className="condition-chip" title={descriptionFor(instance.id, reference)}>{labelFor(instance, reference)}</span>
  ))}</span>;
}

/**
 * Chips plus a toggleable picker for whoever may edit this actor (the server still enforces
 * scope). Exhaustion exposes a 1-6 level stepper while active.
 */
export function ConditionEditor({ actorId, conditions, onFeedback }: Readonly<{ actorId: string; conditions: readonly ConditionInstance[]; onFeedback: (text: string) => void }>) {
  const reference = useConditionReference();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeById = new Map(conditions.map((instance) => [instance.id, instance]));

  const send = (conditionId: string, active: boolean, level?: number) => {
    setBusy(true);
    socket.emit("actor:set-condition", { commandId: newId(), actorId, conditionId, active, ...(level !== undefined ? { level } : {}) }, (result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The condition could not be updated.");
    });
  };

  return <div className="condition-editor">
    <span className="condition-chips">
      {conditions.map((instance) => (
        <button key={instance.id} type="button" className="condition-chip condition-chip-active" disabled={busy} title={`${descriptionFor(instance.id, reference)}\n\nClick to remove.`} onClick={() => send(instance.id, false)}>{labelFor(instance, reference)}</button>
      ))}
      <button type="button" className="condition-chip condition-add" disabled={busy} aria-expanded={open} aria-label="Edit conditions" title="Add or remove conditions" onClick={() => { requestConditionReference(); setOpen((current) => !current); }}>{open ? "−" : "+"}</button>
    </span>
    {open && <div className="condition-picker" role="group" aria-label="Conditions">
      {reference.map((entry) => {
        const instance = activeById.get(entry.id);
        return <span key={entry.id} className="condition-option">
          <button type="button" className="condition-chip" aria-pressed={instance !== undefined} disabled={busy} title={entry.description} onClick={() => send(entry.id, instance === undefined, undefined)}>{entry.name}</button>
          {entry.id === "exhaustion" && instance && <span className="exhaustion-level" aria-label="Exhaustion level">
            <button type="button" disabled={busy || (instance.level ?? 1) <= 1} onClick={() => send("exhaustion", true, (instance.level ?? 1) - 1)}>−</button>
            <strong>{instance.level ?? 1}</strong>
            <button type="button" disabled={busy || (instance.level ?? 1) >= 6} onClick={() => send("exhaustion", true, (instance.level ?? 1) + 1)}>+</button>
          </span>}
        </span>;
      })}
    </div>}
  </div>;
}
