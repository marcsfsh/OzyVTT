import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VIEWER_PATHS } from "@vtt/api-contract";
import { ToastProvider } from "@vtt/ui";
import { PairScreenForm, codeDigits } from "./PairScreenForm";
import { ScreenPairing, spacedCode } from "./ScreenPairing";

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, data: unknown) =>
  new Response(
    JSON.stringify(
      status < 400
        ? { ok: true, apiVersion: "1", data }
        : { ok: false, apiVersion: "1", error: { code: "not_found", message: data } }
    ),
    { status }
  );

describe("pairing a table screen (ADR-0027)", () => {
  it("reads six digits however they were typed, and shows them in two groups", () => {
    expect(codeDigits("482 913")).toBe("482913");
    expect(codeDigits(" 482-913 ")).toBe("482913");
    expect(spacedCode("482913")).toBe("482 913");
  });

  it("the screen opens a request, shows its code, and moves on once the GM lets it in", async () => {
    const calls: string[] = [];
    let approved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (init?.method === "POST")
          return reply(201, { pairing: { code: "482913", expiresAt: "2026-10-17T20:10:00Z" } });
        if (calls.length === 1) return reply(404, "No pairing is open for this screen.");
        return approved
          ? reply(200, { status: "paired" })
          : reply(200, { status: "waiting", pairing: { code: "482913", expiresAt: "2026-10-17T20:10:00Z" } });
      })
    );
    const onPaired = vi.fn();
    render(<ScreenPairing onPaired={onPaired} />);
    expect(await screen.findByText("482 913")).toBeInTheDocument();
    expect(calls.slice(0, 2)).toEqual([
      `GET ${VIEWER_PATHS.screenPairingsCurrent}`,
      `POST ${VIEWER_PATHS.screenPairings}`
    ]);
    approved = true;
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalled(), { timeout: 5_000 });
  });

  it("the GM's form sends the digits only, and says when a code is wrong", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? reply(404, "That code is not open on any screen. Check the code the screen shows.")
          : reply(200, { viewer: { id: "v1" } });
      })
    );
    const onPaired = vi.fn();
    render(
      <ToastProvider>
        <PairScreenForm gmToken="gm" onPaired={onPaired} />
      </ToastProvider>
    );
    const pair = screen.getByRole("button", { name: "Pair screen" });
    expect(pair).toBeDisabled();
    await user.type(screen.getByLabelText("Code on the screen"), "111 111");
    await user.click(pair);
    expect(await screen.findByText(/That code is not open on any screen\./)).toBeInTheDocument();
    expect(onPaired).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Code on the screen"));
    await user.type(screen.getByLabelText("Code on the screen"), "482 913");
    await user.click(pair);
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalled());
    expect(bodies[1]).toEqual({ code: "482913", name: "Table screen" });
    expect(await screen.findByText("Table screen is paired. It shows the table in a moment.")).toBeInTheDocument();
  });
});
