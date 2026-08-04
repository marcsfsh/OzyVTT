/**
 * D28 — THE PLAY VOCABULARY LOCK. One product, one set of words, enforced as a test failure.
 *
 * The Codex learned this lesson first (`codex/vocabulary.test.ts`): a *page* was a "note", an
 * "entity" and a "page" on three surfaces, and nothing broke — the product just got harder to
 * learn. The table had the same disease and worse, because more people wrote it: the thing you
 * put on the map was an "actor", a "combatant" and a "creature"; one roll audience had FIVE
 * names in a single `<select>`; the same fight was an "encounter" in the tab bar, a place in
 * one sentence and an event in the next; a character was "Unclaimed" on the GM's roster and
 * "Taken" on the player's.
 *
 * So there is one glossary now, and this is where it is kept honest.
 *
 * **Scope: everything under `apps/client/src` MINUS a pinned exclusion list**, plus
 * `packages/ui/src/primitives` (the shared controls carry the shared words). An exclusion list
 * rather than an include list, deliberately: a new play directory must be born scanned. The
 * previous engagement added `settings/`, `builder/`, `replay/` and `scenes/` — under an include
 * list every one of them would have arrived unlocked, and "we'll add it to the list" is how a
 * lock becomes decoration. The exclusions are `codex/` (its own lock, and a genuinely different
 * glossary — it retires "reveal", which fog legitimately keeps) and `styleguide/` (a developer
 * reference must be able to name a retired word in order to say it is retired). Both are pinned
 * in `design-conventions-shape.ts` with their reasons, and a third entry is a reviewed diff.
 *
 * **The scanner is `copy-scan.ts` — the Codex's, moved out so there is exactly one.** It reads
 * JSX text, label-ish props in both spellings, and the calls that put a sentence on screen. It
 * does NOT read identifiers, wire values or comments: `visibility === "gm-only"` is protocol,
 * `label="GM only"` is copy, and telling those apart is the whole job. Comments are stripped
 * before scanning here (they are not user-facing, and a comment that names a retired word to
 * say it is retired must not fail the rule).
 *
 * **Two things this file deliberately cannot do, stated rather than implied:**
 *  1. *Interpolated copy.* A literal inside a JSX expression — `{claimed ? "Claimed" :
 *     "Unclaimed"}`, `{actor.kind}` — is invisible, because widening the scan to every string
 *     literal would flag every wire value in the tree and the lock would be off within a week.
 *     Those sites are fixed at the source and held by the pins below where they are structured
 *     (the claim words and the roll-visibility words are pinned at their one definition, which
 *     is stronger than any scan).
 *  2. *Meaning.* A regex matches tokens, not senses. "Save" the throw and "Save" the persist
 *     verb are one token; so are "Initiative" the score and "Initiative" the list. Those are
 *     separated by scoping a rule to files where one sense lives, and by review everywhere
 *     else — see LEGITIMATE below, which pins the domain terms this lock must never eat.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citeCopy, looksLikeCode, scanCopy, withoutInterpolations, type CopyString } from "./copy-scan";
import { CLAIM_WORD } from "./actors/actor-display";
import { SETTINGS_GROUPS } from "./settings/SettingsPage";
import { CONVENTION_SHAPE, assertRoots, playCopySources, stripComments } from "./design-conventions-shape";

assertRoots();

/**
 * The glossary, as rules. Each row is a retired pattern plus the word that replaced it, so a
 * failure tells the next person what to type instead of only what not to.
 *
 * `where` scopes a rule to the files where exactly one sense of the word lives. Two rows need
 * it, and both are the same shape of problem: "archive" is the verb-triad WINNER on the roster
 * and in homebrew ("Archive / Restore", reversible, kept) and a retired NOUN in the replay
 * surface, where a finished fight's record is a **Replay**.
 */
