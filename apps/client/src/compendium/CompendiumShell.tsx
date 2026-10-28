import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GmView } from "@vtt/domain";
import { Button, IconPlus, Kbd, StripInk, cx, type PartyCharacter, FilterFlyout } from "@vtt/ui";
import { CodexIcon } from "../codex/icons";
import { currentDevice, shortcutLabel } from "../lib/shortcut";
import { useMediaQuery } from "../lib/useMediaQuery";
import { RulesButton } from "../reference/RulesReference";
import { navigate, replaceQuery, useRoute } from "../router";
import { useRecordLight } from "../shell/recordLight";
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
import { SearchDialog } from "./SearchDialog";
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

  // The top bar's search launcher sends `openSearch=1` once: open the search and clear that one key.
  useEffect(() => {
    if (route.query.get("openSearch") !== "1") return;
    setSearchOpen(true);
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
                <StripInk active={section ?? ""} panel={() => shell.current?.querySelector(":scope > .cx-content")} />
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
              <RulesButton />
              <span className="cx-grow" />
              <Button variant="primary" onClick={() => openNew({ kind: kindInView })}>
                <IconPlus /> New homebrew
              </Button>
            </div>
          )}
          {phone && (
            <div className="cp-phone-sections">
              <nav className="cx-tabbar cp-phone-tabs" aria-label="Compendium sections">
                {SECTIONS.map((item) => {
                  const on = section === item.id && newOptions === null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cx("cx-tabbar-tab", on && "is-on")}
                      aria-current={on ? "page" : undefined}
                      onClick={() => go(item.path)}
                    >
                      {item.label}
                    </button>
                  );
                })}
                <StripInk
                  active={newOptions === null ? (section ?? "") : ""}
                  selector=".is-on"
                  panel={() => shell.current?.querySelector(":scope > .cx-content")}
                />
              </nav>
              <Button
                variant="primary"
                className="cp-phone-new"
                aria-label="New homebrew"
                onClick={() => openNew({ kind: kindInView })}
              >
                <IconPlus />
              </Button>
            </div>
          )}
          <div className="cx-content cp-content">{body}</div>
          {newOptions && <NewRecordDialog options={newOptions} onClose={() => setNewOptions(null)} />}
          {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
        </div>
      </CompendiumGameContext.Provider>
    </CompendiumContext.Provider>
  );
}
