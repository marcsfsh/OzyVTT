import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import bcrypt from "bcryptjs";

type AuthData = { passwordHash: string; tokenSecret: string };
export type GmSession = { role: "gm"; sessionId: string; expiresAt: number };

export class AuthService {
  private data: AuthData | null = null;
  constructor(private readonly filePath: string) {}

  async initialize() {
    try { this.data = JSON.parse(await readFile(this.filePath, "utf8")) as AuthData; } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  get isBootstrapped() { return this.data !== null; }
  async bootstrap(password: string) {
    if (this.data) throw new Error("GM password is already configured.");
    this.data = { passwordHash: await bcrypt.hash(password, 12), tokenSecret: randomUUID() };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data), { mode: 0o600 });
  }
  async login(password: string) {
    if (!this.data || !(await bcrypt.compare(password, this.data.passwordHash))) return null;
    return this.sign({ role: "gm", sessionId: randomUUID(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  }
  verify(token: string | undefined): GmSession | null {
    if (!token || !this.data) return null;
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    const expected = createHmac("sha256", this.data.tokenSecret).update(encoded).digest("base64url");
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    try { const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GmSession; return session.expiresAt > Date.now() && session.role === "gm" ? session : null; } catch { return null; }
  }
  private sign(session: GmSession) {
    const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.data!.tokenSecret).update(encoded).digest("base64url")}`;
  }
}
