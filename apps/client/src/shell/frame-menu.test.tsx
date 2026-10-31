import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as renderBare, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiRequest = vi.fn();
vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  apiBlob: vi.fn(async () => new Blob())
}));

import type { ReactElement } from "react";
import { GameStateSchema, type GmView, type PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { FrameMenu } from "./FrameMenu";

// The frame's one menu (frame spec 2.1): the GM's rows and a player's, in order, Release only with one character, and
// signing out or leaving asked first.

const gmView = (): GmView =>
  ({
    ...(GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView),
    actors: [
      { id: "lyra", name: "Lyra Emberwise", kind: "player-character", ownerSessionId: "s1", presence: "online" },
      { id: "borin", name: "Borin Stoneguard", kind: "player-character", ownerSessionId: "s2", presence: "offline" }
    ]
  }) as unknown as GmView;
const playerView = (count: number): PlayerView =>
  ({
    ...(GameStateSchema.parse({ schemaVersion: 1 }) as unknown as PlayerView),
    actors: [
      { id: "lyra", name: "Lyra Emberwise", kind: "player-character", claimStatus: "mine" },
      { id: "borin", name: "Borin Stoneguard", kind: "player-character", claimStatus: count > 1 ? "mine" : "available" }
    ]
  }) as unknown as PlayerView;
const render = (ui: ReactElement) => renderBare(<ToastProvider>{ui}</ToastProvider>);
const menu = () => within(screen.getByRole("menu", { hidden: true }));
const labels = () =>
  menu()
    .getAllByRole("menuitem", { hidden: true })
    .map((item) => item.textContent);

beforeEach(() => {
  apiRequest.mockResolvedValue({ presentation: { revision: 1, enabled: false, activeMap: null } });
});

describe("the frame's menu", () => {
  it("lists the GM's rows in order: who is here, the table screen with its actions, Settings and Sign out", async () => {
    render(<FrameMenu role="gm" state={gmView()} token="gm" onSignOut={() => {}} />);
    expect(screen.getByLabelText("GM menu, 1 player online")).toBeInTheDocument();
    expect(menu().getByText("Game master")).toBeInTheDocument();
    expect(menu().getByRole("group", { name: "Who is here, 1 of 2", hidden: true })).toBeInTheDocument();
    expect(await menu().findByRole("group", { name: "Table screen, off", hidden: true })).toBeInTheDocument();
    expect(labels()).toEqual(["Preview the table screen here", "Table screen settings", "Settings", "Sign out"]);
  });

  it("asks before signing the GM out", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(<FrameMenu role="gm" state={gmView()} token="gm" onSignOut={onSignOut} />);
    await user.click(menu().getByRole("menuitem", { name: "Sign out", hidden: true }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out on this device?" });
    expect(onSignOut).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("lists a player's rows, with Release while one character is claimed", () => {
    const { unmount } = render(<FrameMenu role="player" state={playerView(1)} onLeave={() => {}} />);
    expect(screen.getByLabelText("Menu, playing Lyra")).toBeInTheDocument();
    expect(labels()).toEqual(["Release Lyra Emberwise", "Settings", "Leave the table"]);
    unmount();
    // With two, the sheet's menu releases each.
    render(<FrameMenu role="player" state={playerView(2)} onLeave={() => {}} />);
    expect(labels()).toEqual(["Settings", "Leave the table"]);
    expect(menu().getByText(/and 1 more/)).toBeInTheDocument();
  });

  it("asks before a player leaves the table", async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn();
    render(<FrameMenu role="player" state={playerView(1)} onLeave={onLeave} />);
    await user.click(menu().getByRole("menuitem", { name: "Leave the table", hidden: true }));
    const dialog = await screen.findByRole("dialog", { name: "Leave the table?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave table" }));
    expect(onLeave).toHaveBeenCalled();
  });
});
