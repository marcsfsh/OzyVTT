import type { KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
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
    when vertical) with a faint steady glow. Full keyboard control. */
export function Tabs({ tabs, activeId, onChange, orientation = "horizontal", ariaLabel, className }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

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
    const horizontal = orientation === "horizontal";
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    const prevKey = horizontal ? "ArrowLeft" : "ArrowUp";
    if (event.key === nextKey) { event.preventDefault(); step(index, 1); }
    else if (event.key === prevKey) { event.preventDefault(); step(index, -1); }
    else if (event.key === "Home") { event.preventDefault(); const i = tabs.findIndex((t) => !t.disabled); if (i >= 0) focusTab(i); }
    else if (event.key === "End") { event.preventDefault(); for (let i = tabs.length - 1; i >= 0; i--) { if (!tabs[i].disabled) { focusTab(i); break; } } }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cx("nh-tabs", `nh-tabs--${orientation}`, className)}
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
