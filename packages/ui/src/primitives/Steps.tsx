import { useRef, type ReactNode } from "react";
import { useOnChange } from "../motion/hooks";
import { burst, canMove, comet, rel } from "../motion/lightRail";
import { cx } from "./util";
import { IconCheck, IconWarning } from "./icons";
import "./Steps.css";

export interface StepItem {
  label: ReactNode;
  /** Plain-text name for the compact (phone) indicator. Defaults to `label`. */
  shortLabel?: string;
  /** Overrides the position-derived state for a non-current step, so a visited but unanswered step stops
      showing a check mark. Never overrides `current`. */
  state?: "done" | "incomplete";
}

interface StepsProps {
  steps: StepItem[];
  /** Zero-based index of the active step; earlier steps read as done. */
  current: number;
  /** Allow jumping back to an already-completed step. Upcoming steps stay locked. */
  onStepSelect?: (index: number) => void;
  /** Highest index the flow accepts a jump to (inclusive). When supplied it replaces the "done steps only" rule,
      so a visited-but-unfinished step stays reachable. */
  maxSelectable?: number;
  /** Accessible name for the flow, used by the compact indicator's progress bar. */
  ariaLabel?: string;
  /** The full form's direction above 760px: a horizontal rail (default) or a vertical list for a column beside the
      step body. */
  orientation?: "horizontal" | "vertical";
  className?: string;
}

/** Progress indicator for multi-step flows. Two forms swapped by media query (no JS breakpoint):
      - ≤760px: "Step 3 of 7" + the step name + a progress bar.
      - >760px: the full rail, which scrolls sideways and never wraps, or a vertical list (`orientation`).
    Only one form is displayed, so `display:none` keeps the other out of the accessibility tree. */
export function Steps({
  steps,
  current,
  onStepSelect,
  maxSelectable,
  ariaLabel = "Progress",
  orientation = "horizontal",
  className
}: StepsProps) {
  const total = Math.max(steps.length, 1);
  const index = Math.min(Math.max(current, 0), total - 1);
  const active = steps[index];
  const activeName = active?.shortLabel ?? active?.label;
  const percent = ((index + 1) / total) * 100;
  // A step change is a tab change on the rail (ADR-0045): light runs from the step left to the step reached, with a
  // burst there. On a phone it runs along the progress bar to its new end.
  const wrap = useRef<HTMLDivElement>(null);
  useOnChange(index, (before, now) => {
    const el = wrap.current;
    if (!el || !canMove()) return;
    const rail = el.querySelector<HTMLElement>(".nh-steps");
    const bar = el.querySelector<HTMLElement>(".nh-steps-bar");
    if (rail && rail.offsetParent !== null && orientation === "horizontal") {
      const steps = [...rail.children];
      const from = steps[before];
      const to = steps[now];
      if (!from || !to) return;
      const line = rel(rail, el).b - 1;
      comet(el, { from: rel(from, el).cx, to: rel(to, el).cx, line, thick: 3, delay: 0, dur: 240 });
      burst(el, { at: rel(to, el).cx, line, delay: 220, w: 80, h: 8 });
    } else if (bar && bar.offsetParent !== null) {
      const box = rel(bar, el);
      const at = (step: number) => box.x + (box.w * (step + 1)) / total;
      comet(el, { from: at(before), to: at(now), line: box.cy, thick: 3, delay: 0, dur: 240 });
      burst(el, { at: at(now), line: box.cy, delay: 220, w: 50, h: 8 });
    }
  });

  return (
    <div ref={wrap} className={cx("nh-steps-wrap", className)}>
      <div className="nh-steps-compact">
        <div className="nh-steps-compact-head">
          <span className="nh-steps-count tabular">
            Step {index + 1} of {total}
          </span>
          <span className="nh-steps-compact-label">{activeName}</span>
        </div>
        <div
          className="nh-steps-bar"
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${total}`}
        >
          <div className="nh-steps-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <ol className={cx("nh-steps", orientation === "vertical" && "nh-steps--vertical")} aria-label={ariaLabel}>
        {steps.map((step, i) => {
          // Precedence: the current step, then the flow's declared state, then position.
          const state = i === index ? "current" : (step.state ?? (i < index ? "done" : "upcoming"));
          const jumpable =
            onStepSelect != null && i !== index && (maxSelectable != null ? i <= maxSelectable : state === "done");
          const inner = (
            <>
              {/* Three marks, never three colours: a check for done, the caution mark for unfinished (the same glyph as the
                  footer's blocked reason), the number for upcoming. */}
              <span className="nh-step-marker" aria-hidden="true">
                {state === "done" ? <IconCheck /> : state === "incomplete" ? <IconWarning /> : i + 1}
              </span>
              <span className="nh-step-label">
                {step.label}
                {/* The check is decorative, so state is spoken only when the flow declared one. */}
                {step.state != null && state !== "current" && (
                  <span className="nh-sr-only">{state === "done" ? ", done" : ", not finished"}</span>
                )}
              </span>
            </>
          );
          return (
            <li
              key={i}
              className={cx("nh-step", `nh-step--${state}`)}
              aria-current={state === "current" ? "step" : undefined}
            >
              {jumpable ? (
                <button type="button" className="nh-step-jump interactive" onClick={() => onStepSelect?.(i)}>
                  {inner}
                </button>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
