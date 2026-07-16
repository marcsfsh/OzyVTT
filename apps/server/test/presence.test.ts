import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceRegistry } from "../src/presence.js";

afterEach(() => { vi.useRealTimers(); });

describe("PresenceRegistry", () => {
  it("keeps a verified session online until its final connection disconnects", () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const registry = new PresenceRegistry(1_000, expired);
    registry.connect("session-a", "player");
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    expect(registry.statusFor("session-a")).toBe("online");
    vi.advanceTimersByTime(2_000);
    expect(registry.statusFor("session-a")).toBe("online");
    expect(expired).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("uses reconnect grace, cancels flicker on recovery, and eventually reports offline", () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const registry = new PresenceRegistry(1_000, expired);
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    expect(registry.statusFor("session-a")).toBe("reconnecting");
    vi.advanceTimersByTime(999);
    registry.connect("session-a", "player");
    expect(registry.statusFor("session-a")).toBe("online");
    vi.advanceTimersByTime(2_000);
    expect(expired).not.toHaveBeenCalled();

    registry.disconnect("session-a", false);
    vi.advanceTimersByTime(1_000);
    expect(registry.statusFor("session-a")).toBe("offline");
    expect(expired).toHaveBeenCalledOnce();
    registry.dispose();
  });

  it("removes revoked sessions immediately instead of preserving reconnect grace", () => {
    vi.useFakeTimers();
    const registry = new PresenceRegistry(1_000);
    registry.connect("revoked-gm", "gm");
    registry.disconnect("revoked-gm", true);
    expect(registry.statusFor("revoked-gm")).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(registry.statusFor("revoked-gm")).toBeNull();
    registry.dispose();
  });
});
