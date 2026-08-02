/**
 * C6 — the viewer-safety invariants say the same thing in the document and in the tests that
 * prove them. Phrase pinning, applied to the highest-consequence prose in the repo
 * (CLAUDE.md rule 3), and the same pattern `packages/api-contract/test/reference.test.ts`
 * already uses against ADR-0016.
 *
 * Both directions are load-bearing, and this is the prose form of "never coverage without
 * byte-equality":
 *   - Direction 1 (completeness): an invariant the suite proves must be written down. Alone it
 *     passes forever against a document padded with invariants nobody proves.
 *   - Direction 2 (currency): an invariant the document asserts must still be proven. Alone it
 *     passes forever against a document that states three of seven.
 * Shipping one without the other produces a document that looks guarded and is not.
 *
 * The phrases are sentences about BEHAVIOUR, not implementation nouns, so ordinary refactors do
 * not touch them.
 *
 * WHITESPACE IS NORMALISED ON BOTH SIDES before comparing. The first version compared raw text,
 * which made re-flowing a paragraph — `gq` in Vim, an editor's "reformat", a contributor tidying
 * a ragged line — turn this check red with **no word changed**. That is the false alarm that gets
 * a check deleted rather than obeyed, and the document could only defend itself with an HTML
 * comment asking humans not to re-wrap, which no tool reads. Collapsing runs of whitespace keeps
 * the thing that matters (the words, in order) and makes line breaks irrelevant.
 */
import { describe, expect, it } from "vitest";
import { CHECK_SHAPE, read } from "./docs-support.js";

const DOC = "docs/ai-context/viewer-mode.md";

/** Line breaks are formatting; the words are the claim. Compare the words. */
const flat = (s: string): string => s.replace(/\s+/g, " ");

/** Every phrase is lifted verbatim from the title of the test that proves the invariant. */
const PINS: ReadonlyArray<readonly [phrase: string, provingTest: string]> = [
  ["hides all presentation content while disabled", "apps/server/test/viewer-presentation.test.ts"],
  ["rejects non-GM control", "apps/server/test/viewer-presentation.test.ts"],
  ["omits a gm-only combatant from both the player and the viewer lists", "apps/server/test/encounter-projections.test.ts"],
  ["projects only public, non-expired annotations onto the shared screen", "apps/server/test/encounter-projections.test.ts"],
  ["exact HP never reaches others", "apps/server/test/encounter-projections.test.ts"],
  ["keeping the map/fog but no tokens", "apps/server/test/encounter-projections.test.ts"],
  ["reaches players and the viewer verbatim", "apps/server/test/fog.test.ts"],
];

/**
 * The exported names the document points at instead of restating what they contain — including
 * the two types its "read the types, not a list here" rule sends the reader to. Both directions
 * again: the doc must still name it, and it must still be exported.
 */
const SYMBOLS: ReadonlyArray<readonly [symbol: string, file: string]> = [
  ["projectViewerPresentation", "apps/server/src/viewer-presentation.ts"],
  ["applyViewerCommand", "apps/server/src/viewer-presentation.ts"],
  ["ViewerAuthorizationError", "apps/server/src/viewer-presentation.ts"],
  ["ViewerPresentationProjection", "apps/server/src/viewer-presentation.ts"],
  ["ViewerEncounterScene", "apps/server/src/viewer-presentation.ts"],
  ["projectViewerEncounterScene", "apps/server/src/viewer-encounter.ts"],
];

describe("viewer-safety invariants", () => {
  it("states the viewer-safety invariants in the same words as the tests that prove them", () => {
    const doc = flat(read(DOC));
    let verified = 0;
    for (const [phrase, provingTest] of PINS) {
      const test = flat(read(provingTest));
      expect(
        doc,
        `viewer safety: ${provingTest} proves "${phrase}" but ${DOC} does not say it.\n` +
          `Fix: restore the sentence in ${DOC}'s Invariants section. The doc and the test that proves the invariant state it in the same words, on purpose, so changing one forces changing the other.\n` +
          `(Line wrapping does not matter — both sides are whitespace-normalised before comparing. If the sentence looks present, a WORD changed.)`
      ).toContain(flat(phrase));
      expect(
        test,
        `viewer safety: ${DOC} states "${phrase}" but ${provingTest} no longer does. The invariant may have moved, been renamed, or been weakened.\n` +
          `Fix: if it still holds, restore the wording in the test title.\n` +
          `If it genuinely changed, change all THREE in the same commit: the test title, the sentence in ${DOC}, and the PINS entry at the top of apps/server/test/docs-viewer-safety.test.ts.\n` +
          `See both sides at once: git grep -n ${JSON.stringify(phrase)} -- ${provingTest} ${DOC}`
      ).toContain(flat(phrase));
      verified++;
    }
    // COUNT THE WORK, not the declaration. `PINS.length` alone still reads as 7 after
    // `for (… of PINS.slice(0, 0))` — measured: all seven pins disabled, suite green.
    expect(
      verified,
      `only ${verified} of an expected ${CHECK_SHAPE.pins} viewer-safety phrase pins actually ran.\n` +
        `A pin that is declared but not iterated guards nothing, and the suite reports it as passing.\n` +
        `Fix: restore the loop over the whole PINS array. If a pin was deliberately retired, update CHECK_SHAPE.pins in apps/server/test/docs-support.ts in the same commit.`
    ).toBe(CHECK_SHAPE.pins);
  });

  it("names only viewer symbols that still exist", () => {
    const doc = read(DOC);
    let verified = 0;
    for (const [symbol, file] of SYMBOLS) {
      expect(doc, `${DOC} no longer names \`${symbol}\`, so this pin guards nothing.\nFix: restore the reference in ${DOC}, or remove the SYMBOLS row in apps/server/test/docs-viewer-safety.test.ts.`).toContain(symbol);
      expect(
        read(file),
        `${DOC} names \`${symbol}\`, which is no longer exported from ${file}.\n` +
          `Fix: update the doc to the new name, or restore the export.`
      ).toMatch(new RegExp(`export (?:function|const|type|class|interface) ${symbol}\\b`));
      verified++;
    }
    expect(
      verified,
      `only ${verified} of an expected ${CHECK_SHAPE.symbols} viewer symbols were actually checked.\n` +
        `Emptying SYMBOLS leaves this test reporting as passed while proving nothing.\n` +
        `Fix: restore the array. If a symbol was deliberately retired, update CHECK_SHAPE.symbols in apps/server/test/docs-support.ts in the same commit.`
    ).toBe(CHECK_SHAPE.symbols);
  });
});
