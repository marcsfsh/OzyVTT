import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyDatabaseError, migrate, openDatabase, transaction } from "../src/database.js";

const directories: string[] = [];
function freshPath() {
  const directory = mkdtempSync(join(tmpdir(), "vtt-database-"));
  directories.push(directory);
  return join(directory, "nested", "vtt.sqlite");
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("database helpers", () => {
  it("applies each store's migrations once, in order", () => {
    const path = freshPath();
    const database = openDatabase(path);
    const ran: string[] = [];
    const migrations = [
      { version: 2, up: () => ran.push("two") },
      { version: 1, up: () => ran.push("one") }
    ];
    migrate(database, "a", migrations, { path });
    migrate(database, "a", migrations, { path });
    migrate(database, "b", migrations, { path });
    expect(ran).toEqual(["one", "two", "one", "two"]);
    database.close();
  });

  it("rolls back a failed transaction", () => {
    const path = freshPath();
    const database = openDatabase(path);
    database.exec("CREATE TABLE t (n INTEGER) STRICT");
    expect(() =>
      transaction(database, () => {
        database.prepare("INSERT INTO t VALUES (1)").run();
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(database.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 0 });
    database.close();
  });

  it("refuses a database that carries a legacy migration table", () => {
    const path = freshPath();
    const database = openDatabase(path);
    database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)");
    expect(() => migrate(database, "game", [], { path, legacyTables: ["schema_migrations"] })).toThrow(
      LegacyDatabaseError
    );
    database.close();
  });
});
