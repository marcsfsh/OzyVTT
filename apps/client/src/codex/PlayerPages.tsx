import { useCallback, useMemo } from "react";
import { Button, Chip, Combobox, IconChevron, Input, Select, Skeleton } from "@vtt/ui";
import type { PlayerCodexPageSummary } from "@vtt/domain";
import { playerCodexApi } from "./api";
import { CodexImage } from "./CodexImage";
import { CodexMarkdown } from "./CodexMarkdown";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ENTITY_TYPE_LIST, entityDef, type EntityType } from "./entities";
import { EntityIcon } from "./icons";
import { journalEntryPath, pagePath, pathForHit, pathForSection, questPath, sessionPath, tagPath } from "./routes";
import { SearchResultList, useCodexSearch } from "./SearchResults";
import { useCodexQuery } from "./useCodexQuery";

const NO_CONNECTIONS: readonly never[] = [];

/** The player's Pages: revealed pages in a filterable rail beside a read-only reader. */
export function PlayerPages({
  token,
  pages,
  loading,
  pageId,
  query,
  search,
  onSearchChange,
  onFilterChange,
  onOpen,
  onFollowLink,
  knownTitles
}: Readonly<{
  token: string;
  pages: readonly PlayerCodexPageSummary[];
  loading: boolean;
  /** From `/codex/pages/:id`. */
  pageId: string | null;
  query: URLSearchParams;
  /** Kept by the shell, so the box survives a visit to another section. */
  search: string;
  onSearchChange: (text: string) => void;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
  onOpen: (path: string) => void;
  onFollowLink: (target: string) => void;
  knownTitles: ReadonlySet<string>;
}>) {
  const readPage = useCallback(() => playerCodexApi.getPage(token, pageId ?? ""), [token, pageId]);
  const opened = useCodexQuery(pageId ? readPage : null);
  // A page the player can't see is a 404, which reads the same as no page.
  const page = pageId && !opened.error ? (opened.data?.page ?? null) : null;
  const pageConnections = page ? (opened.data?.connections ?? NO_CONNECTIONS) : NO_CONNECTIONS;

  /** Filters live in the address like the GM's. */
  const typeFilter = (query.get("type") as EntityType | null) ?? null;
  const tags = useMemo(() => [...new Set(pages.flatMap((summary) => summary.tags))].sort(), [pages]);
  const shownPages = useMemo(() => {
    const tag = query.get("tag");
    return pages.filter(
      (summary) => (!typeFilter || summary.entityType === typeFilter) && (!tag || summary.tags.includes(tag))
    );
  }, [pages, typeFilter, query]);

  const runSearch = useCallback((text: string) => playerCodexApi.search(token, text), [token]);
  const searchState = useCodexSearch(search, runSearch, pages);

  return (
    <div className={`codex-workspace${pageId ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input
            value={search}
            placeholder="Search pages"
            aria-label="Search the Codex"
            onChange={(event) => {
              onSearchChange(event.target.value);
              if (event.target.value.trim()) onFilterChange({ type: null, tag: null });
            }}
          />
        </div>
        {!search.trim() && (
          <div className="codex-rail-tools">
            <Select
              aria-label="Filter by kind"
              value={typeFilter ?? ""}
              onChange={(event) => onFilterChange({ type: event.target.value || null })}
            >
              <option value="">All kinds</option>
              {ENTITY_TYPE_LIST.map((type) => (
                <option key={type} value={type}>
                  {entityDef(type).label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {!search.trim() && tags.length > 0 && (
          <div className="codex-rail-tagfilter">
            <Combobox
              options={tags.map((tag) => ({ id: tag, label: `#${tag}` }))}
              value={query.get("tag")}
              onChange={(tag) => onFilterChange({ tag })}
              ariaLabel="Filter by tag"
              placeholder="Filter by tag"
            />
          </div>
        )}
        <nav className="codex-list scroll-y" aria-label="Pages">
          {search.trim() ? (
            <SearchResultList
              state={searchState}
              selectedId={pageId}
              onOpen={(hit) => onOpen(pathForHit(hit))}
              emptyLabel="No pages match."
            />
          ) : (
            <>
              <div className="codex-filter-chips">
                {typeFilter && (
                  <Chip onRemove={() => onFilterChange({ type: null })} removeLabel="Clear kind filter">
                    {entityDef(typeFilter).label}s
                  </Chip>
                )}
                {query.get("tag") && (
                  <Chip onRemove={() => onFilterChange({ tag: null })} removeLabel="Clear tag filter">
                    #{query.get("tag")}
                  </Chip>
                )}
              </div>
              {loading && (
                <div className="codex-list-loading">
                  {[0, 1, 2].map((row) => (
                    <Skeleton key={row} variant="text" />
                  ))}
                </div>
              )}
              {!loading && pages.length === 0 && <p className="codex-list-empty">Nothing shared yet.</p>}
              {!loading && pages.length > 0 && shownPages.length === 0 && (
                <p className="codex-list-empty">No pages match these filters.</p>
              )}
              {shownPages.map((summary) => (
                <button
                  key={summary.id}
                  type="button"
                  className={`codex-list-item${summary.id === pageId ? " is-active" : ""}`}
                  onClick={() => onOpen(pagePath(summary.id))}
                >
                  {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}
                  <span className="codex-list-title">{summary.title}</span>
                </button>
              ))}
            </>
          )}
        </nav>
      </aside>
      <section className="codex-main scroll-y">
        {pageId && (
          <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(pathForSection("pages"))}>
            <IconChevron className="codex-chevron-left" aria-hidden="true" />
            All pages
          </Button>
        )}
        {page ? (
          <article className="codex-reader">
            {page.bannerAssetId && (
              <CodexImage assetId={page.bannerAssetId} token={token} alt="" className="codex-banner-img" />
            )}
            <h2 className="codex-reader-title">
              {page.entityType !== "note" && <EntityIcon type={page.entityType} className="codex-reader-titleicon" />}
              {page.title}
            </h2>
            {page.tags.length > 0 && (
              <div className="codex-editor-tagjumps">
                {page.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="codex-tag-chip tap-target"
                    onClick={() => onOpen(tagPath(tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            {Object.entries(page.fields).length > 0 && (
              <dl className="codex-reader-fields">
                {Object.entries(page.fields).map(([key, value]) => {
                  const def = entityDef(page.entityType).fields.find((field) => field.key === key);
                  return (
                    <div key={key} className="codex-reader-field">
                      <dt>{def?.label ?? key}</dt>
                      <dd>{value}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
            <div className="codex-reader-body">
              {page.body.trim() ? (
                <CodexMarkdown text={page.body} onNavigate={onFollowLink} token={token} knownTitles={knownTitles} />
              ) : (
                <p className="codex-preview-empty">Nothing written here yet.</p>
              )}
            </div>
            {/* The GM's panel over the player feed, with no `write` prop: read-only by construction. */}
            <div className="codex-reader-rels">
              <ConnectionsPanel
                connections={pageConnections}
                onOpen={(kind, id) =>
                  onOpen(
                    kind === "page"
                      ? pagePath(id)
                      : kind === "session"
                        ? sessionPath(id)
                        : kind === "quest"
                          ? questPath(id)
                          : journalEntryPath(id)
                  )
                }
              />
            </div>
          </article>
        ) : (
          <div className="codex-main-empty">
            <h3>No page selected</h3>
            <p>Choose a page from the list to read it.</p>
          </div>
        )}
      </section>
    </div>
  );
}
