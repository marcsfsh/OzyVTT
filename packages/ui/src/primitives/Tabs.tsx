import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "./util";
import "./Tabs.css";

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  ariaLabel?: string;
  className?: string;
}

/** The one tab bar (retires the ad-hoc gm-tabs / viewer tool tabs / map-kind
    chips). Rest = text-dim; active = text + 2px magenta underline (or left bar
    when vertical) with a faint steady glow. Full keyboard control.

    A horizontal bar that overflows solves two problems the bare `overflow-x: auto`
    did not: the scrollbar is hidden, so at 375px an eighth tab was simply GONE with
    nothing on screen saying otherwise; and selecting a tab by keyboard could leave the
    selected tab outside the scrollport. So the bar now keeps the active tab in view and
    fades whichever edge has more content behind it — and shows no fade at all when
    everything fits, because a permanent fade is decoration, not an affordance. */
export function Tabs({ tabs, activeId, onChange, orientation = "horizontal", ariaLabel, className }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const barRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ scrollable: false, atStart: true, atEnd: true });

  const horizontal = orientation === "horizontal";

  /* Measure on mount, on resize, and on scroll. A ResizeObserver rather than a window
     listener because the bar overflows when its CONTAINER narrows (a rail collapsing,
     a detail pane opening), which a window resize event does not always accompany. */
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !horizontal) return;
    const measure = () => {
      const scrollable = bar.scrollWidth - bar.clientWidth > 1;
      setOverflow({
        scrollable,
        atStart: bar.scrollLeft <= 1,
        atEnd: bar.scrollLeft >= bar.scrollWidth - bar.clientWidth - 1
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    bar.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); bar.removeEventListener("scroll", measure); };
  }, [horizontal, tabs.length]);

  /* Bring the selected tab into the scrollport. Deliberately NOT `scrollIntoView`: that
     walks every scrollable ancestor, so on mount it would drag the whole page to
     wherever the tab bar happens to sit. Scrolling the bar itself can only move the bar.
     SCROLL_PAD matches `scroll-padding-inline` in Tabs.css, so the tab lands clear of
     the edge fade instead of under it, and agrees with the scroll-snap position. */
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !horizontal) return;
    const tab = bar.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tab) return;
    const near = tab.offsetLeft - SCROLL_PAD;
    const far = tab.offsetLeft + tab.offsetWidth + SCROLL_PAD;
    let target = bar.scrollLeft;
    if (near < bar.scrollLeft) target = near;
    else if (far > bar.scrollLeft + bar.clientWidth) target = far - bar.clientWidth;
    if (target === bar.scrollLeft) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    bar.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [activeId, horizontal, tabs.length]);

  const focusTab = (index: number) => {
    onChange(tabs[index].id);
    refs.current[index]?.focus();
  };
  const step = (from: number, dir: 1 | -1) => {
    const n = tabs.length;
    let i = from;
    for (let s = 0; s < n; s++) {
      i = (i + dir + n) % n;
      if (!tabs[i].disabled) break;
    }
    focusTab(i);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    const prevKey = horizontal ? "ArrowLeft" : "ArrowUp";
    if (event.key === nextKey) { event.preventDefault(); step(index, 1); }
    else if (event.key === prevKey) { event.preventDefault(); step(index, -1); }
    else if (event.key === "Home") { event.preventDefault(); const i = tabs.findIndex((t) => !t.disabled); if (i >= 0) focusTab(i); }
    else if (event.key === "End") { event.preventDefault(); for (let i = tabs.length - 1; i >= 0; i--) { if (!tabs[i].disabled) { focusTab(i); break; } } }
  };

  return (
    <div
      ref={barRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cx(
        "nh-tabs",
        `nh-tabs--${orientation}`,
        overflow.scrollable && "is-scrollable",
        overflow.scrollable && !overflow.atStart && "is-scrolled-start",
        overflow.scrollable && overflow.atEnd && "is-scrolled-end",
        className
      )}
    >
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[index] = el; }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={tab.disabled}
            className={cx("nh-tab", "interactive", active && "nh-tab--active")}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** Keep in step with `scroll-padding-inline` / the mask width in Tabs.css. */
const SCROLL_PAD = 24;
