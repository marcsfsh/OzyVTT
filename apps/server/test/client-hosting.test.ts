import { describe, expect, it } from "vitest";
import { developmentClientUrl } from "../src/client-hosting.js";

describe("development client redirects", () => {
  it("preserves a LAN IPv4 host and requested path", () => {
    expect(developmentClientUrl("192.168.1.42", "/encounter?view=player", 5173)).toBe("http://192.168.1.42:5173/encounter?view=player");
  });

  it("formats an IPv6 host for a URL", () => {
    expect(developmentClientUrl("fe80::1234", "/", 5173)).toBe("http://[fe80::1234]:5173/");
  });

  it("does not reflect an untrusted Host header into a redirect", () => {
    expect(developmentClientUrl("attacker.example", "/", 5173)).toBe("http://localhost:5173/");
  });
});
