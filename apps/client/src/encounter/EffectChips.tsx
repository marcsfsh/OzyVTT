import { useState } from "react";
import { type PlayerEffect } from "@vtt/domain";
import { Chip } from "@vtt/ui";
import { command } from "../lib/command";

/**
 * Active rules-engine effects (Rage, a grapple) as chips beside the condition chips. Ending one is
 * a real engine transition: linked conditions clear and on-end grants fire server-side (ADR-0020).
 */
export function EffectChips({
  actorId,
  effects,
  canEnd,
  onFeedback
}: Readonly<{
  actorId: string;
  effects: ReadonlyArray<PlayerEffect & { escapeDc?: number | null }>;
  canEnd: boolean;
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  if (effects.length === 0) return null;
  const durationLabel = (effect: PlayerEffect) =>
    effect.duration.type === "rounds"
      ? `${effect.duration.remaining} rounds left`
      : effect.duration.type === "until-source-next-turn"
        ? "until next turn"
        : effect.duration.type === "encounter"
          ? "this encounter"
          : "until ended";
  const end = (effectId: string, name: string) => {
    setBusy(true);
    void command("effect:end", { actorId, effectId }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? `${name} ended.` : (result.message ?? "The effect could not be ended."));
    });
  };
  return (
    <span className="effect-chips">
      {effects.map((effect) => (
        <Chip
          key={effect.id}
          tone="info"
          title={`${effect.name}${effect.sourceName ? ` - from ${effect.sourceName}` : ""} · ${durationLabel(effect)}${effect.escapeDc ? ` · escape DC ${effect.escapeDc}` : ""}`}
          onRemove={
            canEnd
              ? () => {
                  if (!busy) end(effect.id, effect.name);
                }
              : undefined
          }
          removeLabel={`End ${effect.name}`}
        >
          {effect.name}
          {effect.escapeDc ? <small> DC {effect.escapeDc}</small> : null}
        </Chip>
      ))}
    </span>
  );
}
