import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameStateSchema, type GmView, type PlayerView } from "@vtt/domain";
import { LiveChip } from "./LiveChip";

// The live chip (frame spec 2.1): nothing with nothing live, the encounter's name and round for the GM, and "Your
// turn" only for the player whose character acts now.

const base = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
const gm = (combat: Partial<GmView["combat"]>): GmView =>
  ({ ...base, combat: { ...base.combat, ...combat } }) as unknown as GmView;
const player = (turnActorId: string | null): PlayerView =>
  ({
    ...base,
    actors: [
      { id: "lyra", name: "Lyra", kind: "player-character", claimStatus: "mine" },
      { id: "borin", name: "Borin", kind: "player-character", claimStatus: "other" }
    ],
    combat: { ...base.combat, active: true, round: 3, turnActorId, hiddenTurn: false }
  }) as unknown as PlayerView;

describe("the live chip", () => {
  it("shows nothing while no encounter is live", () => {
    const { container } = render(<LiveChip role="gm" state={gm({ activeEncounterId: null })} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the GM's live encounter and its round once the fight runs", () => {
    const encounters = [{ id: "e1", name: "Goblin warren" }] as unknown as GmView["combat"]["encounters"];
    const { unmount } = render(<LiveChip role="gm" state={gm({ activeEncounterId: "e1", encounters })} />);
    expect(screen.getByRole("button", { name: "Live: Goblin warren, not started. Go to the table" })).toBeTruthy();
    unmount();
    render(<LiveChip role="gm" state={gm({ activeEncounterId: "e1", encounters, active: true, round: 3 })} />);
    expect(screen.getByText("R03")).toBeTruthy();
  });

  it("says Your turn only to the player whose character acts now", () => {
    const { unmount } = render(<LiveChip role="player" state={player("lyra")} />);
    expect(screen.getByText("Your turn")).toBeTruthy();
    unmount();
    render(<LiveChip role="player" state={player("borin")} />);
    expect(screen.queryByText("Your turn")).toBeNull();
    expect(screen.getByText("R03")).toBeTruthy();
  });
});
