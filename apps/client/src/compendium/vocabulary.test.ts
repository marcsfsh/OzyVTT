import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource, scanCopy } from "../copy-scan";
import { recordPieceSources } from "../convention-sources";

/**
 * The Compendium's words as a test. It is a record surface, so it says who sees a record the way the Codex does:
 * Hidden, Everyone, or the characters' names ("Revealed to Lyra Emberwise"), through WhoSeesIt in `@vtt/ui`. The play
 * surfaces' "Shown to players" and "Hidden from players" stay out of it, and so do the words those two retired.
 */

const DIR = `${process.cwd()}/src/compendium/`;

const RETIRED: ReadonlyArray<Readonly<{ pattern: RegExp; use: string }>> = [
  { pattern: /\bshown to players\b/i, use: '"Everyone" or "Revealed to <name>": the Codex\'s record words' },
  { pattern: /\bhidden from players\b/i, use: '"Hidden": the Codex\'s record word' },
  { pattern: /\bvisible to players\b/i, use: '"Who sees it", with Hidden, Everyone or the characters' },
  { pattern: /\bshow (it )?to players\b/i, use: '"share it", and Who sees it' },
  { pattern: /\bpublic\b/i, use: '"Everyone"' },
  { pattern: /\bsecret\b/i, use: '"Hidden"' },
  { pattern: /\bremove from pickers\b/i, use: '"Archive": the act is reversible' }
];

const files = () =>
  (readdirSync(DIR, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
    .sort();

describe("The Compendium's words", () => {
  // The record pieces in @vtt/ui are the Compendium's too.
  const strings = scanCopy([
    ...files().map((file) => ({ file, read: readSource(`${DIR}${file}`) })),
    ...recordPieceSources()
  ]);

  it("reads enough of the Compendium to be worth trusting", () => {
    expect(files().length).toBeGreaterThan(15);
    expect(strings.length).toBeGreaterThan(150);
  });

  it("says who sees a record in the Codex's words, never the play surfaces'", () => {
    const found: string[] = [];
    for (const entry of strings) {
      for (const rule of RETIRED)
        if (rule.pattern.test(entry.text)) found.push(`${entry.file}:${entry.line} "${entry.text}" -> ${rule.use}`);
    }
    expect(found).toEqual([]);
  });

  it("keeps Archive reversible in copy: the confirm says the record comes back", () => {
    const at = (text: RegExp) =>
      strings.find((entry) => entry.file === "record/useHomebrewRecord.ts" && text.test(entry.text));
    expect(at(/^Archive this\?$/), "the homebrew archive confirm").toBeDefined();
    const body = at(/stops appearing in the character builder/);
    expect(body, "the homebrew archive confirm has lost its body").toBeDefined();
    expect(/restore it later/i.test(body!.text), "an Archive confirm must say the thing comes back").toBe(true);
  });
});
