import { Switch } from "@vtt/ui";

/**
 * The Codex's one shared "public vs GM-only" vocabulary, factored so it can never drift again.
 * Two axes, two components:
 *  - RevealSwitch: is this whole record shown to players at all? (always "Shown to players" / "GM only")
 *  - GmOnlyTag: this piece of content is GM-only (always a violet "GM only" pill, same everywhere)
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
      label={revealed ? "Shown to players" : "GM only"}
    />
  );
}

/** The one "this content is GM-only" pill. `floating` positions it in a block's top-right corner. */
export function GmOnlyTag({ floating = false }: Readonly<{ floating?: boolean }>) {
  return <span className={`codex-gm-pill${floating ? " is-floating" : ""}`} aria-label="GM only, hidden from players">GM only</span>;
}
