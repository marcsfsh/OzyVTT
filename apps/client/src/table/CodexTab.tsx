import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Skeleton,
  cx,
  AudienceChip,
  EVERYONE,
  HIDDEN,
  sinceLabel,
  type Audience,
  type PartyCharacter
} from "@vtt/ui";
import { pageLinkKey, type CodexEntityType } from "@vtt/domain";
import { codexApi, playerCodexApi } from "../codex/api";
import { findApi, pageRecordApi } from "../codex/api-records";
import type { CodexBlock, CodexPage, CodexSearchHit, PlayerCodexBlock, PlayerCodexSearchHit } from "@vtt/domain";
import { CodexMarkdown } from "../codex/CodexMarkdown";
import { entityDef } from "../codex/entities";
import { EntityIcon } from "../codex/icons";
import { pagePath, pathForHit } from "../codex/routes";
import { HiddenBlock } from "../codex/shared/HiddenBlock";
import { RevealPanel } from "../codex/shared/RevealPanel";
import { playerDocument } from "../codex/page/document";
import { stampOf } from "../codex/shared/reveals";
import { useCodexQuery } from "../codex/useCodexQuery";
import { navigate } from "../router";
import "../codex/shared/shared.css";
import "../codex/page/page.css";
import "./codex-tab.css";

const RECENT_KEY = "vtt.table-codex-recent";
const PAGE_TYPES = ["character", "location", "faction", "item", "religion", "species", "event", "note"] as const;

type Recent = Readonly<{ id: string; title: string }>;
function readRecent(role: string): Recent[] {
  try {
    return (JSON.parse(localStorage.getItem(`${RECENT_KEY}.${role}`) ?? "[]") as Recent[]).slice(0, 4);
  } catch {
    return [];
  }
}

/** The pages a typed name finds, a beat after typing stops. */
function useTabSearch(role: "gm" | "player", token: string, q: string) {
  const [settled, setSettled] = useState(q);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const load = useCallback(() => {
    const params = { q: settled, types: PAGE_TYPES, limit: 8 };
    return role === "gm" ? findApi.search(token, params) : findApi.searchAsPlayer(token, params);
  }, [role, token, settled]);
  return useCodexQuery(settled.trim() ? load : null, { failure: "The search could not be completed." });
}

/** The pages this reader can open, by link key, so a `[[link]]` in the tab opens its page in the tab. */
function useTabLinks(role: "gm" | "player", token: string, open: (page: Recent) => void) {
  const load = useCallback(
    () => (role === "gm" ? codexApi.listPages(token) : playerCodexApi.listPages(token)),
    [role, token]
  );
  const pages = useCodexQuery(load).data;
  return useMemo(() => {
    const byKey = new Map((pages ?? []).map((page) => [pageLinkKey(page.title), page]));
    return {
      known: new Set(byKey.keys()),
      follow: (target: string) => {
        const page = byKey.get(pageLinkKey(target));
        if (page) open({ id: page.id, title: page.title });
      }
    };
  }, [pages, open]);
}

/** A page's role line: its role or kind field, then where it is. */
function roleLine(type: CodexEntityType, fields: Readonly<Record<string, string>>): string {
  return [fields.role?.trim() || fields.kind?.trim() || entityDef(type).label, fields.location?.trim()]
    .filter(Boolean)
    .join(" · ");
}

/** The GM's compact page: who can open it, the fields only the GM sees, and each block with Reveal or Hide again. */
type TabLinks = ReturnType<typeof useTabLinks>;

function GmCompactPage({
  token,
  id,
  party,
  links
}: Readonly<{ token: string; id: string; party: readonly PartyCharacter[]; links: TabLinks }>) {
  const read = useCodexQuery(
    useCallback(() => pageRecordApi.get(token, id), [token, id]),
    { failure: "Couldn't load this page." }
  );
  const [page, setPage] = useState<CodexPage | null>(null);
  useEffect(() => {
    if (read.data) setPage(read.data.page);
  }, [read.data]);
  const [revealing, setRevealing] = useState<CodexBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!page) return read.error ? <Alert tone="danger">{read.error}</Alert> : <Skeleton variant="block" height="6rem" />;
  const setAudience = async (block: CodexBlock, next: Audience) => {
    setBusy(true);
    setError(null);
    try {
      setPage(
        await pageRecordApi.blocks.setAudience(token, id, block.id, {
          audience: next.audience,
          ...(next.audience === "characters" ? { characterIds: next.characterIds } : {})
        })
      );
      setRevealing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change who sees that block.");
    } finally {
      setBusy(false);
    }
  };
  const hiddenFields = entityDef(page.entityType).fields.filter(
    (field) => page.hiddenFields.includes(field.key) && (page.fields[field.key] ?? "").trim()
  );
  return (
    <div className="cx-tab-page">
      <div className="cx-tab-titlerow">
        <h3 className="cx-tab-title">{page.title}</h3>
        <AudienceChip value={page.revealedToPlayers ? EVERYONE : HIDDEN} party={party} />
      </div>
      <span className="cx-hint">{roleLine(page.entityType, page.fields)}</span>
      {error && <Alert tone="danger">{error}</Alert>}
      {hiddenFields.map((field) => (
        <div key={field.key} className="cx-meta-row is-hidden">
          <span className="cx-meta-key">{field.label} · Hidden</span>
          <span>{page.fields[field.key]}</span>
        </div>
      ))}
      {page.blocks.map((block) => (
        <HiddenBlock
          key={block.id}
          title={block.title}
          value={{ audience: block.audience, characterIds: block.characterIds }}
          party={party}
          since={sinceLabel(stampOf(block))}
          busy={busy}
          onReveal={() => setRevealing(block)}
          onHide={() => void setAudience(block, HIDDEN)}
        >
          <CodexMarkdown text={block.text} token={token} onNavigate={links.follow} knownTitles={links.known} />
        </HiddenBlock>
      ))}
      <Button size="sm" variant="ghost" onClick={() => void navigate(pagePath(id))}>
        Open the whole page
      </Button>
      {revealing && (
        <RevealPanel
          title={revealing.title}
          party={party}
          busy={busy}
          error={error}
          preview={<CodexMarkdown text={revealing.text} token={token} audience="player" />}
          onCancel={() => setRevealing(null)}
          onReveal={(next) => void setAudience(revealing, next)}
        />
      )}
    </div>
  );
}

