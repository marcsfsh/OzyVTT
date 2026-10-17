import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SoundBoardSchema, type SoundBoardView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

// The GM's sound controls against a stand-in server: the board arrives over the socket, the library over HTTP.

const listeners = new Map<string, Set<(payload: unknown) => void>>();
let board: SoundBoardView;
const sent: Array<readonly [string, Record<string, unknown>]> = [];

vi.mock("../socket", () => {
  const timed = {
    emit: (event: string, payload: Record<string, unknown>, ack: (error: null, reply: unknown) => void) => {
      if (event === "sound:board") return ack(null, { ok: true, view: board });
      sent.push([event, payload]);
      ack(null, { ok: true, soundRevision: board.revision + 1 });
    }
  };
  return {
    socket: {
      on: (event: string, listener: (payload: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      off: (event: string, listener: (payload: unknown) => void) => listeners.get(event)?.delete(listener),
      emit: vi.fn(),
      connected: true,
      timeout: () => timed
    }
  };
});
vi.mock("../lib/api", () => ({
  apiRequest: vi.fn(async (path: string) => {
    if (path === "/api/v1/sound-assets")
      return {
        sounds: [
          { id: TAVERN, name: "Tavern Song", format: "mp3", durationMs: 184_000 },
          { id: RAIN, name: "Rain", format: "ogg", durationMs: 30_000 }
        ]
      };
    return {};
  })
}));

import { NowPlaying } from "./NowPlaying";
import { SoundBoard } from "./SoundBoard";

const TAVERN = "11111111-1111-5111-8111-111111111111";
const RAIN = "44444444-4444-5444-8444-444444444444";
const SCENE = "77777777-7777-4777-8777-777777777777";
const PLAY = "00000000-0000-4000-8000-000000000001";

function view(change: Record<string, unknown> = {}, screens: SoundBoardView["screens"] = []): SoundBoardView {
  return { revision: 3, serverTime: 1_000, screens, board: SoundBoardSchema.parse(change) };
}
const push = (next: SoundBoardView) => act(() => listeners.get("sound:changed")?.forEach((listener) => listener(next)));

beforeEach(() => {
  listeners.clear();
  sent.length = 0;
  board = view();
});

describe("the Table tab's sound control", () => {
  it("stays out of the way until the board holds a sound, then says what is on and whether the room hears it", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <NowPlaying token="gm" />
      </ToastProvider>
    );
    await act(async () => {});
    expect(container.querySelector(".now-playing")).toBeNull();

    push(
      view(
        {
          music: {
            tracks: [{ assetId: TAVERN, volume: 0.6, durationMs: 184_000 }],
            current: { playId: PLAY, assetId: TAVERN, startedAt: 0, durationMs: 184_000, volume: 0.6 }
          }
        },
        [{ connectionId: "c1", name: "Den TV", sound: "blocked", unplayable: [] }]
      )
    );
    const control = await screen.findByRole("region", { name: "Sound" });
    expect(within(control).getByText("Tavern Song")).toBeInTheDocument();
    expect(within(control).getByText("Table screen waits for a tap")).toBeInTheDocument();
    expect(within(control).getByRole("slider", { name: "Table volume" })).toHaveAttribute("aria-valuetext", "80%");
    await user.click(within(control).getByRole("button", { name: "Pause sound" }));
    expect(sent).toContainEqual(["sound:pause", expect.objectContaining({ paused: true })]);
  });
});

describe("the sound board", () => {
  it("puts a library sound on the board and saves the mix as a scene's sound", async () => {
    const user = userEvent.setup();
    board = view({ ambient: [{ assetId: RAIN, volume: 0.5, durationMs: 30_000, playing: null }] }, [
      { connectionId: "p", name: "GM preview", sound: "muted", unplayable: [] }
    ]);
    render(
      <ToastProvider>
        <SoundBoard gmToken="gm" scenes={[{ id: SCENE, name: "Crypt" }]} activeSceneId={null} />
      </ToastProvider>
    );
    // The GM's own silent preview is not a table screen.
    expect(await screen.findByText("No table screen connected")).toBeInTheDocument();
    // Rain is already a layer, so its row says so in words rather than offering it again.
    expect(screen.getByText("In ambience")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Tavern Song to the playlist" }));
    expect(sent).toContainEqual([
      "sound:arrange",
      expect.objectContaining({ music: { tracks: [{ assetId: TAVERN, volume: 0.8 }], shuffle: false } })
    ]);
    await user.click(screen.getByRole("switch", { name: "Rain" }));
    expect(sent).toContainEqual(["sound:play", expect.objectContaining({ target: "ambient", assetId: RAIN })]);
    await user.click(screen.getByRole("button", { name: "Save current sound" }));
    expect(sent).toContainEqual([
      "sound:set-scene-preset",
      expect.objectContaining({ sceneId: SCENE, preset: "save-current" })
    ]);
  });
});
