import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth.js";

describe("player session recovery", () => {
  it("recognizes a remembered player token after the auth service restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-auth-recovery-"));
    const authPath = join(directory, "auth.json");
    try {
      const first = new AuthService(authPath);
      await first.initialize();
      await first.bootstrap("correct horse battery staple");
      const token = first.issuePlayerSession();
      const original = first.verifyPlayer(token);

      const restarted = new AuthService(authPath);
      await restarted.initialize();
      expect(restarted.verifyPlayer(token)).toEqual(original);
      expect(restarted.verify(token)).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
