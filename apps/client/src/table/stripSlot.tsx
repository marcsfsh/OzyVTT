import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The right end of the strip over the map, where the GM's Fight menu sits during a fight. The panel owns the menu (it
 * runs the panel's commands), so it renders here through a portal; with no strip it stays where it stands.
 */
export const StripEndContext = createContext<HTMLElement | null>(null);

export function InStripEnd({ children }: Readonly<{ children: ReactNode }>) {
  const node = useContext(StripEndContext);
  return node ? createPortal(children, node) : <>{children}</>;
}
