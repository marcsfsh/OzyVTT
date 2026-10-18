import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Menu, MenuItem, Tabs } from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { RulesButton, RulesReference } from "../reference/RulesReference";

export type AppTab = Readonly<{ id: string; label: ReactNode; name: string }>;

/**
 * How many tabs the bar shows at each width, the rest going to a More menu so every tab is one tap away with no
 * hidden sideways scroll. `fits` lists the counts for the ladder's widths: 980px and up, 761 to 979, 561 to 760, and
 * a phone up to 560. On a phone the Rules button moves into the menu too.
 */
export type TabFit = readonly [wide: number, laptop: number, tablet: number, phone: number];

export function useTabFit(fits: TabFit) {
  const wide = useMediaQuery("(min-width: 980px)");
  const laptop = useMediaQuery("(min-width: 761px)");
  const tablet = useMediaQuery("(min-width: 561px)");
  const visible = wide ? fits[0] : laptop ? fits[1] : tablet ? fits[2] : fits[3];
  return { visible, phone: !tablet };
}

/**
 * The app bar's tabs, the More menu and the Rules door. A tab in the menu that is the current one names the menu's
 * trigger, which is underlined like a chosen tab, so the bar always shows where you are. When the bar is still too
 * narrow for its share (a 320px phone, a long section name on the trigger), the last tab moves into the menu too,
 * one at a time, until the rest fit.
 */
export function AppTabs({
  tabs,
  activeId,
  onChange,
  ariaLabel,
  className,
  fits
}: Readonly<{
  tabs: readonly AppTab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
  fits: TabFit;
}>) {
  const fit = useTabFit(fits);
  const { phone } = fit;
  const [rulesOpen, setRulesOpen] = useState(false);
  const [squeezed, setSqueezed] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const visible = Math.max(1, fit.visible - squeezed);
  const shown = tabs.slice(0, visible);
  const rest = tabs.slice(visible);
  const currentInMenu = rest.find((tab) => tab.id === activeId);
  const menu = rest.length > 0 || phone;

  // A new current section, or any change of width, starts from the ladder's count again.
  useLayoutEffect(() => setSqueezed(0), [fit.visible, activeId]);
  useEffect(() => {
    const reset = () => setSqueezed(0);
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  useLayoutEffect(() => {
    const track = box.current?.querySelector<HTMLElement>(".nh-tabs");
    if (!track) return;
    const check = () => {
      if (track.scrollWidth - track.clientWidth > 1 && visible > 1) setSqueezed((count) => count + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(track);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={box} className="app-tabs">
      <Tabs
        className={className}
        ariaLabel={ariaLabel}
        tabs={shown.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={activeId}
        onChange={onChange}
      />
      {menu && (
        <Menu
          align="end"
          className={`app-more${currentInMenu ? " is-current" : ""}`}
          trigger={currentInMenu ? currentInMenu.name : "More"}
          label={currentInMenu ? `${currentInMenu.name}, more sections` : "More sections"}
        >
          {rest.map((tab) => (
            <MenuItem
              key={tab.id}
              aria-current={tab.id === activeId ? "page" : undefined}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </MenuItem>
          ))}
          {phone && <MenuItem onClick={() => setRulesOpen(true)}>Rules</MenuItem>}
        </Menu>
      )}
      {phone ? <RulesReference open={rulesOpen} onClose={() => setRulesOpen(false)} /> : <RulesButton />}
    </div>
  );
}
