import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource, scanCopy } from "../copy-scan";
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

/**
 * The reveal control moved out (`SecretMarkers.tsx` → `packages/ui/src/primitives/Reveal.tsx`), because
 * every surface in the product now asks the same question and the Codex should not own the answer.
 *
 * **That is a MOVE, not a loosening, and the difference is worth stating.** Weakening is coverage lost
 * with nothing put in its place; tracking is the same assertion following the code to where the code
 * went. Measured on the day of the move: the corpus fell from 923 strings / 48 files to 919 / 47, the
 * exact four strings `SecretMarkers.tsx` contributed ("Hidden from players" ×2, "Shown to players",
 * "GM only"). Both floors below are unchanged and both still hold with room to spare — nothing was
 * lowered to accommodate this.
 *
 * The words themselves gained a pin they never had here: the block at the bottom of this file reads the
 * primitive's own source and requires the four phrases verbatim, and requires the Codex corpus to hold
 * NONE of the two record-axis phrases — so a future hand-rolled toggle in `src/codex/` fails with the
 * primitive named instead of quietly re-growing the control this move deleted. The behavioural half
 * (that the switch renders them, and which one in which state) is asserted where the component now
 * lives, in `packages/ui/src/primitives/reveal.test.tsx`.
 */
const REVEAL_PRIMITIVE = `${process.cwd()}/../../packages/ui/src/primitives/Reveal.tsx`;

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
  // The two pin-inspector hints used to say "is still secret" under a §3.4 exemption. The copy sweep
  // rewrote both onto the glossary term ("is hidden from them"), so the exemption rescued nothing and
  // was deleted rather than left as a comment pretending to be a rule.
  // A faction's in-fiction agenda. This is content vocabulary, not visibility vocabulary — the field
  // holds what the faction is secretly up to, and no reader could mistake it for a reveal state.
  "Secret agenda"
]);

/**
 * The scanner itself now lives in `apps/client/src/copy-scan.ts`, because the play surfaces
 * needed the same one and two copies of it would drift — the exact disease these locks exist
 * to catch, inside the enforcement layer. It moved verbatim: the props list, the calls list and
 * all three extraction branches are the ones written here, unchanged, and every floor and pin
 * below is the number it measured before the move. That is the proof the extraction changed
 * nothing. `play-vocabulary.test.ts` reads the same function over the play directories with its
 * own glossary.
 */
function codexSources(): readonly string[] {
  return readdirSync(CODEX_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
    .sort();
}

describe("The canonical glossary (D5)", () => {
  const strings = scanCopy(
    codexSources().map((file) => ({ file, read: readSource(`${CODEX_DIR}${file}`) }))
  );

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
    expect(strings.some((entry) => entry.file === "StandingAdjuster.tsx" && entry.text.startsWith("Optional. Players never see"))).toBe(true);
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

  /** The two halves of the reveal control's relocation — see `REVEAL_PRIMITIVE` above. */
  it("keeps the reveal words locked after the control left this directory", () => {
    const source = readFileSync(REVEAL_PRIMITIVE, "utf8");
    // Reading the file at all is the tripwire: a rename or another move makes this throw, which is the
    // point — the pin must break loudly rather than pass over a control that is no longer there.
    for (const phrase of ["Shown to players", "Hidden from players", "GM only", "Show to players"]) {
      expect(
        source.includes(`"${phrase}"`),
        `packages/ui/src/primitives/Reveal.tsx no longer says ${JSON.stringify(phrase)}.\n` +
          `These four are D28's visibility words and the whole product reads them off this one component.\n` +
          `Fix: restore the phrase. If it is genuinely being retired, retire it HERE too (RETIRED above) and in the\n` +
          `packages/ui reveal tests, in the same commit — never in one place only.`
      ).toBe(true);
    }
  });

  it("never re-grows a reveal control inside the Codex — the record-axis phrases come from the primitive", () => {
    // Zero on the day the control moved out, and it must stay zero: a Codex surface that types
    // "Shown to players" into its own JSX has hand-rolled the toggle again, which is exactly the drift
    // the promotion exists to end. (The CONTENT pill's "GM only" is a different axis and legitimately
    // still appears in Codex copy — the atlas descend-lock and two field labels — so it is not listed.)
    const offenders = strings.filter((entry) => /Shown to players|Hidden from players/.test(entry.text));
    expect(
      offenders.map((entry) => `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`),
      `Fix: import { RevealSwitch } or { VisibilityBadge } from "@vtt/ui" instead of writing the words.`
    ).toEqual([]);
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
