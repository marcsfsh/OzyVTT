import { useState } from "react";
import type { ContentActionSummary } from "@vtt/domain";
import { IconChevron } from "@vtt/ui";

/** The generic actions a table reaches for mid-fight; the rest sit behind "More". */
const PRIMARY_BUILTINS = ["dodge", "dash", "disengage", "help", "hide"] as const;

/** A generic action that needs no target is one tap; Help and the Unarmed Strikes pick a creature first. */
export const isTargetlessBuiltin = (action: ContentActionSummary) =>
  action.targeting !== "single" && action.targeting !== "multi";

/**
 * The SRD generic actions every combatant has (Dodge, Dash, Help, ...) as one cluster of chips, with the Bonus Action
 * forms a feature gives (Cunning Action's Dash, Nimble Escape's Hide) among the first ones, since they're taken every
 * turn. The server decides: a chip stays tappable and a refusal comes back with its reason.
 */
export function CommonActionChips({
  actions,
  busy,
  hintFor,
  onUse
}: Readonly<{
  actions: readonly ContentActionSummary[];
  busy: boolean;
  hintFor?: (action: ContentActionSummary) => string | null;
  onUse: (action: ContentActionSummary, targetless: boolean) => void;
}>) {
  const [more, setMore] = useState(false);
  if (actions.length === 0) return null;
  const isPrimary = (action: ContentActionSummary) =>
    (PRIMARY_BUILTINS as readonly string[]).includes(action.id) || action.activation === "bonus-action";
  const primary = [
    ...PRIMARY_BUILTINS.flatMap((id) => actions.filter((action) => action.id === id)),
    ...actions.filter((action) => action.activation === "bonus-action")
  ];
  const rest = actions.filter((action) => !isPrimary(action));
  const shown = more ? [...primary, ...rest] : primary.length > 0 ? primary : actions;
  return (
    <div className="builtin-actions" role="group" aria-label="Common actions">
      <span className="builtin-actions-label">Common</span>
      {shown.map((action) => {
        const hint = hintFor?.(action) ?? null;
        return (
          <button
            key={action.id}
            type="button"
            className={`builtin-chip${hint ? " hinted" : ""}`}
            disabled={busy}
            title={`${action.description}${hint ? `\n\n${hint}` : ""}`}
            onClick={() => onUse(action, isTargetlessBuiltin(action))}
          >
            {action.name}
          </button>
        );
      })}
      {rest.length > 0 && primary.length > 0 && (
        <button
          type="button"
          className="builtin-chip builtin-more"
          aria-expanded={more}
          onClick={() => setMore((current) => !current)}
        >
          {more ? "Less" : "More"} <IconChevron className="builtin-more-caret" />
        </button>
      )}
    </div>
  );
}
