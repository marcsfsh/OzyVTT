import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, IconEye, IconHome, IconList, IconPlus, Kbd, cx } from "@vtt/ui";
import type { PartyCharacter } from "../codex/shared/audience";
import { FilterFlyout } from "../codex/shared/FilterFlyout";
import { CodexIcon } from "../codex/icons";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { navigate, replaceQuery, useRoute } from "../router";
import {
  CompendiumContext,
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
import { SearchDialog } from "./SearchDialog";
import { SharingView } from "./SharingView";
import { SourcesView } from "./SourcesView";
import { TablesView } from "./TablesView";
import "../codex/shell/shell.css";
import "./compendium.css";

const SECTIONS: ReadonlyArray<Readonly<{ id: CompendiumSection; label: string; path: string }>> = [
  { id: "overview", label: "Overview", path: COMPENDIUM_PATHS.overview },
  { id: "tables", label: "Tables", path: COMPENDIUM_PATHS.tables },
  { id: "sources", label: "Sources", path: COMPENDIUM_PATHS.sources },
  { id: "sharing", label: "Sharing", path: COMPENDIUM_PATHS.sharing }
];

const TABLE_FLYOUT_ID = "cp-table-flyout";

/**
 * The GM's Compendium: SRD 5.2.1 and the table's homebrew in one set of tables, with Overview, Tables, Sources and
 * Sharing, the search (Ctrl K) and New homebrew. A record opens at its own address, docked beside its table on a wide
 * laptop; while it is edited, or on a narrower screen, it takes the width and the table folds into a flyout that
 * keeps its kind and filters. A phone gets the section's screen with the tab bar under the thumb.
 */
export function CompendiumShell({ token, party }: Readonly<{ token: string; party: readonly PartyCharacter[] }>) {
  useCompendiumPing();
  const route = useRoute();
  const phone = useMediaQuery(PHONE_QUERY);
  const wide = useMediaQuery(WIDE_QUERY);
  const view: CompendiumView = compendiumViewOf(route.segments, route.query) ?? { view: "overview" };
  const section = sectionOf(view);
  const [newOptions, setNewOptions] = useState<NewRecordOptions | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  const go = useCallback((path: string, options?: Readonly<{ replace?: boolean }>) => navigate(path, options), []);
  const setQuery = useCallback((mutate: (query: URLSearchParams) => void) => replaceQuery(mutate), []);
  const openNew = useCallback((options?: NewRecordOptions) => setNewOptions(options ?? {}), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);

  // The search belongs to the Compendium, so its shortcut leaves with it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <div className={cx("cx-shell cp-shell", phone ? "is-phone" : "is-laptop")}>
        {!phone && (
          <div className="cx-bar cp-bar">
            <h1 className="cp-bar-title">Compendium</h1>
            <nav className="cx-bar-sections nh-tabs nh-tabs--horizontal" aria-label="Compendium sections">
              {SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx("nh-tab cx-bar-tab", section === item.id && "nh-tab--active")}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => go(item.path)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
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
            <span className="cx-grow" />
            <Button variant="primary" onClick={() => openNew({ kind: kindInView })}>
              <IconPlus /> New homebrew
            </Button>
          </div>
        )}
        <div className="cx-content cp-content">{body}</div>
        {phone && (
          <nav className="cx-tabbar" aria-label="Compendium sections">
            {[
              { id: "overview", label: "Overview", icon: <IconHome className="cx-icon" /> },
              { id: "tables", label: "Tables", icon: <IconList className="cx-icon" /> },
              { id: "new", label: "New", icon: <IconPlus className="cx-icon" /> },
              { id: "sources", label: "Sources", icon: <CodexIcon iconId="archive" className="cx-icon" /> },
              { id: "sharing", label: "Sharing", icon: <IconEye className="cx-icon" /> }
            ].map((tab) => {
              const on = tab.id === "new" ? newOptions !== null : section === tab.id && newOptions === null;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cx("cx-tabbar-tab", on && "is-on")}
                  aria-current={on && tab.id !== "new" ? "page" : undefined}
                  onClick={() =>
                    tab.id === "new"
                      ? openNew({ kind: kindInView })
                      : go(SECTIONS.find((item) => item.id === tab.id)!.path)
                  }
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        )}
        {newOptions && <NewRecordDialog options={newOptions} onClose={() => setNewOptions(null)} />}
        {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      </div>
    </CompendiumContext.Provider>
  );
}
