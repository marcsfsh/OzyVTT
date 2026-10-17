import { describe, expect, it } from "vitest";
import { callerOfToken } from "../src/request-auth.js";
import { credentialPerScope, fixedVerifiers } from "./fixed-verifiers.js";

const verifiers = fixedVerifiers({
  gm: ["gm-token"],
  player: ["player-token"],
  integration: credentialPerScope,
  viewer: ["viewer-token"]
});

describe("reading the caller from a credential", () => {
  it("names the role a live credential carries", () => {
    expect(callerOfToken("gm-token", verifiers)).toMatchObject({ kind: "gm", sessionId: "gm:gm-token" });
    expect(callerOfToken("player-token", verifiers)).toMatchObject({ kind: "player" });
    expect(callerOfToken("viewer-token", verifiers)).toMatchObject({ kind: "viewer" });
  });

  it("tells no credential from a dead one", () => {
    expect(callerOfToken(undefined, verifiers)).toEqual({ kind: "none" });
    expect(callerOfToken("", verifiers)).toEqual({ kind: "none" });
    // A socket sends whatever it likes; anything but a string is no credential.
    expect(callerOfToken(42 as unknown as string, verifiers)).toEqual({ kind: "none" });
    expect(callerOfToken("garbage", verifiers)).toEqual({ kind: "invalid" });
  });

  it("keeps a live integration credential that lacks the scope apart from a dead one", () => {
    expect(callerOfToken("int-codex:read", verifiers, { scope: "codex:read" })).toMatchObject({
      kind: "integration",
      inScope: true
    });
    expect(callerOfToken("int-codex:read", verifiers, { scope: "codex:write" })).toMatchObject({
      kind: "integration",
      inScope: false
    });
    // A route that takes no integration credential still reads a live one as live, so it answers 403.
    expect(callerOfToken("int-codex:read", verifiers)).toMatchObject({ kind: "integration", inScope: false });
  });
});
