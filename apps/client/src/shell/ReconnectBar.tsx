import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tag, canMove, comet, fadeIn, fill, ghostOut, useOnChange } from "@vtt/ui";

/**
 * The bar under the top bar while the table can't hear this device (DESIGN.md, Reconnecting): a WAIT tag and what to
 * do. It holds until the table has sent a fresh snapshot, then says "Back at the table" for 2 seconds and goes.
 */
export function ReconnectBar({ current }: Readonly<{ current: boolean }>) {
  // Worked out as `current` changes, in the same render, so the bar never vanishes for a frame between Reconnecting
  // and Back at the table.
  const [back, setBack] = useState(false);
  const [was, setWas] = useState(current);
  if (was !== current) {
    setWas(current);
    setBack(current);
  }
  useEffect(() => {
    if (!back) return;
    const timer = window.setTimeout(() => setBack(false), 2000);
    return () => window.clearTimeout(timer);
  }, [back]);
  const shown = !current || back;
  const bar = useBarLight(shown, current);
  if (!shown) return null;
  return (
    <p ref={bar} className={`reconnect-bar${current ? " is-back" : ""}`} role="status">
      <span className="reconnect-bar-line" aria-hidden="true" />
      {current ? (
        "Back at the table"
      ) : (
        <>
          <Tag tone="wait">Wait</Tag> Reconnecting. Wait before making changes.
        </>
      )}
    </p>
  );
}

/**
 * The bar's own line (ADR-0045, group 9): grey and unlit while the app waits, and nothing moves. When the table is
 * back, a comet runs along it and lights it in the horizon's colours; when the bar goes, its copy fades where it was.
 */
function useBarLight(shown: boolean, back: boolean) {
  const bar = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!shown || !el) return;
    fadeIn(el, { dur: 200, y: -6 });
    return () => ghostOut(el, { leave: "fade", whenGone: true, within: el.parentElement });
  }, [shown]);
  useOnChange(back, (_was, now) => {
    const el = bar.current;
    const line = el?.querySelector<HTMLElement>(".reconnect-bar-line");
    if (!now || !el || !line || !canMove()) return;
    comet(el, { from: 0, to: el.clientWidth, line: el.clientHeight - 1, thick: 3, delay: 0, dur: 320 });
    fill(line, { origin: "0%", delay: 40, dur: 320 });
  });
  return bar;
}
