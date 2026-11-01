import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToastProvider } from "@vtt/ui";

// The GM's Table screen page (table screen spec 2.3): what is on the screen as one bar, the paired screens as cards
// with the connected ones first, and Pair another screen as the last card.

const answers = vi.hoisted(() => ({ enabled: true, activeMap: true as boolean }));
vi.mock("../lib/api", () => ({
  apiRequest: vi.fn(async (path: string) => {
    if (path === "/api/v1/viewer/presentation")
      return {
        presentation: {
          schemaVersion: 1,
          revision: 4,
          enabled: answers.enabled,
          activeMap: answers.activeMap ? { assetId: "map-1", altText: "Goblin warren" } : null,
          camera: null,
          measurement: null,
          pings: [],
          initiative: { visible: false, round: 0, hiddenTurn: false, entries: [] },
          encounter: { mapAssetId: null, tokens: [] }
        }
      };
    if (path === "/api/v1/viewer/access")
      return {
        viewers: [
          {
            id: "v1",
            name: "Kitchen TV",
            createdAt: "2026-10-12T20:00:00Z",
            expiresAt: null,
            lastUsedAt: "2026-10-25T20:00:00Z",
            revokedAt: null
          },
          {
            id: "v2",
            name: "Den TV",
            createdAt: "2026-10-12T20:00:00Z",
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: null
          },
          {
            id: "v3",
            name: "Old laptop",
            createdAt: "2026-10-01T20:00:00Z",
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: "2026-10-02T20:00:00Z"
          }
        ],
        connections: [
          { connectionId: "c1", viewerId: "v2", name: "Den TV", connectedAt: "2026-10-31T20:00:00Z", sound: "on" }
        ]
      };
    if (path.includes("viewer-urls")) return { viewerUrls: ["http://192.168.1.20:3001/viewer.html"] };
    return {};
  })
}));
vi.mock("../scene/mapImage", async (original) => ({
  ...(await original<typeof import("../scene/mapImage")>()),
  useAuthorizedMapImage: () => ({ status: "loading" })
}));

import { ViewerControls } from "./ViewerControls";

afterEach(() => {
  answers.enabled = true;
  answers.activeMap = true;
});

const map = { assetId: "map-2", width: 700, height: 500, altText: "Smoke crossing" };
const mount = () =>
  render(
    <ToastProvider>
      <ViewerControls gmToken="gm" map={map} />
    </ToastProvider>
  );

describe("the Table screen page", () => {
  it("draws each paired screen as a card, connected first, and none for a revoked one", async () => {
    mount();
    await screen.findByText("Den TV");
    const cards = within(screen.getByRole("list", { name: "Paired screens" })).getAllByRole("listitem");
    const names = cards.map(
      (card) => card.querySelector("strong")?.textContent ?? card.querySelector("h3")?.textContent
    );
    expect(names).toEqual(["Den TV", "Kitchen TV", "Pair another screen"]);
    expect(cards[0]).toHaveTextContent("Connected · Sound on");
    expect(cards[1]).toHaveTextContent("Not connected");
    expect(cards[1]).toHaveTextContent("Last seen");
    expect(within(cards[2]).getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    expect(within(cards[2]).getByRole("button", { name: "Pair screen" })).toBeInTheDocument();
  });

  it("puts Pause on the bar while a map is on the screen, and Present the offered map while paused", async () => {
    mount();
    const bar = await screen.findByRole("region", { name: "On the screen" });
    expect(await within(bar).findByRole("button", { name: "Pause the table screen" })).toBeInTheDocument();
    expect(bar).toHaveTextContent("Goblin warren");
  });

  it("offers Present {map} on the bar while paused", async () => {
    answers.enabled = false;
    mount();
    const bar = await screen.findByRole("region", { name: "On the screen" });
    expect(await within(bar).findByRole("button", { name: "Present Smoke crossing" })).toBeInTheDocument();
    expect(bar).toHaveTextContent("Paused");
  });
});
