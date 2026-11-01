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
  Tabs,
  Skeleton,
  cx,
  sinceLabel,
  type Audience,
  TitleLine
} from "@vtt/ui";
import { pageLinkKey } from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { codexApi, standingApi } from "../api";
import { pageRecordApi } from "../api-records";
import type { CodexBlock, CodexPage, CodexPageConnection } from "@vtt/domain";
import { CodexMarkdown } from "../CodexMarkdown";
import { PageTimeline } from "../PageTimeline";
import { usePageLinks } from "../pageLinks";
import {
  atlasPath,
  journalEntryPath,
  pagePath,
  pathForSection,
  questPath,
  relationshipsPath,
  sessionPath
} from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex } from "../shell/context";
import { HiddenBlock } from "../shared/HiddenBlock";
import { RevealColumn, RevealPanel } from "../shared/RevealPanel";
import { linksSentence, stampOf } from "../shared/reveals";
import { useCodexQuery } from "../useCodexQuery";
import { gmDocument, kindGroupOf } from "./document";
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
  PageCrumb,
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
import { GmTagColumn, SideHead, useEscapeToFacts } from "./SideColumn";
import { StandingColumn } from "./StandingColumn";
import { standingLabel, standingValueLabel } from "../chronicle";
import { VersionBand, VersionsColumn, useVersions, versionLines } from "./VersionsColumn";
import { addedSince } from "./versions";
import "./page.css";

