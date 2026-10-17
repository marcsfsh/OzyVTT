import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentActionSummary, ContentSkillSummary } from "@vtt/domain";

// `command()` sends through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit` here.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { beginTargeting, clearTargeting, resolveTargeting, useTargeting } from "./targeting";

// Search, Study, Influence and Escape a Grapple are made with a skill the roller picks; Hex's caster picks the ability
// its target's checks have Disadvantage with. Both ride the action's resolve.

const SKILLS: readonly ContentSkillSummary[] = [
  { id: "perception", name: "Perception", description: "", ability: "wis" },
  { id: "insight", name: "Insight", description: "", ability: "wis" },
  { id: "athletics", name: "Athletics", description: "", ability: "str" },
  { id: "acrobatics", name: "Acrobatics", description: "", ability: "dex" }
];
const HERO = "10000000-0000-4000-8000-000000000001";
const FOE = "10000000-0000-4000-8000-000000000002";

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const resolves = () =>
  emit.mock.calls
    .filter((call) => call[0] === "action:resolve")
    .map((call) => {
      const { commandId: _commandId, ...payload } = call[1] as Record<string, unknown>;
      return payload;
    });

const action = (fields: Partial<ContentActionSummary> & Pick<ContentActionSummary, "id" | "name">) =>
  ({
    activation: "action",
    description: "",
    attackBonus: null,
    reachFeet: null,
    rangeFeet: null,
    rangeNormalFeet: null,
    saveAbility: null,
    saveDc: null,
    damage: [],
    area: null,
    attackCount: null,
    usesLimit: null,
    usesPer: null,
    usesRecharge: null,
    usesPool: null,
    requiresEffectTag: null,
    multiattack: null,
    grants: false,
    reaction: null,
    ...fields
  }) as ContentActionSummary;

const SEARCH = action({
  id: "search",
  name: "Search",
  builtin: true,
  targeting: "none",
  checkSkills: [
    { id: "perception", ability: "wis" },
    { id: "insight", ability: "wis" }
  ]
});
const ESCAPE = action({
  id: "escape-grapple",
  name: "Escape a Grapple",
  builtin: true,
  targeting: "none",
  checkSkills: [
    { id: "athletics", ability: "str" },
    { id: "acrobatics", ability: "dex" }
  ]
});
const HEX = action({ id: "hex", name: "Hex", activation: "bonus-action", grants: true, choosesAbility: true });

/** The picker as a runner shows it, for whatever session the store holds. */
function Picker() {
  const picking = useTargeting();
  return picking ? (
    <ActionTargetPicker
      picking={picking}
      targets={[{ id: FOE, label: "Goblin" }]}
      busy={false}
      onRoll={() => resolveTargeting(undefined, () => {})}
    />
  ) : null;
}

describe("a check action's skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "content:skills") ack?.({ ok: true, skills: SKILLS, attribution: "SRD 5.2.1, CC BY 4.0." });
      else ack?.({ ok: true });
    });
  });
  afterEach(() => act(() => clearTargeting()));

  it("starts Search on Perception, takes another, and rolls with no target", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(SEARCH, HERO));
    render(<Picker />);
    expect(screen.getByText(/choose the skill, then Roll/)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    const skill = screen.getByLabelText("Skill") as HTMLSelectElement;
    expect(skill.value).toBe("perception");
    await user.selectOptions(skill, "insight");
    await user.click(screen.getByRole("button", { name: "Roll Search" }));
    expect(resolves()).toEqual([{ actorId: HERO, actionId: "search", skill: "insight", commit: true }]);
  });

  it("lets Escape a Grapple use the better of its two unless one is picked", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(ESCAPE, HERO));
    render(<Picker />);
    expect((screen.getByLabelText("Skill") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Roll Escape a Grapple" }));
    expect(resolves().at(-1)).toEqual({ actorId: HERO, actionId: "escape-grapple", commit: true });
    await user.selectOptions(screen.getByLabelText("Skill"), "acrobatics");
    await user.click(screen.getByRole("button", { name: "Roll Escape a Grapple" }));
    expect(resolves().at(-1)).toMatchObject({ skill: "acrobatics" });
  });
});

describe("Hex's chosen ability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emit.mockImplementation((_event: string, _payload: unknown, ack?: (result: unknown) => void) =>
      ack?.({ ok: true })
    );
  });
  afterEach(() => act(() => clearTargeting()));

  it("waits for the ability, then casts with it", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(HEX, HERO));
    render(<Picker />);
    await user.click(screen.getByRole("checkbox", { name: "Goblin" }));
    const roll = screen.getByRole("button", { name: "Roll Hex" }) as HTMLButtonElement;
    expect(roll.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("Ability"), "dex");
    await user.click(roll);
    expect(resolves()).toEqual([{ actorId: HERO, actionId: "hex", targetIds: [FOE], ability: "dex", commit: true }]);
  });
});
