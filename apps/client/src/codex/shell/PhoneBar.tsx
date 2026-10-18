import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton, IconChevronLeft } from "@vtt/ui";

/**
 * The phone's top bar belongs to the view on screen: a page puts its title, Back, See as and Edit there. A view
 * renders `CodexPhoneBar`, which lands in the frame's slot; a view that renders none gets the frame's default bar
 * (the section's title and Search). On a laptop the slot is absent and this renders nothing, since each view has
 * its own header there.
 */
export type PhoneBarSlot = Readonly<{
  target: HTMLElement | null;
  /** Counts the views holding the bar, so the default steps aside while one does. */
  claim: () => () => void;
  /** The shell's own controls (New, the GM menu and Search), kept on a section's bar that brings none. */
  defaults: ReactNode;
}>;

export const PhoneBarContext = createContext<PhoneBarSlot | null>(null);

export function CodexPhoneBar({
  title,
  content,
  onBack,
  actions
}: Readonly<{
  title?: ReactNode;
  /** In place of the title: a search box, say. */
  content?: ReactNode;
  /** Shows Back at the start of the bar. */
  onBack?: () => void;
  /** Controls at the end of the bar. A section's bar without them keeps the shell's own; a record's has Back. */
  actions?: ReactNode;
}>) {
  const slot = useContext(PhoneBarContext);
  const claim = slot?.claim;
  useLayoutEffect(() => (claim ? claim() : undefined), [claim]);
  if (!slot?.target) return null;
  return createPortal(
    <>
      {onBack && (
        <IconButton label="Back" size="sm" onClick={onBack}>
          <IconChevronLeft />
        </IconButton>
      )}
      {content ?? <h2 className="cx-phonebar-title">{title}</h2>}
      {(actions ?? (onBack ? null : slot.defaults)) && (
        <div className="cx-phonebar-actions">{actions ?? slot.defaults}</div>
      )}
    </>,
    slot.target
  );
}
