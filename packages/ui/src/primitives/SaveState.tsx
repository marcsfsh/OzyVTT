import type { ReactNode } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { IconCheck, IconPencil, IconShuffle, IconWarning } from "./icons";
import "./SaveState.css";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

interface SaveStateProps {
  status: SaveStatus;
  /** Rendered only for "conflict" — the record changed on the server. */
  onReload?: () => void;
  /** Rendered only for "error" — the PATCH failed. */
  onRetry?: () => void;
  className?: string;
}

/** The autosave readout for a save-as-you-type editor (Codex pages, homebrew records).
    - "idle" and "saved" both read Saved, so "your work is safe" is always visible.
    - Every state differs by word first, glyph second, colour third; colours avoid `--text-muted`.
    - Conflict offers Reload and error offers Retry.
    A separate polite live region announces only settled states (saved / conflict / error); "dirty" would fire
    on every keystroke. */
export function SaveState({ status, onReload, onRetry, className }: SaveStateProps) {
  const view = VIEWS[status];
  return (
    <div className={cx("nh-savestate", `nh-savestate--${view.tone}`, className)}>
      <span className="nh-savestate-icon" aria-hidden="true">
        {view.icon}
      </span>
      <span className="nh-savestate-label">{view.label}</span>
      {status === "conflict" && onReload && (
        <Button variant="secondary" size="sm" className="nh-savestate-action" onClick={onReload}>
          Reload
        </Button>
      )}
      {status === "error" && onRetry && (
        <Button variant="secondary" size="sm" className="nh-savestate-action" onClick={onRetry}>
          Retry
        </Button>
      )}
      {/* Settled states only; see the note above. */}
      <span className="nh-sr-only" role="status">
        {view.settled ? view.label : ""}
      </span>
    </div>
  );
}

type View = Readonly<{
  label: string;
  tone: "rest" | "work" | "caution" | "danger";
  settled: boolean;
  icon: ReactNode;
}>;

/* One table, so a status can't ship with a word but no glyph. "saving" uses the shuffle glyph rather than a
   spinner, because looping motion isn't allowed. */
const VIEWS: Record<SaveStatus, View> = {
  idle: { label: "Saved", tone: "rest", settled: false, icon: <IconCheck /> },
  saved: { label: "Saved", tone: "rest", settled: true, icon: <IconCheck /> },
  dirty: { label: "Unsaved changes", tone: "work", settled: false, icon: <IconPencil /> },
  saving: { label: "Saving…", tone: "work", settled: false, icon: <IconShuffle /> },
  conflict: { label: "Changed elsewhere", tone: "caution", settled: true, icon: <IconWarning /> },
  error: { label: "Couldn't save", tone: "danger", settled: true, icon: <IconWarning /> }
};