const PHONE_TABS = [
  { id: "overview", label: "Overview" },
  { id: "relations", label: "Relations" },
  { id: "mentions", label: "Mentions" }
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
  // Versions in the side column; `revisionId` is the version being read in the main column, null for now.
  const [versions, setVersions] = useState<Readonly<{ revisionId: number | null }> | null>(null);
  const history = useVersions(token, id, versions !== null);
  const [phoneTab, setPhoneTab] = useState("overview");
  // The side column's one open part. A tag is in the address, so the browser's Back closes it.
  const tag = query.get("tag");
  // A faction's standing is the side column's part named in the address (`?side=standing`), so the Factions grid can
  // open a faction's page on it.
  const standingOpen = query.get("side") === "standing";
  const openTag = (name: string) => {
    setRevealing(null);
    setVersions(null);
    go(`${pagePath(id)}?tag=${encodeURIComponent(name)}`);
  };
  const closeSide = useCallback(() => {
    setRevealing(null);
    setVersions(null);
    setQuery((params) => {
      params.delete("tag");
      params.delete("side");
    });
  }, [setQuery]);
  const openStanding = () => {
    setRevealing(null);
    setVersions(null);
    setQuery((params) => {
      params.delete("tag");
      params.set("side", "standing");
    });
  };
  // A reveal or the versions replace whatever part is open, a tag included.
  const openReveal = (block: CodexBlock) => {
    if (tag || standingOpen)
      setQuery((params) => {
        params.delete("tag");
        params.delete("side");
      });
    setVersions(null);
    setRevealing(block);
  };
  const openVersions = () => {
    if (tag || standingOpen)
      setQuery((params) => {
        params.delete("tag");
        params.delete("side");
      });
    setRevealing(null);
    setVersions({ revisionId: null });
  };
  useEscapeToFacts(tag !== null || revealing !== null || versions !== null || standingOpen, closeSide);
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
          title: "Hide this faction page?",
          body: "Players stop seeing your standing with them too, since a standing shows only while its faction page does.",
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
      title: `Delete "${page.title}"?`,
      body: "This cannot be undone.",
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
      // Restoring returns to now, with the versions still open beside it.
      setVersions({ revisionId: null });
      await read.reload();
      void history.reload();
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
      {/* The editor has no side column, so a reveal from it stays a dialog. */}
      {editing && revealing && (
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
          onRevealBlock={openReveal}
          onBlockAudience={(block, next) => void setAudience(block, next)}
          onOpenConnection={openConnection}
          onOpenPin={openPin}
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
      triggerClassName={cx("nh-aud", page.revealedToPlayers ? "is-everyone" : "is-hidden")}
      trigger={
        <>
          {page.revealedToPlayers ? <IconEye className="nh-aud-icon" /> : <IconEyeOff className="nh-aud-icon" />}
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
        className="nh-aud-item-hidden"
        onClick={() => page.revealedToPlayers && void setPageRevealed(false)}
      >
        Hide the page from players
      </MenuItem>
    </Menu>
  );
  const visibility = (
    <div className="cx-visline">
      <KindChip type={page.entityType} />
      {pageAudience}
      <VisibilityCounts blocks={page.blocks} hiddenFields={page.hiddenFields} fields={page.fields} party={party} />
    </div>
  );
  const more = (
    <Menu icon align="end" label="More" trigger={<IconMore />}>
      <MenuItem onClick={openVersions}>Version history</MenuItem>
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
          onReveal={() => openReveal(block)}
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

  // The version being read, what changed after each version, and the page now in a revision's shape.
  const now = { ...page, blocks: page.blocks };
  const lines = versionLines(history.revisions, now);
  const readingAt = versions?.revisionId ?? null;
  const reading = history.revisions.find((revision) => revision.id === readingAt) ?? null;
  const readingWhat = reading ? (lines[history.revisions.indexOf(reading)] ?? "Saved") : "";
  const versionDocument = reading && (
    <>
      {addedSince(reading, now).map((name) => (
        <p key={name} className="cx-version-added">{`Added since: ${name}`}</p>
      ))}
      {gmDocument(reading.playerBody, reading.blocks).map((item, index) =>
        item.kind === "text" ? (
          <DocText
            key={`v${index}`}
            text={item.text}
            token={token}
            audience="gm"
            onNavigate={followLink}
            knownTitles={knownTitles}
          />
        ) : (
          <section key={item.block.id} className="cx-version-block" aria-label={item.block.title ?? "A block"}>
            {item.block.title && <h3 className="cx-block-title">{item.block.title}</h3>}
            <CodexMarkdown text={item.block.text} token={token} knownTitles={knownTitles} />
          </section>
        )
      )}
    </>
  );

  const standingRow = feeds.campaign.standing.find((row) => row.factionPageId === id) ?? null;
  const isFaction = page.entityType === "faction";
  // The side column's open part: the standing, a reveal, the versions or a tag, else nothing (the facts).
  const sidePart =
    standingOpen && isFaction ? (
      <>
        <SideHead title="Standing toward the party" onBack={closeSide} />
        <StandingColumn
          // The standing arrives with the campaign feed; a new value starts the column again from it.
          key={`${standingRow?.id ?? "none"}:${standingRow?.value ?? 0}`}
          gmToken={token}
          factionPageId={id}
          standing={standingRow}
          onSaved={() => void feeds.campaignFeed.reload()}
          onClose={closeSide}
        />
      </>
    ) : versions ? (
      <>
        <SideHead title={`Versions · ${history.revisions.length}`} onBack={closeSide} />
        <VersionsColumn
          revisions={history.revisions}
          lines={lines}
          nowAt={page.updatedAt}
          line={history.line}
          chosen={readingAt}
          onChoose={(revisionId) => setVersions({ revisionId })}
          opened={
            phone && reading ? (
              <div className="cx-version-open">
                <VersionBand revision={reading} what={readingWhat} onRestore={() => void restore(reading.id)} />
                <div className="cx-doc">{versionDocument}</div>
              </div>
            ) : undefined
          }
        />
      </>
    ) : revealing ? (
      <>
        <SideHead title={`Reveal ${revealing.title?.trim() || "this block"}`} tone="hidden" onBack={closeSide} />
        <RevealColumn
          key={revealing.id}
          party={party}
          busy={busy}
          error={error}
          preview={<CodexMarkdown text={revealing.text} token={token} audience="player" knownTitles={knownTitles} />}
          links={linksSentence(revealing.text, feeds.pages)}
          onReveal={(next) => void setAudience(revealing, next)}
        />
      </>
    ) : tag ? (
      <>
        <SideHead onBack={closeSide} />
        <GmTagColumn tag={tag} />
      </>
    ) : null;

  const metaPanel = (
    <>
      {seeAs.on ? null : (
        <>
          {fields.length > 0 && (
            <MetaSection label="Facts">
              <FieldList fields={fields} />
            </MetaSection>
          )}
          {isFaction && (
            <MetaSection label="Standing">
              <button
                type="button"
                className="cx-standing-fact interactive"
                aria-label={`Change the standing: ${standingLabel(standingRow?.value ?? 0)} ${standingValueLabel(standingRow?.value ?? 0)}`}
                onClick={openStanding}
              >
                <b>{standingLabel(standingRow?.value ?? 0)}</b>
                <span className="cx-standing-n">{standingValueLabel(standingRow?.value ?? 0)}</span>
                <span className="cx-standing-change">Change</span>
              </button>
            </MetaSection>
          )}
          <MetaSection label="Relationships">
            <RelationshipList connections={connections} pageTitle={page.title} onOpen={openConnection} />
          </MetaSection>
          <OnTheAtlas token={token} pins={pins} onOpenPin={openPin} />
          <MentionedOn connections={connections} onOpen={openConnection} />
          <TagChips tags={page.tags} onPick={openTag} />
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
          back={{ label: kindGroupOf(page.entityType).label, onClick: () => go(groupPath(page.entityType)) }}
          actions={
            <>
              {seeAsControl}
              <IconButton label="Edit" size="sm" onClick={() => setEditing(true)}>
                <IconPencil />
              </IconButton>
              {/* More reaches Version history (the History tab) and the rest on a phone too. */}
              {more}
            </>
          }
        />
        {!seeAs.on && <PageMapHeader token={token} pins={pins} onOpenPin={openPin} />}
        <div className="cx-page-phonebody">
          {!seeAs.on && (
            <>
              <PhoneRecordHeader title={page.title}>{visibility}</PhoneRecordHeader>
              <Tabs
                ariaLabel="Page sections"
                tabs={
                  standingOpen && isFaction
                    ? [...PHONE_TABS, { id: "side", label: "Standing" }]
                    : versions
                      ? [...PHONE_TABS, { id: "side", label: "History" }]
                      : revealing
                        ? [...PHONE_TABS, { id: "side", label: "Reveal" }]
                        : tag
                          ? [...PHONE_TABS, { id: "side", label: `#${tag}` }]
                          : PHONE_TABS
                }
                activeId={sidePart ? "side" : phoneTab}
                onChange={(next) => {
                  if (next === "side") return;
                  if (sidePart) closeSide();
                  setPhoneTab(next);
                }}
                className="cx-phonetabs"
              />
            </>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {sidePart && !seeAs.on ? (
            sidePart
          ) : seeAs.on || phoneTab === "overview" ? (
            <>
              {!seeAs.on && fields.length > 0 && (
                <MetaSection label="Facts">
                  <FieldList fields={fields} />
                </MetaSection>
              )}
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
              <TagChips tags={page.tags} onPick={openTag} />
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
          <TitleLine className="cx-page-titlerow" crumb={<PageCrumb entityType={page.entityType} go={go} />}>
            <h1 className="cx-page-title">{page.title}</h1>
          </TitleLine>
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
          {reading && !seeAs.on ? (
            <>
              <VersionBand
                revision={reading}
                what={readingWhat}
                onRestore={() => void restore(reading.id)}
                onBack={() => setVersions({ revisionId: null })}
              />
              <article className="cx-doc is-version">{versionDocument}</article>
            </>
          ) : (
            <article className="cx-doc">{document}</article>
          )}
        </div>
        {!seeAs.on && (
          <aside className="cx-page-meta scroll-y" aria-label="About this page">
            {sidePart ?? metaPanel}
          </aside>
        )}
      </div>
      {overlays}
    </div>
  );
}
