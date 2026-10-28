import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, IconSparkle, Skeleton, canMove, comet, cx, fadeIn, useOnChange, wash } from "@vtt/ui";
import { pageLinkKey } from "@vtt/domain";
import { playerCodexApi } from "../api";
import { pageRecordApi } from "../api-records";
import type { PlayerCodexBlock } from "@vtt/domain";
import { CodexMarkdown } from "../CodexMarkdown";
import { atlasPath, journalEntryPath, pagePath, questPath, sessionPath, tagPath } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { PlayerCodexContext, useCodexShell, usePlayerCodex } from "../shell/context";
import { useCodexQuery } from "../useCodexQuery";
import { playerDocument } from "./document";
import {
  FieldList,
  MentionedOn,
  OnTheAtlas,
  RelationshipList,
  TagChips,
  metaFields,
  type AnyPageConnection
} from "./MetaPanel";
import {
  KindChip,
  MetaSection,
  PageCrumbs,
  PageMapHeader,
  PhoneRecordHeader,
  groupPath,
  usePagePins
} from "./pageParts";
import { PlayerRevealTimeline } from "./RevealTimeline";
import "./page.css";

const READ_KEY = "codex-page-read";

/** When this device last read each page, so a block revealed since is marked New. Per viewer and per device. */
function readTimes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function markRead(pageId: string, at: string) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify({ ...readTimes(), [pageId]: at }));
  } catch {
    /* private mode: nothing is marked New next time */
  }
}

type Open = (kind: AnyPageConnection["otherKind"], id: string) => void;

/** How a revealed block is known on the player's side: when it first reached them, and its title. */
const blockKey = (block: PlayerCodexBlock) => `${block.revealed.at}|${block.title ?? ""}`;

/**
 * A page as one viewer receives it: the assembled body with the blocks that reached them read as ordinary text, the
 * fields and relationships they may read, and their Timeline. Nothing on it says another viewer reads more. The GM's
 * See as players mounts this too, on a preview token.
 */
