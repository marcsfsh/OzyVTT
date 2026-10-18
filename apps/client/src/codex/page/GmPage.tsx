import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  IconButton,
  IconEye,
  IconEyeOff,
  IconMore,
  IconPencil,
  Menu,
  MenuItem,
  SegmentedControl,
  Skeleton,
  cx
} from "@vtt/ui";
import { pageLinkKey } from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { codexApi, standingApi } from "../api";
import { pageRecordApi } from "../api-records";
import type { CodexBlock, CodexPage, CodexPageConnection } from "@vtt/domain";
import { CodexMarkdown } from "../CodexMarkdown";
import { RevisionHistory } from "../RevisionHistory";
import { PageTimeline } from "../PageTimeline";
import { usePageLinks } from "../pageLinks";
import {
  atlasPath,
  journalEntryPath,
  pagePath,
  pathForSection,
  questPath,
  relationshipsPath,
  sessionPath,
  tagPath
} from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex } from "../shell/context";
import { HiddenBlock } from "../shared/HiddenBlock";
import { RevealPanel } from "../shared/RevealPanel";
import { linksSentence, stampOf } from "../shared/reveals";
import { sinceLabel, type Audience } from "../shared/audience";
import { useCodexQuery } from "../useCodexQuery";
import { gmDocument } from "./document";
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
  DocText,
  KindChip,
  MetaSection,
  PageCrumbs,
  PageMapHeader,
  PhoneRecordHeader,
  VisibilityCounts,
  groupPath,
  usePagePins
} from "./pageParts";
import { GmRevealTimeline } from "./RevealTimeline";
import { PlayerPageBody } from "./PlayerPage";
import { SeeAsControl, usePreviewToken, type SeeAsViewer } from "./SeeAs";
import { PageWriter } from "./PageWriter";
import "./page.css";

const PHONE_TABS = [
  { value: "overview", label: "Overview" },
  { value: "relations", label: "Relations" },
  { value: "mentions", label: "Mentions" }
];

/** The audience a block has now, in the shared pieces' shape. */
const audienceOf = (block: Pick<CodexBlock, "audience" | "characterIds">): Audience => ({
  audience: block.audience,
  characterIds: block.characterIds
});

/**
 * The GM's page: one document with its hidden blocks where they belong, the metadata beside it and the Timeline at
 * its end. Edit switches the same address into the editor (`?mode=edit`); See as players swaps the document for
 * exactly what Everyone or one character's player receives.
 */
