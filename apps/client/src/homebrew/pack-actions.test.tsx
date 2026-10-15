import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";
import type { HomebrewPack, HomebrewPackImportReport } from "./api";

vi.mock("./api", () => ({ homebrewApi: { exportPack: vi.fn(), importPack: vi.fn() } }));

import { homebrewApi } from "./api";
import { PackActions } from "./PackActions";

const PACK: HomebrewPack = {
  schemaId: "vtt.homebrew-pack",
  schemaVersion: 1,
  name: "Ozy's Homebrew",
  attribution: null,
  exportedAt: "2026-10-15T00:00:00.000Z",
  records: [{ id: "wizard", type: "class", name: "Wizard Again" }]
};
const PLAN: HomebrewPackImportReport = {
  imported: [{ id: "hb-wizard-again-a1b2c3", type: "class", name: "Wizard Again", originalId: "wizard" }],
  reminted: [{ originalId: "wizard", id: "hb-wizard-again-a1b2c3", reason: "srd-collision" }],
  overwritten: [],
  rejected: [],
  dryRun: true
};

const importPack = homebrewApi.importPack as unknown as ReturnType<typeof vi.fn>;

describe("homebrew pack import", () => {
  beforeEach(() => {
    importPack.mockReset();
  });

  it("shows the server's dry-run plan, and imports only when the GM confirms", async () => {
    importPack.mockResolvedValueOnce(PLAN).mockResolvedValueOnce({ ...PLAN, dryRun: false });
    const onImported = vi.fn();
    const { container } = render(
      <ToastProvider>
        <PackActions gmToken="gm" onImported={onImported} />
      </ToastProvider>
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File([JSON.stringify(PACK)], "pack.json", { type: "application/json" }));

    // The plan is the dry run, and nothing has been written yet.
    expect(await screen.findByText(/1 record will arrive as drafts only you can see/)).toBeTruthy();
    expect(screen.getByText(/wizard \(an SRD id\)/)).toBeTruthy();
    expect(importPack).toHaveBeenCalledTimes(1);
    expect(importPack.mock.calls[0][2]).toEqual({ dryRun: true, onIdCollision: "remint" });
    expect(onImported).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(importPack.mock.calls[1][2]).toEqual({ onIdCollision: "remint" });
  });
});
