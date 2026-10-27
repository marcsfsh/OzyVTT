import { cx } from "./util";
import "./VcrCounter.css";

/**
 * The round, as a VCR counter: PLAY and RND 03 during a fight, STOP and RND -- between fights. One label says it
 * for assistive technology.
 */
export function VcrCounter({
  round,
  size = "md",
  className
}: Readonly<{
  /** The current round while a fight runs; null between fights. */
  round: number | null;
  size?: "md" | "lg";
  className?: string;
}>) {
  const playing = round !== null;
  const shown = playing ? String(Math.max(0, round)).padStart(2, "0") : "--";
  return (
    <div
      className={cx("nh-vcr", size === "lg" && "nh-vcr--lg", playing && "is-playing", className)}
      role="img"
      aria-label={playing ? `Round ${round}` : "No fight running"}
    >
      <span className="nh-vcr-state" aria-hidden="true">
        {playing ? "PLAY" : "STOP"}
        <svg className="nh-vcr-mark" viewBox="0 0 12 14" aria-hidden="true">
          {playing ? <path d="M1 1l10 6-10 6z" /> : <path d="M1 2h10v10H1z" />}
        </svg>
      </span>
      <span className="nh-vcr-round" aria-hidden="true">
        RND {shown}
      </span>
    </div>
  );
}
