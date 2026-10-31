import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GmView } from "@vtt/domain";
import { Button, IconButton, IconPlus, IconSearch, Kbd, cx, type PartyCharacter, FilterFlyout } from "@vtt/ui";
import { CodexIcon } from "../codex/icons";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { RulesButton } from "../reference/RulesReference";
import { navigate, replaceQuery, useRoute } from "../router";
import { useRecordLight } from "../shell/recordLight";
import { SectionBar } from "../shell/SectionBar";
import { openSearch as openOneSearch } from "../shell/search-store";
import {
  CompendiumContext,
  CompendiumGameContext,
  PHONE_QUERY,
  WIDE_QUERY,
  type CompendiumContextValue,
  type NewRecordOptions
} from "./context";
import { useCompendiumPing } from "./data";
import { kindPlural, type Kind } from "./kinds";
import { NewRecordDialog } from "./NewRecordDialog";
import { OverviewView } from "./OverviewView";
import { RecordView } from "./record/RecordView";
import { COMPENDIUM_PATHS, compendiumViewOf, sectionOf, type CompendiumSection, type CompendiumView } from "./routes";
import { SharingView } from "./SharingView";
import { SourcesView } from "./SourcesView";
import { TablesView } from "./TablesView";
import "../codex/shell/shell.css";
import "./compendium.css";

/* Browse is the tables and Homebrew the overview of what you made; the addresses stay as they were. */
const SECTIONS: ReadonlyArray<Readonly<{ id: CompendiumSection; label: string; path: string }>> = [
  { id: "tables", label: "Browse", path: COMPENDIUM_PATHS.tables },
  { id: "overview", label: "Homebrew", path: COMPENDIUM_PATHS.overview },
  { id: "sources", label: "Sources", path: COMPENDIUM_PATHS.sources },
  { id: "sharing", label: "Sharing", path: COMPENDIUM_PATHS.sharing }
];

const TABLE_FLYOUT_ID = "cp-table-flyout";

/**
 * The GM's Compendium: SRD 5.2.1 and the table's homebrew in one set of tables, with Browse, Homebrew, Sources and
 * Sharing, the search (Ctrl K) and New homebrew. A record opens at its own address, docked beside its table on a wide
 * laptop; while it is edited, or on a narrower screen, it takes the width and the table folds into a flyout that
 * keeps its kind and filters. A phone gets the section's screen under a row of its sections and New.
 */
