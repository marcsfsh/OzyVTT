import { afterEach, describe, expect, it } from "vitest";
import {
  askOtherTabsForGmToken,
  forgetGmToken,
  keepsGmSignedIn,
  replaceGmToken,
  shareGmToken,
  storedGmToken,
  storeGmToken,
  tokenExpiry
} from "./gm-token";

/** A token shaped like the server's: a base64url JSON payload, a dot, and a signature this side never reads. */
const token = (expiresAt: number, id = "a") =>
  `${btoa(JSON.stringify({ role: "gm", sessionId: id, issuedAt: 0, expiresAt }))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")}.sig`;

const HOUR = 60 * 60 * 1000;

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("the GM token in this browser", () => {
  it("reads the expiry from the token's own payload", () => {
    expect(tokenExpiry(token(1234))).toBe(1234);
    expect(tokenExpiry("not a token")).toBeNull();
  });

  it("keeps the token for this tab only, unless the GM asks to stay signed in", () => {
    const tab = token(Date.now() + HOUR);
    storeGmToken(tab, false);
    expect(storedGmToken()).toBe(tab);
    expect(keepsGmSignedIn()).toBe(false);
    expect(localStorage.length).toBe(0);

    const kept = token(Date.now() + HOUR, "b");
    storeGmToken(kept, true);
    expect(keepsGmSignedIn()).toBe(true);
    sessionStorage.clear();
    expect(storedGmToken(), "a new tab resumes with the kept token").toBe(kept);
  });

  it("never offers a token that has run out", () => {
    storeGmToken(token(Date.now() - 1), true);
    expect(storedGmToken()).toBeNull();
    expect(keepsGmSignedIn()).toBe(false);
  });

  it("replaces the token where it was kept, and keeps the GM's choice", () => {
    storeGmToken(token(Date.now() + HOUR), true);
    const next = token(Date.now() + HOUR, "next");
    replaceGmToken(next);
    expect(sessionStorage.getItem("vtt.gm-token")).toBe(next);
    expect(localStorage.getItem("vtt.gm-token")).toBe(next);
  });

  it("forgets only the token that ended, never a newer one another tab stored", () => {
    const ended = token(Date.now() + HOUR, "old");
    const newer = token(Date.now() + HOUR, "new");
    storeGmToken(ended, false);
    localStorage.setItem("vtt.gm-token", newer);
    forgetGmToken(ended);
    expect(sessionStorage.getItem("vtt.gm-token")).toBeNull();
    expect(localStorage.getItem("vtt.gm-token")).toBe(newer);
    forgetGmToken();
    expect(localStorage.getItem("vtt.gm-token")).toBeNull();
  });

  it.runIf(typeof BroadcastChannel === "function")("hands a live session to a new tab that asks", async () => {
    const live = token(Date.now() + HOUR);
    const stop = shareGmToken(() => live);
    try {
      expect(await askOtherTabsForGmToken(1_000)).toBe(live);
    } finally {
      stop();
    }
  });

  it.runIf(typeof BroadcastChannel === "function")("gets nothing when no tab holds a session", async () => {
    const stop = shareGmToken(() => null);
    try {
      expect(await askOtherTabsForGmToken(100)).toBeNull();
    } finally {
      stop();
    }
  });
});
