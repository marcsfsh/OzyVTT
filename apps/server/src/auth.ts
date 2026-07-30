import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import bcrypt from "bcryptjs";

type PersistedAuthData = {
  passwordHash: string;
  tokenSecret: string;
  /** GM sessions issued at or before this epoch millisecond are invalid, regardless of their own expiry. Set by revoke-all. */
  gmSessionsRevokedBefore?: number;
  /** Individually logged-out GM session IDs, mapped to their own expiry so stale entries can be pruned without a background job. */
  revokedGmSessionIds?: Record<string, number>;
};

export type GmSession = { role: "gm"; sessionId: string; issuedAt: number; expiresAt: number };
export type PlayerSession = { role: "player"; sessionId: string; issuedAt: number; expiresAt: number };
type Session = GmSession | PlayerSession;

export class AuthService {
  private data: PersistedAuthData | null = null;
  constructor(private readonly filePath: string) {}

  async initialize() {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const legacy = raw as Partial<PersistedAuthData> | null;
    if (!legacy || typeof legacy.passwordHash !== "string" || typeof legacy.tokenSecret !== "string") {
      throw new Error("The stored GM auth data is missing or invalid.");
    }
    this.data = {
      passwordHash: legacy.passwordHash,
      tokenSecret: legacy.tokenSecret,
      gmSessionsRevokedBefore: typeof legacy.gmSessionsRevokedBefore === "number" ? legacy.gmSessionsRevokedBefore : undefined,
      revokedGmSessionIds: legacy.revokedGmSessionIds && typeof legacy.revokedGmSessionIds === "object" ? { ...legacy.revokedGmSessionIds } : {}
    };
    this.pruneRevokedSessions();
  }
  get isBootstrapped() { return this.data !== null; }
  async bootstrap(password: string) {
    if (this.data) throw new Error("GM password is already configured.");
    this.data = { passwordHash: await bcrypt.hash(password, 12), tokenSecret: randomUUID(), revokedGmSessionIds: {} };
    await this.persist();
  }
  async login(password: string) {
    if (!this.data || !(await bcrypt.compare(password, this.data.passwordHash))) return null;
    const now = Date.now();
    return this.sign({ role: "gm", sessionId: randomUUID(), issuedAt: now, expiresAt: now + 12 * 60 * 60 * 1000 });
  }
  issuePlayerSession() {
    if (!this.data) throw new Error("The host must complete GM setup before players join.");
    const now = Date.now();
    return this.sign({ role: "player", sessionId: randomUUID(), issuedAt: now, expiresAt: now + 30 * 24 * 60 * 60 * 1000 });
  }
  /**
   * A short-lived PLAYER principal for the GM's own preview of the player Codex. Deliberately a real
   * player token rather than a role flag on the GM's session: every read then walks the same
   * `authorizePlayer` path and the same projection a genuine player gets, so the preview cannot show
   * anything a player could not see. Mirrors the viewer's `mintPreviewSession`. Minting does NOT
   * register presence - that happens on socket join - so no phantom player appears at the table.
   */
  issuePreviewPlayerSession(ttlMs = 12 * 60 * 60 * 1000) {
    if (!this.data) throw new Error("The host must complete GM setup before players join.");
    const now = Date.now();
    return this.sign({ role: "player", sessionId: randomUUID(), issuedAt: now, expiresAt: now + ttlMs });
  }
  verify(token: string | undefined): GmSession | null {
    const session = this.verifySession(token);
    return session?.role === "gm" ? session : null;
  }
  verifyPlayer(token: string | undefined): PlayerSession | null {
    const session = this.verifySession(token);
    return session?.role === "player" ? session : null;
  }
  /** Revokes the single GM session carried by `token`. Returns false if the token was not a currently valid GM session. */
  async logout(token: string | undefined): Promise<boolean> {
    const session = this.verify(token);
    if (!session || !this.data) return false;
    this.data.revokedGmSessionIds = { ...(this.data.revokedGmSessionIds ?? {}), [session.sessionId]: session.expiresAt };
    this.pruneRevokedSessions();
    await this.persist();
    return true;
  }
  /** Invalidates every GM session issued up to now, including ones not currently connected, via a persistent cutoff. */
  async revokeAllGmSessions(): Promise<void> {
    if (!this.data) throw new Error("GM auth is not configured yet.");
    this.data.gmSessionsRevokedBefore = Date.now();
    this.data.revokedGmSessionIds = {};
    await this.persist();
  }
  private verifySession(token: string | undefined): Session | null {
    if (!token || !this.data) return null;
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    const expected = createHmac("sha256", this.data.tokenSecret).update(encoded).digest("base64url");
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    try {
      const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Session;
      if (session.role !== "gm" && session.role !== "player") return null;
      if (typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) return null;
      if (session.role === "gm") {
        if (this.data.gmSessionsRevokedBefore && session.issuedAt <= this.data.gmSessionsRevokedBefore) return null;
        if (this.data.revokedGmSessionIds?.[session.sessionId] !== undefined) return null;
      }
      return session;
    } catch { return null; }
  }
  private pruneRevokedSessions() {
    if (!this.data?.revokedGmSessionIds) return;
    const now = Date.now();
    for (const [sessionId, expiresAt] of Object.entries(this.data.revokedGmSessionIds)) {
      if (expiresAt <= now) delete this.data.revokedGmSessionIds[sessionId];
    }
  }
  private async persist() {
    if (!this.data) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data), { mode: 0o600 });
  }
  private sign(session: Session) {
    const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.data!.tokenSecret).update(encoded).digest("base64url")}`;
  }
}
