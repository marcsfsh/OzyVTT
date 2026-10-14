import { useEffect, useRef, useState } from "react";
import { IconButton } from "@vtt/ui";
import { CodexIcon } from "./icons";
import type { SidebarGroup, SidebarItem } from "./routes";

/**
 * The Codex's one navigation surface, role-blind: it takes item lists and holds no role logic or API
 * imports, so the GM and player shells render the same component. Items are 44px-tall rows.
 */
export type SidebarNavProps = Readonly<{
  groups: readonly SidebarGroup[];
  /** The address currently rendered; the matching item takes `aria-current="page"`. */
  activePath: string;
  /** Rail mode hides labels; `title` and `aria-label` keep the word available. */
  collapsed?: boolean;
  onNavigate: (path: string) => void;
  onAction?: (action: NonNullable<SidebarItem["action"]>) => void;
  /** Rendered above the groups (the "Search ⌘K" entry). */
  header?: React.ReactNode;
  /** Rendered at the foot (the collapse chevron on wide screens). */
  footer?: React.ReactNode;
}>;

/** `/codex/pages/abc` lights Pages; `/codex` lights only Home (a prefix test would light Home everywhere). */
function isActive(itemPath: string, activePath: string): boolean {
  if (itemPath === "/codex") return activePath === "/codex";
  return activePath === itemPath || activePath.startsWith(`${itemPath}/`);
}

/**
 * The rail hides its scrollbar, so it fades each edge only while content extends past it.
 * `ResizeObserver` watches the region and its content, since both can change without a scroll event.
 */
function useScrollEdges(active: boolean, contentKey: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) { setEdges({ top: false, bottom: false }); return; }
    const measure = () => {
      const room = el.scrollHeight - el.clientHeight;
      // 1px, not 0: sub-pixel layout leaves fractional room on boxes that don't overflow.
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
  // Only the rail needs the fade. The group count re-keys the observer when children change.
  const { ref: groupsRef, edges } = useScrollEdges(collapsed, groups.length);
  return (
    <nav className={`codex-sidebar${collapsed ? " is-rail" : ""}`} aria-label="Codex sections">
      {header && <div className="codex-sidebar-head">{header}</div>}
      {/* Scrolls so the Tools group stays reachable on short screens. */}
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

/** The sidebar's collapse control, shared so both shells word it the same way. */
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