const RETIRED: ReadonlyArray<Readonly<{ pattern: RegExp; use: string; where?: RegExp }>> = [
  // ── the playable entity ──
  { pattern: /\bactors?\b/i, use: "“character” / “monster” / “NPC” — the specific kind, or “character or monster” for the generic slot" },
  { pattern: /\bcombatants?\b/i, use: "“character” / “monster”; the list they are in is “Turn order”" },
  { pattern: /\bcreatures?\b/i, use: "the specific kind, or “it”/“its” — “on its own turn”, not “on this creature's turn”" },
  // ── visibility: one decision, one pair of words (the RevealSwitch family's) ──
  { pattern: /\b(gm|shared) layer\b/i, use: "“Shown to players” / “Hidden from players” — a layer is an implementation detail, not a thing a GM decides about" },
  { pattern: /\bGM-only\b/, use: "“GM only”, unhyphenated — the spelling `GmOnlyTag` renders" },
  { pattern: /\bpublicly\b|\bpublic\b/i, use: "“Shown to players”" },
  // The five dice phrasings. `^Everyone$` and not `\bEveryone\b`: a string that is exactly one
  // word is a label, and a label for an audience must be one of the reveal words; "Everyone on
  // the roster is already in this fight" is a sentence and stays English.
  { pattern: /^Everyone$/, use: "“Shown to players” — the roll audience uses the same words as every other reveal (dice/DicePanel.tsx's ROLL_VISIBILITY_WORD)" },
  { pattern: /\bJust me\b|\bJust the GM\b/i, use: "“GM only” / “Hidden from players” — see ROLL_VISIBILITY_WORD in dice/DicePanel.tsx" },
  // ── claim states ──
  { pattern: /\bunclaimed\b/i, use: "“Available” (actors/actor-display.ts's CLAIM_WORD)" },
  { pattern: /\btaken\b/i, use: "“Claimed” (actors/actor-display.ts's CLAIM_WORD)" },
  // ── the rules assistant (D6) ──
  { pattern: /\b(strict|assisted|freeform)\b/i, use: "“Enforce” / “Advise” / “Off” — the wire values keep their names, the dial does not" },
  // ── the fight, and the place it happens ──
  { pattern: /\bencounters?\b/i, use: "“fight” for the event (“Start the fight”, “Add to this fight”) and “Table” for the place — D28 demotes “encounter” to a wire name" },
  { pattern: /\bbattlemaps?\b/i, use: "“battle map”, two words — the Codex's spelling wins" },
  { pattern: /\bscene prep\b/i, use: "“Staging” — one name for the GM-private setup state, not three" },
  // ── a finished fight's record ──
  { pattern: /\brecordings?\b/i, use: "“replay”" },
  { pattern: /\barchives?\b/i, where: /\/replay\//, use: "“replay” — “Archive” stays the reversible verb elsewhere, but a finished fight's record is a Replay" },
  // ── the verb triad ──
  { pattern: /remove from pickers/i, use: "“Archive” — the act is reversible, so it is the Archive verb" },
  { pattern: /^Removed$/, use: "“Archived” — the state a reversible Archive leaves behind" }
];

/**
 * Exemptions, as (file, string) PAIRS rather than the Codex's whole-string set.
 *
 * The difference is the point: a word that is domain-correct in one file must not be excused
 * everywhere. "Creature type" is SRD's own name for a monster's type line and belongs in the
 * homebrew authoring form; the same word in a token picker was drift, and was fixed rather than
 * added here.
 *
 * Every entry must rescue something — see the dead-exemption check at the bottom.
 */
const ALLOWED: ReadonlyArray<readonly [file: string, text: string, why: string]> = [
  [
    "apps/client/src/homebrew/RiderEditor.tsx",
    "Kinds of creature",
    "SRD's own vocabulary: a monster's type line is its “creature type”, and a homebrew rider that " +
      "applies to Undead and Fiends is filtered by exactly that field. Renaming it would make the form " +
      "disagree with the rulebook the GM is copying from."
  ],
  [
    "apps/client/src/homebrew/schemas.ts",
    "Creature type",
    "The same SRD field, in the monster form's own schema — the label the rider form above reads. " +
      "Two files, two rows: a (file, string) exemption is scoped on purpose, so excusing the word here " +
      "does not excuse it in a token picker, where it WAS drift and was fixed instead."
  ]
];

/**
 * The domain terms this lock must never eat, pinned as strings that MUST still be there.
 *
 * A vocabulary lock's real risk is not that it misses drift; it is that an over-broad rule, or
 * an over-eager copy pass, quietly deletes a word the game needs. D28 keeps all six of these on
 * purpose, and each is asserted present at its home rather than merely left un-ruled: fog
 * reveals and hides (in-fight verbs), the shared screen presents, Initiative is the SCORE (only
 * the list is "Turn order"), Save is the THROW, and a character is Claimed and Released.
 */
const LEGITIMATE: ReadonlyArray<readonly [file: string, text: string, why: string]> = [
  ["apps/client/src/scene/MapToolbar.tsx", "Reveal the whole map", "fog: Reveal/Hide are in-fight verbs D28 keeps"],
  ["apps/client/src/scene/MapToolbar.tsx", "Hide the whole map again", "fog: the Hide half"],
  ["apps/client/src/encounter/EncounterPanel.tsx", "Initiative d20", "Initiative the SCORE keeps its D&D name; only the LIST is “Turn order”"],
  ["apps/client/src/encounter/EncounterPanel.tsx", "Saving throw for $", "Save the THROW, not the persist verb"],
  ["apps/client/src/actors/ClaimCharacter.tsx", "Claim", "the table's claim verb"],
  ["apps/client/src/actors/YouArePlaying.tsx", "Release", "the table's release verb — never “Leave”"]
];

// ───────────────────────────── the corpus ─────────────────────────────

const strings: readonly CopyString[] = scanCopy(playCopySources()).filter((entry) => !looksLikeCode(entry.text));
/** What the word rules read: the sentence a person sees, with the `${…}` holes blanked. */
const visible = (entry: CopyString) => withoutInterpolations(entry.text);
const at = (file: string, text: string) => strings.some((entry) => entry.file === file && visible(entry) === text);

describe("The play glossary (D28)", () => {
  it("reads enough of the play surfaces to be worth trusting", () => {
    // The tripwire on the tripwire. A scan that silently matched nothing would pass forever, and
    // every rule below would be decoration — so the floors fail before the rules can lie.
    expect(playCopySources().length).toBeGreaterThan(CONVENTION_SHAPE.playSourceFloor);
    expect(strings.length).toBeGreaterThan(CONVENTION_SHAPE.playCorpusFloor);
  });

  it("covers every play directory, not a list someone remembered to update", () => {
    // The anti-refragmentation assertion. `settings/`, `builder/` and `replay/` are the newest
    // surfaces in the tree; naming them here means a scan that stops walking one fails by NAME
    // rather than by a count that a busy week could talk itself past.
    const dirs = new Set(playCopySources().map((source) => source.file.replace("apps/client/src/", "").split("/")[0]));
    for (const dir of ["actors", "builder", "dice", "encounter", "homebrew", "maps", "replay", "scene", "scenes", "settings", "tokens", "viewer"]) {
      expect(dirs.has(dir), `apps/client/src/${dir}/ is not in the scan`).toBe(true);
    }
    expect(dirs.has("codex"), "codex/ has its own lock and must stay out of this one").toBe(false);
    expect(dirs.has("styleguide"), "styleguide/ must be able to demo a retired word").toBe(false);
  });

  it("sees the copy shapes a naive scanner is blind to", () => {
    // Named strings, not a count, so a future narrowing of the scanner fails HERE by name instead
    // of quietly measuring less. One of each class the `prop="…"`-only scanner used to miss:
    // an object-literal confirm title, an object-literal confirm body, and a template literal.
    expect(at("apps/client/src/replay/ReplayPanel.tsx", "Delete this replay?"), "object-literal confirm title").toBe(true);
    expect(
      at("apps/client/src/encounter/EncounterPanel.tsx", "Turn order stays saved for reference, but the shared screen will hide it."),
      "object-literal confirm body"
    ).toBe(true);
    expect(at("apps/client/src/actors/ClaimCharacter.tsx", "Claim $?"), "template-literal confirm title").toBe(true);
  });

  for (const { pattern, use, where } of RETIRED) {
    const scope = where ? ` in ${String(where)}` : "";
    it(`never says ${String(pattern)}${scope} to a user — say ${use}`, () => {
      const offenders = strings.filter(
        (entry) =>
          (!where || where.test(entry.file)) &&
          pattern.test(visible(entry)) &&
          !ALLOWED.some(([file, text]) => file === entry.file && text === visible(entry))
      );
      expect(offenders.map(citeCopy), `Say ${use}.`).toEqual([]);
    });
  }

  it("has no exemption that rescues nothing — a dead exemption is a comment pretending to be a rule", () => {
    // The rule that keeps the exemption list from becoming the glossary. When copy is fixed at an
    // exempted site, this fails until the row is deleted, so the list can only ever shrink.
    for (const [file, text, why] of ALLOWED) {
      const rescued = strings.filter(
        (entry) => entry.file === file && visible(entry) === text && RETIRED.some(({ pattern, where }) => (!where || where.test(file)) && pattern.test(text))
      );
      expect(rescued.length, `exemption ${JSON.stringify(`${file} :: ${text}`)} rescues nothing — delete it`).toBeGreaterThan(0);
      expect(why.length, `exemption ${JSON.stringify(text)} has no reason attached`).toBeGreaterThan(40);
    }
    expect(ALLOWED.length, "the exemption list is shrink-only — see design-conventions-shape.ts").toBe(CONVENTION_SHAPE.playExemptions);
  });

  it("keeps the domain words D28 deliberately kept", () => {
    // The other direction, and the one a negative-only lock gets wrong: fog still Reveals, the
    // score is still Initiative, the throw is still a Save, and a character is Claimed and
    // Released. If a future rule is written too wide, or a copy pass too eagerly, this fails.
    for (const [file, text, why] of LEGITIMATE) {
      expect(at(file, text), `${file} no longer says ${JSON.stringify(text)} — ${why}`).toBe(true);
    }
  });
});

describe("The structured copy, pinned at its one definition (D28)", () => {
  /**
   * The classes the corpus cannot see, held where they are declared instead. A ternary label and
   * an `<option>`'s interpolated text are invisible to any prop/JSX-text scan; the tables they
   * come from are not, and pinning the TABLE is strictly stronger than pinning a rendering of it.
   */
  it("names the three claim states in D28's words", () => {
    expect(CLAIM_WORD).toEqual({ mine: "Your character", claimed: "Claimed", available: "Available" });
  });

  it("names the four roll audiences in the reveal words", () => {
    // Read as source rather than imported: `dice/DicePanel.tsx` pulls in the socket module, and a
    // vocabulary lock has no business opening a socket. Reading the file is also the tripwire —
    // a rename makes this throw, which is what it is for.
    // Comments stripped: the component's own header quotes all five retired phrasings in order to
    // say they are retired, exactly as the styleguide exclusion does at directory scope.
    const source = stripComments(readFileSync(`${process.cwd()}/src/dice/DicePanel.tsx`, "utf8"));
    // The four audiences, pinned at their EXACT strings. self-only and blind carry plan-1 §C's
    // clarifier suffixes (restored 2026-08-04): the head of each is still the reveal phrase, and
    // the suffix is the fact a player most needs ("the GM sees it" / "you won't see the result").
    for (const phrase of [
      "Shown to players",
      "GM only",
      "Hidden from players — you and the GM see it",
      "GM only — you won't see the result"
    ]) {
      expect(
        source.includes(`"${phrase}"`),
        `dice/DicePanel.tsx no longer says ${JSON.stringify(phrase)}.\n` +
          `One roll audience had five names in this one component ("Everyone", "Just me (GM)", "Just me",\n` +
          `"Just me and the GM", "Just the GM"). ROLL_VISIBILITY_WORD is where that ended.\n` +
          `Fix: restore the phrase, or retire it in RETIRED above and in packages/ui's reveal tests too — never here only.`
      ).toBe(true);
    }
    for (const dead of ["Just me (GM)", "Just me and the GM", "Just the GM"]) {
      expect(source.includes(`"${dead}"`), `dice/DicePanel.tsx has re-grown the phrasing ${JSON.stringify(dead)}`).toBe(false);
    }
  });

  it("names the rules dial Enforce / Advise / Off, and the settings groups D24's three", () => {
    // The dial's own labels are `SettingsPage.tsx`'s DIAL_COPY; the wire values stay
    // strict/assisted/freeform, which is exactly why the RETIRED row above is about copy only.
    const source = readFileSync(`${process.cwd()}/src/settings/SettingsPage.tsx`, "utf8");
    expect(source).toMatch(/value: "strict", label: "Enforce"/);
    expect(source).toMatch(/value: "assisted", label: "Advise"/);
    expect(source).toMatch(/value: "freeform", label: "Off"/);
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(["Mine", "The table", "Players"]);
  });

  it("calls the place the Table and never the Encounter", () => {
    // D28's "Encounter = a fight, not a place", enforced at the one place it is structural. The
    // tab table lives in `main.tsx`, which calls `createRoot` at import and so cannot be imported
    // by a test — but its rows are `label: "…"`, which the corpus reads, so the labels are pinned
    // through the scan. Weaker than importing the array, and said so: the ORDER is not pinned here.
    for (const label of ["Table", "Scenes", "Roster", "Codex", "Homebrew", "Settings"]) {
      expect(at("apps/client/src/main.tsx", label), `the GM tab bar no longer has a "${label}" tab`).toBe(true);
    }
    expect(at("apps/client/src/main.tsx", "Encounter"), 'the table tab is labelled "Encounter" again').toBe(false);
  });
});

describe("The verb triad, pinned per dialog (D28)", () => {
  /**
   * Delete is permanent and says so; Archive is reversible; Remove takes something out of a list
   * and the thing survives. The words drifted hardest in confirm dialogs, because a confirm is
   * written once and never re-read — so each destructive confirm's own copy is pinned by name.
   */
  it("says “cannot be undone” on every Delete, and only on a Delete", () => {
    const undoable = strings.filter((entry) => /this cannot be undone/i.test(visible(entry)));
    expect(undoable.length, "no confirm says “This cannot be undone.” — the Delete dialogs have lost their warning").toBeGreaterThan(2);
    for (const entry of undoable) {
      expect(
        /\barchiv/i.test(visible(entry)),
        `${citeCopy(entry)} promises permanence in an Archive dialog. Archive is REVERSIBLE — use Delete, or drop the sentence.`
      ).toBe(false);
    }
  });

  it("keeps Archive reversible in copy — it offers a way back", () => {
    expect(at("apps/client/src/homebrew/RecordDetail.tsx", "Archive this?"), "the homebrew archive confirm").toBe(true);
    const body = strings.find(
      (entry) => entry.file === "apps/client/src/homebrew/RecordDetail.tsx" && /stops appearing in the character builder/.test(visible(entry))
    );
    expect(body, "the homebrew archive confirm has lost its body").toBeDefined();
    expect(/restore it later/i.test(visible(body!)), "an Archive confirm must say the thing comes back").toBe(true);
  });
});
