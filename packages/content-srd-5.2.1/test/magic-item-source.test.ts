import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the vendored `magic-items.md` so a re-vendor cannot silently shift rows under the parser. The
 * hash fixes every byte; `build-magic-items.ts` refuses a parse that does not find the 260 entries
 * and 268 rows it expects, and `content-pipeline.test.ts` holds its output to the committed bundle.
 */

const SOURCE = fileURLToPath(new URL("../sources/dnd-5e-srd-markdown/magic-items.md", import.meta.url));
const PROVENANCE = fileURLToPath(new URL("../sources/dnd-5e-srd-markdown/PROVENANCE.json", import.meta.url));

describe("the vendored magic-item source", () => {
  it("is the exact file vendored, byte for byte", () => {
    expect(createHash("sha256").update(readFileSync(SOURCE)).digest("hex")).toBe(
      "96c71ad35dddf0e79e47ac3d7bbe96704b5209c1f6e1bf01d543080789e18e98"
    );
  });

  it("is recorded in PROVENANCE.json as vendored, not as deliberately left out", () => {
    const provenance = JSON.parse(readFileSync(PROVENANCE, "utf8")) as {
      files: string[];
      notVendored: string;
      commit: string;
    };
    expect(provenance.files).toContain("magic-items.md");
    expect(provenance.notVendored).not.toContain("magic-items.md");
    expect(provenance.commit).toBe("1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4");
  });
});
