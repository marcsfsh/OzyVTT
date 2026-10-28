import { useEffect, useLayoutEffect, useRef } from "react";
import { canMove, fadeIn, stripSwitch, type Box } from "../motion/lightRail";
import "./StripInk.css";

/** Where the chosen tab's ink sits: under it, over it (a phone's bottom tabs) or along its start (a vertical strip). */
export type InkEdge = "bottom" | "top" | "start";

/** A tab's box in its strip, from its layout box: a pressed tab's scale must not move the ink. */
function boxOf(tab: HTMLElement): Box {
  const x = tab.offsetLeft;
  const y = tab.offsetTop;
  const w = tab.offsetWidth;
  const h = tab.offsetHeight;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

/**
 * The chosen tab's ink (ADR-0045, ADR-0046): one line in a strip that moves with the light, lying on the strip's line. When the chosen tab changes, the
 * old ink drains toward the trip, a comet runs along the strip's line, a burst lands and the ink fills from the side
 * the light arrived on. Render it as the strip's last child; the strip must be positioned. It finds the chosen tab
 * with `selector` among the strip's own children, so a strip of links or of tab buttons can carry it.
 */
export function StripInk({
  active,
  selector = ".nh-tab--active",
  edge = "bottom",
  onTravel,
  onHorizon = false,
  panel
}: Readonly<{
  /** Which tab is chosen. The light runs when it changes, never on the first render. */
  active: string;
  selector?: string;
  edge?: InkEdge;
  /** Draws the trip elsewhere: the ink still drains and fills, and no comet runs in the strip. */
  onTravel?: (from: HTMLElement, to: HTMLElement) => void;
  /** The ink lies on the horizon of the bar it sits in (marked `data-horizon`), and shows its colours there. */
  onHorizon?: boolean;
  /** What the chosen tab shows. It fades in as the light lands; its light lives in the strip, so it only fades. */
  panel?: () => Element | null | undefined;
}>) {
  const ink = useRef<HTMLSpanElement>(null);
  const chosen = useRef<HTMLElement | null>(null);
  const shown = useRef(active);

  /** Puts the ink on the chosen tab, or hides it when no tab is chosen. */
  const place = (): HTMLElement | null => {
    const line = ink.current;
    const strip = line?.parentElement;
    if (!line || !strip) return null;
    const tab = strip.querySelector<HTMLElement>(`:scope > ${selector}`);
    chosen.current = tab;
    line.hidden = !tab;
    if (!tab) return null;
    if (edge === "start") {
      line.style.left = `${tab.offsetLeft}px`;
      line.style.top = `${tab.offsetTop}px`;
      line.style.height = `${tab.offsetHeight}px`;
      return tab;
    }
    // The strip's line may be an edge just past its tabs: the shift seats the ink on it.
    const shift = parseFloat(getComputedStyle(strip).getPropertyValue("--nh-ink-shift")) || 0;
    line.style.left = `${tab.offsetLeft}px`;
    line.style.width = `${tab.offsetWidth}px`;
    line.style.top = `${(edge === "top" ? tab.offsetTop : tab.offsetTop + tab.offsetHeight - line.offsetHeight) + shift}px`;
    const bar = onHorizon ? strip.closest<HTMLElement>("[data-horizon]") : null;
    if (bar) {
      // The stretch of the bar's horizon the ink lies over, so it shows the line's own colours there.
      const rail = bar.getBoundingClientRect();
      const left = strip.getBoundingClientRect().left + strip.clientLeft - strip.scrollLeft + tab.offsetLeft;
      line.style.setProperty("--ink-win-w", `${rail.width}px`);
      line.style.setProperty("--ink-win-x", `${rail.left - left}px`);
    }
    return tab;
  };

  // Every render: a label can change a tab's width. The light runs only when `active` changed.
  useLayoutEffect(() => {
    const line = ink.current;
    const strip = line?.parentElement;
    const before = chosen.current;
    const tab = place();
    const changed = shown.current !== active;
    shown.current = active;
    if (!changed || !line || !strip || !tab || !before || before === tab || !before.isConnected || !canMove()) return;
    const axis = edge === "start" ? "y" : "x";
    stripSwitch(strip, {
      ink: line,
      from: boxOf(before),
      to: boxOf(tab),
      line: axis === "x" ? line.offsetTop + line.offsetHeight / 2 : line.offsetLeft + line.offsetWidth / 2,
      axis,
      travel: !onTravel
    });
    onTravel?.(before, tab);
    const shows = panel?.();
    if (shows) fadeIn(shows, { delay: 120, dur: 170 });
  });

  // The strip and its tabs change size with the window and as the fonts load.
  useEffect(() => {
    const strip = ink.current?.parentElement;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(strip);
    for (const tab of strip.children) if (tab !== ink.current) observer.observe(tab);
    // A strip that scrolls moves its ink along the horizon too.
    const scrolled = () => place();
    if (onHorizon) strip.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", scrolled);
    };
    // `place` reads refs and props that the per-render effect keeps current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      ref={ink}
      className="nh-tabs-ink"
      data-edge={edge}
      {...(onHorizon ? { "data-on-horizon": "" } : {})}
      aria-hidden="true"
    />
  );
}
