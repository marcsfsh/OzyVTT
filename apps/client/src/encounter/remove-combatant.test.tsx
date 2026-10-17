import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmActor, type GmView, type MutationResult } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));

import { RowTools } from "./RowTools";

const HERO = "10000000-0000-4000-8000-000000000001";
const WORM = "10000000-0000-4000-8000-000000000002";

const fight = (initiative: readonly string[]): GmView =>
  GameStateSchema.parse({
    schemaVersion: 1,
    revision: 7,
    actors: [
      { id: HERO, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 } },
      { id: WORM, name: "Purple Worm", kind: "monster", visibility: "public", hp: { current: 247, maximum: 247 } }
    ],
    combat: {
      active: true,
      round: 2,
      turnActorId: initiative[0],
      initiative: initiative.map((actorId, index) => ({ actorId, score: 20 - index }))
    }
  }) as unknown as GmView;

function mount(
  state: GmView,
  run = vi.fn(async (operation: () => Promise<MutationResult>) => void (await operation()))
) {
  const worm = state.actors.find((actor) => actor.id === WORM) as GmActor;
  render(
    <RowTools
      actor={worm}
      state={state}
      busy={false}
      run={run}
      hpDamageType={null}
      onHpDamageTypeChange={() => {}}
      onOpenSheet={() => {}}
      onClose={() => {}}
      onFeedback={() => {}}
    />
  );
  return run;
}

describe("taking a combatant out of the fight from its row", () => {
  it("asks first, then sends the command and says who left", async () => {
    const user = userEvent.setup();
    const run = mount(fight([WORM, HERO]));
    await user.click(screen.getByRole("button", { name: "Take out of fight" }));
    expect(command).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Take Purple Worm out of the fight" });
    expect(confirm.textContent).toContain("Take Purple Worm out of the fight?");
    await user.click(screen.getByRole("button", { name: "Take out" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("encounter:remove-combatant", { actorId: WORM, expectedRevision: 7 })
    );
    expect(run).toHaveBeenCalledWith(expect.any(Function), "Purple Worm left the fight.");
  });

  it("isn't offered for the last combatant, who ends the encounter instead", () => {
    mount(fight([WORM]));
    expect(screen.queryByRole("button", { name: "Take out of fight" })).toBeNull();
  });
});
