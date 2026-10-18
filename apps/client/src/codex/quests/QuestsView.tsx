import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Eyebrow,
  IconButton,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconMore,
  IconPencil,
  IconPlus,
  Input,
  Menu,
  MenuItem,
  Skeleton,
  cx
} from "@vtt/ui";
import { pageLinkKey, type CodexQuestStatus } from "@vtt/domain";
import { playerCodexApi, questApi } from "../api";
import { questRecordApi } from "../api-records";
import type { CodexBlock, CodexQuest, CodexQuestObjective, PlayerCodexQuest } from "@vtt/domain";
import { CodexMarkdown } from "../CodexMarkdown";
import { EntityIcon } from "../icons";
import { usePageLinks } from "../pageLinks";
import { QUEST_STATUS_LABEL, questProgress } from "../quests";
import { pagePath, pathForSection, questPath } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex, usePlayerCodex } from "../shell/context";
import { FilterChips, FilterFlyout, FiltersButton } from "../shared/FilterFlyout";
import { HiddenBlock } from "../shared/HiddenBlock";
import { RevealPanel } from "../shared/RevealPanel";
import { WhoSeesItMenu } from "../shared/WhoSeesIt";
import { HIDDEN, sinceLabel, type Audience } from "../shared/audience";
import { createQuest } from "../creates";
import { useCodexQuery } from "../useCodexQuery";
import { useConfirm } from "../../components/feedback";
import { gmDocument, playerDocument } from "../page/document";
import { DocText } from "../page/pageParts";
import { linksSentence, stampOf } from "../shared/reveals";
import { SeeAsControl, usePreviewToken, type SeeAsViewer } from "../page/SeeAs";
import { QuestWriter } from "./QuestWriter";
import "../page/page.css";
import "./quests.css";

const FLYOUT_ID = "cx-quest-filters";
const STATUS_CHIPS = [
  { value: "active", label: "Active" },
  { value: "not-started", label: "Not started" },
  { value: "done", label: "Done" }
];
const STATUS_GROUP: Readonly<Record<CodexQuestStatus, string>> = {
  active: "active",
  "not-started": "not-started",
  completed: "done",
  failed: "done",
  canceled: "done"
};

type ListQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  objectives: readonly Readonly<{ done: boolean }>[];
  revealedToPlayers?: boolean;
}>;

/** The progress pips and words for a quest's objectives. */
function Progress({
  objectives,
  status
}: Readonly<{ objectives: readonly Readonly<{ done: boolean }>[]; status: CodexQuestStatus }>) {
  const progress = questProgress(objectives);
  return (
    <span className="cx-progress">
      {objectives.map((objective, index) => (
        <i key={index} className={objective.done ? "is-on" : undefined} />
      ))}
      <span>
        {status === "not-started" ? "Not started" : status === "active" ? progress.label : QUEST_STATUS_LABEL[status]}
      </span>
    </span>
  );
}

