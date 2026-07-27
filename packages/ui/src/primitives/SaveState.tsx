import type { ReactNode } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { IconCheck, IconPencil, IconShuffle, IconWarning } from "./icons";
import "./SaveState.css";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export interface SaveStateProps {
  status: SaveStatus;
  /** Rendered only for "conflict" — the record changed on the server. */
  onReload?: () => void;
  /** Rendered only for "error" — the PATCH failed. */
  onRetry?: () => void;
  className?: string;
}

/** The autosave readout for a park-as-you-type editor (Codex pages, homebrew records).
    Three things it fixes about the hand-rolled version it replaces:

    1. **A real resting state.** "idle" and "saved" both read **Saved**. Rendering an
       empty string at rest means the GM cannot tell "your work is safe" from "nothing
       has happened yet" — which is the one question this readout exists to answer.
    2. **Icon AND text, never colour alone.** This palette is heavy in the red-pink-
       magenta band and reserves violet for GM-only, so no state may be carried by hue
       (design-language §2). Every status below differs by word first, glyph second,
       colour third. Colour uses `--text-dim` / `--caution-hi` / `--danger-hi` and
       never `--text-muted`, which is 3.61:1 and fails AA.
    3. **The two states that need an action get one.** A readout the GM cannot act on
       is exactly the state that most needs reading: conflict offers Reload, error
       offers Retry.

    Accessibility: the visible readout is ordinary text, so browse mode reads it any
    time. A separate polite live region carries ONLY the settled states (saved /
    conflict / error) — announcing "dirty" would fire on every keystroke. */
export function SaveState({ status, onReload, onRetry, className }: SaveStateProps) {
  const view = VIEWS[status];
  return (
    <div className={cx("nh-savestate", `nh-savestate--${view.tone}`, className)}>
      <span className="nh-savestate-icon" aria-hidden="true">{view.icon}</span>
      <span className="nh-savestate-label">{view.label}</span>
      {status === "conflict" && onReload && (
        <Button variant="secondary" size="sm" className="nh-savestate-action" onClick={onReload}>Reload</Button>
      )}
      {status === "error" && onRetry && (
        <Button variant="secondary" size="sm" className="nh-savestate-action" onClick={onRetry}>Retry</Button>
      )}
      {/* Settled states only — see the note above. */}
      <span className="nh-sr-only" role="status">{view.settled ? view.label : ""}</span>
    </div>
  );
}

type View = Readonly<{ label: string; tone: "rest" | "work" | "caution" | "danger"; settled: boolean; icon: ReactNode }>;

/* One table, so a new status cannot ship with a word but no glyph (or the reverse).
   "saving" borrows the shuffle glyph — the system's existing in-flight mark — rather
   than a spinner: §7 forbids looping motion, and a spinner is a loop. */
const VIEWS: Record<SaveStatus, View> = {
  idle: { label: "Saved", tone: "rest", settled: false, icon: <IconCheck /> },
  saved: { label: "Saved", tone: "rest", settled: true, icon: <IconCheck /> },
  dirty: { label: "Unsaved changes", tone: "work", settled: false, icon: <IconPencil /> },
  saving: { label: "Saving…", tone: "work", settled: false, icon: <IconShuffle /> },
  conflict: { label: "Changed elsewhere", tone: "caution", settled: true, icon: <IconWarning /> },
  error: { label: "Couldn't save", tone: "danger", settled: true, icon: <IconWarning /> }
};