export function GmPage({ id }: Readonly<{ id: string }>) {
  const { token, query, setQuery, go, phone } = useCodexShell();
  const gm = useGmCodex();
  const { party, feeds } = gm;
  const { confirm, dialog } = useConfirm();
  const read = useCodexQuery(
    useCallback(() => pageRecordApi.get(token, id), [token, id]),
    { failure: "Couldn't load this page." }
  );
  const [page, setPage] = useState<CodexPage | null>(null);
  useEffect(() => {
    if (read.data) setPage(read.data.page);
  }, [read.data]);
  const connections = read.data?.connections ?? [];

  const editing = query.get("mode") === "edit";
  const focusBlockId = query.get("block");
  const [seeAs, setSeeAs] = useState<{ on: boolean; viewer: SeeAsViewer }>({
    on: false,
    viewer: { characterId: null }
  });
  const preview = usePreviewToken(token, seeAs.on && !editing, seeAs.viewer);
  const [revealing, setRevealing] = useState<CodexBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState("overview");
  const pins = usePagePins("gm", token, id);
  const followLink = usePageLinks(feeds.pages, gm.quickCreate);
  const knownTitles = useMemo(() => new Set(feeds.pages.map((summary) => pageLinkKey(summary.title))), [feeds.pages]);

  // A block named in the address (from the table or a clue) scrolls into view once the page is there.
  const docRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusBlockId || !page) return;
    docRef.current?.querySelector(`[data-block="${focusBlockId}"]`)?.scrollIntoView({ block: "center" });
  }, [focusBlockId, page]);

  const setEditing = (on: boolean) =>
    setQuery((params) => {
      if (on) params.set("mode", "edit");
      else params.delete("mode");
    });

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

  const setPageRevealed = async (revealed: boolean) => {
    setError(null);
    // A standing is shown only while its faction page is, so hiding the page hides the standing too: ask first.
    if (!revealed && page?.entityType === "faction") {
      const standing = await standingApi.list(token).catch(() => []);
      const shown = standing.some((row) => row.factionPageId === id && row.revealedToPlayers);
      if (
        shown &&
        !(await confirm({
          title: "Hide this faction page",
          body: "Your standing with them stops being shown to players as well. A standing is only shown while its faction page is.",
          confirmLabel: "Hide page"
        }))
      )
        return;
    }
    try {
      await codexApi.revealPage(token, id, revealed);
      await read.reload();
      void feeds.list.reload();
    } catch {
      setError("Couldn't change who can open this page.");
    }
  };

  const remove = async () => {
    if (!page) return;
    const ok = await confirm({
      title: "Delete page",
      body: `Delete "${page.title}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    try {
      await codexApi.deletePage(token, id);
      void feeds.list.reload();
      go(groupPath(page.entityType));
    } catch {
      setError("Couldn't delete that page.");
    }
  };

  const restore = async (revisionId: number) => {
    try {
      await codexApi.restoreRevision(token, id, revisionId);
      setHistoryOpen(false);
      await read.reload();
    } catch {
      setError("Couldn't restore that version.");
    }
  };

  const openConnection = (kind: AnyPageConnection["otherKind"], otherId: string) =>
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

  if (read.error && !page)
    return (
      <div className="cx-page-missing" role="status">
        <p>{read.error}</p>
        <Button size="sm" onClick={() => go(pathForSection("pages"))}>
          Go to Pages
        </Button>
      </div>
    );
  if (!page)
    return (
      <div className="cx-page-loading">
        <Skeleton variant="text" />
        <Skeleton variant="block" height="12rem" />
      </div>
    );

  const overlays = (
    <>
      {revealing && (
        <RevealPanel
          title={revealing.title}
          party={party}
          busy={busy}
          error={error}
          preview={<CodexMarkdown text={revealing.text} token={token} audience="player" knownTitles={knownTitles} />}
          links={linksSentence(revealing.text, feeds.pages)}
          onCancel={() => setRevealing(null)}
          onReveal={(next) => void setAudience(revealing, next)}
        />
      )}
      {historyOpen && (
        <RevisionHistory
          gmToken={token}
          pageId={id}
          onRestore={(revisionId) => void restore(revisionId)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {dialog}
    </>
  );

  if (editing)
    return (
      <>
        <PageWriter
          page={page}
          connections={connections as readonly CodexPageConnection[]}
          onSaved={(next) => {
            setPage(next);
            feeds.onPageChanged(next as never);
          }}
          onConnectionsChanged={() => void read.reload()}
          onDone={() => {
            setEditing(false);
            void read.reload();
          }}
          onReloadPage={() => read.reload()}
          onRevealBlock={(block) => setRevealing(block)}
          onBlockAudience={(block, next) => void setAudience(block, next)}
          onOpenConnection={openConnection}
        />
        {overlays}
      </>
    );

  const fields = metaFields(page.entityType, page.fields, page.hiddenFields);
  const items = gmDocument(page.playerBody, page.blocks);
  const viewerName = seeAs.viewer.characterId
    ? (party.find((character) => character.id === seeAs.viewer.characterId)?.name ?? "a character")
    : null;
  const seeAsControl = (
    <SeeAsControl
      compact={phone}
      on={seeAs.on}
      viewer={seeAs.viewer}
      party={party}
      onChange={(on, viewer) => setSeeAs({ on, viewer })}
    />
  );
  const pageAudience = (
    <Menu
      label={`Who can open this page: ${page.revealedToPlayers ? "Everyone" : "Hidden"}`}
      triggerClassName={cx("cx-aud", page.revealedToPlayers ? "is-everyone" : "is-hidden")}
      trigger={
        <>
          {page.revealedToPlayers ? <IconEye className="cx-aud-icon" /> : <IconEyeOff className="cx-aud-icon" />}
          {page.revealedToPlayers ? "Revealed to everyone" : "Hidden"}
        </>
      }
    >
      <MenuItem
        role="menuitemradio"
        aria-checked={page.revealedToPlayers}
        icon={<IconEye />}
        onClick={() => !page.revealedToPlayers && void setPageRevealed(true)}
      >
        Reveal the page to everyone
      </MenuItem>
      <MenuItem
        role="menuitemradio"
        aria-checked={!page.revealedToPlayers}
        icon={<IconEyeOff />}
        className="cx-aud-item-hidden"
        onClick={() => page.revealedToPlayers && void setPageRevealed(false)}
      >
        Hide the page from players
      </MenuItem>
    </Menu>
  );
  const visibility = (
    <div className="cx-visline">
      {pageAudience}
      <VisibilityCounts blocks={page.blocks} hiddenFields={page.hiddenFields} fields={page.fields} party={party} />
    </div>
  );
  const more = (
    <Menu icon align="end" label="More" trigger={<IconMore />}>
      <MenuItem onClick={() => setHistoryOpen(true)}>Version history</MenuItem>
      <MenuItem onClick={() => go(relationshipsPath(id))}>Show in Relationships</MenuItem>
      <MenuItem tone="danger" onClick={() => void remove()}>
        Delete page
      </MenuItem>
    </Menu>
  );

  const blockView = (block: CodexBlock) => {
    const stamp = stampOf(block);
    return (
      <div key={block.id} data-block={block.id}>
        <HiddenBlock
          title={block.title}
          value={audienceOf(block)}
          party={party}
          since={sinceLabel(stamp)}
          focus={focusBlockId === block.id}
          busy={busy}
          menu={phone}
          onAudienceChange={(next) => void setAudience(block, next)}
          onReveal={() => setRevealing(block)}
          onHide={() => void setAudience(block, { audience: "hidden", characterIds: [] })}
        >
          <CodexMarkdown
            text={block.text}
            token={token}
            onNavigate={followLink}
            knownTitles={knownTitles}
            onCreate={followLink}
          />
        </HiddenBlock>
      </div>
    );
  };

  const document = seeAs.on ? (
    <PlayerPageBody
      key={preview.token ?? "waiting"}
      token={preview.token}
      tokenError={preview.error}
      pageId={id}
      viewerName={viewerName}
      phone={phone}
      onOpenConnection={openConnection}
      onOpenPin={openPin}
    />
  ) : (
    <>
      {items.map((item, index) =>
        item.kind === "text" ? (
          <DocText
            key={`t${index}`}
            text={item.text}
            token={token}
            audience="gm"
            onNavigate={followLink}
            knownTitles={knownTitles}
          />
        ) : (
          blockView(item.block)
        )
      )}
      {items.length === 0 && <p className="cx-hint">Nothing is written on this page yet. Press Edit to write it.</p>}
      <GmRevealTimeline
        firstShownAt={page.firstShownAt}
        blocks={page.blocks}
        hiddenFields={page.hiddenFields}
        fields={page.fields}
        entityType={page.entityType}
        party={party}
      />
    </>
  );

  const metaPanel = (
    <>
      {seeAs.on ? null : (
        <>
          <FieldList fields={fields} />
          <MetaSection label="Relationships">
            <RelationshipList connections={connections} pageTitle={page.title} onOpen={openConnection} />
          </MetaSection>
          <OnTheAtlas token={token} pins={pins} onOpenPin={openPin} />
          <MentionedOn connections={connections} onOpen={openConnection} />
          <TagChips tags={page.tags} onPick={(tag) => go(tagPath(tag))} />
          <PageTimeline
            gmToken={token}
            pageId={id}
            onOpenReplay={gm.onOpenReplay}
            onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
          />
        </>
      )}
    </>
  );

  if (phone)
    return (
      <div className="cx-page is-phone scroll-y" ref={docRef}>
        <CodexPhoneBar
          title={page.title}
          onBack={() => go(groupPath(page.entityType))}
          actions={
            <>
              {seeAsControl}
              <IconButton label="Edit" size="sm" onClick={() => setEditing(true)}>
                <IconPencil />
              </IconButton>
            </>
          }
        />
        {!seeAs.on && <PageMapHeader token={token} pins={pins} onOpenPin={openPin} />}
        <div className="cx-page-phonebody">
          {!seeAs.on && (
            <>
              <PhoneRecordHeader title={page.title} entityType={page.entityType} fields={page.fields} />
              {visibility}
              <SegmentedControl
                ariaLabel="Page sections"
                size="sm"
                options={PHONE_TABS}
                value={phoneTab}
                onChange={setPhoneTab}
                className="cx-phonetabs"
              />
            </>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {seeAs.on || phoneTab === "overview" ? (
            <>
              {!seeAs.on && <FieldList fields={fields} />}
              <div className="cx-doc">{document}</div>
              {!seeAs.on && (
                <MetaSection label="Relationships">
                  <RelationshipList connections={connections} pageTitle={page.title} onOpen={openConnection} />
                </MetaSection>
              )}
            </>
          ) : phoneTab === "relations" ? (
            <>
              <RelationshipList connections={connections} pageTitle={page.title} onOpen={openConnection} />
              <OnTheAtlas token={token} pins={pins} onOpenPin={openPin} />
            </>
          ) : (
            <>
              <MentionedOn connections={connections} onOpen={openConnection} />
              <TagChips tags={page.tags} onPick={(tag) => go(tagPath(tag))} />
              <PageTimeline
                gmToken={token}
                pageId={id}
                onOpenReplay={gm.onOpenReplay}
                onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
              />
            </>
          )}
        </div>
        {overlays}
      </div>
    );

  return (
    <div className="cx-page">
      <header className="cx-page-head">
        <div className="cx-page-headmain">
          <PageCrumbs title={page.title} entityType={page.entityType} go={go} />
          <div className="cx-page-titlerow">
            <h1 className="cx-page-title">{page.title}</h1>
            <KindChip type={page.entityType} />
          </div>
          {visibility}
        </div>
        <div className="cx-page-actions">
          {seeAsControl}
          <Button size="sm" onClick={() => setEditing(true)}>
            <IconPencil /> Edit
          </Button>
          {more}
        </div>
      </header>
      {error && (
        <div className="cx-page-notice">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="cx-page-cols">
        <div className="cx-page-docscroll scroll-y" ref={docRef}>
          {seeAs.on && (
            <p className="cx-seeas-banner" role="status">
              {viewerName
                ? `You are reading this page as ${viewerName}'s player reads it.`
                : "You are reading this page as a player with no character reads it."}
            </p>
          )}
          <article className="cx-doc">{document}</article>
        </div>
        {!seeAs.on && (
          <aside className="cx-page-meta scroll-y" aria-label="About this page">
            {metaPanel}
          </aside>
        )}
      </div>
      {overlays}
    </div>
  );
}