export function PlayerPageBody({
  token,
  tokenError = null,
  pageId,
  viewerName,
  phone,
  newSince = null,
  onOpenConnection,
  onOpenPin,
  onLoaded
}: Readonly<{
  /** Null while the GM's preview token is on its way. */
  token: string | null;
  tokenError?: string | null;
  pageId: string;
  /** In the GM's preview, whose player this is; null reads as Everyone. */
  viewerName?: string | null;
  phone: boolean;
  /** Blocks that reached the reader after this time are marked New. */
  newSince?: string | null;
  onOpenConnection: Open;
  onOpenPin: (markerId: string, mapId: string) => void;
  onLoaded?: (page: Readonly<{ title: string; blocks: readonly PlayerCodexBlock[] }>) => void;
}>) {
  const load = useCallback(() => pageRecordApi.getForPlayer(token ?? "", pageId), [token, pageId]);
  const read = useCodexQuery(token ? load : null, { failure: "Couldn't load this page." });
  const pins = usePagePins("player", token, pageId);
  const page = read.data?.page ?? null;
  useEffect(() => {
    if (page) onLoaded?.(page);
  }, [page, onLoaded]);
  const followLink = useFollowPlayerLink(token);
  const { go } = useCodexShell();
  // A block the GM reveals while the page is open arrives under a comet along its top, a wash falls on it and it
  // brightens once (ADR-0045). Blocks reach a player with no id, so one is known by when it reached them and its title.
  const docRef = useRef<HTMLElement>(null);
  const keys = page ? `${pageId}\n${page.blocks.map(blockKey).join("\n")}` : null;
  useOnChange(keys, (before, now) => {
    const doc = docRef.current;
    if (!before || !now || !doc || !canMove()) return;
    const [wasPage, ...was] = before.split("\n");
    const [nowPage, ...shown] = now.split("\n");
    if (wasPage !== nowPage) return;
    for (const key of shown) {
      if (was.includes(key)) continue;
      const block = doc.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(key)}"]`);
      if (!block) continue;
      fadeIn(block, { dur: 240 });
      comet(block, { from: 0, to: block.clientWidth, line: 0, thick: 3, delay: 0, dur: 260 });
      wash(block, { at: block.clientWidth / 2, h: block.clientHeight, delay: 200 });
      block.animate(
        [{ filter: "brightness(1)" }, { offset: 0.4, filter: "brightness(1.25)" }, { filter: "brightness(1)" }],
        { duration: 460 }
      );
    }
  });

  if (tokenError) return <Alert tone="danger">{tokenError}</Alert>;
  if (!token || (read.loading && !page)) return <Skeleton variant="block" height="10rem" />;
  if (!page)
    return (
      <p className="cx-hint" role="status">
        {viewerName === undefined
          ? read.error
          : `${viewerName ? `${viewerName}'s player` : "A player"} can't open this page. It is Hidden.`}
      </p>
    );
  const connections = read.data?.connections ?? [];
  const items = playerDocument(page.body, page.blocks);
  const isNew = (block: PlayerCodexBlock) => newSince !== null && block.revealed.at > newSince;

  const doc = (
    <article ref={docRef} className="cx-doc">
      {items.map((item, index) =>
        item.kind === "text" ? (
          <div key={index} className="cx-doc-text">
            <CodexMarkdown
              text={item.text}
              token={token}
              audience="player"
              onNavigate={followLink.go}
              knownTitles={followLink.known}
            />
          </div>
        ) : (
          <div
            key={index}
            data-block-key={blockKey(item.block)}
            className={cx("cx-doc-text", isNew(item.block) && "is-new")}
          >
            <CodexMarkdown
              text={item.text}
              token={token}
              audience="player"
              onNavigate={followLink.go}
              knownTitles={followLink.known}
            />
          </div>
        )
      )}
      <PlayerRevealTimeline firstShownAt={page.firstShownAt} blocks={page.blocks} />
    </article>
  );
  const fields = metaFields(page.entityType, page.fields);
  const meta = (
    <>
      <FieldList fields={fields} />
      <MetaSection label="Relationships">
        <RelationshipList connections={connections} pageTitle={page.title} onOpen={onOpenConnection} />
      </MetaSection>
      <OnTheAtlas token={token} pins={pins} onOpenPin={onOpenPin} />
      <MentionedOn connections={connections} onOpen={onOpenConnection} />
      <TagChips tags={page.tags} onPick={(tag) => go(tagPath(tag))} />
    </>
  );
  if (phone)
    return (
      <>
        <PageMapHeader token={token} pins={pins} onOpenPin={onOpenPin} />
        <div className="cx-page-phonebody">
          <PhoneRecordHeader title={page.title} entityType={page.entityType} fields={page.fields} />
          <FieldList fields={fields} />
          {doc}
          <MetaSection label="Relationships">
            <RelationshipList connections={connections} pageTitle={page.title} onOpen={onOpenConnection} />
          </MetaSection>
          <MentionedOn connections={connections} onOpen={onOpenConnection} />
          <TagChips tags={page.tags} onPick={(tag) => go(tagPath(tag))} />
        </div>
      </>
    );
  return (
    <div className="cx-page-cols is-player">
      <div className="cx-page-docscroll scroll-y">{doc}</div>
      <aside className="cx-page-meta scroll-y" aria-label="About this page">
        {meta}
      </aside>
    </div>
  );
}

/** A `[[link]]` in a player's text opens the page of that title, when the reader can open one. */
function useFollowPlayerLink(token: string | null) {
  const { go } = useCodexShell();
  const pages = usePlayerCodexPages(token);
  const known = useMemo(() => new Set(pages.map((summary) => pageLinkKey(summary.title))), [pages]);
  const followLink = useCallback(
    (target: string) => {
      const match = pages.find((candidate) => pageLinkKey(candidate.title) === pageLinkKey(target));
      if (match) go(pagePath(match.id));
    },
    [pages, go]
  );
  return { go: followLink, known };
}

/** The pages this reader can open: the player shell's feed, or for the GM's preview its own token's list. */
function usePlayerCodexPages(token: string | null) {
  const player = useContext(PlayerCodexContext);
  const loadPreview = useCallback(() => playerCodexApi.listPages(token ?? ""), [token]);
  const preview = useCodexQuery(!player && token ? loadPreview : null);
  return (player ? player.feeds.pages : preview.data) ?? [];
}

/** The player's page: crumbs, title and kind over the body, with what is new since this device last read it. */
export function PlayerPage({ id }: Readonly<{ id: string }>) {
  const { token, phone, go, embedded } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const summary = feeds.pages.find((candidate) => candidate.id === id) ?? null;
  const [since] = useState(() => readTimes()[id] ?? null);
  const [newTitles, setNewTitles] = useState<readonly string[]>([]);
  const onLoaded = useCallback(
    (page: Readonly<{ title: string; blocks: readonly PlayerCodexBlock[] }>) => {
      if (since)
        setNewTitles(
          page.blocks.filter((block) => block.revealed.at > since).map((block) => block.title?.trim() || "a block")
        );
      // The preview reads as a player but is the GM's: it never marks anything read.
      if (!embedded) markRead(id, new Date().toISOString());
    },
    [since, id, embedded]
  );
  const open: Open = (kind, otherId) =>
    go(
      kind === "page"
        ? pagePath(otherId)
        : kind === "quest"
          ? questPath(otherId)
          : kind === "session"
            ? sessionPath(otherId)
            : journalEntryPath(otherId)
    );
  const openPin = (markerId: string, mapId: string) => go(atlasPath(mapId, markerId));
  const banner = newTitles.length > 0 && (
    <p className="cx-newbanner" role="status">
      <IconSparkle /> New on this page since you last read it: {newTitles.join(", ")}
    </p>
  );
  const body = (
    <PlayerPageBody
      token={token}
      pageId={id}
      phone={phone}
      newSince={since}
      onOpenConnection={open}
      onOpenPin={openPin}
      onLoaded={onLoaded}
    />
  );
  if (phone)
    return (
      <div className="cx-page is-phone scroll-y">
        <CodexPhoneBar
          title={summary?.title ?? "Page"}
          onBack={() => go(summary ? groupPath(summary.entityType) : "/codex/pages")}
        />
        {banner}
        {body}
      </div>
    );
  return (
    <div className="cx-page">
      {banner}
      {summary && (
        <header className="cx-page-head">
          <div className="cx-page-headmain">
            <PageCrumbs title={summary.title} entityType={summary.entityType} go={go} />
            <div className="cx-page-titlerow">
              <h1 className="cx-page-title">{summary.title}</h1>
              <KindChip type={summary.entityType} />
            </div>
          </div>
        </header>
      )}
      {body}
    </div>
  );
}
