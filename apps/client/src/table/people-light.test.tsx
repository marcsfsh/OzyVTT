import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CombatLogEntry, PlayerActor, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
vi.mock("../socket", () => ({
  socket: {
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    off: vi.fn(),
    emit: vi.fn(),
    connected: false
  }
}));
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { ClaimCharacter } from "../actors/ClaimCharacter";
import { CombatLogPanel } from "../encounter/CombatLog";
import { noteChatSent } from "../encounter/logArrivals";
import { tabTrip } from "../shell/tabLight";
import { TablePanel } from "./TablePanel";

/** jsdom has no Web Animations API; this records which elements were animated, so the light runs. */
function stubAnimate(): Element[] {
  const animated: Element[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element) {
      animated.push(this);
      const finished = new Promise<Animation>(() => {});
      return { finished, cancel: () => {} } as unknown as Animation;
    }
  });
  return animated;
}

let animated: Element[];
beforeEach(() => {
  animated = stubAnimate();
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  vi.restoreAllMocks();
});

const line = (id: number, overrides: Partial<CombatLogEntry> = {}): CombatLogEntry => ({
  id,
  at: "2026-10-28T12:00:00.000Z",
  kind: "damage",
  text: `Line ${id}`,
  gmOnly: false,
  revision: 1,
  ...overrides
});

describe("the log's light", () => {
  it("fades a new line in with a comet along its lower edge", () => {
    render(
      <ToastProvider>
        <CombatLogPanel />
      </ToastProvider>
    );
    act(() => handlers.get("log:entry")!(line(101)));
    act(() => handlers.get("log:entry")!(line(102)));
    const newest = screen.getByText("Line 102").closest("li")!;
    expect(animated).toContain(newest);
    expect(newest.querySelector(".lr-comet.lr-face-r")).not.toBeNull();
  });

  it("lights a chat line this device just sent from the Send side", () => {
    // jsdom lays nothing out; a line needs a width for the light to have a direction.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    render(
      <ToastProvider>
        <CombatLogPanel />
      </ToastProvider>
    );
    act(() => handlers.get("log:entry")!(line(201)));
    noteChatSent();
    act(() =>
      handlers.get("log:entry")!(
        line(202, { kind: "chat", text: "On my way", author: { name: "Lyra", role: "player" } })
      )
    );
    const mine = screen.getByText("On my way").closest("li")!;
    expect(mine.querySelector(".lr-comet.lr-face-l")).not.toBeNull();
  });

  it("runs light along the panel's tabs to Log when a line arrives on another tab", () => {
    const { container } = render(
      <TablePanel
        label="The table"
        active="fight"
        onActive={() => {}}
        tabs={[
          { id: "fight", label: "Fight", content: null },
          { id: "log", label: "Log", content: null }
        ]}
      />
    );
    act(() => handlers.get("log:entry")!(line(301)));
    expect(container.querySelectorAll(".table-panel-tabs > .lr-comet")).toHaveLength(1);
  });
});

describe("a tab trip", () => {
  it("runs a comet to the tab with news and bursts there", () => {
    document.body.innerHTML = `<div class="strip"><button id="a"></button><button id="b"></button></div>`;
    const strip = document.querySelector<HTMLElement>(".strip")!;
    tabTrip(strip, document.getElementById("a"), document.getElementById("b")!);
    expect(strip.querySelectorAll(".lr-comet")).toHaveLength(1);
    expect(strip.querySelectorAll(".lr-burst")).toHaveLength(1);
  });
});

describe("claiming a character", () => {
  const actor = (id: string, name: string) =>
    ({
      id,
      name,
      kind: "player-character",
      visibility: "public",
      hp: { kind: "exact", current: 9, maximum: 9, temporary: 0 },
      effects: [],
      conditions: [],
      claimStatus: "available",
      presence: null
    }) as unknown as PlayerActor;

  it("lights the picked card's top edge and dims the others for a moment", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <ClaimCharacter
          state={
            {
              revision: 1,
              partyVisibility: "name-and-class",
              actors: [actor("a", "Borin"), actor("b", "Mirena")]
            } as unknown as PlayerView
          }
        />
      </ToastProvider>
    );
    await user.click(screen.getAllByRole("radio")[1]!);
    expect(container.querySelector(".claim-row-edge")).not.toBeNull();
    expect(animated).toContain(container.querySelector("[data-actor='a']"));
  });
});
