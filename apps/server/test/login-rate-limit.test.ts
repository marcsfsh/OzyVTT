import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "../src/login-rate-limit.js";

describe("LoginRateLimiter", () => {
  it("allows attempts under the threshold and blocks once the threshold is reached", () => {
    const limiter = new LoginRateLimiter(3, 5 * 60 * 1000, 60 * 1000);
    const now = 1_000_000;

    expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
    limiter.recordFailure("1.2.3.4", now);
    expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
    limiter.recordFailure("1.2.3.4", now);
    expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
    limiter.recordFailure("1.2.3.4", now);

    const blocked = limiter.check("1.2.3.4", now);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not reveal how close a failed attempt was: the block is identical for wrong or malformed input", () => {
    const limiter = new LoginRateLimiter(1, 5 * 60 * 1000, 60 * 1000);
    const now = 1_000_000;
    limiter.recordFailure("5.6.7.8", now);

    const decision = limiter.check("5.6.7.8", now);
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) });
  });

  it("recovers once the lockout window elapses", () => {
    const limiter = new LoginRateLimiter(2, 5 * 60 * 1000, 60 * 1000);
    const now = 1_000_000;
    limiter.recordFailure("9.9.9.9", now);
    limiter.recordFailure("9.9.9.9", now);
    expect(limiter.check("9.9.9.9", now).allowed).toBe(false);

    expect(limiter.check("9.9.9.9", now + 60_001).allowed).toBe(true);
  });

  it("a successful login clears prior failures immediately", () => {
    const limiter = new LoginRateLimiter(2, 5 * 60 * 1000, 60 * 1000);
    const now = 1_000_000;
    limiter.recordFailure("10.0.0.1", now);
    limiter.recordSuccess("10.0.0.1");
    limiter.recordFailure("10.0.0.1", now);

    expect(limiter.check("10.0.0.1", now).allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const limiter = new LoginRateLimiter(1, 5 * 60 * 1000, 60 * 1000);
    const now = 1_000_000;
    limiter.recordFailure("1.1.1.1", now);
    expect(limiter.check("1.1.1.1", now).allowed).toBe(false);
    expect(limiter.check("2.2.2.2", now).allowed).toBe(true);
  });
});
