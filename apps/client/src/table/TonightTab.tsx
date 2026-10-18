import { useCallback, useMemo, useState } from "react";
import { Alert, Badge, Button, IconEyeOff, Input, Skeleton, useToast } from "@vtt/ui";
import {
  dateToInstant,
  formatWorldDate,
  type CodexLiveBoard,
  type CodexLiveClue,
  type CodexPageSummary,
  type GmCodexCalendar
} from "@vtt/domain";
import { calendarApi, codexApi, questApi } from "../codex/api";
import { pageRecordApi, questRecordApi } from "../codex/api-records";
import { CodexMarkdown } from "../codex/CodexMarkdown";
import { entityDef } from "../codex/entities";
import { CodexIcon, EntityIcon } from "../codex/icons";
import { liveApi } from "../codex/prep/api";
import { QUEST_STATUS_LABEL } from "../codex/quests";
import { pagePath, pathForSection, questPath } from "../codex/routes";
import { RevealPanel } from "../codex/shared/RevealPanel";
import { FieldAudienceToggle } from "../codex/shared/WhoSeesIt";
import { EVERYONE, characterNames, namesLabel, type Audience, type PartyCharacter } from "../codex/shared/audience";
import { useCodexQuery } from "../codex/useCodexQuery";
import { navigate } from "../router";
import "../codex/shared/shared.css";
import "./tonight.css";

type Board = CodexLiveBoard;
type Scene = Readonly<{ id: string; name: string }>;

/** Two letters for a name's mark: the first letters of its first two words. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

/** "in 4 days", "tomorrow", "today", or how long ago, counted from the GM's date. */
export function untilLabel(instant: number | null, calendar: GmCodexCalendar | null): string | null {
  if (instant === null || !calendar?.currentDate || calendar.months.length === 0) return null;
  const days = instant - dateToInstant(calendar, calendar.currentDate);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return days === -1 ? "yesterday" : `${-days} days ago`;
}

/**
 * The table's Tonight tab: the active session's live board, built from its prep. The scenes with the current one,
 * the cast, the secrets and clues to tick (a tick that links something players can't read offers to reveal it),
 * the clocks, the quests, the encounters to make live, and a line to log what happens. GM only: every read and
 * write here is a GM route.
 */
export function TonightTab({
  token,
  party = [],
  scenes = [],
  liveSceneId = null,
  onMakeLive
}: Readonly<{
  token: string;
  /** The party's characters, for revealing a block to some of them. */
  party?: readonly PartyCharacter[];
  /** The table's prepared scenes, which the board's encounters name. */
  scenes?: readonly Scene[];
  liveSceneId?: string | null;
  onMakeLive?: (sceneId: string) => void;
}>) {
  const feed = useCodexQuery(
    useCallback(() => liveApi.board(token), [token]),
    { failure: "Couldn't read tonight's board." }
  );
  const calendar = useCodexQuery(
    useCallback(() => calendarApi.get(token), [token]),
    { failure: "Couldn't read the calendar." }
  );
  // The cast's role and drive lines come from the page list, which carries every field.
  const pages = useCodexQuery(
    useCallback(() => codexApi.listPages(token), [token]),
    { failure: "Couldn't read the pages." }
  );

  if (feed.loading && feed.data === undefined)
    return (
      <div className="tonight" aria-busy="true">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" />
        ))}
      </div>
    );
  if (feed.error && feed.data === undefined)
    return (
      <div className="tonight">
        <Alert tone="danger">{feed.error}</Alert>
      </div>
    );
  if (!feed.data)
    return (
      <div className="tonight tonight-empty">
        <p>No session is running. Start one from its page in Story, and its prep becomes tonight's board.</p>
        <Button variant="secondary" onClick={() => void navigate(pathForSection("sessions"))}>
          Open sessions
        </Button>
      </div>
    );
  return (
    <LiveBoard
      token={token}
      board={feed.data}
      calendar={calendar.data ?? null}
      pages={pages.data ?? []}
      party={party}
      scenes={scenes}
      liveSceneId={liveSceneId}
      onMakeLive={onMakeLive}
      reload={feed.reload}
    />
  );
}

