import { useState } from "react";
import type { GmActor } from "@vtt/domain";
import { command } from "../lib/command";
import "./prompts.css";

const DEGREES = [
  { id: "half", tag: "cover-half", label: "Half", name: "Half Cover" },
  { id: "three-quarters", tag: "cover-three-quarters", label: "Three-quarters", name: "Three-quarters Cover" },
  { id: "total", tag: "cover-total", label: "Total", name: "Total Cover" }
] as const;

/**
 * The GM marks the cover a creature has (SRD "The GM determines whether the target has Cover"): every attack and
 * Dexterity save against it then counts it, a player's included, until the GM sets it back to None. Stored as an
 * effect, so the table sees the chip.
 */
export function CoverControl({
  actor,
  onFeedback
}: Readonly<{ actor: Pick<GmActor, "id" | "effects">; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  const markers = actor.effects.filter((effect) => DEGREES.some((degree) => effect.tags.includes(degree.tag)));
  const current = DEGREES.find((degree) => markers.some((effect) => effect.tags.includes(degree.tag)))?.id ?? null;

  const pick = async (next: (typeof DEGREES)[number] | null) => {
    setBusy(true);
    for (const marker of markers) {
      const ended = await command("effect:end", { actorId: actor.id, effectId: marker.id });
      if (!ended.ok) {
        setBusy(false);
        onFeedback(ended.message ?? "The cover could not be changed.");
        return;
      }
    }
    if (next) {
      const added = await command("effect:add", { actorId: actor.id, name: next.name, tags: [next.tag] });
      if (!added.ok) onFeedback(added.message ?? "The cover could not be changed.");
    }
    setBusy(false);
  };

  return (
    <div className="push-choice cover-control" role="group" aria-label="Cover">
      <span className="push-choice-label">Cover</span>
      <button
        type="button"
        className={`save-die-mode${current === null ? " active" : ""}`}
        aria-pressed={current === null}
        disabled={busy || current === null}
        onClick={() => void pick(null)}
      >
        None
      </button>
      {DEGREES.map((degree) => (
        <button
          key={degree.id}
          type="button"
          className={`save-die-mode${current === degree.id ? " active" : ""}`}
          aria-pressed={current === degree.id}
          disabled={busy || current === degree.id}
          onClick={() => void pick(degree)}
        >
          {degree.label}
        </button>
      ))}
    </div>
  );
}
