import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActorDefinition } from "@vtt/schemas";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { PickControl } from "./PickControl";

const ACTOR = "10000000-0000-4000-8000-000000000003";
const halfDragon = {
  traitMechanics: [
    {
      kind: "pick",
      name: "Draconic Origin",
      key: "draconic-origin",
      of: "damage-type",
      options: ["acid", "cold", "fire", "lightning", "poison"]
    }
  ]
} as unknown as ActorDefinition;

describe("the GM's stat-block picks", () => {
  it("chooses a half-dragon's Draconic Origin from the types its trait lists", async () => {
    render(<PickControl actor={{ id: ACTOR, name: "Half-Dragon" }} definition={halfDragon} onFeedback={() => {}} />);
    const select = screen.getByLabelText("Draconic Origin") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "None",
      "Acid",
      "Cold",
      "Fire",
      "Lightning",
      "Poison"
    ]);
    fireEvent.change(select, { target: { value: "cold" } });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("actor:set-pick", { actorId: ACTOR, key: "draconic-origin", value: "cold" })
    );
  });

  it("shows the stored pick, clears it with None, and shows nothing for a stat block with no pick", async () => {
    command.mockClear();
    const { container, rerender } = render(
      <PickControl
        actor={{ id: ACTOR, name: "Half-Dragon", statBlockPicks: { "draconic-origin": "fire" } }}
        definition={halfDragon}
        onFeedback={() => {}}
      />
    );
    const select = screen.getByLabelText("Draconic Origin") as HTMLSelectElement;
    expect(select.value).toBe("fire");
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("actor:set-pick", { actorId: ACTOR, key: "draconic-origin", value: null })
    );
    rerender(<PickControl actor={{ id: ACTOR, name: "Goblin" }} definition={undefined} onFeedback={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