function LiveBoard({
  token,
  board,
  calendar,
  pages,
  party,
  scenes,
  liveSceneId,
  onMakeLive,
  reload
}: Readonly<{
  token: string;
  board: Board;
  calendar: GmCodexCalendar | null;
  pages: readonly CodexPageSummary[];
  party: readonly PartyCharacter[];
  scenes: readonly Scene[];
  liveSceneId: string | null;
  onMakeLive?: (sceneId: string) => void;
  reload: () => Promise<void>;
}>) {
  const [error, setError] = useState<string | null>(null);
  const setScene = async (sceneId: string | null) => {
    setError(null);
    try {
      await liveApi.currentScene(token, board.sessionId, sceneId);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change the current scene.");
    }
  };
  const published = calendar?.publishedDate ?? null;
  const encounters = board.encounterSceneIds
    .map((id) => scenes.find((scene) => scene.id === id))
    .filter((scene): scene is Scene => Boolean(scene));
  const current = board.scenes.find((scene) => scene.current) ?? null;

  return (
    <div className="tonight scroll-y">
      <div className="tonight-head">
        <span className="tonight-eyebrow">
          {board.sessionNumber !== null ? `Session ${board.sessionNumber}` : "This session"} · Live
        </span>
        <span className="tonight-grow" />
        {calendar && published && (
          <span className="tonight-date">Players' date: {formatWorldDate(calendar, published)}</span>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}

      {board.scenes.length > 0 && (
        <section className="tonight-section" aria-label="Scenes">
          <ol className="tonight-scenes">
            {board.scenes.map((scene, index) => (
              <li key={scene.id}>
                <button
                  type="button"
                  className={`tonight-scene${scene.current ? " is-current" : ""}`}
                  aria-pressed={scene.current}
                  onClick={() => void setScene(scene.current ? null : scene.id)}
                >
                  <span className="tonight-scene-step">
                    {index + 1}
                    {scene.current ? " · Now" : ""}
                  </span>
                  <span className="tonight-scene-title">{scene.title || "Untitled scene"}</span>
                  {scene.placeTitle && <span className="tonight-scene-place">{scene.placeTitle}</span>}
                </button>
              </li>
            ))}
          </ol>
          {current?.notes.trim() && (
            <div className="tonight-notes">
              <CodexMarkdown text={current.notes} token={token} />
            </div>
          )}
        </section>
      )}

      {board.pageGroups.map((group) => (
        <Cast key={group.sectionId} group={group} pages={pages} />
      ))}

      {board.checklists.map((list) => (
        <Clues
          key={list.sectionId}
          token={token}
          sessionId={board.sessionId}
          title={list.title}
          items={list.items}
          party={party}
          onChanged={reload}
          onError={setError}
        />
      ))}

      {board.clocks.length > 0 && (
        <section className="tonight-section" aria-label="Clocks">
          <h3 className="tonight-eyebrow">Clocks</h3>
          <ul className="tonight-rows">
            {board.clocks.map((clock) => (
              <li key={clock.id} className={`tonight-row${clock.revealedToPlayers ? "" : " is-hidden"}`}>
                <CodexIcon iconId="hourglass" className="tonight-icon" />
                <span className="tonight-row-text">
                  <span className="tonight-row-title">{clock.text}</span>
                  <span className="tonight-row-meta">
                    {[clock.inWorldLabel, clock.fired ? "Passed" : untilLabel(clock.calendarInstant, calendar)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {!clock.revealedToPlayers && <HiddenWord />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {board.quests.length > 0 && (
        <section className="tonight-section" aria-label="Quests">
          <h3 className="tonight-eyebrow">Quests</h3>
          <ul className="tonight-rows">
            {board.quests.map((quest) => (
              <li key={quest.id}>
                <button
                  type="button"
                  className={`tonight-row is-button${quest.revealedToPlayers ? "" : " is-hidden"}`}
                  onClick={() => void navigate(questPath(quest.id))}
                >
                  <CodexIcon iconId="quest" className="tonight-icon" />
                  <span className="tonight-row-text">
                    <span className="tonight-row-title">{quest.title}</span>
                    <span className="tonight-row-meta">{QUEST_STATUS_LABEL[quest.status]}</span>
                  </span>
                  {!quest.revealedToPlayers && <HiddenWord />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {encounters.length > 0 && (
        <section className="tonight-section" aria-label="Encounters">
          <h3 className="tonight-eyebrow">Encounters</h3>
          <ul className="tonight-rows">
            {encounters.map((scene) => (
              <li key={scene.id} className="tonight-row">
                <CodexIcon iconId="battle" className="tonight-icon" />
                <span className="tonight-row-text">
                  <span className="tonight-row-title">{scene.name}</span>
                </span>
                {scene.id === liveSceneId ? (
                  <Badge tone="success">Live</Badge>
                ) : (
                  onMakeLive && (
                    <Button variant="secondary" size="sm" onClick={() => onMakeLive(scene.id)}>
                      Make live
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <LogLine token={token} board={board} onLogged={reload} />
    </div>
  );
}

function HiddenWord() {
  return (
    <span className="tonight-hidden">
      <IconEyeOff /> Hidden
    </span>
  );
}

/** One prep section of pages: the people and places in play, each with its role and what drives it. */
function Cast({ group, pages }: Readonly<{ group: Board["pageGroups"][number]; pages: readonly CodexPageSummary[] }>) {
  if (group.pages.length === 0) return null;
  return (
    <section className="tonight-section" aria-label={group.title}>
      <h3 className="tonight-eyebrow">{group.title}</h3>
      <ul className="tonight-cast">
        {group.pages.map((entry) => {
          const page = pages.find((each) => each.id === entry.id);
          const fields: Readonly<Record<string, string>> = page?.fields ?? {};
          const role = [
            fields.role?.trim() || fields.kind?.trim() || entityDef(entry.entityType).label,
            fields.location?.trim()
          ]
            .filter(Boolean)
            .join(" · ");
          const drive = (fields.goals ?? "").trim();
          const driveHidden = page?.hiddenFields.includes("goals") ?? false;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`tonight-person${entry.revealedToPlayers ? "" : " is-hidden"}`}
                onClick={() => void navigate(pagePath(entry.id))}
              >
                <span className="tonight-mark" aria-hidden="true">
                  {entry.entityType === "character" ? initials(entry.title) : <EntityIcon type={entry.entityType} />}
                </span>
                <span className="tonight-row-text">
                  <span className="tonight-person-name">{entry.title}</span>
                  <span className="tonight-row-meta">{role}</span>
                  {drive && <span className={`tonight-person-drive${driveHidden ? " is-hidden" : ""}`}>{drive}</span>}
                </span>
                {!entry.revealedToPlayers && <HiddenWord />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Clues({
  token,
  sessionId,
  title,
  items,
  party,
  onChanged,
  onError
}: Readonly<{
  token: string;
  sessionId: string;
  title: string;
  items: readonly CodexLiveClue[];
  party: readonly PartyCharacter[];
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}>) {
  const { toast } = useToast();
  /** The ticked clue whose link players can't read yet, and so offers to reveal it. */
  const [offer, setOffer] = useState<CodexLiveClue | null>(null);
  const [choosing, setChoosing] = useState<Readonly<{ clue: CodexLiveClue; text: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const tick = async (clue: CodexLiveClue, done: boolean) => {
    onError(null);
    try {
      const answer = await liveApi.tick(token, sessionId, clue.id, done);
      // The server's answer says whether players can read what the clue links, as of this tick.
      setOffer(done && answer.clue.link && answer.clue.linkRevealed === false ? answer.clue : null);
      await onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't tick that clue.");
    }
  };

  const reveal = async (clue: CodexLiveClue, audience: Audience) => {
    const link = clue.link;
    if (!link) return;
    setBusy(true);
    setPanelError(null);
    try {
      if (link.blockId) {
        const routes = link.recordKind === "page" ? pageRecordApi.blocks : questRecordApi.blocks;
        await routes.setAudience(token, link.recordId, link.blockId, {
          audience: audience.audience,
          ...(audience.audience === "characters" ? { characterIds: audience.characterIds } : {})
        });
      } else if (link.recordKind === "page") await codexApi.revealPage(token, link.recordId, true);
      else await questApi.reveal(token, link.recordId, true);
      const name = link.blockId ? clue.blockTitle?.trim() || "The hidden block" : clue.linkTitle?.trim() || "It";
      const who =
        audience.audience === "characters" ? namesLabel(characterNames(audience.characterIds, party)) : "everyone";
      toast(`${name} is revealed to ${who}.`, { tone: "success" });
      setOffer(null);
      setChoosing(null);
      await onChanged();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Couldn't reveal it.";
      if (choosing) setPanelError(message);
      else onError(message);
    } finally {
      setBusy(false);
    }
  };

  /** Choose characters reads the block first, so the panel shows what they will read. */
  const choose = async (clue: CodexLiveClue) => {
    const link = clue.link;
    if (!link?.blockId) return;
    onError(null);
    try {
      const record =
        link.recordKind === "page"
          ? (await pageRecordApi.get(token, link.recordId)).page
          : await questRecordApi.get(token, link.recordId);
      const block = record.blocks.find((each) => each.id === link.blockId);
      setPanelError(null);
      setChoosing({ clue, text: block?.text ?? "" });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't read the hidden block.");
    }
  };

  if (items.length === 0) return null;
  return (
    <section className="tonight-section" aria-label={title}>
      <h3 className="tonight-eyebrow">{title}</h3>
      <ul className="tonight-clues">
        {items.map((clue) => {
          const linked = clue.link
            ? [
                clue.linkTitle ?? "A record that is gone",
                clue.link.blockId ? clue.blockTitle?.trim() || "a hidden block" : null
              ]
                .filter(Boolean)
                .join(" · ")
            : null;
          const offered = offer?.id === clue.id ? offer : null;
          return (
            <li key={clue.id} className="tonight-clue">
              <label className={`tonight-check${clue.done ? " is-done" : ""}`}>
                <input
                  type="checkbox"
                  checked={clue.done}
                  onChange={(event) => void tick(clue, event.target.checked)}
                />
                <span className="tonight-row-text">
                  <span className="tonight-row-title">{clue.text}</span>
                  {linked && (
                    <span className="tonight-row-meta">
                      {linked}
                      {clue.linkRevealed === false && <HiddenWord />}
                    </span>
                  )}
                </span>
              </label>
              {offered?.link && (
                <div className="tonight-offer" role="group" aria-label="Reveal what this clue links">
                  <p>
                    {offered.link.blockId
                      ? `This clue links the hidden block ${offered.blockTitle?.trim() || "with no title"}. Reveal it now?`
                      : `This clue links ${offered.linkTitle ?? "a record"}, which players can't read yet. Show it to them now?`}
                  </p>
                  <div className="tonight-offer-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void reveal(offered, EVERYONE)}
                    >
                      {offered.link.blockId ? "Everyone" : "Show to players"}
                    </Button>
                    {offered.link.blockId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || party.length === 0}
                        onClick={() => void choose(offered)}
                      >
                        Choose characters
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setOffer(null)}>
                      Not now
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {choosing && (
        <RevealPanel
          title={choosing.clue.blockTitle}
          party={party}
          initial={{ audience: "characters", characterIds: [] }}
          preview={<CodexMarkdown text={choosing.text} token={token} audience="player" />}
          busy={busy}
          error={panelError}
          onCancel={() => setChoosing(null)}
          onReveal={(audience) => void reveal(choosing.clue, audience)}
        />
      )}
    </section>
  );
}

/** One line of what happened, filed under the session at the GM's date; Hidden unless the GM shows it. */
function LogLine({ token, board, onLogged }: Readonly<{ token: string; board: Board; onLogged: () => Promise<void> }>) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logged = useMemo(() => [...board.logged].reverse().slice(0, 6), [board.logged]);
  const log = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await liveApi.log(token, board.sessionId, text.trim(), shown);
      setText("");
      await onLogged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't log that.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tonight-section" aria-label="Log what happens">
      <h3 className="tonight-eyebrow">Log what happens</h3>
      <form
        className="tonight-log"
        onSubmit={(event) => {
          event.preventDefault();
          void log();
        }}
      >
        <Input
          aria-label="What happened"
          placeholder="The party paid Mother Quill"
          value={text}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
          Log
        </Button>
      </form>
      <FieldAudienceToggle field="this line" hidden={!shown} onChange={(hidden) => setShown(!hidden)} />
      {error && <Alert tone="danger">{error}</Alert>}
      {logged.length > 0 && (
        <ul className="tonight-rows" aria-label="Logged tonight">
          {logged.map((line) => (
            <li key={line.id} className={`tonight-row${line.revealedToPlayers ? "" : " is-hidden"}`}>
              <CodexIcon iconId="book" className="tonight-icon" />
              <span className="tonight-row-text">
                <span className="tonight-row-title">{line.text}</span>
              </span>
              {!line.revealedToPlayers && <HiddenWord />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
