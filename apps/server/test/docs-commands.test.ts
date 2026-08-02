/**
 * C2 — `CLAUDE.md`'s command surface and workspace list against `package.json`.
 *
 * `CLAUDE.md` is the one file every session loads. A root command that is not in it is a
 * command an agent cannot find, and enforcement without a discoverable remedy is an obstacle
 * rather than a check. Deliberately format-independent: no table parsing, so a rewrite of the
 * Commands table cannot silently disable this.
 */
import { describe, expect, it } from "vitest";
import { read, repoReferencesIn, rootScripts, workspacePaths, workspaceScriptNames } from "./docs-support.js";

const claude = read("CLAUDE.md");

/** `npm run map` must not be satisfied by `npm run map:something`. */
const namesCommand = (script: string): RegExp =>
  new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9:_-])`);

describe("CLAUDE.md command surface", () => {
  it("documents every root npm script (a command an agent cannot find is a check with no remedy)", () => {
    for (const script of rootScripts()) {
      expect(
        claude,
        `\`npm run ${script}\` exists in package.json but CLAUDE.md never mentions it.\n` +
          `Fix: add a row to CLAUDE.md's Commands table.`
      ).toMatch(namesCommand(script));
    }
  });

  it("names no command that no longer exists", () => {
    const root = rootScripts();
    for (const m of claude.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
      const name = m[1];
      // A workspace-scoped command (`npm run docs:generate --workspace=…`) is not a root script
      // and naming one is not a defect. Only skip names a workspace actually defines.
      if (name.includes(":") && workspaceScriptNames().has(name)) continue;
      expect(
        root,
        `CLAUDE.md tells agents to run \`npm run ${name}\`, which is not a script in package.json.\n` +
          `Fix: delete the line from CLAUDE.md, or add the script to package.json.`
      ).toContain(name);
    }
  });

  it("names every workspace", () => {
    // NOT a substring test. `claude.includes("ui")` is true because `ui` sits inside the word
    // "built", so that assertion could never fail. Resolve against the same brace-expanded
    // reference set docs-paths.test.ts extracts, so the claim under test is the PATH.
    const referenced = repoReferencesIn("CLAUDE.md");
    for (const ws of workspacePaths()) {
      expect(
        referenced.has(ws),
        `Workspace \`${ws}\` exists but is not named anywhere in CLAUDE.md.\n` +
          `Fix: add it to CLAUDE.md's monorepo-layout line (the \`packages/{…}\` brace list is expanded before this check, so adding it there is enough).`
      ).toBe(true);
    }
  });
});
