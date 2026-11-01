import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GmView } from "@vtt/domain";
import {
  IconButton,
  IconSort,
  IconList,
  IconPlus,
  IconSearch,
  IconX,
  Kbd,
  cx,
  type PartyCharacter,
  FilterFlyout
} from "@vtt/ui";
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
import { useCompendium as useCompendiumValue } from "./context";
import { KindIcon, kindPlural, type Kind } from "./kinds";
import { closeRecord, openRecord, parseKey, setFold, useOpenRecords } from "./openRecords";
import { FilterPane, ResultsPane, useNames } from "./TablesView";
import { NewRecordDialog } from "./NewRecordDialog";
import { OverviewView } from "./OverviewView";
import { RecordView } from "./record/RecordView";
import {
  COMPENDIUM_PATHS,
  compendiumViewOf,
  recordPath,
  sectionOf,
  tablePath,
  withTableQuery,
  type CompendiumSection,
  type CompendiumView
} from "./routes";
import { TablesView } from "./TablesView";
import { SharingView } from "./SharingView";
import { SourcesView } from "./SourcesView";
import "../codex/shell/shell.css";
import "./compendium.css";
import { BarPrimary } from "../shell/SectionBar";

/* Browse is the tables and Homebrew the overview of what you made; the addresses stay as they were. */
const SECTIONS: ReadonlyArray<Readonly<{ id: CompendiumSection; label: string; path: string }>> = [
  // Home first (compendium rule 3.1); its id stays `overview` so the addresses don't change.
  { id: "overview", label: "Home", path: COMPENDIUM_PATHS.overview },
  { id: "tables", label: "Browse", path: COMPENDIUM_PATHS.tables },
  { id: "sources", label: "Sources", path: COMPENDIUM_PATHS.sources },
  { id: "sharing", label: "Sharing", path: COMPENDIUM_PATHS.sharing }
];

const TABLE_FLYOUT_ID = "cp-table-flyout";
/** Where all three panes open at once; narrower laptops fold the filters (compendium spec 2.3). */
const THREE_PANES_QUERY = "(min-width: 1280px)";

/** A folded pane: its head as a 44px edge with its icon and its name read across; pressing it opens the pane. */
function FoldEdge({ label, icon, onOpen }: Readonly<{ label: string; icon: ReactNode; onOpen: () => void }>) {
  return (
    <button type="button" className="cp-fold-edge" onClick={onOpen} aria-label={`Open ${label}`}>
      <span className="cp-fold-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="cp-fold-label">{label}</span>
    </button>
  );
}

/**
 * The open records as tabs over the record pane only (compendium spec 2.3): each its kind's icon, its name and Close,
 * each a link to its address. A phone draws them as a strip of chips under the header.
 */
