import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { IconButton, Kbd } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../../lib/shortcut";
import { CodexIcon } from "../icons";
import {
  CAMPAIGN_PARTS,
  CODEX_BAR,
  CODEX_PHONE_TABS,
  SECTION_TITLE,
  barItemOf,
  campaignPartOf,
  pathForSection,
  phoneTabOf,
  type CampaignPart,
  type CodexPhoneTab,
  type CodexSection
} from "../routes";
import { replaceQuery, useRoute } from "../../router";
import { PhoneBarContext, type PhoneBarSlot } from "./PhoneBar";
import "./shell.css";

const CAMPAIGN_KEY = "codex-campaign-part";

/**
 * The frame both Codex shells share. A laptop gets the section bar (Home, Search, Atlas, Story, Quests and
 * Relationships), the search box that opens the palette (Ctrl K), and the GM's New and GM menu. A phone gets a top
 * bar the view on screen fills (`CodexPhoneBar`), Campaign's switch under it on Story, Quests, Relationships and
 * Sessions, and the tab bar under the thumb. There is no left rail. Role-blind: the shells pass the GM's controls.
 */
export function CodexFrame({
  section,
  phone,
  embedded = false,
  className,
  go,
  paletteOpen,
  onPaletteChange,
  laptopActions,
  phoneActions,
  notices,
  overlays,
  children
}: Readonly<{
  /** Null for an address that names nothing, which lights no section. */
  section: CodexSection | null;
  phone: boolean;
  /** The player preview inside the GM's dialog: no shortcut of its own, and the dialog is the frame. */
  embedded?: boolean;
  className?: string;
  go: (path: string) => void;
  paletteOpen: boolean;
  onPaletteChange: (open: boolean) => void;
  /** The GM's New and GM menu, after the search box. */
  laptopActions?: ReactNode;
  /** The GM's controls in the phone's default top bar, before Search. */
  phoneActions?: ReactNode;
  notices?: ReactNode;
  /** Dialogs and drawers that sit outside the content region, the palette among them. */
  overlays?: ReactNode;
  children: ReactNode;
}>) {
  // The key that opens search, written the way this device's keyboard says it; a touch device shows none.
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
  // The shortcut belongs to the Codex, so it leaves with it.
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

  // The top bar's search launcher sends `openSearch=1` once: open the palette and clear that one key.
  const route = useRoute();
  useEffect(() => {
    if (embedded || route.query.get("openSearch") !== "1") return;
    onPaletteChange(true);
    replaceQuery((query) => query.delete("openSearch"));
  }, [embedded, route.query, onPaletteChange]);

  const litBar = section ? barItemOf(section) : null;
  const litTab = section ? phoneTabOf(section) : null;
  const part = section ? campaignPartOf(section) : null;

  // Campaign reopens the part last used, so the tab is one tap back to where the GM was.
  const [lastPart, setLastPart] = useState<CampaignPart>(() => {
    try {
      const stored = localStorage.getItem(CAMPAIGN_KEY);
      return CAMPAIGN_PARTS.some((candidate) => candidate.id === stored) ? (stored as CampaignPart) : "story";
    } catch {
      return "story";
    }
  });
  useEffect(() => {
    if (!part || embedded) return;
    setLastPart(part);
    try {
      localStorage.setItem(CAMPAIGN_KEY, part);
    } catch {
      /* private mode: Campaign opens on Story */
    }
  }, [part, embedded]);

  const tabPath = (tab: CodexPhoneTab) =>
    tab === "campaign"
      ? (CAMPAIGN_PARTS.find((candidate) => candidate.id === lastPart)?.path ?? pathForSection("story"))
      : pathForSection(tab);

  const [barTarget, setBarTarget] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);
  const defaults = useMemo(
    () => (
      <>
        {phoneActions}
        <IconButton label="Search" size="sm" onClick={() => onPaletteChange(true)}>
          <CodexIcon iconId="search" className="cx-icon" />
        </IconButton>
      </>
    ),
    [phoneActions, onPaletteChange]
  );
  const slot = useMemo<PhoneBarSlot>(
    () => ({ target: phone ? barTarget : null, claim, defaults }),
    [phone, barTarget, claim, defaults]
  );

  const searchBox = (
    <button
      type="button"
      className="cx-searchbox"
      onClick={() => onPaletteChange(true)}
      aria-keyshortcuts="Meta+K Control+K"
    >
      <CodexIcon iconId="search" className="cx-icon" />
      <span className="cx-searchbox-label">Search the Codex</span>
      {!embedded && shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );

  return (
    <PhoneBarContext.Provider value={slot}>
      <div
        className={`codex-root cx-shell${phone ? " is-phone" : " is-laptop"}${embedded ? " is-embedded" : ""}${className ? ` ${className}` : ""}`}
      >
        {phone ? (
          <header className="cx-phonebar">
            {claims === 0 && (
              <>
                <h2 className="cx-phonebar-title">{section ? SECTION_TITLE[section] : "Codex"}</h2>
                <div className="cx-phonebar-actions">{defaults}</div>
              </>
            )}
            <div className="cx-phonebar-slot" ref={setBarTarget} />
          </header>
        ) : (
          <div className="cx-bar">
            <nav className="cx-bar-sections nh-tabs nh-tabs--horizontal" aria-label="Codex sections">
              {CODEX_BAR.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nh-tab cx-bar-tab${litBar === item.id ? " nh-tab--active" : ""}`}
                  aria-current={litBar === item.id ? "page" : undefined}
                  onClick={() => go(item.path)}
                >
                  <CodexIcon iconId={item.iconId} className="cx-icon" />
                  {item.label}
                </button>
              ))}
            </nav>
            <span className="cx-grow" />
            {searchBox}
            {laptopActions}
          </div>
        )}

        {phone && (
          <nav className="cx-tabbar" aria-label="Codex sections">
            {CODEX_PHONE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`cx-tabbar-tab${litTab === tab.id ? " is-on" : ""}`}
                aria-current={litTab === tab.id ? "page" : undefined}
                onClick={() => go(tabPath(tab.id))}
              >
                <CodexIcon iconId={tab.iconId} className="cx-icon" />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        )}
        {phone && part && (
          <nav className="cx-campaign" aria-label="Campaign">
            <div className="nh-segmented nh-segmented--sm">
              {CAMPAIGN_PARTS.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="nh-segmented-option tap-target interactive"
                  aria-current={candidate.id === part ? "page" : undefined}
                  onClick={() => go(candidate.path)}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          </nav>
        )}

        {notices}
        <div className="cx-content">{children}</div>

        {overlays}
      </div>
    </PhoneBarContext.Provider>
  );
}