/** A player's compact page: the blocks that reached them, the newest marked, and the way to the whole page. */
function PlayerCompactPage({ token, id, links }: Readonly<{ token: string; id: string; links: TabLinks }>) {
  const read = useCodexQuery(
    useCallback(() => pageRecordApi.getForPlayer(token, id), [token, id]),
    { failure: "Couldn't load this page." }
  );
  const page = read.data?.page;
  if (!page) return read.error ? <Alert tone="danger">{read.error}</Alert> : <Skeleton variant="block" height="6rem" />;
  const blocks = playerDocument(page.body, page.blocks).filter(
    (item): item is Extract<typeof item, { kind: "block" }> => item.kind === "block"
  );
  const newest = page.blocks.reduce<PlayerCodexBlock | null>(
    (latest, block) => (!latest || block.revealed.at > latest.revealed.at ? block : latest),
    null
  );
  return (
    <div className="cx-tab-page">
      <h3 className="cx-tab-title">{page.title}</h3>
      <span className="cx-hint">{roleLine(page.entityType, page.fields)}</span>
      {blocks.length === 0 && (
        <div className="cx-doc-text">
          <CodexMarkdown
            text={page.body}
            token={token}
            audience="player"
            onNavigate={links.follow}
            knownTitles={links.known}
          />
        </div>
      )}
      {blocks.map((item, index) => (
        <div key={index} className={cx("cx-doc-text", item.block === newest && "is-new")}>
          <CodexMarkdown
            text={item.text}
            token={token}
            audience="player"
            onNavigate={links.follow}
            knownTitles={links.known}
          />
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => void navigate(pagePath(id))}>
        Open the whole page
      </Button>
    </div>
  );
}

/**
 * The table's Codex tab: search the Codex without leaving the map, and read a page compactly. The GM gets Reveal on
 * each block; a player reads through their own projection, with the newest block that reached them marked.
 */
export function CodexTab({
  role,
  token,
  party = []
}: Readonly<{ role: "gm" | "player"; token: string; party?: readonly PartyCharacter[] }>) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(() => readRecent(role)[0]?.id ?? null);
  const [recent, setRecent] = useState<readonly Recent[]>(() => readRecent(role));
  const search = useTabSearch(role, token, q);
  const hits: readonly (CodexSearchHit | PlayerCodexSearchHit)[] = q.trim() ? (search.data?.hits ?? []) : [];
  const open = useCallback(
    (hit: Recent) => {
      setOpenId(hit.id);
      setQ("");
      setRecent((current) => {
        const next = [hit, ...current.filter((row) => row.id !== hit.id)].slice(0, 4);
        try {
          localStorage.setItem(`${RECENT_KEY}.${role}`, JSON.stringify(next));
        } catch {
          /* private mode: no recent pages */
        }
        return next;
      });
    },
    [role]
  );
  const links = useTabLinks(role, token, open);
  return (
    <div className="cx-tab scroll-y">
      <Input
        type="search"
        aria-label="Search the Codex"
        placeholder="Search the Codex"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      {q.trim() ? (
        <ul className="cx-tab-hits">
          {search.loading && hits.length === 0 && <Skeleton variant="text" />}
          {search.error && <Alert tone="danger">{search.error}</Alert>}
          {!search.loading && hits.length === 0 && !search.error && <li className="cx-hint">Nothing matches.</li>}
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <button
                type="button"
                className="cx-tab-hit"
                onClick={() =>
                  hit.kind === "page" ? open({ id: hit.id, title: hit.title }) : void navigate(pathForHit(hit))
                }
              >
                {hit.entityType && <EntityIcon type={hit.entityType} />}
                <span className="cx-tab-hit-text">
                  <b>{hit.title}</b>
                  {hit.match && <span className="cx-hint">{hit.match.line}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {recent.length > 0 && (
            <ul className="cx-meta-chips" aria-label="Recent pages">
              {recent.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={cx("cx-tag", "interactive", row.id === openId && "is-on")}
                    aria-current={row.id === openId ? "true" : undefined}
                    onClick={() => open(row)}
                  >
                    {row.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {openId ? (
            role === "gm" ? (
              <GmCompactPage key={openId} token={token} id={openId} party={party} links={links} />
            ) : (
              <PlayerCompactPage key={openId} token={token} id={openId} links={links} />
            )
          ) : (
            <p className="cx-hint">Search for a page to read it here, beside the map.</p>
          )}
        </>
      )}
    </div>
  );
}