function OpenRecordTabs({
  current,
  keys,
  phone,
  onClose
}: Readonly<{ current: string; keys: readonly string[]; phone: boolean; onClose: (kind: Kind, id: string) => void }>) {
  const { token, query } = useCompendiumValue();
  const names = useNames(token);
  const shown = keys.includes(current) ? keys : [...keys, current];
  return (
    <div className={phone ? "cp-opentabs is-phone" : "cp-opentabs"} role="tablist" aria-label="Open records">
      {shown.map((key) => {
        const { kind: which, id } = parseKey(key);
        const kind = which as Kind;
        const name = names.record(id) ?? id;
        const on = key === current;
        return (
          <span key={key} className={on ? "cp-opentab is-on" : "cp-opentab"}>
            <a
              role="tab"
              aria-selected={on}
              className="cp-opentab-link"
              href={withTableQuery(recordPath(kind, id), query)}
              onClick={(event) => {
                event.preventDefault();
                navigate(withTableQuery(recordPath(kind, id), query));
              }}
            >
              <KindIcon kind={kind} />
              <span className="cp-opentab-name">{name}</span>
            </a>
            <IconButton label={`Close ${name}`} size="sm" onClick={() => onClose(kind, id)}>
              <IconX />
            </IconButton>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The GM's Compendium: SRD 5.2.1 and the table's homebrew in one set of tables, with Home, Browse, Sources and
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
  // A record shown from anywhere joins the open records (compendium spec 2.3).
  useEffect(() => {
    if (recordKey) openRecord(recordKey);
  }, [recordKey]);
  const open = useOpenRecords();
  const threePanes = useMediaQuery(THREE_PANES_QUERY);
  const closeTab = useCallback(
    (kind: Kind, id: string) => {
      const next = closeRecord(`${kind}:${id}`);
      if (next) {
        const { kind: nextKind, id: nextId } = parseKey(next);
        navigate(withTableQuery(recordPath(nextKind as Kind, nextId), route.query));
      } else navigate(withTableQuery(tablePath(kind), route.query));
    },
    [route.query]
  );

  const value = useMemo<CompendiumContextValue>(
    () => ({ token, party, phone, wide, view, query: route.query, go, setQuery, openNew, openSearch, closeTab }),
    // `view` is read from the address, which `route` already names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, party, phone, wide, route, go, setQuery, openNew, openSearch, closeTab]
  );
  const shortcut = useMemo(() => shortcutLabel("K", currentDevice()), []);
  const kindInView: Kind | null = view.view === "tables" || view.view === "record" ? view.kind : null;
  const shell = useRef<HTMLDivElement>(null);
  useRecordLight(shell, recordKey, {
    content: ":scope > .cx-content",
    // Beside a docked table only the record fades; elsewhere the record is the whole content.
    record: ".cp-panes .cp-pane--record > .cp-record"
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
        const tabs = <OpenRecordTabs current={recordKey!} keys={open.keys} phone={phone} onClose={closeTab} />;
        if (phone)
          return (
            <div className="cp-phone-record">
              {tabs}
              <RecordView key={recordKey} kind={view.kind} id={view.id} tab={view.tab} layout="phone" />
            </div>
          );
        const docked = wide && view.tab !== "edit";
        if (!docked)
          // Editing takes the width under the open records' tabs; a narrower laptop keeps the table in a flyout.
          return (
            <div className="cp-recordlayout is-full">
              <div className="cp-pane cp-pane--record">
                {tabs}
                <RecordView
                  key={recordKey}
                  kind={view.kind}
                  id={view.id}
                  tab={view.tab}
                  layout="full"
                  onOpenTable={view.tab === "edit" ? undefined : () => setTableOpen(true)}
                />
              </div>
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
            </div>
          );
        // Three panes, all live (compendium spec 2.3): the filters, the results and the record under its tabs. Below
        // 1280px the filters start folded so the record keeps room for its card.
        const filtersFolded = open.folds.filters ?? !threePanes;
        return (
          <div className="cp-panes">
            {filtersFolded ? (
              <FoldEdge label="Filters" icon={<IconSort />} onOpen={() => setFold("filters", false)} />
            ) : (
              <div className="cp-pane cp-pane--filters">
                <FilterPane kind={view.kind} onFold={() => setFold("filters", true)} />
              </div>
            )}
            {open.folds.results ? (
              <FoldEdge label={kindPlural(view.kind)} icon={<IconList />} onOpen={() => setFold("results", false)} />
            ) : (
              <div className="cp-pane cp-pane--results">
                <ResultsPane
                  kind={view.kind}
                  selectedId={view.id}
                  openKeys={open.keys}
                  onFold={() => setFold("results", true)}
                />
              </div>
            )}
            <div className="cp-pane cp-pane--record">
              {tabs}
              <RecordView key={recordKey} kind={view.kind} id={view.id} tab={view.tab} layout="dock" />
            </div>
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
                <BarPrimary label="New homebrew" onClick={() => openNew({ kind: kindInView })} />
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
