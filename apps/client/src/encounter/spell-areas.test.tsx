import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmView, type MutationResult } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));

import { SpellAreas } from "./SpellAreas";
import { clearTargeting, setTemplatePlacement, useTargeting } from "./targeting";

// The GM's list of spell areas the server runs on the map: where each stands, Place for one a player's cast left
// unplaced, and End.

const DRUID = "10000000-0000-4000-8000-000000000001";
const CLERIC = "10000000-0000-4000-8000-000000000002";
const MOONBEAM = "60000000-0000-4000-8000-000000000001";
const GUARDIANS = "60000000-0000-4000-8000-000000000002";

const zone = (id: string, spellId: string, name: string, casterId: string, area: unknown) => ({
  id,
  spellId,
  name,
  laterActionId: `spell-${spellId}-then-save`,
  casterId,
  castId: id,
  startedRound: 1,
  level: 3,
  dc: 15,
  annotationId: null,
  area
});

const state = GameStateSchema.parse({
  schemaVersion: 1,
  revision: 4,
  actors: [
    { id: DRUID, name: "Maelin", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 } },
    { id: CLERIC, name: "Mira", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 } }
  ],
  combat: {
    active: true,
    round: 1,
    turnActorId: DRUID,
    initiative: [
      { actorId: DRUID, score: 15 },
      { actorId: CLERIC, score: 12 }
    ],
    spellZones: [
      zone(MOONBEAM, "moonbeam", "Moonbeam", DRUID, { shape: "cylinder", sizeFeet: 5, widthFeet: null }),
      zone(GUARDIANS, "spirit-guardians", "Spirit Guardians", CLERIC, null)
    ]
  }
}) as unknown as GmView;

/** Shows the targeting session the list starts, as the map's confirm bar reads it. */
function Session() {
  const session = useTargeting();
  return <p data-testid="session">{session ? `${session.action.name}:${session.placeZoneId}` : "none"}</p>;
}

const run = vi.fn(async (operation: () => Promise<MutationResult>) => void (await operation()));
afterEach(() => {
  clearTargeting();
  command.mockClear();
  run.mockClear();
});

describe("the GM's spell areas", () => {
  it("lists where each area stands, offering Place only for one waiting to be placed", () => {
    render(<SpellAreas state={state} busy={false} run={run} />, { wrapper: ToastProvider });
    const list = screen.getByRole("region", { name: "Spell areas" });
    expect(list.textContent).toContain("Moonbeam · Maelin · not placed yet");
    expect(list.textContent).toContain("Spirit Guardians · Mira · around its caster");
    expect(screen.getAllByRole("button", { name: "Place" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "End" })).toHaveLength(2);
  });

  it("places an area through the map's template, sent as the zone's placement", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SpellAreas state={state} busy={false} run={run} />
        <Session />
      </>,
      { wrapper: ToastProvider }
    );
    await user.click(screen.getByRole("button", { name: "Place" }));
    expect(screen.getByTestId("session").textContent).toBe(`Moonbeam area:${MOONBEAM}`);
    // The row says how to place it and holds the placement's own buttons.
    expect(screen.getByText(/Drag on the map to place the 5-foot-radius cylinder/)).toBeTruthy();
    const set = screen.getByRole("button", { name: "Set it here" });
    expect((set as HTMLButtonElement).disabled).toBe(true);
    act(() => setTemplatePlacement({ x: 125, y: 125 }, { x: 175, y: 125 }));
    await user.click(screen.getByRole("button", { name: "Set it here" }));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("none"));
    expect(command).toHaveBeenCalledWith("spell-zone:place", {
      zoneId: MOONBEAM,
      template: { shape: "circle", origin: { x: 125, y: 125 }, target: { x: 175, y: 125 } },
      expectedRevision: 4
    });
  });

  it("sizes the area from the spell and offers no roll, since placing it rolls nothing", async () => {
    const user = userEvent.setup();
    render(<SpellAreas state={state} busy={false} run={run} />, { wrapper: ToastProvider });
    await user.click(screen.getByRole("button", { name: "Place" }));
    const row = screen.getByRole("status");
    expect(row.textContent).toBe("Moonbeam · Drag on the map to place the 5-foot-radius cylinder.");
    expect(screen.queryByRole("button", { name: /Roll/ })).toBeNull();
    act(() => setTemplatePlacement({ x: 125, y: 125 }, { x: 175, y: 125 }));
    expect(row.textContent).toBe("Moonbeam · Drag again to move it, or set it here.");
    const region = screen.getByRole("region", { name: "Spell areas" });
    expect((within(region).getByRole("button", { name: "Set it here" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ends an area", async () => {
    const user = userEvent.setup();
    render(<SpellAreas state={state} busy={false} run={run} />, { wrapper: ToastProvider });
    await user.click(screen.getAllByRole("button", { name: "End" })[1]!);
    expect(command).toHaveBeenCalledWith("spell-zone:end", { zoneId: GUARDIANS, expectedRevision: 4 });
    expect(run).toHaveBeenCalledWith(expect.any(Function), "Spirit Guardians ended.");
  });
});
