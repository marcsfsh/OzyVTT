import { useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton, IconX } from "@vtt/ui";
import { useMenuDismiss, useMenuPlacement } from "./menuPlacement";
import "./token-menu.css";

export type SpotChoice = Readonly<{ id: string; label: string; onChoose: () => void }>;

/**
 * What can go on one spot of the map, from a right-click or a long press there: each creature still in the tray, and
 * for the GM a light. The other way in is a button and then a click (`armPlacement`). The server decides where each
 * lands, as it does for a drag.
 */
export function MapSpotMenu({
  x,
  y,
  choices,
  onClose
}: Readonly<{ x: number; y: number; choices: readonly SpotChoice[]; onClose: () => void }>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const style = useMenuPlacement(ref, x, y, [choices.length]);
  useMenuDismiss(ref, onClose);
  return createPortal(
    <div
      ref={ref}
      className="token-context-menu anim-popover scroll-y"
      role="menu"
      style={style}
      aria-label="Place here"
    >
      <div className="token-context-head">
        <strong>Place here</strong>
        <IconButton label="Close menu" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      {choices.length === 0 ? (
        <p className="token-context-empty">Everyone is on the map. Drag a token to move it.</p>
      ) : (
        choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            role="menuitem"
            className="token-context-item"
            onClick={() => {
              choice.onChoose();
              onClose();
            }}
          >
            {choice.label}
          </button>
        ))
      )}
    </div>,
    document.fullscreenElement ?? document.body
  );
}
