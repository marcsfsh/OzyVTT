import { afterEach, describe, expect, it, vi } from "vitest";

type Ack = (error: Error | null, reply?: unknown) => void;
const sent: Array<{ event: string; payload: Record<string, unknown>; ack: Ack }> = [];

vi.mock("../socket", () => ({
  socket: {
    timeout: () => ({
      emit: (event: string, payload: Record<string, unknown>, ack: Ack) => sent.push({ event, payload, ack })
    })
  }
}));

const { command, read, TIMEOUT_MESSAGE } = await import("./command");
const { ApiError, apiBlob, apiRequest } = await import("./api");

afterEach(() => {
  sent.length = 0;
  vi.unstubAllGlobals();
});

describe("command", () => {
  it("adds a fresh commandId and resolves with the reply", async () => {
    const reply = command("character:release", { expectedRevision: 3 });
    expect(sent[0]?.event).toBe("character:release");
    expect(sent[0]?.payload).toMatchObject({ expectedRevision: 3 });
    expect(sent[0]?.payload.commandId).toMatch(/^[0-9a-f-]{36}$/);
    sent[0]?.ack(null, { ok: true, revision: 4 });
    await expect(reply).resolves.toEqual({ ok: true, revision: 4 });
  });

  it("answers a timeout as a refusal instead of hanging", async () => {
    const reply = command("character:release", {});
    sent[0]?.ack(new Error("operation has timed out"));
    await expect(reply).resolves.toEqual({ ok: false, code: "timeout", message: TIMEOUT_MESSAGE });
  });

  it("sends a read without a commandId", async () => {
    const reply = read("log:read", {});
    expect(sent[0]?.payload).toEqual({});
    sent[0]?.ack(null, { ok: true, entries: [] });
    await expect(reply).resolves.toEqual({ ok: true, entries: [] });
  });
});

describe("apiRequest", () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );

  it("returns the envelope's data and sends JSON with the bearer token", async () => {
    respond(200, { ok: true, apiVersion: 1, data: { id: "a" } });
    await expect(apiRequest("/api/v1/x", { token: "t", body: { a: 1 } })).resolves.toEqual({ id: "a" });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer t", "content-type": "application/json" });
    expect(init.body).toBe('{"a":1}');
  });

  it("throws the envelope's error fields", async () => {
    respond(409, { ok: false, error: { code: "conflict", message: "Changed.", currentRevision: 7 } });
    const error = await apiRequest("/api/v1/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Changed.", status: 409, code: "conflict", currentRevision: 7 });
    expect((error as InstanceType<typeof ApiError>).isConflict).toBe(true);
  });

  it("reports a network failure as offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(apiRequest("/api/v1/x")).rejects.toMatchObject({ status: 0, code: "offline" });
  });
});

describe("apiBlob", () => {
  it("returns the bytes and sends the bearer token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("png-bytes", { status: 200 }))
    );
    const blob = await apiBlob("/api/v1/x/content", { token: "t" });
    expect(await blob.text()).toBe("png-bytes");
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer t" });
  });

  it("throws the envelope's error on a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: { code: "forbidden", message: "No." } }), { status: 403 })
      )
    );
    await expect(apiBlob("/api/v1/x/content")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "No."
    });
  });
});
