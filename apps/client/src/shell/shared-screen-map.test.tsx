import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@vtt/ui";

// The shared screen's controls, reduced to the map the shell offers them.
vi.mock("../viewer/ViewerControls", () => ({
  ViewerControls: ({ map }: { map?: { altText: string } }) => <p>Offered: {map?.altText ?? "no map"}</p>
}));

import { goTo } from "../../test/route";
import { gmView, serveScenes } from "../../test/scenes-fakes";
import { GmShell } from "./GmShell";

afterEach(() => vi.unstubAllGlobals());

const renderShell = () =>
  render(
    <ToastProvider>
      <GmShell
        state={gmView()}
        token="gm"
        connection="online"
        busy={false}
        onSignOut={vi.fn()}
        onRevokeAll={vi.fn()}
        onChangePassword={vi.fn(async () => null)}
      />
    </ToastProvider>
  );

describe("the Shared screen's map", () => {
  // Opened straight from its address, or reached before the Table's load came back, it once offered no map and
  // left Present disabled.
  it("offers the newest battle map when the GM opens the Shared screen first", async () => {
    serveScenes();
    goTo("/viewer-controls");
    renderShell();
    expect(await screen.findByText("Offered: Sunken crypt")).toBeInTheDocument();
  });
});
