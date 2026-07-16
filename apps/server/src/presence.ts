import type { ClientRole, PresenceStatus } from "@vtt/domain";

type SessionRecord = { role: ClientRole; connectionCount: number; status: PresenceStatus; lastChangedAt: number; graceTimer?: NodeJS.Timeout };

const DEFAULT_GRACE_MS = 8000;
const OFFLINE_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Server-authoritative presence keyed only by verified session IDs; never stores a token, socket ID, or address.
 * A session can hold several concurrent connections (multiple tabs/devices sharing one remembered token); it only
 * leaves "online" once its last connection drops, and then only after a short grace period, so a page reload or a
 * brief network blip does not flicker straight to "offline".
 */
export class PresenceRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly graceMs = DEFAULT_GRACE_MS, private readonly onGraceExpired: (sessionId: string) => void = () => {}) {}

  connect(sessionId: string, role: ClientRole) {
    this.pruneStaleOfflineEntries();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.graceTimer) { clearTimeout(existing.graceTimer); existing.graceTimer = undefined; }
      existing.connectionCount += 1;
      existing.status = "online";
      existing.lastChangedAt = Date.now();
      return;
    }
    this.sessions.set(sessionId, { role, connectionCount: 1, status: "online", lastChangedAt: Date.now() });
  }

  /**
   * `immediate` skips the grace period and removes the session outright; use it only when the session itself is no
   * longer valid (expired or revoked), never for an ordinary connection drop that a remembered token could still recover.
   */
  disconnect(sessionId: string, immediate: boolean) {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.connectionCount = Math.max(0, record.connectionCount - 1);
    if (record.connectionCount > 0) return;
    if (record.graceTimer) { clearTimeout(record.graceTimer); record.graceTimer = undefined; }
    if (immediate) { this.sessions.delete(sessionId); return; }
    record.status = "reconnecting";
    record.lastChangedAt = Date.now();
    const timer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current || current.connectionCount > 0) return;
      current.status = "offline";
      current.lastChangedAt = Date.now();
      current.graceTimer = undefined;
      this.onGraceExpired(sessionId);
    }, this.graceMs);
    timer.unref?.();
    record.graceTimer = timer;
  }

  statusFor(sessionId: string | null | undefined): PresenceStatus | null {
    if (!sessionId) return null;
    return this.sessions.get(sessionId)?.status ?? null;
  }

  dispose() {
    for (const record of this.sessions.values()) if (record.graceTimer) clearTimeout(record.graceTimer);
    this.sessions.clear();
  }

  private pruneStaleOfflineEntries() {
    const now = Date.now();
    for (const [sessionId, record] of this.sessions) {
      if (record.status === "offline" && now - record.lastChangedAt > OFFLINE_ENTRY_TTL_MS) this.sessions.delete(sessionId);
    }
  }
}
