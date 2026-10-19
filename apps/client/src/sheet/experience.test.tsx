import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmView } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true, each: 300, ready: [] }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { AwardExperience, ExperienceLine, experienceOf } from "./Experience";
import { FightMenu } from "../encounter/FightMenu";
import { fightExperienceOf } from "../encounter/GmEncounterPanel";
import type { SheetActor } from "./sheet-model";

// SRD Character Advancement: level 2 starts at 300 XP and level 3 at 900; level 20 is the last.

const LYRA = "10000000-0000-4000-8000-0000000000c1";

describe("the Experience Points line", () => {
  it("shows the total and where the next level starts", () => {
    render(<ExperienceLine points={250} level={1} />);
    expect(screen.getByRole("region", { name: "Experience Points" }).textContent).toContain("250 XP");
    expect(screen.getByText("Level 2 at 300 XP.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the level up once the total reaches it, to a viewer who may level", () => {
    const onLevelUp = vi.fn();
    render(<ExperienceLine points={900} level={2} onLevelUp={onLevelUp} />);
    expect(screen.getByText("Enough for level 3, which starts at 900 XP.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Level up to 3" }));
    expect(onLevelUp).toHaveBeenCalled();
  });

  it("says when there is no level above", () => {
    render(<ExperienceLine points={400000} level={20} onLevelUp={() => {}} />);
    expect(screen.getByText("Level 20 is the last level.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is absent until the GM awards XP", () => {
    expect(experienceOf({ id: LYRA, name: "Lyra", kind: "player-character" } as unknown as SheetActor)).toBe(undefined);
    expect(
      experienceOf({ id: LYRA, name: "Lyra", kind: "player-character", experiencePoints: 0 } as unknown as SheetActor)
    ).toBe(0);
  });
});

describe("the GM's XP award", () => {
  it("awards the amount to the character", async () => {
    const said = vi.fn();
    render(<AwardExperience actorId={LYRA} name="Lyra" onFeedback={said} />);
    fireEvent.click(screen.getByRole("button", { name: "Award XP" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("actor:award-experience", { actorIds: [LYRA], amount: 100 })
    );
    await waitFor(() => expect(said).toHaveBeenCalledWith("Lyra gains 100 XP."));
  });

  it("shares a fight's XP among its characters, from the monsters at 0 Hit Points", () => {
    const actor = (id: string, kind: string, current: number) => ({ id, name: id, kind, hp: { current, maximum: 10 } });
    const state = {
      actors: [
        actor("lyra", "player-character", 5),
        actor("borin", "player-character", 0),
        actor("goblin", "monster", 0),
        actor("orc", "monster", 4),
        actor("guide", "npc", 0),
        actor("bystander", "player-character", 10)
      ],
      combat: { initiative: ["lyra", "borin", "goblin", "orc", "guide"].map((actorId) => ({ actorId })) }
    } as unknown as GmView;
    const award = fightExperienceOf(state)!;
    expect(award.recipients.map((entry) => entry.id)).toEqual(["lyra", "borin"]);
    expect(award.defeated.map((entry) => entry.id)).toEqual(["goblin"]);
    const standing = {
      ...state,
      actors: state.actors.map((entry) => ({ ...entry, hp: { ...entry.hp, current: 5 } }))
    } as unknown as GmView;
    expect(fightExperienceOf(standing)).toBeNull();
  });
});

describe("the fight menu's XP award", () => {
  it("awards the fight's XP, at the lair XP when the GM says the fight was in their lair", async () => {
    const award = vi.fn();
    const state = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
    render(
      <FightMenu
        state={{ ...state, combat: { ...state.combat, active: true } }}
        busy={false}
        run={vi.fn()}
        onFeedback={() => {}}
        onAddMonsters={() => {}}
        onEnd={() => {}}
        onAwardExperience={award}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Fight options/ }));
    const xp = within(screen.getByRole("group", { name: "Experience Points" }));
    await user.click(xp.getByRole("switch", { name: "Fought in their lair" }));
    await user.click(xp.getByRole("button", { name: "Award the fight's XP" }));
    expect(award).toHaveBeenCalledWith(true);
  });
});
