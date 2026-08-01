/**
 * C5 — the `.claude/` instruction layer describes the `.claude/` directory that exists.
 *
 * Four assertions, one source-of-truth family (directory listings) and one remedy family
 * (edit the index):
 *   1. `.claude/README.md`'s roster matches the directory, both directions, plus hook wiring.
 *   2. Every projection / HTTP choke point is matched by a `.claude/rules/*.md` `paths:` glob,
 *      so the hard invariants auto-load when it is opened — and every glob matches something.
 *   3. Every `docs/ai-context/` brief is reachable from the documented routing table.
 *   4. The documentation checks themselves are not skipped.
 */
import { describe, expect, it } from "vitest";
import { exists, globToRegExp, isDir, ls, read, tracked } from "./docs-support.js";

const readme = read(".claude/README.md");

// The listings are FILTERED. `.claude/hooks/` holds a README.md beside the three .mjs files,
// and an unfiltered listing would demand a roster row for it on day one.
const skills = ls(".claude/skills", (n) => isDir(`.claude/skills/${n}`) && exists(`.claude/skills/${n}/SKILL.md`));
const agents = ls(".claude/agents", (n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, ""));
const ruleFiles = ls(".claude/rules", (n) => n.endsWith(".md"));
const hooks = ls(".claude/hooks", (n) => n.endsWith(".mjs"));

const backticked = (name: string) => `\`${name}\``;

describe(".claude roster", () => {
  it("names every skill, agent, rule and hook that exists", () => {
    const rows: ReadonlyArray<readonly [kind: string, path: string, name: string]> = [
      ...skills.map((n) => ["skill", `.claude/skills/${n}/SKILL.md`, n] as const),
      ...agents.map((n) => ["agent", `.claude/agents/${n}.md`, n] as const),
      ...ruleFiles.map((n) => ["rule", `.claude/rules/${n}`, n] as const),
      ...hooks.map((n) => ["hook", `.claude/hooks/${n}`, n] as const),
    ];
    for (const [kind, path, name] of rows) {
      expect(
        readme,
        `${path} exists but the ${kind} \`${name}\` appears in no row of .claude/README.md.\n` +
          `Fix: add the row. (.claude/README.md says of itself that it must be updated when a skill/agent/rule/hook is added.)`
      ).toContain(backticked(name));
    }
  });

  it("names no skill or hook that no longer exists", () => {
    for (const m of readme.matchAll(/`(vtt-[a-z-]+)`/g)) {
      expect(skills, `.claude/README.md names the skill \`${m[1]}\`, which no longer exists.\nFix: delete the row.`).toContain(m[1]);
    }
    for (const m of readme.matchAll(/`([a-z-]+\.mjs)`/g)) {
      expect(hooks, `.claude/README.md names the hook \`${m[1]}\`, which no longer exists.\nFix: delete the row from .claude/README.md.`).toContain(m[1]);
    }
  });

  it("wires exactly the hook files that exist in .claude/settings.json", () => {
    const wired = new Set(JSON.stringify(JSON.parse(read(".claude/settings.json")).hooks ?? {}).match(/[A-Za-z0-9_-]+\.mjs/g) ?? []);
    for (const h of wired) {
      expect(hooks, `.claude/settings.json wires \`${h}\`, which is not a file in .claude/hooks/.\nFix: correct the command in .claude/settings.json, or restore the hook.`).toContain(h);
    }
    for (const h of hooks) {
      expect([...wired], `.claude/hooks/${h} exists but .claude/settings.json never runs it, so it does nothing.\nFix: wire it in .claude/settings.json, or delete the file.`).toContain(h);
    }
  });
});

describe(".claude rule coverage", () => {
  const rules = ruleFiles.map((file) => {
    const frontmatter = read(`.claude/rules/${file}`).match(/^---\n([\s\S]*?)\n---/);
    const globs = frontmatter ? [...frontmatter[1].matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]) : [];
    return { file, globs };
  });

  /** Where a projection or an HTTP surface is built is where a leak gets shipped. */
  const CHOKE_POINTS = tracked().filter((f) => /^apps\/server\/src\/([a-z0-9-]*projections|[a-z0-9-]*-http)\.ts$/.test(f));

  it("auto-loads a hard-invariant rule for every projection / HTTP choke point", () => {
    expect(CHOKE_POINTS.length, "no projection/HTTP choke points found - the pattern in this test has stopped matching the tree").toBeGreaterThan(0);
    for (const file of CHOKE_POINTS) {
      expect(
        rules.some((r) => r.globs.some((g) => globToRegExp(g).test(file))),
        `${file} is a projection/HTTP choke point that no .claude/rules/*.md \`paths:\` glob matches, so no hard-invariant rule auto-loads when it is opened.\n` +
          `Fix: add the path to the rule that owns the invariant — viewer/player leakage goes in .claude/rules/viewer-safety.md, authorization in roles-auth.md, the HTTP contract in api-contract.md.\n` +
          `(This is CLAUDE.md rule 3: projection is the security boundary.)`
      ).toBe(true);
    }
  });

  it("declares no path glob that matches nothing", () => {
    const files = tracked();
    for (const rule of rules) {
      for (const glob of rule.globs) {
        expect(
          files.some((f) => globToRegExp(glob).test(f)),
          `.claude/rules/${rule.file} declares \`${glob}\`, which matches no tracked file, so that rule never loads for it.\n` +
            `Fix: correct the glob or delete it from the frontmatter.`
        ).toBe(true);
      }
    }
  });
});

describe("context routing", () => {
  it("routes every docs/ai-context brief", () => {
    const router = read(".claude/skills/vtt-context-router/SKILL.md");
    for (const file of ls("docs/ai-context", (n) => n.endsWith(".md"))) {
      expect(
        router,
        `docs/ai-context/${file} exists but .claude/skills/vtt-context-router/SKILL.md never names it, so the documented workflow cannot reach it.\n` +
          `Fix: add it to the routing table in that skill.`
      ).toContain(file);
    }
  });
});

describe("the documentation checks themselves", () => {
  // The documentation checks hold every other claim in the repo. Nothing holds them, so they
  // hold themselves: a check that is disabled must not be able to leave the suite green.
  // Measured on this repo's vitest: emptying a check file is caught ("No test suite found in
  // file"), but disabling its assertions reports "Test Files 1 skipped" and EXITS 0 —
  // camouflaged by the skip this suite already reports in normal operation.
  const DISABLED = new RegExp("\\.(?:skip|todo)\\s*\\(");

  it("are not skipped", () => {
    const checks = ls("apps/server/test", (n) => /^docs-[a-z-]+\.test\.ts$/.test(n));
    expect(checks.length, "no apps/server/test/docs-*.test.ts files found - the documentation checks are gone").toBeGreaterThan(0);
    for (const file of checks) {
      expect(
        DISABLED.test(read(`apps/server/test/${file}`)),
        `apps/server/test/${file} contains a skipped or todo test. A documentation check that is skipped is a check that is gone, and vitest reports it as "skipped" rather than as a failure — so CI stays green.\n` +
          `Fix: fix the claim the check named, or delete the check outright in a commit that says so. Do not skip it.`
      ).toBe(false);
    }
  });
});
