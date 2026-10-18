/**
 * Windows and macOS file systems ignore case, so `./SceneList` there can resolve to a sibling `sceneList.ts`, and the
 * build fails only on those machines. This fails on two files in one folder whose import names differ only in case.
 */
import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPO = `${process.cwd()}/../..`;
const ROOTS = ["apps/client/src", "apps/client/test", "apps/server/src", "apps/server/test", "packages", "e2e"];
// The extensions an import may leave off; `landing.css` beside `Landing.tsx` is always imported by its full name.
const RESOLVED = /\.(m?[jt]sx?|json)$/;

function folders(dir: string): string[] {
  const out = [dir];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...folders(path));
  }
  return out;
}

describe("file names", () => {
  it("never differ only in case within a folder", () => {
    const clashes: string[] = [];
    for (const root of ROOTS) {
      for (const dir of folders(`${REPO}/${root}`)) {
        const byName = new Map<string, Set<string>>();
        for (const name of readdirSync(dir)) {
          if (!RESOLVED.test(name)) continue;
          const stem = name.replace(RESOLVED, "");
          const seen = byName.get(stem.toLowerCase()) ?? new Set<string>();
          seen.add(stem);
          byName.set(stem.toLowerCase(), seen);
        }
        for (const stems of byName.values())
          if (stems.size > 1) clashes.push(`${dir.slice(REPO.length + 1)}: ${[...stems].sort().join(" and ")}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});
