import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Drawer, IconButton, Kbd } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { discardTransient, navigate, popTransient, pushTransient, releaseStrandedEntry } from "../router";
import { CodexIcon } from "./icons";
import type { SidebarGroup, SidebarItem } from "./routes";
import { SidebarCollapseToggle, SidebarNav } from "./SidebarNav";
import { useSidebarRailBand } from "./useSidebarRail";

/**
 * The frame both Codex shells share: the sidebar (expanded, rail or phone drawer), the top bar, the ways
 * into the search palette (its Cmd/Ctrl-K shortcut included) and the one scrolling region. Role-blind: the
 * GM and player shells pass their own navigation, title and content.
 */
export type CodexFrameProps = Readonly<{
  groups: readonly SidebarGroup[];
  /** The address currently rendered, so the sidebar lights its item. */
  activePath: string;
  title: string;
  /** Where the collapse preference is remembered, per role. */
  sidebarKey: string;
  /** Extra root classes (the player shell adds `codex-player`). */
  className?: string;
  /**
   * The player preview inside the GM's modal: navigation stays local, there is no rail or shortcut,
   * and the preview sheet is the frame.
   */
  embedded?: boolean;
  /** Required when `embedded`, where the browser address must not move. */
  onLocalNavigate?: (path: string) => void;
  onSidebarAction?: (action: NonNullable<SidebarItem["action"]>) => void;
  /** Top-bar controls beside Search. */
  actions?: ReactNode;
  /** Alerts above the scrolling region. */
  notices?: ReactNode;
  /** The caller renders the palette in `overlays`; the frame's search controls open it. */
  paletteOpen: boolean;
  onPaletteChange: (open: boolean) => void;
  /** Drawers and dialogs that sit outside the scrolling region, the palette among them. */
  overlays?: ReactNode;
  children: ReactNode;
}>;

export function CodexFrame({
  groups,
  activePath,
  title,
  sidebarKey,
  className,
  embedded = false,
  onLocalNavigate,
  onSidebarAction,
  actions,
  notices,
  paletteOpen,
  onPaletteChange,
  overlays,
  children
}: CodexFrameProps) {
  const drawerKey = `${sidebarKey}-nav`;
  // The key that opens search, written the way this device's keyboard says it; a touch device shows none.
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
  // Codex-scoped by design, so the shortcut leaves with the section.
  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onPaletteChange(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded, paletteOpen, onPaletteChange]);

  /** 761-849px forces the rail. The embedded preview isn't at the viewport, so it never is. */
  const railBand = useSidebarRailBand() && !embedded;
  const [sidebarMode, setSidebarMode] = useState<"open" | "rail">(() => {
    try {
      return localStorage.getItem(sidebarKey) === "rail" ? "rail" : "open";
    } catch {
      return "open";
    }
  });
  useEffect(() => {
    if (embedded) return;
    try {
      localStorage.setItem(sidebarKey, sidebarMode);
    } catch {
      /* private mode - fine */
    }
  }, [sidebarKey, sidebarMode, embedded]);
  const collapsed = railBand || (!embedded && sidebarMode === "rail");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = () => {
    setDrawerOpen(true);
    // The Android back gesture closes the drawer and the page stays in the section.
    if (!embedded) pushTransient(drawerKey, () => setDrawerOpen(false));
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    if (!embedded) popTransient(drawerKey);
  };
  /**
   * Navigating from the drawer can't use `closeDrawer`: its `history.back()` runs after `navigate`'s push
   * and would undo it. Discard the transient entry and replace it with the destination instead.
   */
  const goto = (path: string) => {
    setDrawerOpen(false);
    if (embedded) {
      onLocalNavigate?.(path);
      return;
    }
    const stranded = discardTransient(drawerKey);
    void navigate(path, { replace: stranded }).then((moved) => {
      // The unsaved-changes guard may veto; then release the stranded entry so the next Back works.
      if (!moved && stranded) releaseStrandedEntry();
    });
  };

  const searchEntry = (
    <button
      type="button"
      className="codex-sidebar-search"
      onClick={() => {
        closeDrawer();
        onPaletteChange(true);
      }}
      aria-keyshortcuts="Meta+K Control+K"
      /* Collapsed, the glyph is the whole button, so it needs an accessible name. */
      title={collapsed ? "Search" : undefined}
      aria-label={collapsed ? "Search" : undefined}
    >
      <CodexIcon iconId="search" className="codex-navitem-icon codex-sidebar-searchglyph" aria-hidden="true" />
      {!collapsed && <span className="codex-navitem-label">Search</span>}
      {!embedded && !collapsed && shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
  const nav = (asRail: boolean) => (
    <SidebarNav
      groups={groups}
      activePath={activePath}
      collapsed={asRail}
      onNavigate={goto}
      onAction={(action) => {
        closeDrawer();
        onSidebarAction?.(action);
      }}
      header={searchEntry}
      /**
       * Gate on `railBand`, never `collapsed`: otherwise collapsing hides the only control that expands.
       * In the forced band there is nothing to expand into. The phone drawer is always expanded.
       */
      footer={
        railBand || drawerOpen || embedded ? undefined : (
          <SidebarCollapseToggle
            collapsed={sidebarMode === "rail"}
            onToggle={() => setSidebarMode((mode) => (mode === "rail" ? "open" : "rail"))}
          />
        )
      }
    />
  );

  return (
    /* A rail column beside chrome rows over one scrolling region. Embedded, the preview sheet is the frame. */
    <div
      className={`codex-root${className ? ` ${className}` : ""} codex-shell${embedded ? " is-embedded" : " pane-frame pane-scene scanlines anim-view"}${collapsed ? " is-rail" : ""}`}
    >
      {!embedded && <div className="pane-sky" aria-hidden="true" />}
      {/* >=761px the sidebar is in the layout; <=760px it is a Drawer opened from the top bar. */}
      <aside className="codex-shell-side">{nav(collapsed)}</aside>
      <Drawer open={drawerOpen} onClose={closeDrawer} side="left" title="Codex" className="codex-navdrawer">
        {nav(false)}
      </Drawer>

      <div className="codex-shell-main">
        <div className="codex-topbar neon-beam">
          <IconButton label="Codex sections" className="codex-topbar-menu" onClick={openDrawer}>
            <CodexIcon iconId="menu" className="codex-navitem-icon" />
          </IconButton>
          <h2 className="codex-topbar-title">{title}</h2>
          <div className="codex-topbar-actions">
            <IconButton label="Search" className="codex-topbar-search" onClick={() => onPaletteChange(true)}>
              <CodexIcon iconId="search" className="codex-navitem-icon" />
            </IconButton>
            {actions}
          </div>
        </div>
        {notices}
        {/* The one scroll region. */}
        <div className="codex-shell-content scroll-y frame-fill">{children}</div>
      </div>

      {overlays}
    </div>
  );
}