/** The quest list as the filter flyout holds it: a filter box, the status chips and, for the GM, Who sees it. */
function QuestList({
  quests,
  openId,
  gm,
  go,
  onPicked
}: Readonly<{
  quests: readonly ListQuest[];
  openId: string | null;
  gm: boolean;
  go: (path: string) => void;
  onPicked?: () => void;
}>) {
  const { query, setFilter } = useCodexShell();
  // "none" is no status chosen, which lists every quest. A quest's own status (an older address) reads as its group.
  const statuses = (query.get("status") ?? "active")
    .split(",")
    .filter((value) => value && value !== "none")
    .map((value) => STATUS_GROUP[value as CodexQuestStatus] ?? value);
  const audiences = (query.get("who") ?? "").split(",").filter(Boolean);
  const [text, setText] = useState("");
  const listed = quests.filter(
    (quest) =>
      (statuses.length === 0 || statuses.includes(STATUS_GROUP[quest.status])) &&
      (audiences.length === 0 ||
        (audiences.includes("everyone") && quest.revealedToPlayers) ||
        (audiences.includes("hidden") && quest.revealedToPlayers === false)) &&
      (!text.trim() || quest.title.toLowerCase().includes(text.trim().toLowerCase()))
  );
  return (
    <>
      <Input
        type="search"
        aria-label="Filter quests"
        placeholder="Filter quests"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Eyebrow>Status</Eyebrow>
      <FilterChips
        label="Status"
        options={STATUS_CHIPS}
        selected={statuses}
        onChange={(next) => setFilter({ status: next.join(",") || "none" })}
      />
      {gm && (
        <>
          <Eyebrow>Who sees it</Eyebrow>
          <FilterChips
            label="Who sees it"
            options={[
              { value: "everyone", label: "Everyone" },
              { value: "hidden", label: "Hidden" }
            ]}
            selected={audiences}
            onChange={(next) => setFilter({ who: next.join(",") || null })}
          />
        </>
      )}
      <Eyebrow>
        {listed.length} {listed.length === 1 ? "quest" : "quests"}
      </Eyebrow>
      <ul className="cx-questlist">
        {listed.map((quest) => (
          <li key={quest.id}>
            <button
              type="button"
              className={cx("cx-questrow", quest.id === openId && "is-on")}
              aria-current={quest.id === openId ? "true" : undefined}
              onClick={() => {
                go(questPath(quest.id));
                onPicked?.();
              }}
            >
              <span className="cx-questrow-text">
                <b>{quest.title}</b>
                <Progress objectives={quest.objectives} status={quest.status} />
              </span>
              {gm && quest.revealedToPlayers === false && (
                <span className="cx-meta-hidden">
                  <IconEyeOff />
                  Hidden
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** What the list shows, in words: "Active quests", or "Every quest" with no status chosen. */
function statusSummary(status: string | null): string {
  const chosen = [
    ...new Set(
      (status ?? "active")
        .split(",")
        .filter((value) => value !== "none" && value)
        .map((value) => STATUS_GROUP[value as CodexQuestStatus] ?? value)
    )
  ];
  if (chosen.length === 0 || chosen.length === STATUS_CHIPS.length) return "Every quest";
  return `${chosen.map((value) => STATUS_CHIPS.find((chip) => chip.value === value)?.label ?? value).join(" and ")} quests`;
}

/** The flyout and the toolbar that opens it, shared by both roles. */
function useQuestFlyout(defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);
  return { open, setOpen };
}

/** A quest's linked pages and its numbers, beside the quest. */
function QuestMeta({
  status,
  objectives,
  entityIds,
  pages,
  go
}: Readonly<{
  status: CodexQuestStatus;
  objectives: readonly Readonly<{ done: boolean }>[];
  entityIds: readonly string[];
  pages: ReadonlyArray<Readonly<{ id: string; title: string; entityType: never | string }>>;
  go: (path: string) => void;
}>) {
  const linked = entityIds
    .map((id) => pages.find((page) => page.id === id))
    .filter((page): page is NonNullable<typeof page> => Boolean(page));
  return (
    <>
      <dl className="cx-meta-fields">
        <div className="cx-meta-row">
          <dt className="cx-meta-key">Status</dt>
          <dd>{QUEST_STATUS_LABEL[status]}</dd>
        </div>
        <div className="cx-meta-row">
          <dt className="cx-meta-key">Progress</dt>
          <dd>{questProgress(objectives).label}</dd>
        </div>
      </dl>
      <section className="cx-meta-section" aria-label="Linked pages">
        <Eyebrow>Linked pages</Eyebrow>
        {linked.length === 0 ? (
          <p className="cx-hint">No pages are linked to this quest.</p>
        ) : (
          linked.map((page) => (
            <button key={page.id} type="button" className="cx-meta-link" onClick={() => go(pagePath(page.id))}>
              <EntityIcon type={page.entityType as never} />
              <span className="cx-meta-link-title">{page.title}</span>
            </button>
          ))
        )}
      </section>
    </>
  );
}

const audienceOf = (row: Readonly<{ audience: Audience["audience"]; characterIds: readonly string[] }>): Audience => ({
  audience: row.audience,
  characterIds: row.characterIds
});

/**
 * The GM's quest: status, the text with its hidden blocks, the objectives each with a check and Who sees it, and
 * the linked pages beside it. Ticking an objective and setting who sees it are their own writes.
 */
function GmQuest({ id }: Readonly<{ id: string }>) {
  const { token, phone, go, query, setQuery } = useCodexShell();
  const gm = useGmCodex();
  const { party, feeds } = gm;
  const read = useCodexQuery(
    useCallback(() => questRecordApi.get(token, id), [token, id]),
    {
      failure: "Couldn't load this quest."
    }
  );
  const [quest, setQuest] = useState<CodexQuest | null>(null);
  useEffect(() => {
    if (read.data) setQuest(read.data);
  }, [read.data]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState<CodexBlock | null>(null);
  const [newObjective, setNewObjective] = useState("");
  const [seeAs, setSeeAs] = useState<{ on: boolean; viewer: SeeAsViewer }>({
    on: false,
    viewer: { characterId: null }
  });
  const preview = usePreviewToken(token, seeAs.on, seeAs.viewer);
  const followLink = usePageLinks(feeds.pages, gm.quickCreate);
  const knownTitles = useMemo(() => new Set(feeds.pages.map((page) => pageLinkKey(page.title))), [feeds.pages]);
  const editing = query.get("mode") === "edit";
  const { confirm, dialog } = useConfirm();

  const run = async (write: () => Promise<CodexQuest>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      setQuest(await write());
      void feeds.questFeed.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!quest) return;
    const ok = await confirm({
      title: "Delete quest",
      body: `Delete "${quest.title}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    try {
      await questApi.remove(token, id);
      void feeds.questFeed.reload();
      go(pathForSection("quests"));
    } catch {
      setError("Couldn't delete that quest.");
    }
  };
  const objectivesWrite = (objectives: readonly CodexQuestObjective[], extra?: Readonly<{ text: string }>) =>
    questRecordApi.update(token, id, {
      objectives: [
        ...objectives.map((objective) => ({ id: objective.id, text: objective.text, done: objective.done })),
        ...(extra ? [{ text: extra.text, done: false, audience: "everyone" as const }] : [])
      ],
      expectedRev: quest?.rev
    });

  if (!quest)
    return read.error ? (
      <div className="cx-page-missing" role="status">
        <p>{read.error}</p>
      </div>
    ) : (
      <div className="cx-page-loading">
        <Skeleton variant="block" height="10rem" />
      </div>
    );

  const setBlockAudience = (block: CodexBlock, next: Audience) =>
    run(async () => {
      const updated = await questRecordApi.blocks.setAudience(token, id, block.id, {
        audience: next.audience,
        ...(next.audience === "characters" ? { characterIds: next.characterIds } : {})
      });
      setRevealing(null);
      return updated;
    }, "Couldn't change who sees that block.");
  const progress = questProgress(quest.objectives);
  const items = gmDocument(quest.playerBody, quest.blocks);
  // Blocks after the last of the text read after the objectives, where the GM's notes on the quest belong.
  const lastText = items.map((item) => item.kind).lastIndexOf("text");
  const lead = items.slice(0, lastText + 1);
  const trailing = items.slice(lastText + 1);
  const itemView = (item: (typeof items)[number], index: number) =>
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
      <HiddenBlock
        key={item.block.id}
        title={item.block.title}
        value={audienceOf(item.block)}
        party={party}
        since={sinceLabel(stampOf(item.block))}
        busy={busy}
        menu={phone}
        onAudienceChange={(next) => void setBlockAudience(item.block, next)}
        onReveal={() => setRevealing(item.block)}
        onHide={() => void setBlockAudience(item.block, HIDDEN)}
      >
        <CodexMarkdown
          text={item.block.text}
          token={token}
          onNavigate={followLink}
          knownTitles={knownTitles}
          onCreate={followLink}
        />
      </HiddenBlock>
    );
  const reveal = (
    <Menu
      label={`Who can open this quest: ${quest.revealedToPlayers ? "Everyone" : "Hidden"}`}
      triggerClassName={cx("cx-aud", quest.revealedToPlayers ? "is-everyone" : "is-hidden")}
      trigger={
        <>
          {quest.revealedToPlayers ? <IconEye className="cx-aud-icon" /> : <IconEyeOff className="cx-aud-icon" />}
          {quest.revealedToPlayers ? "Revealed to everyone" : "Hidden"}
        </>
      }
    >
      <MenuItem
        role="menuitemradio"
        aria-checked={quest.revealedToPlayers}
        onClick={() =>
          !quest.revealedToPlayers &&
          void run(async () => {
            await questApi.reveal(token, id, true);
            return questRecordApi.get(token, id);
          }, "Couldn't reveal the quest.")
        }
      >
        Reveal the quest to everyone
      </MenuItem>
      <MenuItem
        role="menuitemradio"
        aria-checked={!quest.revealedToPlayers}
        onClick={() =>
          quest.revealedToPlayers &&
          void run(async () => {
            await questApi.reveal(token, id, false);
            return questRecordApi.get(token, id);
          }, "Couldn't hide the quest.")
        }
      >
        Hide the quest from players
      </MenuItem>
    </Menu>
  );
  const objectives = (
    <section className="cx-objectives" aria-label="Objectives">
      <Eyebrow>Objectives</Eyebrow>
      <ul className="cx-objlist">
        {quest.objectives.map((objective, index) => (
          <li
            key={objective.id}
            className={cx("cx-obj", objective.done && "is-done", objective.audience === "hidden" && "is-hidden")}
          >
            <label className="cx-obj-check">
              <input
                type="checkbox"
                checked={objective.done}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    () =>
                      objectivesWrite(
                        quest.objectives.map((row, at) => (at === index ? { ...row, done: event.target.checked } : row))
                      ),
                    "Couldn't tick that objective."
                  )
                }
              />
              <span className="nh-sr-only">{objective.text} done</span>
            </label>
            <span className="cx-obj-text">{objective.text}</span>
            <WhoSeesItMenu
              value={audienceOf(objective)}
              party={party}
              what={objective.text}
              disabled={busy}
              onChange={(next) =>
                void run(
                  () =>
                    questRecordApi.setObjectiveAudience(token, id, objective.id, {
                      audience: next.audience,
                      ...(next.audience === "characters" ? { characterIds: next.characterIds } : {})
                    }),
                  "Couldn't change who sees that objective."
                )
              }
            />
          </li>
        ))}
      </ul>
      <form
        className="cx-obj-add"
        onSubmit={(event) => {
          event.preventDefault();
          const text = newObjective.trim();
          if (!text) return;
          void run(() => objectivesWrite(quest.objectives, { text }), "Couldn't add that objective.").then(() =>
            setNewObjective("")
          );
        }}
      >
        <Input
          aria-label="New objective"
          placeholder="Add an objective"
          value={newObjective}
          onChange={(event) => setNewObjective(event.target.value)}
        />
        <Button size="sm" type="submit" disabled={!newObjective.trim() || busy}>
          Add
        </Button>
      </form>
    </section>
  );
  const document = seeAs.on ? (
    <PlayerQuestPreview token={preview.token} tokenError={preview.error} questId={id} phone={phone} />
  ) : (
    <>
      <div className="cx-quest-line">
        <span className="cx-kind">{QUEST_STATUS_LABEL[quest.status]}</span>
        {reveal}
        <span className="cx-hint">{progress.label}</span>
      </div>
      {lead.map(itemView)}
      {objectives}
      {trailing.map(itemView)}
    </>
  );
  const meta = (
    <QuestMeta
      status={quest.status}
      objectives={quest.objectives}
      entityIds={quest.entityIds}
      pages={feeds.pages}
      go={go}
    />
  );
  const actions = (
    <>
      <SeeAsControl
        compact={phone}
        on={seeAs.on}
        viewer={seeAs.viewer}
        party={party}
        onChange={(on, viewer) => setSeeAs({ on, viewer })}
      />
      {phone ? (
        <IconButton label="Edit" size="sm" onClick={() => setQuery((params) => params.set("mode", "edit"))}>
          <IconPencil />
        </IconButton>
      ) : (
        <Button size="sm" onClick={() => setQuery((params) => params.set("mode", "edit"))}>
          <IconPencil /> Edit
        </Button>
      )}
      <Menu icon align="end" label="More" trigger={<IconMore />}>
        <MenuItem tone="danger" onClick={() => void remove()}>
          Delete quest
        </MenuItem>
      </Menu>
    </>
  );
  const overlays = (
    <>
      {dialog}
      {revealing && (
        <RevealPanel
          title={revealing.title}
          party={party}
          busy={busy}
          error={error}
          preview={<CodexMarkdown text={revealing.text} token={token} audience="player" knownTitles={knownTitles} />}
          links={linksSentence(revealing.text, feeds.pages)}
          onCancel={() => setRevealing(null)}
          onReveal={(next) => void setBlockAudience(revealing, next)}
        />
      )}
    </>
  );

  if (editing)
    return (
      <>
        <QuestWriter
          quest={quest}
          onSaved={(next) => {
            setQuest(next);
            void feeds.questFeed.reload();
          }}
          onReload={() => read.reload()}
          onDone={() => setQuery((params) => params.delete("mode"))}
          onRevealBlock={setRevealing}
        />
        {overlays}
      </>
    );

  if (phone)
    return (
      <div className="cx-page is-phone scroll-y">
        <CodexPhoneBar title={quest.title} onBack={() => go(pathForSection("quests"))} actions={actions} />
        <div className="cx-page-phonebody">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="cx-doc">{document}</div>
          {!seeAs.on && meta}
        </div>
        {overlays}
      </div>
    );
  return (
    <div className="cx-page">
      <header className="cx-page-head">
        <div className="cx-page-headmain">
          <nav className="cx-crumbs" aria-label="Where this quest sits">
            <button type="button" className="cx-crumb" onClick={() => go(pathForSection("quests"))}>
              Quests
            </button>
            <b className="cx-crumb-here">{quest.title}</b>
          </nav>
          <h1 className="cx-page-title">{quest.title}</h1>
        </div>
        <div className="cx-page-actions">{actions}</div>
      </header>
      {error && (
        <div className="cx-page-notice">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="cx-page-cols">
        <div className="cx-page-docscroll scroll-y">
          <article className="cx-doc">{document}</article>
        </div>
        {!seeAs.on && (
          <aside className="cx-page-meta scroll-y" aria-label="About this quest">
            {meta}
          </aside>
        )}
      </div>
      {overlays}
    </div>
  );
}

/** A quest as one viewer receives it: their body, and the objectives they may read with a check or a dash. */
function PlayerQuestBody({
  quest,
  token,
  pages,
  phone,
  go
}: Readonly<{
  quest: PlayerCodexQuest;
  token: string;
  pages: ReadonlyArray<Readonly<{ id: string; title: string; entityType: string }>>;
  phone: boolean;
  go: (path: string) => void;
}>) {
  const progress = questProgress(quest.objectives);
  const doc = (
    <article className="cx-doc">
      <div className="cx-quest-line">
        <span className="cx-kind">{QUEST_STATUS_LABEL[quest.status]}</span>
        <span className="cx-hint">{progress.label}</span>
      </div>
      {playerDocument(quest.body, quest.blocks).map((item, index) => (
        <div key={index} className="cx-doc-text">
          <CodexMarkdown text={item.text} token={token} audience="player" />
        </div>
      ))}
      <section className="cx-objectives" aria-label="Objectives">
        <Eyebrow>Objectives</Eyebrow>
        <ul className="cx-objlist">
          {quest.objectives.map((objective, index) => (
            <li key={index} className={cx("cx-obj", objective.done && "is-done")}>
              <span className="cx-obj-mark" aria-hidden="true">
                {objective.done ? <IconCheck /> : <span className="cx-obj-dash" />}
              </span>
              <span className="cx-obj-text">{objective.text}</span>
              <span className="cx-hint">{objective.done ? "Done" : "Open"}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
  const meta = (
    <QuestMeta
      status={quest.status}
      objectives={quest.objectives}
      entityIds={quest.entityIds}
      pages={pages as never}
      go={go}
    />
  );
  if (phone)
    return (
      <>
        {doc}
        {meta}
      </>
    );
  return (
    <div className="cx-page-cols is-player">
      <div className="cx-page-docscroll scroll-y">{doc}</div>
      <aside className="cx-page-meta scroll-y" aria-label="About this quest">
        {meta}
      </aside>
    </div>
  );
}

/** The GM's See as players on a quest: the quest exactly as that viewer's player receives it. */
function PlayerQuestPreview({
  token,
  tokenError,
  questId,
  phone
}: Readonly<{ token: string | null; tokenError: string | null; questId: string; phone: boolean }>) {
  const { go } = useCodexShell();
  const load = useCallback(async () => {
    const reader = token ?? "";
    const [quests, pages] = await Promise.all([playerCodexApi.quests(reader), playerCodexApi.listPages(reader)]);
    return {
      quest: (quests as unknown as readonly PlayerCodexQuest[]).find((quest) => quest.id === questId) ?? null,
      pages
    };
  }, [token, questId]);
  const read = useCodexQuery(token ? load : null);
  if (tokenError) return <Alert tone="danger">{tokenError}</Alert>;
  if (!read.data) return <Skeleton variant="block" height="8rem" />;
  if (!read.data.quest) return <p className="cx-hint">Players can't open this quest. It is Hidden.</p>;
  return <PlayerQuestBody quest={read.data.quest} token={token ?? ""} pages={read.data.pages} phone={phone} go={go} />;
}

/** Quests for the GM: the list in the filter flyout, and the quest the address names. */
export function GmQuests() {
  const { recordId, go, phone, token, query } = useCodexShell();
  const gm = useGmCodex();
  const flyout = useQuestFlyout(!recordId);
  const [creating, setCreating] = useState(false);
  const newQuest = async () => {
    setCreating(true);
    try {
      const quest = await createQuest(token);
      await gm.feeds.questFeed.reload();
      go(questPath(quest.id, "edit"));
    } catch (cause) {
      gm.reportError(cause instanceof Error ? cause.message : "Couldn't create the quest.");
    } finally {
      setCreating(false);
    }
  };
  const list = (
    <QuestList quests={gm.feeds.quests} openId={recordId} gm go={go} onPicked={() => flyout.setOpen(false)} />
  );
  if (phone)
    return recordId ? (
      <GmQuest key={recordId} id={recordId} />
    ) : (
      <div className="cx-page is-phone scroll-y">
        <CodexPhoneBar title="Quests" />
        <div className="cx-page-phonebody">{list}</div>
      </div>
    );
  return (
    <div className="cx-quests">
      <div className="cx-sub">
        <FiltersButton open={flyout.open} onToggle={() => flyout.setOpen(!flyout.open)} controls={FLYOUT_ID} />
        <span className="cx-crumbs">{statusSummary(query.get("status"))}</span>
        <span className="cx-grow" />
        <Button size="sm" disabled={creating} onClick={() => void newQuest()}>
          <IconPlus /> New quest
        </Button>
      </div>
      <div className="cx-quests-main">
        <FilterFlyout id={FLYOUT_ID} open={flyout.open} title="Quests" onClose={() => flyout.setOpen(false)}>
          {list}
        </FilterFlyout>
        {recordId ? (
          <GmQuest key={recordId} id={recordId} />
        ) : (
          <p className="cx-empty">Choose a quest from Filters, or make one with New.</p>
        )}
      </div>
    </div>
  );
}

/** Quests for a player: the same list over their own projection, and the quest as they receive it. */
export function PlayerQuests() {
  const { recordId, go, phone, token, query } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const flyout = useQuestFlyout(!recordId);
  const quests = feeds.quests as unknown as readonly PlayerCodexQuest[];
  const quest = recordId ? (quests.find((candidate) => candidate.id === recordId) ?? null) : null;
  const list = (
    <QuestList quests={quests} openId={recordId} gm={false} go={go} onPicked={() => flyout.setOpen(false)} />
  );
  const body = quest ? (
    <PlayerQuestBody quest={quest} token={token} pages={feeds.pages} phone={phone} go={go} />
  ) : recordId && !feeds.loading ? (
    <p className="cx-empty">This quest isn't one you can open.</p>
  ) : null;
  if (phone)
    return (
      <div className="cx-page is-phone scroll-y">
        <CodexPhoneBar
          title={quest?.title ?? "Quests"}
          onBack={recordId ? () => go(pathForSection("quests")) : undefined}
        />
        <div className="cx-page-phonebody">{recordId ? body : list}</div>
      </div>
    );
  return (
    <div className="cx-quests">
      <div className="cx-sub">
        <FiltersButton open={flyout.open} onToggle={() => flyout.setOpen(!flyout.open)} controls={FLYOUT_ID} />
        <span className="cx-crumbs">{statusSummary(query.get("status"))}</span>
      </div>
      <div className="cx-quests-main">
        <FilterFlyout id={FLYOUT_ID} open={flyout.open} title="Quests" onClose={() => flyout.setOpen(false)}>
          {list}
        </FilterFlyout>
        {quest ? (
          <div className="cx-page">
            <header className="cx-page-head">
              <div className="cx-page-headmain">
                <nav className="cx-crumbs" aria-label="Where this quest sits">
                  <button type="button" className="cx-crumb" onClick={() => go(pathForSection("quests"))}>
                    Quests
                  </button>
                  <b className="cx-crumb-here">{quest.title}</b>
                </nav>
                <h1 className="cx-page-title">{quest.title}</h1>
              </div>
            </header>
            {body}
          </div>
        ) : (
          (body ?? <p className="cx-empty">Choose a quest from Filters.</p>)
        )}
      </div>
    </div>
  );
}
