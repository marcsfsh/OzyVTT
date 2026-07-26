import { useId, type ReactNode } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { Steps, type StepItem } from "./Steps";
import "./WizardShell.css";

export interface WizardShellProps {
  /** Flow title, e.g. "Create a character". Set in the display face, not the wordmark. */
  title: ReactNode;
  eyebrow?: ReactNode;
  steps: StepItem[];
  /** Zero-based index of the active step. */
  current: number;
  /** Jump back to a completed step from the indicator. Upcoming steps stay locked. */
  onStepSelect?: (index: number) => void;

  children: ReactNode;

  /** Back is hidden on the first step — omit the handler there. */
  onBack?: () => void;
  onNext?: () => void;
  backLabel?: string;
  nextLabel?: string;
  /** Per-step validation gate. Present ⇒ Next is disabled and this reason is shown
      and announced; the button is `aria-describedby` it, so the block is never
      silent. Absent ⇒ Next is live. */
  blockedReason?: ReactNode;
  /** Disables both footer actions while a submit is in flight. */
  busy?: boolean;

  /** "Save & close" — parks a server-held draft and leaves. */
  onSaveAndClose?: () => void;
  saveLabel?: string;
  /** Resume-draft affordance slot: an Alert, a Button, whatever the flow needs. */
  resume?: ReactNode;

  /** Optional detail/preview pane beside the step body. */
  detail?: ReactNode;
  detailTitle?: ReactNode;
  /** Narrow screens are master-detail (mirroring the Codex workspace): the detail
      pane replaces the body when this is true, with a back link to the list. */
  detailOpen?: boolean;
  onCloseDetail?: () => void;
  detailBackLabel?: string;

  /** Persistent footnote — the wizard's CC BY attribution line lives here. */
  footnote?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/** The multi-step frame for the character builder (and any other long guided flow).
    NOT a modal: it is a full page on a laptop and a full-screen sheet on a phone
    (builder decision 4), so it owns the viewport instead of floating over it.

    What it guarantees:
      - A step indicator that does not blob at 375px (Steps ships a compact form).
      - A Back / Next footer with real validation gating — a disabled Next always
        comes with a visible, announced reason.
      - Sticky header and footer, so the actions stay reachable while the step body
        scrolls on a phone.
      - An optional detail/preview pane that collapses to master-detail on narrow
        screens rather than stacking two panes nobody can read.

    It owns no step state: the flow drives `current`, `blockedReason`, and the
    handlers. */
export function WizardShell({
  title, eyebrow, steps, current, onStepSelect, children,
  onBack, onNext, backLabel = "Back", nextLabel = "Next", blockedReason, busy = false,
  onSaveAndClose, saveLabel = "Save & close", resume,
  detail, detailTitle, detailOpen = false, onCloseDetail, detailBackLabel = "Back to the list",
  footnote, ariaLabel, className
}: WizardShellProps) {
  const reasonId = useId();
  const blocked = blockedReason != null;

  return (
    <section className={cx("nh-wizard", className)} aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}>
      <header className="nh-wizard-head">
        <div className="nh-wizard-titles">
          {eyebrow != null && <span className="nh-eyebrow">{eyebrow}</span>}
          <h1 className="nh-wizard-title">{title}</h1>
        </div>
        {onSaveAndClose && (
          <div className="nh-wizard-headops">
            <Button variant="secondary" size="sm" onClick={onSaveAndClose} disabled={busy}>{saveLabel}</Button>
          </div>
        )}
        <div className="nh-wizard-progress">
          <Steps steps={steps} current={current} onStepSelect={onStepSelect} ariaLabel={`${typeof title === "string" ? title : "Wizard"} progress`} />
        </div>
      </header>

      {resume != null && <div className="nh-wizard-resume">{resume}</div>}

      <div className={cx("nh-wizard-body", detail != null && "nh-wizard-body--split", detailOpen && "has-detail")}>
        <div className="nh-wizard-main">{children}</div>
        {detail != null && (
          <aside className="nh-wizard-detail" aria-label={typeof detailTitle === "string" ? detailTitle : "Details"}>
            {onCloseDetail && (
              <button type="button" className="nh-wizard-detail-back" onClick={onCloseDetail}>‹ {detailBackLabel}</button>
            )}
            {detailTitle != null && <h2 className="nh-wizard-detail-title">{detailTitle}</h2>}
            <div className="nh-wizard-detail-body">{detail}</div>
          </aside>
        )}
      </div>

      <footer className="nh-wizard-foot">
        <div className="nh-wizard-foot-back">
          {onBack && <Button variant="secondary" onClick={onBack} disabled={busy}>{backLabel}</Button>}
        </div>
        <p className={cx("nh-wizard-blocked", !blocked && "is-clear")} id={reasonId} role="status">
          {blocked && <><span className="nh-wizard-blocked-icon" aria-hidden="true">⚠</span>{blockedReason}</>}
        </p>
        <div className="nh-wizard-foot-next">
          {onNext && (
            <Button variant="primary" arrow onClick={onNext} disabled={blocked || busy} aria-describedby={blocked ? reasonId : undefined}>
              {nextLabel}
            </Button>
          )}
        </div>
      </footer>

      {footnote != null && <p className="nh-wizard-footnote">{footnote}</p>}
    </section>
  );
}
