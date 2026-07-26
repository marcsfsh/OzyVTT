import type { ReactNode } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { IconPencil, IconWarning } from "./icons";
import "./ReviewSummary.css";

export interface ReviewItem {
  label: ReactNode;
  value: ReactNode;
  /** Render the value in the mono/tabular face — scores, HP, AC, gold. Prose
      (species, background, the chosen feat) stays in the body face. */
  numeric?: boolean;
}

export interface ReviewSection {
  id: string;
  title: ReactNode;
  items: readonly ReviewItem[];
  /** A line of context under the title (an equipment pack's contents, a warning). */
  note?: ReactNode;
  /** Jump back to the step that owns this section. */
  onEdit?: () => void;
  editLabel?: string;
  /** Something is still missing here — says so, in text, with an icon. */
  incomplete?: ReactNode;
}

export interface ReviewSummaryProps {
  sections: readonly ReviewSection[];
  /** Extra content under the sections (the attribution line, a submit note). */
  children?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/** The final "here's your character" step: every choice, grouped by the step that
    made it, each group with its own way back.

    It extends the existing `.nh-statlist` key/value grid rather than inventing a
    second one — same cells, same mono values — and adds the section headings and
    per-section Edit links a review step needs. Anything still missing is called out
    in words next to its Edit link, so the last screen before submit never hides a
    hole in the sheet. */
export function ReviewSummary({ sections, children, ariaLabel = "Character summary", className }: ReviewSummaryProps) {
  return (
    <div className={cx("nh-review", className)} aria-label={ariaLabel} role="group">
      {sections.map((section) => (
        <section key={section.id} className={cx("nh-review-section", section.incomplete != null && "is-incomplete")}>
          <header className="nh-review-head">
            <h3 className="nh-review-title">{section.title}</h3>
            {section.onEdit && (
              <Button variant="ghost" size="sm" className="nh-review-edit" onClick={section.onEdit}>
                <span className="nh-review-edit-icon" aria-hidden="true"><IconPencil /></span>
                {section.editLabel ?? "Edit"}
                <span className="nh-sr-only"> {typeof section.title === "string" ? section.title : ""}</span>
              </Button>
            )}
          </header>

          {section.incomplete != null && (
            <p className="nh-review-incomplete"><span className="nh-review-incomplete-icon" aria-hidden="true"><IconWarning /></span>{section.incomplete}</p>
          )}

          <dl className="nh-statlist nh-review-stats">
            {section.items.map((item, index) => (
              <div key={index}>
                <dt>{item.label}</dt>
                <dd className={cx(item.numeric ? "nh-review-num tabular" : "nh-review-text")}>{item.value}</dd>
              </div>
            ))}
          </dl>

          {section.note != null && <p className="nh-review-note">{section.note}</p>}
        </section>
      ))}
      {children}
    </div>
  );
}