export function CompendiumShell({
  token,
  party,
  game = null
}: Readonly<{ token: string; party: readonly PartyCharacter[]; game?: GmView | null }>) {
  useCompendiumPing();
  const route = useRoute();
  const phone = useMediaQuery(PHONE_QUERY);
  const wide = useMediaQuery(WIDE_QUERY);
  const view: CompendiumView = compendiumViewOf(route.segments, route.query) ?? { view: "overview" };
  const section = sectionOf(view);
  const [newOptions, setNewOptions] = useState<NewRecordOptions | null>(null);
  const [tableOpen, setTableOpen] = useState(false);

  const go = useCallback((path: string, options?: Readonly<{ replace?: boolean }>) => navigate(path, options), []);
  const setQuery = useCallback((mutate: (query: URLSearchParams) => void) => replaceQuery(mutate), []);
  const openNew = useCallback((options?: NewRecordOptions) => setNewOptions(options ?? {}), []);
  // The one search, at the Compendium (frame spec 2.3); the app holds Ctrl K for every page.
  const openSearch = useCallback(() => openOneSearch("compendium"), []);

  // An old link's `openSearch=1` opens the search once and clears that one key.
  useEffect(() => {
    if (route.query.get("openSearch") !== "1") return;
    openOneSearch("compendium");
    replaceQuery((query) => query.delete("openSearch"));
  }, [route.query]);

  // A row picked in the folded table opens its record and puts the table away.
  const recordKey = view.view === "record" ? `${view.kind}:${view.id}` : null;
  useEffect(() => setTableOpen(false), [recordKey]);

  const value = useMemo<CompendiumContextValue>(
    () => ({ token, party, phone, wide, view, query: route.query, go, setQuery, openNew, openSearch }),
    // `view` is read from the address, which `route` already names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, party, phone, wide, route, go, setQuery, openNew, openSearch]
  );
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
  const kindInView: Kind | null = view.view === "tables" || view.view === "record" ? view.kind : null;
  const shell = useRef<HTMLDivElement>(null);
  useRecordLight(shell, recordKey, {
    content: ":scope > .cx-content",
    // Beside a docked table only the record fades; elsewhere the record is the whole content.
    record: ".cp-recordlayout.is-docked > :not(.cp-dock-table)"
  });

  const body = ((): ReactNode => {
    switch (view.view) {
      case "overview":
        return <OverviewView />;
      case "tables":
        return <TablesView kind={view.kind} />;
      case "sources":
        return <SourcesView />;
      case "sharing":
        return <SharingView />;
      case "record": {
        if (phone) return <RecordView key={recordKey} kind={view.kind} id={view.id} tab={view.tab} layout="phone" />;
        const docked = wide && view.tab !== "edit";
        // The record keeps its place among its siblings, so a change between docked and full keeps its draft.
        return (
          <div className={cx("cp-recordlayout", docked ? "is-docked" : "is-full")}>
            {docked ? (
              <div className="cp-dock-table">
                <TablesView kind={view.kind} compact selectedId={view.id} />
              </div>
            ) : null}
            <RecordView
              key={recordKey}
              kind={view.kind}
              id={view.id}
              tab={view.tab}
              layout={docked ? "dock" : "full"}
              onOpenTable={docked ? undefined : () => setTableOpen(true)}
            />
            {!docked && (
              <FilterFlyout
                id={TABLE_FLYOUT_ID}
                open={tableOpen}
                title={kindPlural(view.kind)}
                closeLabel="Close the table"
                className="cp-table-flyout"
                onClose={() => setTableOpen(false)}
              >
                <TablesView kind={view.kind} inFlyout selectedId={view.id} />
              </FilterFlyout>
            )}
          </div>
        );
      }
    }
  })();

  return (
    <CompendiumContext.Provider value={value}>
      <CompendiumGameContext.Provider value={game}>
        <div ref={shell} className={cx("cx-shell cp-shell", phone ? "is-phone" : "is-laptop")}>
          <SectionBar
            name="Compendium"
            navLabel="Compendium sections"
            pagesLabel="Compendium pages"
            pages={SECTIONS.map((item) => ({ id: item.id, label: item.label }))}
            activeId={phone && newOptions !== null ? "" : (section ?? "")}
            onChange={(id) => go(SECTIONS.find((item) => item.id === id)!.path)}
            panel={() => shell.current?.querySelector(":scope > .cx-content")}
            phoneHidden={view.view === "record"}
            search={
              <button
                type="button"
                className="cx-searchbox cp-searchbox"
                onClick={openSearch}
                aria-keyshortcuts="Meta+K Control+K"
              >
                <CodexIcon iconId="search" className="cx-icon" />
                <span className="cx-searchbox-label">Search the SRD and homebrew</span>
                {shortcut && <Kbd>{shortcut}</Kbd>}
              </button>
            }
            end={
              <>
                <RulesButton />
                <Button variant="primary" size="sm" onClick={() => openNew({ kind: kindInView })}>
                  New homebrew
                </Button>
              </>
            }
            phoneIcons={
              <>
                <IconButton label="Search the SRD and homebrew" onClick={openSearch}>
                  <IconSearch />
                </IconButton>
                <IconButton label="New homebrew" onClick={() => openNew({ kind: kindInView })}>
                  <IconPlus />
                </IconButton>
              </>
            }
          >
            <div className="cx-content cp-content">{body}</div>
          </SectionBar>
          {newOptions && <NewRecordDialog options={newOptions} onClose={() => setNewOptions(null)} />}
        </div>
      </CompendiumGameContext.Provider>
    </CompendiumContext.Provider>
  );
}
