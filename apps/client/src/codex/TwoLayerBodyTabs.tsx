import type { ReactNode } from "react";
import { SegmentedControl } from "@vtt/ui";

/**
 * THE TWO-LAYER NOTES CONTROL — one control, one pair of words, everywhere the split is offered.
 *
 * Every two-layer record in the Codex asks the GM the same question: *which layer am I writing?* Until
 * this file existed, seven surfaces asked it in seven different ways — the page editor said
 * "Player-facing / GM only", a quest said "What the party was told / GM notes", the four journal kinds
 * each carried their own player-side word ("Player-facing summary", "What will happen", "What the party
 * knows" twice) against a shared "GM-only notes", and the notes importer said "Player-facing side /
 * GM-only side". Seven names for one idea is the exact disease D5's glossary exists to end, and the GM
 * paid for it by having to re-learn the same toggle on every screen.
 *
 * The words are now **"Player-visible notes"** and **"GM-only notes"**, defined once, below.
 *
 * **This renames a control, and nothing else.** The gate on who can read a layer is `revealedToPlayers`
 * through `RevealSwitch`, and the layers themselves are the server's `playerBody`/`gmBody` and
 * `playerText`/`gmText` — untouched by this file and not renameable from it. `BodyLayer`'s two values
 * are those wire words, so a call site can hand the control its existing state with no mapping.
 *
 * **Why the labels live in an option-shaped record and not two bare strings.** `codex/vocabulary.test.ts`
 * reads this source through `copy-scan.ts`, which sees `label: "…"` and does not see
 * `PLAYER_LABEL = "…"`. Written this way the canonical pair stays inside the scanned corpus, so the
 * retirement rules that fire on the seven old labels can also see the words that replaced them.
 */

/** Which of a record's two layers is being written. The values are the server's, not this control's. */
export type BodyLayer = "player" | "gm";

/**
 * The canonical pair. Every surface reads its words from here — including the one surface that cannot
 * use the component below, `BackupView`'s "Import into", which needs the GM option first and lives
 * inside a `Field`. Sharing the option objects rather than the component is what keeps that surface
 * from drifting back into a seventh set of words.
 */
export const BODY_LAYER: Readonly<Record<BodyLayer, Readonly<{ value: BodyLayer; label: string }>>> = {
  player: { value: "player", label: "Player-visible notes" },
  gm: { value: "gm", label: "GM-only notes" }
};

export interface TwoLayerBodyTabsProps {
  value: BodyLayer;
  onChange: (layer: BodyLayer) => void;
  /** Anything the bar carries beside the switch — the journal composer's `GmOnlyTag`, for one. */
  children?: ReactNode;
}

/**
 * The body bar: the layer switch, plus whatever that surface hangs beside it.
 *
 * The group's accessible name is fixed rather than a prop, for the same reason the labels are: three
 * surfaces used to give the same control two different names ("Which layer to write", "Which body to
 * edit"), which is the visible drift repeating itself one level down in the accessibility tree.
 */
export function TwoLayerBodyTabs({ value, onChange, children }: TwoLayerBodyTabsProps) {
  return (
    <div className="codex-body-bar">
      <SegmentedControl ariaLabel="Which layer to write" value={value}
        onChange={(next) => onChange(next as BodyLayer)}
        options={[BODY_LAYER.player, BODY_LAYER.gm]} />
      {children}
    </div>
  );
}
