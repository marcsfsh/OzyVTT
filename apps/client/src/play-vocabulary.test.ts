/**
 * The play vocabulary lock: one set of words for the product, enforced as test failures. Scans
 * `apps/client/src` minus `PLAY_EXCLUDED`, plus the `packages/ui` primitives, with `copy-scan.ts`.
 * A regex matches tokens, not senses, so some rules are scoped to files and LEGITIMATE pins the
 * domain words that must survive.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citeCopy, looksLikeCode, scanCopy, withoutInterpolations, type CopyString } from "./copy-scan";
import { CLAIM_WORD } from "./actors/actor-display";
import { SETTINGS_GROUPS } from "./settings/SettingsPage";
import { CONVENTION_SHAPE, assertRoots, playCopySources, stripComments } from "./design-conventions-shape";

assertRoots();

/**
 * Retired patterns, each with the word that replaced it so a failure says what to write. `where`
 * scopes a rule to files where only one sense of the word lives.
 */
const RETIRED: ReadonlyArray<Readonly<{ pattern: RegExp; use: string; where?: RegExp }>> = [
  // The playable entity
  {
    pattern: /\bactors?\b/i,
    use: "“character” / “monster” / “NPC” — the specific kind, or “character or monster” for the generic slot"
  },
  { pattern: /\bcombatants?\b/i, use: "“character” / “monster”; the list they are in is “Turn order”" },
  {
    pattern: /\bcreatures?\b/i,
    use: "the specific kind, or “it”/“its” — “on its own turn”, not “on this creature's turn”"
  },
  // Visibility: one decision, one pair of words (the RevealSwitch family's)
  {
    pattern: /\b(gm|shared) layer\b/i,
    use: "“Shown to players” / “Hidden from players” — a layer is an implementation detail, not a thing a GM decides about"
  },
  { pattern: /\bGM-only\b/, use: "“GM only”, unhyphenated — the spelling `GmOnlyTag` renders" },
  { pattern: /\bpublicly\b|\bpublic\b/i, use: "“Shown to players”" },
  // The dice phrasings. `^Everyone$`, not `\bEveryone\b`: a one-word string is a label and must use
  // the reveal words, while a sentence containing "Everyone" is just English.
  {
    pattern: /^Everyone$/,
    use: "“Shown to players” — the roll audience uses the same words as every other reveal (dice/DicePanel.tsx's ROLL_VISIBILITY_WORD)"
  },
  {
    pattern: /\bJust me\b|\bJust the GM\b/i,
    use: "“GM only” / “Hidden from players” — see ROLL_VISIBILITY_WORD in dice/DicePanel.tsx"
  },
  // Claim states
  { pattern: /\bunclaimed\b/i, use: "“Available” (actors/actor-display.ts's CLAIM_WORD)" },
  { pattern: /\btaken\b/i, use: "“Claimed” (actors/actor-display.ts's CLAIM_WORD)" },
  // The rules assistant
  {
    pattern: /\b(strict|assisted|freeform)\b/i,
    use: "“Enforce” / “Advise” / “Off” — the wire values keep their names, the dial does not"
  },
  // The fight, and the place it happens
  {
    pattern: /\bencounters?\b/i,
    use: "“fight” for the event (“Start the fight”, “Add to this fight”) and “Table” for the place — D28 demotes “encounter” to a wire name"
  },
  { pattern: /\bbattlemaps?\b/i, use: "“battle map”, two words — the Codex's spelling wins" },
  { pattern: /\bscene prep\b/i, use: "“Staging” — one name for the GM-private setup state, not three" },
  // A finished fight's record
  { pattern: /\brecordings?\b/i, use: "“replay”" },
  {
    pattern: /\barchives?\b/i,
    where: /\/replay\//,
    use: "“replay” — “Archive” stays the reversible verb elsewhere, but a finished fight's record is a Replay"
  },
  // The verb triad
  { pattern: /remove from pickers/i, use: "“Archive” — the act is reversible, so it is the Archive verb" },
  { pattern: /^Removed$/, use: "“Archived” — the state a reversible Archive leaves behind" }
];

/** (file, string) exemptions, so a word is excused only where it is correct; each must rescue something. */
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

/** Domain terms the lock must never eat, asserted present at their home. */
const LEGITIMATE: ReadonlyArray<readonly [file: string, text: string, why: string]> = [
  ["apps/client/src/scene/MapToolbar.tsx", "Reveal the whole map", "fog: Reveal/Hide are in-fight verbs D28 keeps"],
  ["apps/client/src/scene/MapToolbar.tsx", "Hide the whole map again", "fog: the Hide half"],
  [
    "apps/client/src/encounter/EncounterPanel.tsx",
    "Initiative d20",
    "Initiative the SCORE keeps its D&D name; only the LIST is “Turn order”"
  ],
  ["apps/client/src/encounter/EncounterPanel.tsx", "Saving throw for $", "Save the THROW, not the persist verb"],
  ["apps/client/src/actors/ClaimCharacter.tsx", "Claim", "the table's claim verb"],
  ["apps/client/src/actors/MyCharacter.tsx", "Release", "the table's release verb — never “Leave”"]
];

// The corpus

const strings: readonly CopyString[] = scanCopy(playCopySources()).filter((entry) => !looksLikeCode(entry.text));
/** What the word rules read: the sentence a person sees, with the `${…}` holes blanked. */
const visible = (entry: CopyString) => withoutInterpolations(entry.text);
const at = (file: string, text: string) => strings.some((entry) => entry.file === file && visible(entry) === text);

