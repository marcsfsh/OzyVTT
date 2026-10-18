import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The bar under the thumb on a phone: a control that belongs there while it is shown (a target picker's Cancel and
 * Roll) renders into it, and the bar's own controls step aside meanwhile. On a laptop the context is empty and the
 * control stays where it stands.
 */
export const FooterSlotContext = createContext<HTMLElement | null>(null);

export function InFooter({ children }: Readonly<{ children: ReactNode }>) {
  const node = useContext(FooterSlotContext);
  return node ? createPortal(children, node) : <>{children}</>;
}
