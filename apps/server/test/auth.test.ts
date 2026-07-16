import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth.js";

async function withTempAuthPath(run: (authPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-auth-"));
  try {
    await run(join(directory, "auth.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("player session recovery", () => {
  it("recognizes a remembered player token after the auth service restarts", async () => {
    await withTempAuthPath(async (authPath) => {
      const first = new AuthService(authPath);
      await first.initialize();
      await first.bootstrap("correct horse battery staple");
      const token = first.issuePlayerSession();
      const original = first.verifyPlayer(token);

      const restarted = new AuthService(authPath);
      await restarted.initialize();
      expect(restarted.verifyPlayer(token)).toEqual(original);
      expect(restarted.verify(token)).toBeNull();
    });
  });

  it("keeps a remembered player token valid after a GM session is individually revoked", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");
      const playerToken = auth.issuePlayerSession();
      const gmToken = (await auth.login("correct horse battery staple"))!;

      await auth.logout(gmToken);

      expect(auth.verifyPlayer(playerToken)?.role).toBe("player");
      expect(auth.verify(gmToken)).toBeNull();
    });
  });

  it("keeps a remembered player token valid after every GM session is revoked", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");
      const playerToken = auth.issuePlayerSession();
      const gmToken = (await auth.login("correct horse battery staple"))!;

      await auth.revokeAllGmSessions();

      expect(auth.verifyPlayer(playerToken)?.role).toBe("player");
      expect(auth.verify(gmToken)).toBeNull();
    });
  });
});

describe("GM login", () => {
  it("issues a verifiable GM session for the correct password", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");

      const token = await auth.login("correct horse battery staple");

      expect(token).not.toBeNull();
      expect(auth.verify(token!)?.role).toBe("gm");
    });
  });

  it("rejects an incorrect password without issuing a token", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");

      expect(await auth.login("wrong password")).toBeNull();
    });
  });
});

describe("GM session revocation", () => {
  it("logout revokes only the presented session, not other active GM sessions", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");
      const sessionA = (await auth.login("correct horse battery staple"))!;
      const sessionB = (await auth.login("correct horse battery staple"))!;

      const revoked = await auth.logout(sessionA);

      expect(revoked).toBe(true);
      expect(auth.verify(sessionA)).toBeNull();
      expect(auth.verify(sessionB)?.role).toBe("gm");
    });
  });

  it("logout is idempotent and reports false for a token that is not a live GM session", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");
      const token = (await auth.login("correct horse battery staple"))!;

      expect(await auth.logout(token)).toBe(true);
      expect(await auth.logout(token)).toBe(false);
      expect(await auth.logout(undefined)).toBe(false);
      expect(await auth.logout("not-a-real-token")).toBe(false);
    });
  });

  it("revoke-all invalidates every previously issued GM session but allows a fresh login afterward", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await auth.initialize();
      await auth.bootstrap("correct horse battery staple");
      const sessionA = (await auth.login("correct horse battery staple"))!;
      const sessionB = (await auth.login("correct horse battery staple"))!;

      await auth.revokeAllGmSessions();

      expect(auth.verify(sessionA)).toBeNull();
      expect(auth.verify(sessionB)).toBeNull();

      const freshSession = await auth.login("correct horse battery staple");
      expect(auth.verify(freshSession!)?.role).toBe("gm");
    });
  });

  it("persists individual revocation across an AuthService restart", async () => {
    await withTempAuthPath(async (authPath) => {
      const first = new AuthService(authPath);
      await first.initialize();
      await first.bootstrap("correct horse battery staple");
      const token = (await first.login("correct horse battery staple"))!;
      await first.logout(token);

      const restarted = new AuthService(authPath);
      await restarted.initialize();
      expect(restarted.verify(token)).toBeNull();
    });
  });

  it("persists a revoke-all cutoff across an AuthService restart", async () => {
    await withTempAuthPath(async (authPath) => {
      const first = new AuthService(authPath);
      await first.initialize();
      await first.bootstrap("correct horse battery staple");
      const token = (await first.login("correct horse battery staple"))!;
      await first.revokeAllGmSessions();

      const restarted = new AuthService(authPath);
      await restarted.initialize();
      expect(restarted.verify(token)).toBeNull();

      const freshToken = await restarted.login("correct horse battery staple");
      expect(restarted.verify(freshToken!)?.role).toBe("gm");
    });
  });
});

describe("legacy and malformed auth data", () => {
  it("loads a pre-revocation auth.json that has no session-revocation fields", async () => {
    await withTempAuthPath(async (authPath) => {
      const bootstrapAuth = new AuthService(authPath);
      await bootstrapAuth.initialize();
      await bootstrapAuth.bootstrap("correct horse battery staple");
      const legacyToken = (await bootstrapAuth.login("correct horse battery staple"))!;

      const legacyShape = JSON.parse(await readFile(authPath, "utf8"));
      delete legacyShape.gmSessionsRevokedBefore;
      delete legacyShape.revokedGmSessionIds;
      await writeFile(authPath, JSON.stringify(legacyShape));

      const migrated = new AuthService(authPath);
      await expect(migrated.initialize()).resolves.not.toThrow();
      expect(migrated.verify(legacyToken)?.role).toBe("gm");

      const revoked = await migrated.logout(legacyToken);
      expect(revoked).toBe(true);
      expect(migrated.verify(legacyToken)).toBeNull();
    });
  });

  it("rejects auth data that is missing required fields", async () => {
    await withTempAuthPath(async (authPath) => {
      await writeFile(authPath, JSON.stringify({ someUnrelatedField: true }));
      const auth = new AuthService(authPath);
      await expect(auth.initialize()).rejects.toThrow();
    });
  });

  it("treats a missing auth.json as not-yet-bootstrapped rather than an error", async () => {
    await withTempAuthPath(async (authPath) => {
      const auth = new AuthService(authPath);
      await expect(auth.initialize()).resolves.not.toThrow();
      expect(auth.isBootstrapped).toBe(false);
    });
  });
});
