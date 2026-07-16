/** Bounded per-key failed-login throttle for a trusted-LAN host: no external store, no unbounded memory growth. */
export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = { failures: number; windowStartedAt: number; lockedUntil?: number };

export class LoginRateLimiter {
  private readonly attempts = new Map<string, Entry>();
  constructor(
    private readonly maxAttempts = 5,
    private readonly windowMs = 5 * 60 * 1000,
    private readonly lockoutMs = 5 * 60 * 1000
  ) {}

  /** Call before processing an attempt. Does not itself count as an attempt. */
  check(key: string, now = Date.now()): RateLimitDecision {
    this.prune(now);
    const entry = this.attempts.get(key);
    if (entry?.lockedUntil && entry.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)) };
    }
    return { allowed: true };
  }

  recordFailure(key: string, now = Date.now()) {
    const entry = this.attempts.get(key);
    const current: Entry = !entry || now - entry.windowStartedAt > this.windowMs ? { failures: 1, windowStartedAt: now } : { ...entry, failures: entry.failures + 1 };
    if (current.failures >= this.maxAttempts) current.lockedUntil = now + this.lockoutMs;
    this.attempts.set(key, current);
  }

  /** A successful login clears the key's history so a legitimate GM is not left with a stale failure count. */
  recordSuccess(key: string) {
    this.attempts.delete(key);
  }

  private prune(now: number) {
    for (const [key, entry] of this.attempts) {
      const windowExpired = now - entry.windowStartedAt > this.windowMs;
      const lockExpired = !entry.lockedUntil || entry.lockedUntil <= now;
      if (windowExpired && lockExpired) this.attempts.delete(key);
    }
  }
}
