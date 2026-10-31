import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, Kbd, SegmentedControl } from "@vtt/ui";
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
import { useRecordLight } from "../../shell/recordLight";
import { openSearch } from "../../shell/search-store";
import { SectionBar } from "../../shell/SectionBar";
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
  recordId = null,
  phone,
  embedded = false,
  className,
  go,
  paletteOpen = false,
  onPaletteChange,
  laptopActions,
  phoneActions,
  notices,
  overlays,
  children
}: Readonly<{
  /** Null for an address that names nothing, which lights no section. */
  section: CodexSection | null;
  /** The record the address opens, or null on a list: opening and leaving one runs its light. */
  recordId?: string | null;
  phone: boolean;
  /** The player preview inside the GM's dialog: no shortcut of its own, and the dialog is the frame. */
  embedded?: boolean;
  className?: string;
  go: (path: string) => void;
  /** The preview's own palette; the app's one search serves every other Codex. */
  paletteOpen?: boolean;
  onPaletteChange?: (open: boolean) => void;
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
  // The app's one Ctrl K opens search at the Codex (frame rule 3.4); the GM's preview keeps its own palette, which
  // searches as the player it shows.
  const openFind = useCallback(
    () => (embedded && onPaletteChange ? onPaletteChange(!paletteOpen) : openSearch("codex")),
    [embedded, paletteOpen, onPaletteChange]
  );
  // An old link's `openSearch=1` opens the search once and clears that one key.
  const route = useRoute();
  useEffect(() => {
    if (embedded || route.query.get("openSearch") !== "1") return;
    openSearch("codex");
    replaceQuery((query) => query.delete("openSearch"));
  }, [embedded, route.query]);

  const shell = useRef<HTMLDivElement>(null);
  useRecordLight(shell, recordId, { content: ":scope > .cx-content" });

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
        <IconButton label="Search" size="sm" onClick={openFind}>
          <CodexIcon iconId="search" className="cx-icon" />
        </IconButton>
      </>
    ),
    [phoneActions, openFind]
  );
  const slot = useMemo<PhoneBarSlot>(
    () => ({ target: phone ? barTarget : null, claim, defaults }),
    [phone, barTarget, claim, defaults]
  );

  const searchBox = (
    <button type="button" className="cx-searchbox" onClick={openFind} aria-keyshortcuts="Meta+K Control+K">
      <CodexIcon iconId="search" className="cx-icon" />
      <span className="cx-searchbox-label">Search the Codex</span>
      {!embedded && shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );

  return (
    <PhoneBarContext.Provider value={slot}>
      <div
        ref={shell}
        className={`codex-root cx-shell${phone ? " is-phone" : " is-laptop"}${embedded ? " is-embedded" : ""}${className ? ` ${className}` : ""}`}
      >
        <SectionBar
          name="Codex"
          navLabel="Codex sections"
          pagesLabel="Codex pages"
          pages={(phone ? CODEX_PHONE_TABS : CODEX_BAR).map((item) => ({ id: item.id, label: item.label }))}
          activeId={(phone ? litTab : litBar) ?? ""}
          onChange={(id) => {
            if (phone) go(tabPath(id as CodexPhoneTab));
            else go(CODEX_BAR.find((item) => item.id === id)!.path);
          }}
          panel={() => shell.current?.querySelector(":scope > .cx-content")}
          search={searchBox}
          end={laptopActions}
          phoneHead={
            <>
              {claims === 0 && (
                <>
                  {/* A page in the strip is named by the strip, so the header names the section; one off it names
                      itself (rule 12). */}
                  <h1 className="secbar-name">{litTab || !section ? "Codex" : SECTION_TITLE[section]}</h1>
                  <span className="secbar-icons">{defaults}</span>
                </>
              )}
              <div className="cx-phonebar-slot" ref={setBarTarget} />
            </>
          }
        >
          {phone && part && (
            <nav className="cx-campaign" aria-label="Campaign">
              <SegmentedControl
                size="sm"
                current
                ariaLabel="Campaign parts"
                value={part}
                onChange={(id) => {
                  const target = CAMPAIGN_PARTS.find((candidate) => candidate.id === id);
                  if (target) go(target.path);
                }}
                options={CAMPAIGN_PARTS.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
              />
            </nav>
          )}

          {notices}
          <div className="cx-content">{children}</div>

          {overlays}
        </SectionBar>
      </div>
    </PhoneBarContext.Provider>
  );
}
