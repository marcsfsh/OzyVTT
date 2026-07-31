import { Badge, IconEye, IconEyeOff, Switch } from "@vtt/ui";

/**
 * The Codex's one shared "public vs GM-only" vocabulary, factored so it can never drift again.
 * Two axes, three components:
 *  - RevealSwitch: is this whole record shown to players at all? ("Shown to players" / "Hidden from players")
 *  - HiddenFromPlayers: the same RECORD-level fact, read-only, for a list with no switch on the row
 *  - GmOnlyTag: this piece of content is GM-only (always a violet "GM only" pill, same everywhere)
 *
 * The two axes used to share one phrase, and on a journal row both appeared at once: the switch read
 * "GM only" for the whole entry while the violet pill read "GM only" for one paragraph of it — the same
 * three words answering two different questions eighty pixels apart. So the RECORD axis now says
 * "Hidden from players", the exact antonym of the state it toggles out of, and the CONTENT pill keeps
 * "GM only". Either phrase alone is now unambiguous about which question it is answering.
 *
 * (`AtlasView`'s descend-lock eye icon still says "GM only" in its `aria-label`. It is left alone
 * deliberately: it is an icon with its own explanatory `title`, on a map row that carries no content pill,
 * so there is nothing there for it to collide with.)
 */

/** The one reveal toggle. Same wording on pages, journal entries, maps, and markers. */
export function RevealSwitch({ revealed, onChange, ariaLabel }: Readonly<{
  revealed: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}>) {
  return (
    <Switch
      checked={revealed}
      onChange={onChange}
      aria-label={ariaLabel ?? "Show to players"}
      label={revealed ? "Shown to players" : "Hidden from players"}
    />
  );
}

/**
 * "This whole record is hidden" where the row has no switch to read it from — the page timeline, a page's
 * marker list, the marker inspector's entry list. These used `GmOnlyTag`, which is the CONTENT pill: on a
 * list of records it was answering the record question with the paragraph vocabulary. Same words as the
 * switch's off state, on purpose, because it is the same fact.
 */
export function HiddenFromPlayers() {
  return <Badge tone="neutral" className="codex-hidden-pill"><IconEyeOff /> Hidden from players</Badge>;
}

/**
 * The one "this content is GM-only" pill, now over the `Badge` primitive's violet tone (D25: bespoke
 * lookalikes become primitives). Violet stays exclusively GM-only, which is why the tone exists.
 * `floating` positions it in a block's top-right corner.
 */
export function GmOnlyTag({ floating = false }: Readonly<{ floating?: boolean }>) {
  return <Badge tone="violet" className={`codex-gm-pill${floating ? " is-floating" : ""}`}>GM only</Badge>;
}

/**
 * D18 / G11 — **one fact, one badge.** Whether a record is shown to players, said the same way on every
 * list in the suite: icon + the RevealSwitch's exact words, never colour alone and never a drifted
 * "Shown"/"Hidden" shorthand that means something subtly different card to card.
 *
 * GM-only by construction: the shared card types carry no reveal flag, so a player caller literally
 * cannot pass `revealed` — the same capability-flag pattern `onAdjustStanding` uses.
 */
export function VisibilityBadge({ revealed }: Readonly<{ revealed: boolean }>) {
  return revealed
    ? <Badge tone="success" className="codex-visibility-badge"><IconEye /> Shown to players</Badge>
    : <Badge tone="neutral" className="codex-visibility-badge"><IconEyeOff /> Hidden from players</Badge>;
}
