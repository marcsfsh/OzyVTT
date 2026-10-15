import { useId, type ReactNode } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { IconChevron, IconWarning } from "./icons";
import { Steps, type StepItem } from "./Steps";
import "./WizardShell.css";

interface WizardShellProps {
  /** Flow title, e.g. "Create a character". Set in the display face, not the wordmark. */
  title: ReactNode;
  eyebrow?: ReactNode;
  steps: StepItem[];
  /** Zero-based index of the active step. */
  current: number;
  /** Jump back to a completed step from the indicator. Upcoming steps stay locked. */
  onStepSelect?: (index: number) => void;
  /** Highest step index the indicator may jump to (inclusive); see `Steps.maxSelectable`. */
  maxSelectable?: number;

  children: ReactNode;

  /** Back is hidden on the first step — omit the handler there. */
  onBack?: () => void;
  /** An extra action beside Back for another way out of a step (e.g. "Back to review"). It moves, it doesn't commit. */
  footerSecondary?: ReactNode;
  onNext?: () => void;
  backLabel?: string;
  nextLabel?: string;
  /** Per-step validation gate. Present ⇒ Next is disabled and this reason is shown and announced (Next is
      `aria-describedby` it). Absent ⇒ Next is live. */
  blockedReason?: ReactNode;
  /** Disables both footer actions while a submit is in flight. */
  busy?: boolean;

  /** "Save & close" — parks a server-held draft and leaves. */
  onSaveAndClose?: () => void;
  saveLabel?: string;
  /** Resume-draft affordance slot: an Alert, a Button, whatever the flow needs. */
  resume?: ReactNode;

  /** Optional detail/preview pane beside the step body; the one detail pane in a guided flow. */
  detail?: ReactNode;
  detailTitle?: ReactNode;
  /** On narrow screens the detail pane replaces the body (master-detail) while this is true, with a back link. */
  detailOpen?: boolean;
  /** The narrow-screen way in: rendered above the step body below 760px, where the pane is hidden. */
  onOpenDetail?: () => void;
  detailOpenLabel?: string;
  onCloseDetail?: () => void;
  detailBackLabel?: string;

  /** Persistent footnote; the wizard's CC BY attribution line goes here. */
  footnote?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/** The multi-step frame for the character builder and other long guided flows. Not a modal: a full page on a
    laptop and a full-screen sheet on a phone. Provides a compact-capable step indicator, a Back / Next footer
    whose disabled Next always has an announced reason, sticky header and footer, and an optional detail pane
    that becomes master-detail on narrow screens. The flow owns all step state. */
export function WizardShell({
  title,
  eyebrow,
  steps,
  current,
  onStepSelect,
  maxSelectable,
  children,
  onBack,
  footerSecondary,
  onNext,
  backLabel = "Back",
  nextLabel = "Next",
  blockedReason,
  busy = false,
  onSaveAndClose,
  saveLabel = "Save & close",
  resume,
  detail,
  detailTitle,
  detailOpen = false,
  onOpenDetail,
  detailOpenLabel = "Show details",
  onCloseDetail,
  detailBackLabel = "Back to the list",
  footnote,
  ariaLabel,
  className
}: WizardShellProps) {
  const reasonId = useId();
  const blocked = blockedReason != null;

  return (
    <section
      className={cx("nh-wizard", className)}
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
    >
      <header className="nh-wizard-head">
        <div className="nh-wizard-titles">
          {eyebrow != null && <span className="nh-eyebrow">{eyebrow}</span>}
          <h1 className="nh-wizard-title">{title}</h1>
        </div>
        {onSaveAndClose && (
          <div className="nh-wizard-headops">
            <Button variant="secondary" size="sm" onClick={onSaveAndClose} disabled={busy}>
              {saveLabel}
            </Button>
          </div>
        )}
        <div className="nh-wizard-progress">
          <Steps
            steps={steps}
            current={current}
            onStepSelect={onStepSelect}
            maxSelectable={maxSelectable}
            ariaLabel={`${typeof title === "string" ? title : "Wizard"} progress`}
          />
        </div>
      </header>

      {resume != null && <div className="nh-wizard-resume">{resume}</div>}

      {/* The step body is the wizard's one scrolling region; head and foot stay put. */}
      <div
        className={cx(
          "nh-wizard-body",
          "scroll-y",
          detail != null && "nh-wizard-body--split",
          detailOpen && "has-detail"
        )}
      >
        <div className="nh-wizard-main">
          {detail != null && onOpenDetail && (
            <Button variant="ghost" size="sm" className="nh-wizard-detail-open" onClick={onOpenDetail}>
              {detailOpenLabel}
            </Button>
          )}
          {children}
          {/* The footnote scrolls with the step so licence text doesn't permanently take phone height. */}
          {footnote != null && <p className="nh-wizard-footnote">{footnote}</p>}
        </div>
        {detail != null && (
          <aside className="nh-wizard-detail" aria-label={typeof detailTitle === "string" ? detailTitle : "Details"}>
            {onCloseDetail && (
              <Button variant="ghost" size="sm" className="nh-wizard-detail-back" onClick={onCloseDetail}>
                {/* The disclosure caret, turned a quarter, rather than a "‹" glyph that renders too small. */}
                <span className="nh-wizard-detail-back-icon" aria-hidden="true">
                  <IconChevron />
                </span>
                {detailBackLabel}
              </Button>
            )}
            {detailTitle != null && <h2 className="nh-wizard-detail-title">{detailTitle}</h2>}
            <div className="nh-wizard-detail-body">{detail}</div>
          </aside>
        )}
      </div>

      <footer className="nh-wizard-foot">
        <div className="nh-wizard-foot-back">
          {onBack && (
            <Button variant="secondary" onClick={onBack} disabled={busy}>
              {backLabel}
            </Button>
          )}
          {footerSecondary}
        </div>
        <p className={cx("nh-wizard-blocked", !blocked && "is-clear")} id={reasonId} role="status">
          {blocked && (
            <>
              <span className="nh-wizard-blocked-icon" aria-hidden="true">
                <IconWarning />
              </span>
              {blockedReason}
            </>
          )}
        </p>
        <div className="nh-wizard-foot-next">
          {onNext && (
            <Button
              variant="primary"
              arrow
              onClick={onNext}
              disabled={blocked || busy}
              aria-describedby={blocked ? reasonId : undefined}
            >
              {nextLabel}
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
