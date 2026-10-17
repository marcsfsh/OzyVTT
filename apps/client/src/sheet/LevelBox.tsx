import { useEffect, useRef, useState } from "react";
import { Button, IconChevronLeft, IconLevelUp } from "@vtt/ui";

/**
 * The level box beside the menu button on a phone: the character's level, and when this viewer may level the
 * character, a button that opens a small panel with Level up, what that level brings, and Level down. Otherwise the
 * level is plain text.
 */
export function LevelBox({
  level,
  className,
  levelUpTo,
  brings,
  onLevelUp,
  onLevelDown
}: Readonly<{
  level: number;
  /** "Wizard" for one class; absent for several. */
  className: string | null;
  /** The level a step up reaches, or null at the table's cap. */
  levelUpTo: number | null;
  /** What the next level brings, as the server says it; absent until it answers. */
  brings?: readonly string[] | null;
  /** Absent when this viewer may not level the character. */
  onLevelUp?: () => void;
  onLevelDown?: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const face = (
    <>
      <span className="cs-level-k">Level</span>
      <span className="cs-level-v">{level}</span>
    </>
  );
  if (!onLevelUp && !onLevelDown)
    return (
      <span className="cs-level" role="img" aria-label={`Level ${level}`}>
        {face}
      </span>
    );
  return (
    <div className="cs-level-wrap" ref={rootRef}>
      <button
        type="button"
        className={`cs-level is-button${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-label={`Level ${level}. Level up or down`}
        onClick={() => setOpen((current) => !current)}
      >
        {face}
      </button>
      {open && (
        <div className="cs-level-panel" role="group" aria-label={`Level ${level}`}>
          <span className="cs-eyebrow">
            Level {level}
            {className ? ` · ${className}` : ""}
          </span>
          {onLevelUp && (
            <Button variant="primary" block disabled={levelUpTo === null} onClick={onLevelUp}>
              <IconLevelUp /> {levelUpTo === null ? "At the table's highest level" : `Level up to ${levelUpTo}`}
            </Button>
          )}
          {levelUpTo !== null && brings && brings.length > 0 && (
            <p className="cs-sub">
              Level {levelUpTo} brings {brings.join(" · ")}.
            </p>
          )}
          {onLevelDown && level > 1 && (
            <Button block onClick={onLevelDown}>
              <IconChevronLeft /> Level down to {level - 1}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
