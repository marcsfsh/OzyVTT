import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StripInk } from "./StripInk";
import { cx } from "./util";
import "./Tabs.css";

interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  /** A class for this tab alone (a GM-only tab's violet). */
  className?: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  ariaLabel?: string;
  className?: string;
  /** Ties each tab to its panel: tab `${idBase}-tab-${id}` controls panel `${idBase}-panel-${id}`. */
  idBase?: string;
  /** Which edge of a horizontal tab carries the ink: a phone's bottom tabs light along their top. */
  inkEdge?: "bottom" | "top";
  /** Draws the trip between two tabs elsewhere (the top bar's sections light the horizon); the ink still moves. */
  onTravel?: (from: HTMLElement, to: HTMLElement) => void;
  /** What the chosen tab shows, to fade in on a change; the panel `idBase` names unless given. */
  panel?: () => Element | null | undefined;
}

/** The one tab bar: a sunken track whose chosen tab is raised and underlined in cyan (a left bar when vertical).
    Full keyboard control. An overflowing horizontal bar hides its scrollbar, keeps the active tab in view
    and fades whichever edge has more content (no fade when everything fits). The underline is the strip's ink, and
    a change of tab runs light along the strip to the new one (ADR-0045). */
export function Tabs({
  tabs,
  activeId,
  onChange,
  orientation = "horizontal",
  ariaLabel,
  className,
  idBase,
  inkEdge = "bottom",
  onTravel,
  panel
}: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const barRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ scrollable: false, atStart: true, atEnd: true });

  const horizontal = orientation === "horizontal";

  /* A ResizeObserver, because the bar overflows when its container narrows and a window listener can't see that. */
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
    return () => {
      observer.disconnect();
      bar.removeEventListener("scroll", measure);
    };
  }, [horizontal, tabs.length]);

  /* Scroll the bar itself: `scrollIntoView` would scroll every ancestor (and the page on mount).
     SCROLL_PAD matches `scroll-padding-inline` in Tabs.css so the tab lands clear of the edge fade. */
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
    if (event.key === nextKey) {
      event.preventDefault();
      step(index, 1);
    } else if (event.key === prevKey) {
      event.preventDefault();
      step(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const i = tabs.findIndex((t) => !t.disabled);
      if (i >= 0) focusTab(i);
    } else if (event.key === "End") {
      event.preventDefault();
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (!tabs[i].disabled) {
          focusTab(i);
          break;
        }
      }
    }
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
        // With no tab chosen (a page that belongs to none), the first is the bar's one stop, so the keyboard can enter.
        const stop = active || (index === 0 && !tabs.some((other) => other.id === activeId));
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="tab"
            type="button"
            {...(idBase ? { id: `${idBase}-tab-${tab.id}`, "aria-controls": `${idBase}-panel-${tab.id}` } : {})}
            aria-selected={active}
            tabIndex={stop ? 0 : -1}
            disabled={tab.disabled}
            className={cx("nh-tab", "interactive", active && "nh-tab--active", tab.className)}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
      <StripInk
        active={activeId}
        edge={horizontal ? inkEdge : "start"}
        onTravel={onTravel}
        panel={panel ?? (idBase ? () => document.getElementById(`${idBase}-panel-${activeId}`) : undefined)}
      />
    </div>
  );
}

/** Keep in step with `scroll-padding-inline` / the mask width in Tabs.css. */
const SCROLL_PAD = 24;
