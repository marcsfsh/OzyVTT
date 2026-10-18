import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource, scanCopy } from "../copy-scan";
import { CAMPAIGN_PARTS, CODEX_BAR, CODEX_PHONE_TABS, SECTION_TITLE, codexDestinations } from "./routes";
import { CHRONICLE_KIND_META } from "./chronicle";

/**
 * The Codex glossary as a test: fails on retired words in user-facing strings under `src/codex/` (JSX
 * text, label-like props or object keys, and `setError`/`toast`/`setNotice` arguments). Identifiers,
 * comments, CSS classes and wire field names are out of scope.
 */

/** Vite rewrites `import.meta.url`, so use the cwd (the client workspace root, asserted below). */
const CODEX_DIR = `${process.cwd()}/src/codex/`;

/** The reveal control lives in `@vtt/ui`; the last block pins its words there and keeps them out of the Codex. */
const REVEAL_PRIMITIVE = `${process.cwd()}/../../packages/ui/src/primitives/Reveal.tsx`;

/** Each rule is a retired word plus the word that replaced it, so a failure tells you what to type. */
const RETIRED: ReadonlyArray<Readonly<{ pattern: RegExp; use: string }>> = [
  { pattern: /\bnote ?books?\b/i, use: "Pages (the section) / page (the record)" },
  { pattern: /\bback ?links?\b/i, use: "connection: D8 made it one list" },
  { pattern: /\bwiki[- ]?links?\b/i, use: 'connection, or "[[link]]" when you mean the syntax' },
  { pattern: /\bmarkers?\b/i, use: "pin" },
  { pattern: /\bquest log\b/i, use: "Quests" },
  { pattern: /\bsession log\b/i, use: "Sessions" },
  { pattern: /\bcampaign clock\b/i, use: "your date / today" },
  { pattern: /\breveal(s|ed|ing)?\b/i, use: '"Shown to players" / "Hidden from players" / "Show … to players"' },
  { pattern: /\bpublic\b/i, use: '"Shown to players"' },
  // No lookahead: "secret" mid-sentence must match too.
  { pattern: /\bsecret\b/i, use: '"Hidden from players" or "GM only"' },
  // The feature is the Journal in copy; `chronicle` identifiers are fine.
  { pattern: /\bchronicles?\b/i, use: "Journal" },
  { pattern: /\btimelines?\b/i, use: "Journal" },
  /**
   * The old names of the two-layer notes control. Anchored to the whole string, because the same words
   * appear legitimately in prose and "GM only" is the content-axis pill.
   */
  { pattern: /^Player-facing\b/, use: '"Player-visible notes": BODY_LAYER in codex/TwoLayerBodyTabs.tsx' },
  {
    pattern: /^What (will happen|the party knows|the party was told)$/,
    use: '"Player-visible notes": BODY_LAYER in codex/TwoLayerBodyTabs.tsx'
  },
  {
    pattern: /^(GM notes|GM-only side|GM secret body)$/,
    use: '"GM-only notes": BODY_LAYER in codex/TwoLayerBodyTabs.tsx'
  }
];

/** Exemptions, matched as whole strings so a new violation can't hide behind one. */
const ALLOWED = new Set<string>([
  // In-fiction content (what a faction is up to), with nothing to do with visibility.
  "Secret agenda"
]);

