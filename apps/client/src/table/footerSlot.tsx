import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The bar under the thumb on a phone: a control that belongs there while it is shown (a target picker, with its
 * Cancel and Roll) renders into it, and the bar's own controls step aside meanwhile. On a laptop the context is empty and the
 * control stays where it stands.
 */
export const FooterSlotContext = createContext<HTMLElement | null>(null);

export function InFooter({
  children,
  pick = false
}: Readonly<{
  children: ReactNode;
  /** A target picker's list: in the bar it scrolls on its own over Cancel and Roll, so the map keeps its height. */
  pick?: boolean;
}>) {
  const node = useContext(FooterSlotContext);
  if (!node) return <>{children}</>;
  return createPortal(pick ? <div className="table-panel-foot-pick scroll-y">{children}</div> : children, node);
}
