import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Runs `npm run content` for real into an empty scratch directory. Every step reads earlier steps'
 * bundles from that directory, so a step that read its own output, or ran before its input existed,
 * fails here; and every bundle must come out byte-identical to the committed one, so a source,
 * parser or overlay change that moves a bundle without regenerating it fails too.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const committedDir = join(packageRoot, "bundles");
const scratch = mkdtempSync(join(tmpdir(), "content-pipeline-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("npm run content", () => {
  it("rebuilds every committed bundle byte for byte from sources/ alone", { timeout: 120_000 }, () => {
    const stdout = execFileSync("node", ["--import", "tsx", "scripts/build-content.ts", `--out=${scratch}`], {
      cwd: packageRoot,
      encoding: "utf8"
    });
    expect(stdout).toContain("cross-check: 3 hand-authored classes agree with the source.");
    expect(stdout).toMatch(/rows changed by the overlay: [1-9]\d*/);

    const committed = readdirSync(committedDir).sort();
    expect(readdirSync(scratch).sort(), "the pipeline writes exactly the committed bundles").toEqual(committed);
    for (const file of committed) {
      expect(readFileSync(join(scratch, file), "utf8") === readFileSync(join(committedDir, file), "utf8"), file).toBe(
        true
      );
    }
  });
});
