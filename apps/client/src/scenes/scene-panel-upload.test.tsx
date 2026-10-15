import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, auth: { token: "gm-token" } }
}));

import { ScenePanel } from "./ScenePanel";

const ASSET = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Cavern",
  kind: "battlemap",
  folder: null,
  width: 700,
  height: 500,
  calibration: null,
  scale: null
};

afterEach(() => vi.unstubAllGlobals());

describe("uploading a map from the New scene dialog", () => {
  it("tells the shell, so the other tabs' copy of the library is refreshed", async () => {
    const user = userEvent.setup();
    let uploaded = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === "POST") uploaded = true;
        const data = init?.method === "POST" ? { asset: ASSET } : { assets: uploaded ? [ASSET] : [] };
        return new Response(JSON.stringify({ ok: true, apiVersion: "1", data }), { status: 200 });
      })
    );
    const onMapUploaded = vi.fn();
    const { container } = render(
      <ToastProvider>
        <ScenePanel actors={[]} selectedMap={null} mapLibrary={[]} onMapUploaded={onMapUploaded} />
      </ToastProvider>
    );

    await user.click(screen.getByRole("button", { name: "Pick a map" }));
    const input = container.querySelector<HTMLInputElement>("input.map-picker-file")!;
    await user.upload(input, new File(["png"], "cavern.png", { type: "image/png" }));

    await vi.waitFor(() => expect(onMapUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: ASSET.id })));
  });
});
