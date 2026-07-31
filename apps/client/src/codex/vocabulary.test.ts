import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECTION_TITLE, GM_SIDEBAR, PLAYER_SIDEBAR } from "./routes";
import { CHRONICLE_KIND_META } from "./chronicle";

/**
 * D5 — the canonical glossary, locked as a test rather than as a paragraph nobody re-reads.
 *
 * The Codex used to call the same thing three names on three surfaces: a *page* was a "note" in the
 * composer, an "entity" in the picker and a "page" in the rail; a *pin* was a "marker" everywhere except
 * the player's map; visibility was "revealed", "shared", "public" and "shown" depending on who wrote the
 * component that week. Vocabulary drift is the cheapest bug to introduce (one word, in a hurry, in copy
 * nobody diffs) and the most expensive to notice, because nothing breaks — the product just gets harder
 * to learn. So this test reads the source and fails the build on the retired words.
 *
 * **How it decides what is user-facing.** It scans only strings that reach a user: JSX text nodes, and
 * string literals on the label-ish props (`aria-label`, `label`, `placeholder`, `title`, `empty`, …).
 * Identifiers, comments, CSS classes and wire field names are deliberately out of scope — `NotebookTree`
 * is a component name and `markerId` is the server's field; renaming those is churn, not clarity. The
 * rule is about what the GM and the players READ.
 *
 * **Scoped to `src/codex/**` plus the styleguide's Codex sections**, because the words are Codex words.
 * "Reveal the whole map" on the fog-of-war toolbar is combat vocabulary and stays.
 */

/**
 * `import.meta.url` is rewritten by Vite to a root-relative URL, so it cannot locate the sources on
 * disk. Vitest runs per workspace, so the client's own root is the cwd — asserted below rather than
 * assumed, because a silently-empty scan is exactly the failure mode this file exists to prevent.
 */
const CODEX_DIR = `${process.cwd()}/src/codex/`;

/** Each rule is a retired word plus the word that replaced it, so a failure tells you what to type. */
const RETIRED: ReadonlyArray<Readonly<{ pattern: RegExp; use: string }>> = [
  { pattern: /\bnote ?books?\b/i, use: "Pages (the section) / page (the record)" },
  { pattern: /\bback ?links?\b/i, use: "connection — D8 made it one list" },
  { pattern: /\brelationships?\b/i, use: "connection — D8 made it one list" },
  { pattern: /\bwiki[- ]?links?\b/i, use: "connection, or “[[link]]” when you mean the syntax" },
  { pattern: /\bmarkers?\b/i, use: "pin" },
  { pattern: /\bquest log\b/i, use: "Quests" },
  { pattern: /\bsession log\b/i, use: "Sessions" },
  { pattern: /\bcampaign clock\b/i, use: "your date / today" },
  // The visibility words are the ones that drift hardest, because every surface needs them.
  { pattern: /\breveal(s|ed|ing)?\b/i, use: "“Shown to players” / “Hidden from players” / “Show … to players”" },
  { pattern: /\bpublic\b/i, use: "“Shown to players”" },
  { pattern: /\bsecret\b(?! )/i, use: "“Hidden from players” or “GM only”" }
];

/**
 * Exemptions, each with the reason it is not drift. Kept as exact strings rather than as a loosened
 * regex: a new violation that happens to resemble an exempt one must still fail.
 */
const ALLOWED = new Set<string>([
  // "Reveal audit" is a proper noun — the name of a section in the sidebar and its own heading.
  "Reveal audit",
  // The audit's own column headers name the ACT being audited, which is the reveal itself.
  "Reveal history",
  // §3.4 wording the director approved: "secret" as an adjective in prose about the GM layer reads more
  // naturally than "hidden from players" mid-sentence, and both appear together in these two hints.
  "This pin is shown, but the map",
  "This pin is shown, but"
]);

type Found = Readonly<{ file: string; line: number; text: string }>;

function codexSources(): readonly string[] {
  return readdirSync(CODEX_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
    .sort();
}

/** JSX text nodes plus label-ish attribute strings — the strings a person actually reads. */
function userFacingStrings(file: string): readonly Found[] {
  const found: Found[] = [];
  readFileSync(`${CODEX_DIR}${file}`, "utf8").split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/\b(?:aria-label|ariaLabel|label|placeholder|title|empty|emptyLabel|heading|confirmLabel|cancelLabel)=\{?"([^"]+)"/g)) {
      found.push({ file, line: index + 1, text: match[1] });
    }
    for (const match of line.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) {
      const text = match[1].trim();
      if (text.length > 1) found.push({ file, line: index + 1, text });
    }
  });
  return found;
}

describe("The canonical glossary (D5)", () => {
  const strings = codexSources().flatMap(userFacingStrings);

  it("reads enough of the Codex to be worth trusting", () => {
    // A guard that silently matched nothing would pass forever. This is the tripwire on the tripwire:
    // if a refactor moves the Codex out from under the glob, this fails before the word rules do.
    expect(codexSources().length).toBeGreaterThan(25);
    expect(strings.length).toBeGreaterThan(400);
  });

  for (const { pattern, use } of RETIRED) {
    it(`never says ${String(pattern)} to a user — say ${use}`, () => {
      const offenders = strings.filter(
        (entry) => pattern.test(entry.text) && ![...ALLOWED].some((allowed) => entry.text.includes(allowed))
      );
      expect(offenders.map((entry) => `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`)).toEqual([]);
    });
  }
});

describe("The words the navigation itself uses (D1/D5)", () => {
  it("names every sidebar destination in the glossary's words, in both roles", () => {
    const labels = (groups: typeof GM_SIDEBAR) => groups.flatMap((group) => group.items.map((item) => item.label));
    expect(labels(GM_SIDEBAR)).toEqual([
      "Home", "Pages", "Atlas", "Graph", "Sessions", "Quests", "Journal", "Calendar", "Downtime",
      "Reveal audit", "Preview as player", "Backup", "Settings"
    ]);
    // D14's whole claim in one assertion: the player's Codex is the same place, minus the GM's tools —
    // not a second, thinner product with its own names for things.
    expect(labels(PLAYER_SIDEBAR)).toEqual(labels(GM_SIDEBAR).slice(0, 9));
  });

  it("titles each section with the sidebar's own word, so the top bar cannot drift from the nav", () => {
    for (const item of GM_SIDEBAR.flatMap((group) => group.items)) {
      if (!item.path) continue;
      const section = item.path === "/codex" ? "home" : item.path.replace("/codex/", "");
      expect(SECTION_TITLE[section as keyof typeof SECTION_TITLE]).toBe(item.label);
    }
  });
});

describe("The words a chronicle row uses (D5/R2)", () => {
  it("gives every kind a label in TEXT, quests included", () => {
    // R2 and the icon+text rule together: remove every colour from the timeline and each row must still
    // say what it is. A kind with no label would be a colour-only row.
    for (const [kind, meta] of Object.entries(CHRONICLE_KIND_META)) {
      expect(meta.label, `chronicle kind ${kind}`).toMatch(/^[A-Z]/);
      expect(meta.iconId, `chronicle kind ${kind}`).toBeTruthy();
    }
    // The handoff named this one specifically: Lane B started writing `quest` rows onto the chronicle,
    // and a missing entry here renders an unlabelled row rather than throwing.
    expect(CHRONICLE_KIND_META.quest.label).toBe("Quest");
  });
});
