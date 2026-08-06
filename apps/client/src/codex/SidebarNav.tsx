import { useEffect, useRef, useState } from "react";
import { IconButton } from "@vtt/ui";
import { CodexIcon } from "./icons";
import type { SidebarGroup, SidebarItem } from "./routes";

/**
 * D1 — the Codex's one navigation surface, and deliberately **role-blind**.
 *
 * It takes item lists and renders nav semantics. It holds no role logic, imports no API module, and its
 * props cannot carry a reveal flag or a GM body — the same capability-flag discipline `CampaignHome`
 * keeps, which is what lets the GM shell and the player shell render literally the same component
 * instead of two lookalikes that drift apart.
 *
 * §4 touch floor: every item is `.codex-navitem` with `min-height: var(--tap-min)` — **route 1** (grow
 * the paint), which a stacked vertical list must use: a route-2 `::after` box would overhang into the
 * neighbouring row and silently steal its taps.
 */
export type SidebarNavProps = Readonly<{
  groups: readonly SidebarGroup[];
  /** The address currently rendered; the matching item takes `aria-current="page"`. */
  activePath: string;
  /** Rail mode hides the labels; `title` + `aria-label` keep the word reachable. */
  collapsed?: boolean;
  onNavigate: (path: string) => void;
  onAction?: (action: NonNullable<SidebarItem["action"]>) => void;
  /** Rendered above the groups — the palette entry ("Search ⌘K"). */
  header?: React.ReactNode;
  /** Rendered at the sidebar's foot — the collapse chevron on wide screens. */
  footer?: React.ReactNode;
}>;

/**
 * Which item is lit. `/codex/pages/abc` lights Pages; `/codex` lights Home and nothing else — the
 * prefix test would otherwise light Home on every codex address, which is the "lit tab lie" this recut
 * exists to remove.
 */
function isActive(itemPath: string, activePath: string): boolean {
  if (itemPath === "/codex") return activePath === "/codex";
  return activePath === itemPath || activePath.startsWith(`${itemPath}/`);
}

/**
 * **The rail's scroll affordance, and it is CONDITIONAL on real overflow.**
 *
 * Wave 1 aligned the collapsed rail's three columns by taking `scrollbar-gutter: stable` off this
 * region — which put the ⌘K glyph, the thirteen nav icons and the collapse chevron on one 44.0px centre
 * line, at the cost of the region's visible scrollbar. Measured after that change: 0px of overflow at
 * ≥850px of viewport height, but **75px hidden at 1366×768 and 143px at 1280×700**. Wheel, trackpad,
 * touch and keyboard all still scroll it; what left was the only thing saying there was more.
 *
 * A fade mask stands in — the same remedy `Tabs.css` uses for the same trade, and ruling 44's own stated
 * justification (discoverability) is what earns it. It is measured rather than assumed on both counts:
 * an unconditional fade would claim "there is more below" at every height where there is not, and a
 * bottom-only fade would keep claiming it after the GM has scrolled to the end. So each edge is drawn
 * only while there is content past it, which also makes the fade a live readout of where you are.
 *
 * `ResizeObserver` watches the region AND its content, because both change without a scroll event: the
 * viewport shortens, or the 761–849 band strips the labels and the list gets shorter.
 */
function useScrollEdges(active: boolean, contentKey: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) { setEdges({ top: false, bottom: false }); return; }
    const measure = () => {
      const room = el.scrollHeight - el.clientHeight;
      // 1px, not 0: sub-pixel layout leaves fractional room on boxes that do not actually overflow.
      setEdges({ top: room > 1 && el.scrollTop > 1, bottom: room > 1 && el.scrollTop < room - 1 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => { el.removeEventListener("scroll", measure); observer.disconnect(); };
  }, [active, contentKey]);
  return { ref, edges };
}

export function SidebarNav({ groups, activePath, collapsed = false, onNavigate, onAction, header, footer }: SidebarNavProps) {
  // Only the rail hides its scrollbar (`codex.css`), so only the rail needs the stand-in. The group count
  // is the content key: a group added or removed changes which children the observer has to watch.
  const { ref: groupsRef, edges } = useScrollEdges(collapsed, groups.length);
  return (
    <nav className={`codex-sidebar${collapsed ? " is-rail" : ""}`} aria-label="Codex sections">
      {header && <div className="codex-sidebar-head">{header}</div>}
      {/* The rail's own region (§7): thirteen destinations and three eyebrows do not fit a 720p laptop,
          and the ones that fall off the end are Tools — where Settings and Backup live. */}
      <div ref={groupsRef} className={`codex-sidebar-groups scroll-y${edges.top ? " has-fade-top" : ""}${edges.bottom ? " has-fade-bottom" : ""}`}>
        {groups.map((group, index) => (
          <div key={group.label ?? `group-${index}`} className={`codex-sidebar-group${group.label === "Tools" ? " is-tools" : ""}`}>
            {group.label && !collapsed && <span className="codex-sidebar-grouplabel eyebrow">{group.label}</span>}
            <ul className="codex-sidebar-list">
              {group.items.map((item) => {
                const active = item.path ? isActive(item.path, activePath) : false;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`codex-navitem${active ? " is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      onClick={() => { if (item.path) onNavigate(item.path); else if (item.action) onAction?.(item.action); }}
                    >
                      <CodexIcon iconId={item.iconId} className="codex-navitem-icon" />
                      {!collapsed && <span className="codex-navitem-label">{item.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {footer && <div className="codex-sidebar-foot">{footer}</div>}
    </nav>
  );
}

/** The collapse control at the sidebar's foot. Its own component so the shells cannot word it two ways. */
export function SidebarCollapseToggle({ collapsed, onToggle }: Readonly<{ collapsed: boolean; onToggle: () => void }>) {
  return (
    <IconButton
      label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
      size="sm"
      className={`codex-sidebar-collapse${collapsed ? " is-rail" : ""}`}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <CodexIcon iconId="menu" className="codex-navitem-icon" />
    </IconButton>
  );
}
