import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, Kbd } from "@vtt/ui";
import { currentDevice, shortcutLabel } from "../../lib/shortcut";
import { CodexIcon } from "../icons";
import { SECTION_TITLE, barItemOf, codexBar, type CodexSection } from "../routes";
import { replaceQuery, useRoute } from "../../router";
import { useRecordLight } from "../../shell/recordLight";
import { openSearch } from "../../shell/search-store";
import { SectionBar } from "../../shell/SectionBar";
import { PhoneBarContext, type PhoneBarSlot } from "./PhoneBar";
import "./shell.css";

/**
 * The frame both Codex shells share (Codex frame rule 3.1, ADR-0054). A laptop gets the Titled bar: Codex, its pages
 * as words (Home, Pages, Atlas, Story, Quests, Relationships, and Compendium for a player), the search field that opens
 * the palette (Ctrl K), and the GM's New and More. A phone gets a header the view on screen can fill (`CodexPhoneBar`)
 * with Search and the GM's New, and the same pages as a strip of words under it. The shells pass the GM's controls.
 */
export function CodexFrame({
  role,
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
  /** Whose bar: a player's ends with the Compendium, which the GM has as a section of its own. */
  role: "gm" | "player";
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
  /** The GM's New and More, after the search field. */
  laptopActions?: ReactNode;
  /** The GM's controls in the phone's default header, after Search. */
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

  const lit = section ? barItemOf(section) : null;
  const pages = codexBar(role);
  const onStrip = pages.some((item) => item.id === lit);

  const [barTarget, setBarTarget] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);
  const defaults = useMemo(
    () => (
      <>
        <IconButton label="Search" size="sm" onClick={openFind}>
          <CodexIcon iconId="search" className="cx-icon" />
        </IconButton>
        {phoneActions}
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
          pages={pages.map((item) => ({ id: item.id, label: item.label }))}
          activeId={onStrip ? lit! : ""}
          onChange={(id) => go(pages.find((item) => item.id === id)!.path)}
          panel={() => shell.current?.querySelector(":scope > .cx-content")}
          phoneStrip={!recordId}
          search={searchBox}
          end={laptopActions}
          phoneHead={
            <>
              {claims === 0 && (
                <>
                  {/* A page in the strip is named by the strip, so the header names the section; one off it names
                      itself (rule 12). */}
                  <h1 className="secbar-name">{onStrip || !section ? "Codex" : SECTION_TITLE[section]}</h1>
                  <span className="secbar-icons">{defaults}</span>
                </>
              )}
              <div className="cx-phonebar-slot" ref={setBarTarget} />
            </>
          }
        >
          {notices}
          <div className="cx-content">{children}</div>

          {overlays}
        </SectionBar>
      </div>
    </PhoneBarContext.Provider>
  );
}
