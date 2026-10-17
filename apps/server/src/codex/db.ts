import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../database.js";
import { stampFirstShown } from "./first-shown.js";

/** The connection and clock every Codex module works through. */
export type CodexDb = Readonly<{ database: DatabaseSync; now: () => number }>;

export function stamp(db: CodexDb): string {
  return new Date(db.now()).toISOString();
}

export function freshId(): string {
  return randomUUID();
}

/** The coarse counter every write bumps: it is the GM's `codex:changed` ping and keys the GM's ETags. */
export function readRevision(db: CodexDb): number {
  const row = db.database.prepare("SELECT codex_revision FROM codex_meta WHERE id = 1").get() as {
    codex_revision: number;
  };
  return row.codex_revision;
}

export function bumpRevision(db: CodexDb): void {
  db.database.prepare("UPDATE codex_meta SET codex_revision = codex_revision + 1 WHERE id = 1").run();
}

/**
 * One Codex write: `work`, the first-shown date of whatever it let players read, and a revision bump, in one
 * transaction. The leaf writes the aggregate modules export open no transaction of their own, so several compose
 * inside one `write`.
 */
export function write<T>(db: CodexDb, work: () => T): T {
  return transaction(db.database, () => {
    const result = work();
    stampFirstShown(db.database, stamp(db));
    bumpRevision(db);
    return result;
  });
}
