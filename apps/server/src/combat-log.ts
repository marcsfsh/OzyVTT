import { createHmac, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChatAuthor, CombatLogEntry, PlayerRollRecord, RollRecord, RollVisibility } from "@vtt/domain";
import { migrate, openDatabase, type Migration } from "./database.js";
import { playerRoll } from "./projections.js";

type LogRow = Readonly<{
  id: number;
  at: string;
  kind: string;
  text: string;
  gm_only: number;
  revision: number;
  actor_id: string | null;
  visibility: string | null;
  initiator_session_id: string | null;
  payload_json: string | null;
}>;

// Newest entries kept, so the feed never grows without bound; sized for narration plus every die rolled.
const CAP = 2000;

const SELECT_COLUMNS =
  "id, at, kind, text, gm_only, revision, actor_id, visibility, initiator_session_id, payload_json";

// The roll columns are null on narration rows.
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE combat_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          text TEXT NOT NULL,
          gm_only INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          actor_id TEXT,
          visibility TEXT,
          initiator_session_id TEXT,
          payload_json TEXT
        ) STRICT;
      `)
  }
];

// Drawn once per server run: a player's feed ids hold for as long as the server runs, which is all the client needs to
// match a live line to the same line in its backfill.
const FEED_ID_KEY = randomBytes(32);

/** A feed row's id as a player gets it: the same for the same row, and with no order, so the gaps between two lines
 *  can't count the GM-only lines in between (what a hidden creature's turn writes). */
export function playerFeedId(id: number): number {
  return Number.parseInt(createHmac("sha256", FEED_ID_KEY).update(String(id)).digest("hex").slice(0, 12), 16);
}

/** Who is reading the feed. `sessionId` is the reader's own, the only thing that unlocks a `self-only` roll row;
 *  `characterIds` are the party characters the reader plays now, which unlock a whisper to one of them. */
export type FeedReader = Readonly<{ gm: boolean; sessionId?: string; characterIds?: ReadonlySet<string> }>;

/** What a chat row keeps beside its text: who said it, the whispered character, and the command that sent it. */
type ChatPayload = Readonly<{
  chat: Readonly<{ commandId: string; author: ChatAuthor; whisper?: Readonly<{ characterId: string; name: string }> }>;
}>;
/** A whisper's stored visibility: the GM and the players of `whisper.characterId` read it, nobody else. */
const WHISPER = "whisper";

/** A stored feed row before projection. Carries `initiatorSessionId` and the raw roll visibility, which
 *  must never reach a player: never serialize it without `projectFeedRow`. */
export type StoredFeedRow = Readonly<{
  entry: CombatLogEntry;
  visibility: RollVisibility | typeof WHISPER | null;
  initiatorSessionId: string | null;
}>;

/** Whether a reader may see a row (null if not). Non-roll rows follow `gmOnly`; `self-only` rolls reach
 *  their roller and the GM; `blind` rolls reach only the GM. */
export function projectFeedRow(row: StoredFeedRow, reader: FeedReader): CombatLogEntry | null {
  if (reader.gm) return row.entry;
  if (row.entry.gmOnly) return null;
  switch (row.visibility) {
    case WHISPER:
      return row.entry.whisper !== undefined && reader.characterIds?.has(row.entry.whisper.characterId) === true
        ? { ...row.entry, id: playerFeedId(row.entry.id) }
        : null;
    case null:
    case "public":
      return { ...row.entry, id: playerFeedId(row.entry.id) };
    case "self-only":
      return row.initiatorSessionId !== null && row.initiatorSessionId === reader.sessionId
        ? { ...row.entry, id: playerFeedId(row.entry.id), private: true }
        : null;
    // gm-only and blind rows are stored with gm_only = 1 and refused above; this catches a mis-stored row.
    default:
      return null;
  }
}

/** The table feed: a durable, append-only record of what happened, including every die rolled. Rows
 *  naming a GM-only combatant (or marked gmOnly) never reach players. Shares `RollRecord.id` with the
 *  live `GameState.rolls` window so clients can dedupe. */
export class CombatLogStore {
  private database?: DatabaseSync;
  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now
  ) {}

  async initialize() {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "combat-log", MIGRATIONS, { path: this.databasePath });
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  /** Appends one feed line and returns it with its id, and evicts beyond the newest CAP rows. With `roll`,
   *  the roll's visibility and initiator ride the row so the read filter can decide. */
  append(
    entry: Readonly<{
      kind: CombatLogEntry["kind"];
      text: string;
      gmOnly: boolean;
      revision: number;
      actorId?: string | null;
      roll?: RollRecord | null;
      /** A chat line's author and whisper, and its sender's session (which never leaves the server). */
      chat?: ChatPayload["chat"] & Readonly<{ sessionId: string }>;
    }>
  ): StoredFeedRow {
    const database = this.requireDatabase();
    const at = new Date(this.now()).toISOString();
    const roll = entry.roll ?? null;
    const chat = entry.chat ?? null;
    const actorId = entry.actorId ?? roll?.actorId ?? chat?.author.actorId ?? chat?.whisper?.characterId ?? null;
    const visibility = roll?.visibility ?? (chat?.whisper ? WHISPER : null);
    const initiatorSessionId = roll?.initiatorSessionId ?? chat?.sessionId ?? null;
    const safe = roll ? playerRoll(roll) : null;
    const chatPayload: ChatPayload | null = chat
      ? {
          chat: {
            commandId: chat.commandId,
            author: chat.author,
            ...(chat.whisper ? { whisper: chat.whisper } : {})
          }
        }
      : null;
    const info = database
      .prepare(
        `INSERT INTO combat_log (at, kind, text, gm_only, revision, actor_id, visibility, initiator_session_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        at,
        entry.kind,
        entry.text,
        entry.gmOnly ? 1 : 0,
        entry.revision,
        actorId,
        visibility,
        initiatorSessionId,
        safe ? JSON.stringify(safe) : chatPayload ? JSON.stringify(chatPayload) : null
      );
    const id = Number(info.lastInsertRowid);
    database.prepare("DELETE FROM combat_log WHERE id <= ?").run(id - CAP);
    return {
      entry: {
        id,
        at,
        kind: entry.kind,
        text: entry.text,
        gmOnly: entry.gmOnly,
        revision: entry.revision,
        ...(actorId !== null ? { actorId } : {}),
        ...(safe ? { roll: safe } : {}),
        ...(chatPayload ? chatFields(chatPayload) : {})
      },
      visibility,
      initiatorSessionId
    };
  }

  /** The chat row a command already wrote, so a resent command answers with it instead of writing again. */
  chatByCommand(commandId: string): StoredFeedRow | null {
    const row = this.requireDatabase()
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM combat_log WHERE kind = 'chat' AND json_extract(payload_json, '$.chat.commandId') = ?`
      )
      .get(commandId) as LogRow | undefined;
    return row ? toStoredRow(row) : null;
  }

  /** A retained row by the id its reader holds: the row's own for the GM, the feed id a player was sent. */
  findForReader(entryId: number, gm: boolean): StoredFeedRow | null {
    const database = this.requireDatabase();
    if (gm) {
      const row = database.prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE id = ?`).get(entryId) as
        LogRow | undefined;
      return row ? toStoredRow(row) : null;
    }
    // A player's ids carry no order, so the row is found by recomputing them over the retained chat rows.
    const rows = database
      .prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE kind = 'chat' ORDER BY id DESC`)
      .all() as LogRow[];
    const row = rows.find((candidate) => playerFeedId(candidate.id) === entryId);
    return row ? toStoredRow(row) : null;
  }

  /** Removes one row; nothing of it is kept. */
  remove(id: number): void {
    this.requireDatabase().prepare("DELETE FROM combat_log WHERE id = ?").run(id);
  }

  /** Every retained line at or after a revision, oldest first: an encounter archive's commentary (GM export, so GM-only lines included). */
  exportSince(minRevision: number): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE revision >= ? ORDER BY id`)
      .all(minRevision) as LogRow[];
    return rows.map((row) => toStoredRow(row).entry);
  }

  /** The recent feed, oldest first, projected for one reader. `limit` counts rows before filtering, which keeps
   *  the visibility rule in code and out of SQL. */
  list(
    includeGmOnly: boolean,
    limit = 250,
    sessionId?: string,
    characterIds?: ReadonlySet<string>
  ): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE (? = 1 OR gm_only = 0) ORDER BY id DESC LIMIT ?`)
      .all(includeGmOnly ? 1 : 0, limit) as LogRow[];
    const reader: FeedReader = {
      gm: includeGmOnly,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(characterIds !== undefined ? { characterIds } : {})
    };
    return rows
      .flatMap((row) => {
        const projected = projectFeedRow(toStoredRow(row), reader);
        return projected ? [projected] : [];
      })
      .reverse();
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }
  private requireDatabase() {
    if (!this.database) throw new Error("CombatLogStore has not been initialized.");
    return this.database;
  }
}

/** One stored row to the pre-projection shape. */
/** The fields a chat row's entry carries. */
function chatFields(payload: ChatPayload): Pick<CombatLogEntry, "author" | "whisper"> {
  return { author: payload.chat.author, ...(payload.chat.whisper ? { whisper: payload.chat.whisper } : {}) };
}

function toStoredRow(row: LogRow): StoredFeedRow {
  const chat = row.kind === "chat" && row.payload_json !== null ? (JSON.parse(row.payload_json) as ChatPayload) : null;
  const roll = row.payload_json === null || chat !== null ? null : (JSON.parse(row.payload_json) as PlayerRollRecord);
  return {
    entry: {
      id: row.id,
      at: row.at,
      kind: row.kind as CombatLogEntry["kind"],
      text: row.text,
      gmOnly: row.gm_only === 1,
      revision: row.revision,
      ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
      ...(roll ? { roll } : {}),
      ...(chat ? chatFields(chat) : {})
    },
    visibility: row.visibility as StoredFeedRow["visibility"],
    initiatorSessionId: row.initiator_session_id
  };
}
