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
 * **How it decides what is user-facing.** It scans only strings that reach a user: JSX text nodes,
 * label-ish props (`aria-label`, `label`, `placeholder`, `title`, `help`, `body`, `heading`, …) whether
 * written as a JSX attribute *or* as an object-literal key, and the arguments of the three calls that
 * put a sentence on screen without a prop (`setError`, `toast`, `setNotice`). Identifiers, comments,
 * CSS classes and wire field names are deliberately out of scope — `NotebookTree` is a component name
 * and `markerId` is the server's field; renaming those is churn, not clarity. The rule is about what
 * the GM and the players READ.
 *
 * **What it used to miss, and why that mattered.** The scanner matched `prop="…"` only, so every
 * `useConfirm({ title: …, body: … })` dialog, every `Field help=` and every template literal was
 * invisible to it. It reported 673 strings and 0 offenders while five retired words shipped — including
 * a pin dialog whose button read "Delete pin" and whose confirm read "Delete marker". Widening it to
 * `prop[:=]` plus backticks brought the corpus to ~900 strings and the offenders with it.
 *
 * **Scoped to `src/codex/**`**, because the words are Codex words. "Reveal the whole map" on the
 * fog-of-war toolbar is combat vocabulary and stays. The styleguide is deliberately NOT scanned: it is
 * a developer reference that has to be able to name a retired word in order to say it is retired.
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
  // No `(?! )` lookahead. It made every mid-sentence "secret " unmatchable, which is most of them — the
  // rule could only ever fire on "secret." or "secret," and shipped `aria-label="GM secret body"` green.
  { pattern: /\bsecret\b/i, use: "“Hidden from players” or “GM only”" },
  // D5 glossary §4: the timeline feature is the **Journal**, never "chronicle" and never "timeline", in
  // any copy a GM reads. `chronicle.ts` and `CodexChronicleRecord` are identifiers and stay.
  { pattern: /\bchronicles?\b/i, use: "Journal" },
  { pattern: /\btimelines?\b/i, use: "Journal" }
];

/**
 * Exemptions, each with the reason it is not drift.
 *
 * **Whole-string equality, not `includes`.** As substrings these rescued nothing at all — measured by
 * removing each and re-running: every one of them was inert from the day it was written, because the
 * fragments they name carry no retired word. Worse, `includes` meant a *new* violation that happened to
 * contain an exempt phrase would be excused, which is the opposite of what the comment claimed.
 */
const ALLOWED = new Set<string>([
  // "Reveal audit" is a proper noun — the name of a section in the sidebar and its own heading.
  "Reveal audit",
  // §3.4 wording the director approved: "secret" as an adjective in prose about the GM layer reads more
  // naturally than "hidden from players" mid-sentence. These are the two pin-inspector hints, and they
  // are the only two places it survives.
  "is still secret —",
  "is still secret, so players cannot see either",
  // A faction's in-fiction agenda. This is content vocabulary, not visibility vocabulary — the field
  // holds what the faction is secretly up to, and no reader could mistake it for a reveal state.
  "Secret agenda"
]);

type Found = Readonly<{ file: string; line: number; text: string }>;

function codexSources(): readonly string[] {
  return readdirSync(CODEX_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
    .sort();
}

/** The props that carry copy. Both spellings — `help="…"` in JSX and `help: "…"` in a confirm/meta object. */
const COPY_PROPS = [
  "aria-label", "ariaLabel", "label", "placeholder", "title", "empty", "emptyLabel", "heading",
  "help", "hint", "body", "summary", "confirmLabel", "cancelLabel", "removeLabel", "maxReachedReason"
].join("|");
/** The three calls that put a sentence on screen with no prop to hang it on. */
const COPY_CALLS = "setError|setNotice|toast";

/** JSX text nodes, label-ish props and message calls — the strings a person actually reads. */
function userFacingStrings(file: string): readonly Found[] {
  const found: Found[] = [];
  readFileSync(`${CODEX_DIR}${file}`, "utf8").split("\n").forEach((line, index) => {
    // `[:=]` catches the object-literal half, and the backtick branch catches template literals —
    // between them, `confirm({ title: "Delete marker", body: \`…\` })` becomes visible for the first
    // time. The two branches are separate so a template literal may contain a double quote of its own,
    // which the atlas's `Delete map "${name}"?` does.
    const quoted = `(?:"([^"\\n]+)"|\`([^\`\\n]+)\`)`;
    for (const match of line.matchAll(new RegExp(`\\b(?:${COPY_PROPS})\\s*[:=]\\s*\\{?${quoted}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    for (const match of line.matchAll(new RegExp(`\\b(?:${COPY_CALLS})\\(\\s*${quoted}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A JSX text node runs from the `>` that closed a tag up to the next `<` or `{`. The old form
    // required a literal `<` to close it, so any sentence interrupted by an interpolation vanished
    // whole — including MarkerInspector's "is still secret, so players cannot see either{onRevealMap …".
    // `(?<!=)` is what keeps that widening honest: without it every arrow function's `=>` opens a
    // "text node" and the body of the Codex's own code is scanned as copy.
    for (const match of line.matchAll(/(?<!=)>([^<>{}\n]*[A-Za-z][^<>{}\n]*)(?=[<{])/g)) {
      const text = match[1].trim();
      // A backtick is the tell for the other thing a `>` closes: a generic type argument, as in
      // `request<{ marker: CodexMarker }>(token, \`/markers/…\`)`. No sentence a GM reads has one.
      if (text.length > 1 && !text.includes("`")) found.push({ file, line: index + 1, text });
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
    expect(strings.length).toBeGreaterThan(850);
  });

  it("sees the object-literal copy the old scanner was blind to", () => {
    // The specific blindness that let five retired words ship green: a `useConfirm` dialog states its
    // title and body as object keys, and `prop="…"` never matched one. Named strings rather than a
    // count, so a future narrowing of the scanner fails here instead of quietly measuring less.
    const at = (file: string, text: string) => strings.some((entry) => entry.file === file && entry.text === text);
    expect(at("MarkerInspector.tsx", "Delete pin")).toBe(true);
    expect(at("MarkerInspector.tsx", "Delete this pin? This cannot be undone.")).toBe(true);
    expect(at("AtlasView.tsx", 'Delete map "${currentMap.name}"? Its pins are removed.')).toBe(true);
    expect(strings.some((entry) => entry.file === "StandingAdjuster.tsx" && entry.text.startsWith("Optional — players never see"))).toBe(true);
  });

  for (const { pattern, use } of RETIRED) {
    it(`never says ${String(pattern)} to a user — say ${use}`, () => {
      const offenders = strings.filter((entry) => pattern.test(entry.text) && !ALLOWED.has(entry.text));
      expect(offenders.map((entry) => `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`)).toEqual([]);
    });
  }

  it("has no exemption that rescues nothing — a dead exemption is a comment pretending to be a rule", () => {
    // Every ALLOWED entry was inert when this lock was written: as substrings they matched fragments
    // carrying no retired word at all, so removing any of them changed nothing. Now they are whole
    // strings, and each one must be load-bearing or be deleted.
    for (const allowed of ALLOWED) {
      const rescued = strings.filter((entry) => entry.text === allowed && RETIRED.some(({ pattern }) => pattern.test(entry.text)));
      expect(rescued.length, `exemption ${JSON.stringify(allowed)} rescues nothing`).toBeGreaterThan(0);
    }
  });
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
