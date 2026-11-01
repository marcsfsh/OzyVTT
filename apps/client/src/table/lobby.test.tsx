import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { ACTORS, gmView } from "../../test/scenes-fakes";
import { goTo } from "../../test/route";
import { Lobby } from "./Lobby";

afterEach(() => vi.unstubAllGlobals());

const serve = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, apiVersion: "1", data: { joinUrls: ["http://192.168.1.50:3001"], hostUrl: "" } }),
          { status: 200 }
        )
    )
  );

/** Lyra on a player's device (reconnecting), Borin at the table, Tamsin open, and an archived character left out. */
function view(): GmView {
  const base = gmView([], null);
  const [lyra, borin, ...rest] = ACTORS;
  return {
    ...base,
    actors: [
      { ...lyra!, ownerSessionId: "s1", presence: "reconnecting" },
      { ...borin!, playedAtTable: true },
      { ...lyra!, id: "a-tamsin", name: "Tamsin Reed" },
      { ...lyra!, id: "a-old", name: "Old Tam", archived: true },
      ...rest
    ]
  } as unknown as GmView;
}

describe("the lobby", () => {
  it("counts who is claimed and names who plays each character in the roster's words", async () => {
    serve();
    render(
      <ToastProvider>
        <Lobby state={view()} token="gm" />
      </ToastProvider>
    );
    const party = within(screen.getByRole("region", { name: /The party/ }));
    expect(party.getByText("2 of 3 claimed")).toBeInTheDocument();
    const rows = party.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringMatching(/Lyra Emberwise.*On a player's device · Reconnecting/),
      expect.stringMatching(/Borin Stoneguard.*At the table/),
      expect.stringMatching(/Tamsin Reed.*Open to claim/)
    ]);
    // An archived character and the monsters are no part of the party.
    expect(party.queryByText("Old Tam")).toBeNull();
    expect(party.queryByText("Goblin Boss")).toBeNull();
    expect(await screen.findByRole("img", { name: "QR code for http://192.168.1.50:3001" })).toBeInTheDocument();
  });

  it("prepares an encounter from its Cup", async () => {
    const user = userEvent.setup();
    serve();
    goTo("/table");
    render(
      <ToastProvider>
        <Lobby state={view()} token="gm" />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Prepare an encounter" }));
    expect(window.location.pathname).toBe("/encounters/new");
  });
});
