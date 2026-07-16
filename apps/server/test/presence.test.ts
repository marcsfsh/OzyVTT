import { describe, expect, it, vi } from "vitest";
import { PresenceRegistry } from "../src/presence.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("PresenceRegistry", () => {
  it("marks a session online on its first connection", () => {
    const registry = new PresenceRegistry(50);
    registry.connect("session-a", "player");
    expect(registry.statusFor("session-a")).toBe("online");
    registry.dispose();
  });

  it("returns null for a session that has never connected", () => {
    const registry = new PresenceRegistry(50);
    expect(registry.statusFor("never-seen")).toBeNull();
    registry.dispose();
  });

  it("stays online while any of several connections for the same session remain open", () => {
    const registry = new PresenceRegistry(50);
    registry.connect("session-a", "player");
    registry.connect("session-a", "player");
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    registry.disconnect("session-a", false);
    expect(registry.statusFor("session-a")).toBe("online");
    registry.dispose();
  });

  it("enters a reconnecting grace period only after the last connection drops, then goes offline once the grace period elapses", async () => {
    const registry = new PresenceRegistry(30);
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    expect(registry.statusFor("session-a")).toBe("reconnecting");

    await sleep(60);
    expect(registry.statusFor("session-a")).toBe("offline");
    registry.dispose();
  });

  it("does not flicker to offline if the session reconnects within the grace period", async () => {
    const registry = new PresenceRegistry(60);
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    expect(registry.statusFor("session-a")).toBe("reconnecting");

    await sleep(15);
    registry.connect("session-a", "player");
    expect(registry.statusFor("session-a")).toBe("online");

    await sleep(80);
    expect(registry.statusFor("session-a")).toBe("online");
    registry.dispose();
  });

  it("recovers the same presence entry for a remembered session ID across a full disconnect/reconnect cycle", async () => {
    const registry = new PresenceRegistry(30);
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    await sleep(60);
    expect(registry.statusFor("session-a")).toBe("offline");

    registry.connect("session-a", "player");
    expect(registry.statusFor("session-a")).toBe("online");
    registry.dispose();
  });

  it("immediately purges a session when told the underlying token is no longer valid, skipping the grace period", () => {
    const registry = new PresenceRegistry(5000);
    registry.connect("session-a", "gm");
    registry.disconnect("session-a", true);
    expect(registry.statusFor("session-a")).toBeNull();
    registry.dispose();
  });

  it("invokes the grace-expired callback exactly once when a session actually goes offline", async () => {
    const onGraceExpired = vi.fn();
    const registry = new PresenceRegistry(20, onGraceExpired);
    registry.connect("session-a", "player");
    registry.disconnect("session-a", false);
    await sleep(60);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
    expect(onGraceExpired).toHaveBeenCalledWith("session-a");
    registry.dispose();
  });

  it("does not invoke the grace-expired callback for an immediate purge", async () => {
    const onGraceExpired = vi.fn();
    const registry = new PresenceRegistry(20, onGraceExpired);
    registry.connect("session-a", "gm");
    registry.disconnect("session-a", true);
    await sleep(40);
    expect(onGraceExpired).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("tracks independent sessions separately", () => {
    const registry = new PresenceRegistry(50);
    registry.connect("session-a", "player");
    registry.connect("session-b", "gm");
    registry.disconnect("session-a", true);
    expect(registry.statusFor("session-a")).toBeNull();
    expect(registry.statusFor("session-b")).toBe("online");
    registry.dispose();
  });

  it("ignores a disconnect for a session that was never connected", () => {
    const registry = new PresenceRegistry(50);
    expect(() => registry.disconnect("ghost-session", false)).not.toThrow();
    expect(registry.statusFor("ghost-session")).toBeNull();
    registry.dispose();
  });
});
