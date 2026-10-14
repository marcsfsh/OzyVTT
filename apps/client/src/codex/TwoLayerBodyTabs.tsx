import type { ReactNode } from "react";
import { SegmentedControl } from "@vtt/ui";

/**
 * The two-layer notes control: one pair of words ("Player-visible notes" / "GM-only notes") everywhere
 * the split is offered. It only names the layers; visibility is `revealedToPlayers` via `RevealSwitch`.
 * Labels live in option objects (`label: "..."`) so `vocabulary.test.ts`'s copy scan can see them.
 */

/** Which layer is being written. The values match the server's field prefixes. */
export type BodyLayer = "player" | "gm";

/** The canonical pair, also used directly by `BackupView`'s "Import into" field. */
export const BODY_LAYER: Readonly<Record<BodyLayer, Readonly<{ value: BodyLayer; label: string }>>> = {
  player: { value: "player", label: "Player-visible notes" },
  gm: { value: "gm", label: "GM-only notes" }
};

export interface TwoLayerBodyTabsProps {
  value: BodyLayer;
  onChange: (layer: BodyLayer) => void;
  /** Anything shown beside the switch, e.g. the journal composer's `GmOnlyTag`. */
  children?: ReactNode;
}

/** The layer switch plus whatever the surface hangs beside it. The accessible name is fixed so it can't drift. */
export function TwoLayerBodyTabs({ value, onChange, children }: TwoLayerBodyTabsProps) {
  return (
    <div className="codex-body-bar">
      <SegmentedControl
        ariaLabel="Which layer to write"
        value={value}
        onChange={(next) => onChange(next as BodyLayer)}
        options={[BODY_LAYER.player, BODY_LAYER.gm]}
      />
      {children}
    </div>
  );
}
