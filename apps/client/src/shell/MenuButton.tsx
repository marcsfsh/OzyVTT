import { useRef } from "react";
import { Portrait, canMove, pop, rel, useOnChange, warm, type PictureSource } from "@vtt/ui";

/**
 * The menu button's face (frame spec 2.1): the character's portrait for a player, the violet GM mark for the GM, who
 * also sees how many players are online in VT323 beside it. A player connecting lights the number, as the faces used
 * to light (ADR-0045, group 14).
 */
export function MenuFace({ picture, online }: Readonly<{ picture?: PictureSource | null; online?: number }>) {
  const count = useRef<HTMLSpanElement>(null);
  useOnChange(online ?? 0, (before, now) => {
    const el = count.current;
    if (!el || now <= before || !canMove()) return;
    warm(el, { dur: 220 });
    const box = rel(el, el.parentElement ?? el);
    if (el.parentElement) pop(el.parentElement, { x: box.cx, y: box.cy, size: 30, tone: "cyan" });
  });
  return (
    <span className="frame-menu-face">
      {picture ? (
        <Portrait size="xs" frame="party" picture={picture} />
      ) : (
        <span className="frame-menu-gm" aria-hidden="true">
          GM
        </span>
      )}
      {online !== undefined && (
        <span ref={count} className="frame-menu-count" aria-hidden="true">
          {online}
        </span>
      )}
    </span>
  );
}