/** The scanner is shared with `play-vocabulary.test.ts` via `copy-scan.ts`. */
function codexSources(): readonly string[] {
  return readdirSync(CODEX_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
    .sort();
}

describe("The canonical glossary", () => {
  const strings = scanCopy(codexSources().map((file) => ({ file, read: readSource(`${CODEX_DIR}${file}`) })));

  it("reads enough of the Codex to be worth trusting", () => {
    // Guard against a scan that silently matches nothing. The floor keeps headroom on purpose.
    expect(codexSources().length).toBeGreaterThan(25);
    expect(strings.length).toBeGreaterThan(850);
  });

  it("sees the object-literal copy the old scanner was blind to", () => {
    // Object-key strings (e.g. `useConfirm` title/body) must be scanned; named so a narrowing fails here.
    const at = (file: string, text: string) => strings.some((entry) => entry.file === file && entry.text === text);
    expect(at("PagesView.tsx", "Delete folder")).toBe(true);
    expect(at("PagesView.tsx", 'Delete the folder "${path}"?${note}')).toBe(true);
    expect(
      strings.some(
        (entry) => entry.file === "StandingAdjuster.tsx" && entry.text.startsWith("Optional. Players never see")
      )
    ).toBe(true);
  });

  for (const { pattern, use } of RETIRED) {
    it(`never says ${String(pattern)} to a user: say ${use}`, () => {
      const offenders = strings.filter((entry) => pattern.test(entry.text) && !ALLOWED.has(entry.text));
      expect(offenders.map((entry) => `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`)).toEqual([]);
    });
  }

  it("has no exemption that rescues nothing: a dead exemption is a comment pretending to be a rule", () => {
    // Every exemption must still be needed.
    for (const allowed of ALLOWED) {
      const rescued = strings.filter(
        (entry) => entry.text === allowed && RETIRED.some(({ pattern }) => pattern.test(entry.text))
      );
      expect(rescued.length, `exemption ${JSON.stringify(allowed)} rescues nothing`).toBeGreaterThan(0);
    }
  });

  /** See `REVEAL_PRIMITIVE`. */
  it("keeps the reveal words locked after the control left this directory", () => {
    const source = readFileSync(REVEAL_PRIMITIVE, "utf8");
    // Reading the file is itself the tripwire: a move or rename should fail loudly.
    for (const phrase of ["Shown to players", "Hidden from players", "GM only", "Show to players"]) {
      expect(
        source.includes(`"${phrase}"`),
        `packages/ui/src/primitives/Reveal.tsx no longer says ${JSON.stringify(phrase)}.\n` +
          `These four are D28's visibility words and the whole product reads them off this one component.\n` +
          `Fix: restore the phrase. If it is genuinely being retired, retire it HERE too (RETIRED above) and in the\n` +
          `packages/ui reveal tests, in the same commit, and never in one place only.`
      ).toBe(true);
    }
  });

  it("never re-grows a reveal control inside the Codex: the record-axis phrases come from the primitive", () => {
    // A Codex surface typing these phrases has hand-rolled the toggle again. ("GM only" is the content pill and is allowed.)
    const offenders = strings.filter((entry) => /Shown to players|Hidden from players/.test(entry.text));
    expect(
      offenders.map((entry) => `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`),
      `Fix: import { RevealSwitch } or { VisibilityBadge } from "@vtt/ui" instead of writing the words.`
    ).toEqual([]);
  });
});

describe("The words the navigation itself uses", () => {
  it("names the laptop's sections, the phone's tabs and Campaign's parts in the decided words", () => {
    expect(CODEX_BAR.map((item) => item.label)).toEqual([
      "Home",
      "Search",
      "Atlas",
      "Story",
      "Quests",
      "Relationships"
    ]);
    expect(CODEX_PHONE_TABS.map((tab) => tab.label)).toEqual(["Home", "Pages", "Atlas", "Campaign", "Search"]);
    expect(CAMPAIGN_PARTS.map((part) => part.label)).toEqual(["Story", "Quests", "Relationships", "Sessions"]);
  });

  it("titles each section with the bar's own word, so a phone's top bar cannot drift from the nav", () => {
    for (const item of CODEX_BAR) {
      const section = item.path === "/codex" ? "home" : item.path.replace("/codex/", "");
      expect(SECTION_TITLE[section as keyof typeof SECTION_TITLE]).toBe(item.label);
    }
  });

  it("offers the player every destination the GM has, minus the GM menu's", () => {
    const gm = codexDestinations("gm").map((item) => item.label);
    const player = codexDestinations("player").map((item) => item.label);
    expect(gm.slice(0, player.length)).toEqual(player);
    expect(gm.slice(player.length)).toEqual(["Prep templates", "Backup", "Autosave and history"]);
  });
});

describe("The words a chronicle row uses", () => {
  it("gives every kind a label in TEXT, quests included", () => {
    // Each kind must say what it is without colour.
    for (const [kind, meta] of Object.entries(CHRONICLE_KIND_META)) {
      expect(meta.label, `chronicle kind ${kind}`).toMatch(/^[A-Z]/);
      expect(meta.iconId, `chronicle kind ${kind}`).toBeTruthy();
    }
    expect(CHRONICLE_KIND_META.quest.label).toBe("Quest");
  });
});
