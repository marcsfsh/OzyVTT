import type { ReactNode } from "react";
import { cx } from "./util";
import "./KindCard.css";

/**
 * One kind card (theme rule 19, ADR-0076): its icon and name, the count under them in VT323 30px, then its line. The
 * whole card opens the kind's list through `onOpen`; the line may hold its own controls.
 */
export function KindCard({
  icon,
  name,
  count,
  line,
  onOpen,
  className,
  children
}: Readonly<{
  icon: ReactNode;
  name: string;
  count?: number | string;
  line?: ReactNode;
  onOpen?: () => void;
  className?: string;
  /** More under a hairline (a few of the kind's records); its links and buttons stay pressable. */
  children?: ReactNode;
}>) {
  return (
    <section className={cx("nh-kindcard", className)} aria-label={name}>
      {onOpen && (
        <button type="button" className="nh-kindcard-open" onClick={onOpen}>
          <span className="nh-sr-only">Open {name}</span>
        </button>
      )}
      <span className="nh-kindcard-head">
        <span className="nh-kindcard-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="nh-kindcard-name">{name}</span>
      </span>
      {count !== undefined && <span className="nh-kindcard-count">{count}</span>}
      {line != null && <span className="nh-kindcard-line">{line}</span>}
      {children != null && <div className="nh-kindcard-more">{children}</div>}
    </section>
  );
}
