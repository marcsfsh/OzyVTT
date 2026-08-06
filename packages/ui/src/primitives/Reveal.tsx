import { Badge } from "./Badge";
import { StableSwap } from "./StableSwap";
import { Tooltip } from "./Tooltip";
import { cx } from "./util";
import { IconEye, IconEyeOff } from "./icons";
import "./Reveal.css";

/**
 * The one shared "shown to players vs GM-only" vocabulary, factored so it can never drift again.
 * Two axes, four components:
 *  - RevealSwitch: is this whole record shown to players at all? ("Shown to players" / "Hidden from players")
 *  - VisibilityBadge: the same RECORD-level fact, read-only, said with an icon AND the same words
 *  - HiddenFromPlayers: the off half of that badge alone, for a list that only marks what is withheld
 *  - GmOnlyTag: this piece of CONTENT is GM-only (always a violet "GM only" pill, same everywhere)
 *
 * The two axes used to share one phrase, and on a journal row both appeared at once: the switch read
 * "GM only" for the whole entry while the violet pill read "GM only" for one paragraph of it — the same
 * three words answering two different questions eighty pixels apart. So the RECORD axis says
 * "Hidden from players", the exact antonym of the state it toggles out of, and the CONTENT pill keeps
 * "GM only". Either phrase alone is unambiguous about which question it is answering.
 *
 * **Why this is a primitive and not Codex code.** It began in `apps/client/src/codex/SecretMarkers.tsx`
 * and served the Codex only. The same control is now the answer everywhere the product asks "do the
 * players see this?" — homebrew records, the staging tray, archived previews, per-replay visibility,
 * adding a monster, moving a token between layers — so it lives with the rest of the design system and
 * the words come with it. The words are the decision (D28), not a default: any surface that asks this
 * question uses THIS control, and no surface invents "Add as GM-only" or "Move to shared layer" again.
 *
 * (The Codex atlas's descend-lock eye icon still says "GM only" in its `aria-label`. Left alone
 * deliberately: it is an icon with its own explanatory `title`, on a map row that carries no content
 * pill, so there is nothing there for it to collide with.)
 */

/** The words themselves, in one place, because they are the contract. */
const SHOWN = "Shown to players";
const HIDDEN = "Hidden from players";

/**
 * The one reveal toggle — **an icon-only eye** (ruling 17), with the state carried by the magenta the
 * client kept and by which of the two glyphs is drawn. Removing the label removes the optical-centring
 * complaint at the root rather than tuning it, and ruling 58 makes this exact glyph, colour and
 * position the app-wide signal for "players can see this".
 *
 * **It keeps a name and a tooltip, and that is not optional.** An icon-only toggle with no accessible
 * name is a regression, not a simplification (ruling 17's own constraint). Three things carry the
 * meaning now: `aria-label` for assistive technology, the tooltip for a pointer, and `title` for the
 * platforms that surface one on a long press — because hover does not exist on half this table's
 * devices, and this is the control where a GM misreading the state leaks something to the table
 * (ruling 58: a safety property, not tidiness).
 *
 * The tooltip says the STATE in the glossary's exact words, so the phrase the label used to show is
 * still in the document and still the only place it is written.
 *
 * `role="switch"` and `aria-checked` are unchanged: the semantics were never the problem.
 */
export function RevealSwitch({ revealed, onChange, ariaLabel, banded = false, disabled = false, className }: Readonly<{
  revealed: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  /** Pass in a form grid so the control aligns with the input wells beside it (D23b). */
  banded?: boolean;
  disabled?: boolean;
  className?: string;
}>) {
  const state = revealed ? SHOWN : HIDDEN;
  return (
    <Tooltip content={state} className={cx("nh-reveal", banded && "nh-reveal--banded", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={revealed}
        aria-label={ariaLabel ?? "Show to players"}
        title={state}
        disabled={disabled}
        onClick={() => onChange(!revealed)}
        className={cx("nh-reveal-toggle", revealed && "is-revealed", "tap-target", "interactive")}
      >
        {revealed ? <IconEye /> : <IconEyeOff />}
      </button>
    </Tooltip>
  );
}

/**
 * **One fact, one badge.** Whether a record is shown to players, said the same way on every list in the
 * suite: icon + the RevealSwitch's exact words, never colour alone and never a drifted "Shown"/"Hidden"
 * shorthand that means something subtly different card to card. Width-stable for the same reason the
 * switch is: these badges sit in card headers whose other contents must not shuffle when one flips.
 *
 * GM-only by construction wherever the caller is: a shared card type that carries no reveal flag simply
 * cannot pass `revealed`.
 */
export function VisibilityBadge({ revealed }: Readonly<{ revealed: boolean }>) {
  return revealed
    ? <Badge tone="success" className="nh-visibility-badge"><IconEye /><StableSwap current={SHOWN} alternate={HIDDEN} /></Badge>
    : <Badge tone="neutral" className="nh-visibility-badge"><IconEyeOff /><StableSwap current={HIDDEN} alternate={SHOWN} /></Badge>;
}

/**
 * "This whole record is hidden" where the row has no switch to read it from — a page timeline, a page's
 * pin list, the pin inspector's entry list. These used `GmOnlyTag`, which is the CONTENT pill: on a list
 * of records it answered the record question in the paragraph vocabulary. Same words as the switch's off
 * state, on purpose, because it is the same fact. No width reservation here: nothing toggles in place —
 * the row either carries this pill or it does not.
 */
export function HiddenFromPlayers() {
  return <Badge tone="neutral" className="nh-reveal-pill"><IconEyeOff /> {HIDDEN}</Badge>;
}

/**
 * The one "this content is GM-only" pill, over the `Badge` primitive's violet tone. Violet stays
 * exclusively GM-only, which is why the tone exists. `floating` positions it in a block's top-right
 * corner (the block itself supplies the positioning context).
 */
export function GmOnlyTag({ floating = false }: Readonly<{ floating?: boolean }>) {
  return <Badge tone="violet" className={`nh-reveal-pill${floating ? " nh-reveal-pill--floating" : ""}`}>GM only</Badge>;
}
