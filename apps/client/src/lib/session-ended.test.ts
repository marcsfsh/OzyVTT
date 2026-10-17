import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, onSessionEnded } from "./api";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, apiVersion: "1", error: { code: "x", message: "No." } }), { status })
    )
  );

describe("hearing that a session ended (ADR-0026)", () => {
  it("reports a 401 for a request that carried a token, with that token", async () => {
    const heard = vi.fn();
    const stop = onSessionEnded(heard);
    try {
      answer(401);
      await expect(apiRequest("/api/v1/game/state", { token: "dead" })).rejects.toThrow("No.");
      expect(heard).toHaveBeenCalledWith("dead");
    } finally {
      stop();
    }
  });

  it("stays quiet for a 403, and for a 401 to a request with no token", async () => {
    const heard = vi.fn();
    const stop = onSessionEnded(heard);
    try {
      answer(403);
      await expect(apiRequest("/api/v1/map-assets", { token: "player" })).rejects.toThrow();
      answer(401);
      await expect(apiRequest("/api/v1/map-assets")).rejects.toThrow();
      expect(heard).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
