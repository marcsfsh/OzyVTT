import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";
import { JoinAddress, joinCandidates } from "./JoinAddress";

afterEach(() => vi.unstubAllGlobals());

const serve = (joinUrls: readonly string[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, apiVersion: "1", data: { joinUrls, hostUrl: "http://localhost:3001" } }),
          { status: 200 }
        )
    )
  );

describe("the join address", () => {
  it("offers the page's own address first, and never a localhost one", () => {
    expect(joinCandidates(["http://192.168.1.50:3001"], "http://localhost:5173")).toEqual(["http://192.168.1.50:3001"]);
    expect(
      joinCandidates(["http://192.168.1.50:3001", "http://10.0.0.4:3001"], "http://ozy.lan:3001/"),
      "a name the phones already resolve works, so it leads"
    ).toEqual(["http://ozy.lan:3001", "http://192.168.1.50:3001", "http://10.0.0.4:3001"]);
    expect(joinCandidates(["http://127.0.0.1:3001", "http://[::1]:3001"], "http://localhost:3001")).toEqual([]);
    expect(joinCandidates(["http://192.168.1.50:3001"], "http://192.168.1.50:3001")).toEqual([
      "http://192.168.1.50:3001"
    ]);
  });

  it("shows the address with Copy, and the QR code behind a button", async () => {
    const user = userEvent.setup();
    serve(["http://192.168.1.50:3001"]);
    render(
      <ToastProvider>
        <JoinAddress token="gm" />
      </ToastProvider>
    );
    const region = await screen.findByRole("region", { name: "Join address" });
    expect(region).toHaveTextContent("Players join at");
    expect(region).toHaveTextContent("http://192.168.1.50:3001");
    expect(screen.queryByRole("img", { name: /QR code/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show QR code" }));
    expect(screen.getByRole("img", { name: "QR code for http://192.168.1.50:3001" })).toBeInTheDocument();

    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("http://192.168.1.50:3001");
    expect(await screen.findByText("Join address copied.")).toBeInTheDocument();
  });

  it("says what to do when the host has no network address", async () => {
    serve([]);
    render(
      <ToastProvider>
        <JoinAddress token="gm" />
      </ToastProvider>
    );
    expect(await screen.findByText(/Connect it to the Wi-Fi the players use/)).toBeInTheDocument();
  });
});
