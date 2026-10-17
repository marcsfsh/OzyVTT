import type {
  CodexLiveBoard,
  CodexLiveClue,
  CodexPrepChecklistItem,
  CodexSession,
  CodexSessionHappened
} from "@vtt/domain";
import type { CodexStore } from "../codex-store.js";
import { deadlineFired } from "./journal-kinds.js";
import { prepItems, prepScenes } from "./prep.js";

/**
 * The live board (the GM's Tonight tab) and the recap step's sources, read from a session's prep sections. Both are
 * GM-only. The board names what each pick points at, and leaves out a pick whose record is gone.
 */

/** How many filed entries the board shows, and the recap reads. */
const BOARD_LOGGED = 50;
const HAPPENED_ENTRIES = 200;

/** A checklist item with what its link names. A block's title and audience wait for blocks to exist in the model. */
export function liveClue(store: CodexStore, item: CodexPrepChecklistItem): CodexLiveClue {
  const record =
    item.link === null
      ? null
      : item.link.recordKind === "page"
        ? store.getPage(item.link.recordId)
        : store.getQuest(item.link.recordId);
  return {
    ...item,
    linkTitle: record?.title ?? null,
    blockTitle: null,
    linkRevealed: record && item.link?.blockId === null ? record.revealedToPlayers : null
  };
}

/** Ids picked across every section of one type, deduped, in prep order. */
function picked(session: CodexSession, pick: (section: CodexSession["prep"][number]) => readonly string[]): string[] {
  return [...new Set(session.prep.flatMap(pick))];
}

/** The board for one session. */
export function boardFor(store: CodexStore, session: CodexSession): CodexLiveBoard {
  // The GM's clock: the board is the GM's, and a deadline fires for them by their own date.
  const campaignInstant = store.campaignInstant();
  const filed = store
    .listTimeline()
    .filter((entry) => entry.sessionId === session.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    sessionId: session.id,
    sessionNumber: session.sessionNumber,
    rev: session.rev,
    currentSceneId: session.currentSceneId,
    scenes: prepScenes(session.prep).map(({ section, scene }) => ({
      sectionId: section.id,
      id: scene.id,
      title: scene.title,
      placePageId: scene.placePageId,
      placeTitle: scene.placePageId === null ? null : (store.getPage(scene.placePageId)?.title ?? null),
      notes: scene.notes,
      current: scene.id === session.currentSceneId
    })),
    pageGroups: session.prep.flatMap((section) =>
      section.type === "pages"
        ? [
            {
              sectionId: section.id,
              title: section.title,
              pages: section.pageIds.flatMap((pageId) => {
                const page = store.getPage(pageId);
                return page
                  ? [
                      {
                        id: page.id,
                        title: page.title,
                        entityType: page.entityType,
                        revealedToPlayers: page.revealedToPlayers
                      }
                    ]
                  : [];
              })
            }
          ]
        : []
    ),
    checklists: session.prep.flatMap((section) =>
      section.type === "checklist"
        ? [{ sectionId: section.id, title: section.title, items: section.items.map((item) => liveClue(store, item)) }]
        : []
    ),
    clocks: picked(session, (section) => (section.type === "clocks" ? section.deadlineIds : [])).flatMap((entryId) => {
      const entry = store.getEntry(entryId);
      return entry
        ? [
            {
              id: entry.id,
              text: entry.playerText || entry.gmText || "",
              inWorldLabel: entry.inWorldLabel,
              calendarInstant: entry.calendarInstant,
              fired: deadlineFired(entry, campaignInstant),
              revealedToPlayers: entry.revealedToPlayers
            }
          ]
        : [];
    }),
    quests: picked(session, (section) => (section.type === "quests" ? section.questIds : [])).flatMap((questId) => {
      const quest = store.getQuest(questId);
      return quest
        ? [{ id: quest.id, title: quest.title, status: quest.status, revealedToPlayers: quest.revealedToPlayers }]
        : [];
    }),
    encounterSceneIds: picked(session, (section) => (section.type === "encounters" ? section.sceneIds : [])),
    logged: filed.slice(-BOARD_LOGGED).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.playerText || entry.gmText || "",
      revealedToPlayers: entry.revealedToPlayers,
      createdAt: entry.createdAt
    }))
  };
}

/** The active session's board, or null when no session is active. */
export function liveBoard(store: CodexStore): CodexLiveBoard | null {
  const sessionId = store.activeSessionId;
  const session = sessionId === null ? null : store.getSession(sessionId);
  return session ? boardFor(store, session) : null;
}

/**
 * What happened in a session, for the recap: what was filed under it, the clues ticked, and the blocks revealed
 * while it was active. Blocks have no reveal stamps yet, so `reveals` is empty until they do.
 */
export function sessionHappened(store: CodexStore, session: CodexSession): CodexSessionHappened {
  return {
    sessionId: session.id,
    entries: store
      .listTimeline()
      .filter((entry) => entry.sessionId === session.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, HAPPENED_ENTRIES),
    cluesTicked: prepItems(session.prep)
      .filter(({ item }) => item.done)
      .sort((a, b) => (a.item.doneAt ?? "").localeCompare(b.item.doneAt ?? ""))
      .map(({ section, item }) => ({ ...liveClue(store, item), sectionId: section.id, sectionTitle: section.title })),
    reveals: []
  };
}
