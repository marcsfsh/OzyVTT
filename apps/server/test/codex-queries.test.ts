import { describe, expect, it } from "vitest";
import { z } from "zod";
import { codexRoutes } from "@vtt/api-contract/routes";
import { CODEX_SEARCH_TYPES, CODEX_SEARCH_VISIBILITIES } from "@vtt/domain";
import { MAX_FIND_LIMIT } from "../src/codex/find.js";
import { parseHomeSince, parseSearchQuery } from "../src/codex-requests.js";

/**
 * `GET /codex/search` and `GET /codex/home` read their query strings in `codex-requests.ts`, for the messages a GM
 * sees, while the route registry documents them from the contract's query schemas. These cases hold the two to the
 * same answers.
 */

type Raw = Readonly<Record<string, string>>;

/** A query value arrives as text; the documented integer is the number that text spells. */
function documented(schema: z.ZodType | undefined, raw: Raw) {
  if (!schema) throw new Error("The route documents no query.");
  const values = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, key === "limit" ? Number(value) : value])
  );
  return schema.safeParse(values).success;
}
function served(parse: (raw: Raw) => unknown, raw: Raw) {
  try {
    parse(raw);
    return true;
  } catch {
    return false;
  }
}

describe("the Codex query strings", () => {
  it("accepts and refuses the same search parameters the document constrains", () => {
    const cases: Raw[] = [
      {},
      { q: "dragon" },
      { q: "x".repeat(200) },
      { q: "x".repeat(201) },
      ...CODEX_SEARCH_VISIBILITIES.map((visibility) => ({ visibility })),
      { visibility: "secret" },
      { limit: "1" },
      { limit: String(MAX_FIND_LIMIT) },
      { limit: "0" },
      { limit: String(MAX_FIND_LIMIT + 1) },
      { limit: "2.5" },
      { limit: "ten" }
    ];
    for (const raw of cases)
      expect(served(parseSearchQuery, raw), JSON.stringify(raw)).toBe(documented(codexRoutes.searchCodex.query, raw));
  });

  it("documents every search the server serves, and names each search type it knows", () => {
    // The server checks these free-text parameters further, so the document only has to admit what it serves.
    const served: Raw[] = [
      { types: "page,journal" },
      { types: CODEX_SEARCH_TYPES.join(",") },
      { sort: "name:desc,modified" },
      { modifiedFrom: "2026-10-17", modifiedTo: "2026-10-18T12:00:00Z" }
    ];
    for (const raw of served) {
      expect(() => parseSearchQuery(raw), JSON.stringify(raw)).not.toThrow();
      expect(documented(codexRoutes.searchCodex.query, raw), JSON.stringify(raw)).toBe(true);
    }
    const typesProse = (codexRoutes.searchCodex.query.shape.types as z.ZodType).description ?? "";
    for (const type of ["page", "journal", "map", "marker", "quest", "session"])
      expect(typesProse, type).toContain(`\`${type}\``);
  });

  it("accepts and refuses the same `since` on the home page", () => {
    const cases: Raw[] = [
      {},
      { since: "2026-10-17T19:30:00Z" },
      { since: "2026-10-17T19:30:00.000+02:00" },
      { since: "2026-10-17" },
      { since: "yesterday" }
    ];
    for (const raw of cases)
      expect(served(parseHomeSince, raw), JSON.stringify(raw)).toBe(documented(codexRoutes.getCodexHome.query, raw));
  });
});
