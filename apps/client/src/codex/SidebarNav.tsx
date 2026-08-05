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

export function SidebarNav({ groups, activePath, collapsed = false, onNavigate, onAction, header, footer }: SidebarNavProps) {
  return (
    <nav className={`codex-sidebar${collapsed ? " is-rail" : ""}`} aria-label="Codex sections">
      {header && <div className="codex-sidebar-head">{header}</div>}
      {/* The rail's own region (§7): thirteen destinations and three eyebrows do not fit a 720p laptop,
          and the ones that fall off the end are Tools — where Settings and Backup live. */}
      <div className="codex-sidebar-groups scroll-y">
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
