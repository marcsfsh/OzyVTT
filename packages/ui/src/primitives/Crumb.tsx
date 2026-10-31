import type { ReactNode } from "react";
import { IconChevronLeft } from "./icons";
import { cx } from "./util";
import "./Crumb.css";

/**
 * The crumb on a title's line (theme rule 14, ADR-0072): the back chevron and where it goes, in the crumb's 12px label
 * type, set before the title on its baseline ("‹ PEOPLE  SISTER ILSA VARN"). A link when it has an address, otherwise
 * a button. Its name says where it goes, so a screen reader hears "Back to People".
 */
export function Crumb({
  label,
  href,
  onClick,
  className
}: Readonly<{ label: string; href?: string; onClick?: () => void; className?: string }>) {
  const body = (
    <>
      <IconChevronLeft className="nh-crumb-chevron" />
      <span className="nh-crumb-label">{label}</span>
    </>
  );
  return href ? (
    <a
      className={cx("nh-crumb", className)}
      href={href}
      aria-label={`Back to ${label}`}
      onClick={(event) => {
        if (!onClick) return;
        event.preventDefault();
        onClick();
      }}
    >
      {body}
    </a>
  ) : (
    <button type="button" className={cx("nh-crumb", className)} aria-label={`Back to ${label}`} onClick={onClick}>
      {body}
    </button>
  );
}

/** A title's line: the crumb, then the title (an `h1` or `h2` the caller passes) and what follows it, on one baseline. */
export function TitleLine({
  crumb,
  children,
  className
}: Readonly<{ crumb?: ReactNode; children: ReactNode; className?: string }>) {
  return (
    <div className={cx("nh-titleline", className)}>
      {crumb}
      {children}
    </div>
  );
}