describe("The play glossary (D28)", () => {
  it("reads enough of the play surfaces to be worth trusting", () => {
    // Floors first: a scan that matched nothing would pass every rule below.
    expect(playCopySources().length).toBeGreaterThan(CONVENTION_SHAPE.playSourceFloor);
    expect(strings.length).toBeGreaterThan(CONVENTION_SHAPE.playCorpusFloor);
  });

  it("covers every play directory, not a list someone remembered to update", () => {
    // Named directories, so a scan that stops walking one fails by name rather than by a count.
    const dirs = new Set(playCopySources().map((source) => source.file.replace("apps/client/src/", "").split("/")[0]));
    for (const dir of [
      "actors",
      "builder",
      "dice",
      "encounter",
      "homebrew",
      "maps",
      "replay",
      "scene",
      "scenes",
      "settings",
      "tokens",
      "viewer"
    ]) {
      expect(dirs.has(dir), `apps/client/src/${dir}/ is not in the scan`).toBe(true);
    }
    expect(dirs.has("codex"), "codex/ has its own lock and must stay out of this one").toBe(false);
  });

  it("sees the copy shapes a naive scanner is blind to", () => {
    // Named strings, so a narrowed scanner fails by name: an object-literal confirm title, an
    // object-literal confirm body, and a template literal.
    expect(at("apps/client/src/replay/ReplayList.tsx", "Delete this replay?"), "object-literal confirm title").toBe(
      true
    );
    expect(
      at(
        "apps/client/src/encounter/EncounterPanel.tsx",
        "Turn order stays saved for reference, but the shared screen will hide it."
      ),
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
    // When copy is fixed at an exempted site this fails until the row is deleted, so the list can
    // only shrink.
    for (const [file, text, why] of ALLOWED) {
      const rescued = strings.filter(
        (entry) =>
          entry.file === file &&
          visible(entry) === text &&
          RETIRED.some(({ pattern, where }) => (!where || where.test(file)) && pattern.test(text))
      );
      expect(
        rescued.length,
        `exemption ${JSON.stringify(`${file} :: ${text}`)} rescues nothing — delete it`
      ).toBeGreaterThan(0);
      expect(why.length, `exemption ${JSON.stringify(text)} has no reason attached`).toBeGreaterThan(40);
    }
    expect(ALLOWED.length, "the exemption list is shrink-only — see design-conventions-shape.ts").toBe(
      CONVENTION_SHAPE.playExemptions
    );
  });

  it("keeps the domain words D28 deliberately kept", () => {
    // The other direction: a rule written too wide, or an over-eager copy pass, must not remove these.
    for (const [file, text, why] of LEGITIMATE) {
      expect(at(file, text), `${file} no longer says ${JSON.stringify(text)} — ${why}`).toBe(true);
    }
  });
});

describe("The structured copy, pinned at its one definition (D28)", () => {
  /** Words the corpus cannot see are pinned at the table they come from. */
  it("names the three claim states in D28's words", () => {
    expect(CLAIM_WORD).toEqual({ mine: "Your character", claimed: "Claimed", available: "Available" });
  });

  it("names the four roll audiences in the reveal words", () => {
    // Read as source rather than imported: `dice/DicePanel.tsx` pulls in the socket module. A rename
    // makes this throw, which is intended. Comments are stripped so only rendered copy is checked.
    const source = stripComments(readFileSync(`${process.cwd()}/src/dice/DicePanel.tsx`, "utf8"));
    // The four audiences at their exact strings. self-only and blind carry clarifier suffixes ("the GM
    // sees it" / "you won't see the result") after the reveal phrase.
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
      expect(source.includes(`"${dead}"`), `dice/DicePanel.tsx has re-grown the phrasing ${JSON.stringify(dead)}`).toBe(
        false
      );
    }
  });

  it("names the rules dial Enforce / Advise / Off, and the settings groups D24's three", () => {
    // The dial's labels are `SettingsPage.tsx`'s DIAL_COPY; the wire values stay strict/assisted/freeform,
    // which is why the RETIRED row above is about copy only.
    const source = readFileSync(`${process.cwd()}/src/settings/SettingsPage.tsx`, "utf8");
    expect(source).toMatch(/value: "strict", label: "Enforce"/);
    expect(source).toMatch(/value: "assisted", label: "Advise"/);
    expect(source).toMatch(/value: "freeform", label: "Off"/);
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(["Mine", "The table", "Players"]);
  });

  it("calls the place the Table and never the Encounter", () => {
    // "Encounter" is a fight, not a place. The GM tab table is checked through the scan (its rows are
    // `label: "…"`); the order is not pinned here.
    for (const label of ["Table", "Scenes", "Roster", "Codex", "Homebrew", "Settings"]) {
      expect(at("apps/client/src/shell/GmShell.tsx", label), `the GM tab bar no longer has a "${label}" tab`).toBe(
        true
      );
    }
    expect(at("apps/client/src/shell/GmShell.tsx", "Encounter"), 'the table tab is labelled "Encounter" again').toBe(
      false
    );
  });
});

describe("The verb triad, pinned per dialog (D28)", () => {
  /** Delete is permanent and says so; Archive is reversible; Remove takes something out of a list. */
  it("says “cannot be undone” on every Delete, and only on a Delete", () => {
    const undoable = strings.filter((entry) => /this cannot be undone/i.test(visible(entry)));
    expect(
      undoable.length,
      "no confirm says “This cannot be undone.” — the Delete dialogs have lost their warning"
    ).toBeGreaterThan(2);
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
      (entry) =>
        entry.file === "apps/client/src/homebrew/RecordDetail.tsx" &&
        /stops appearing in the character builder/.test(visible(entry))
    );
    expect(body, "the homebrew archive confirm has lost its body").toBeDefined();
    expect(/restore it later/i.test(visible(body!)), "an Archive confirm must say the thing comes back").toBe(true);
  });
});
