import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentActionSummary, GmActor } from "@vtt/domain";

// `command()` sends through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit` here.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { ToastProvider } from "@vtt/ui";
import { socket } from "../socket";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { KnownForms } from "../sheet/KnownForms";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { ShapeShiftDialog } from "./ShapeShiftDialog";
import { beginTargeting, clearTargeting, resolveTargeting, useTargeting } from "./targeting";

// A shape-shift picks its form before it goes (Wild Shape's Beast, a werewolf's hybrid), each target's own where each
// takes one (Animal Shapes), whether the gear melds, and Enlarge/Reduce its effect. The server checks every pick.

const HERO = "10000000-0000-4000-8000-000000000001";
const FOE = "10000000-0000-4000-8000-000000000002";

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const sent = (event: string) =>
  emit.mock.calls
    .filter((call) => call[0] === event)
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

const WOLF = { id: "wolf", name: "Wolf", challengeRating: 0.25, size: "medium", fly: false };
const CAT = { id: "cat", name: "Cat", challengeRating: 0, size: "tiny", fly: false };
const EAGLE = { id: "giant-eagle", name: "Giant Eagle", challengeRating: 1, size: "large", fly: true };

const WILD_SHAPE = action({
  id: "wild-shape",
  name: "Wild Shape",
  activation: "bonus-action",
  targeting: "none",
  usesLimit: 2,
  forms: { options: [WOLF, CAT], gearChoice: true, learnable: [WOLF, CAT, EAGLE], knownLimit: 4, swapOpen: false }
});
const ANIMAL_SHAPES = action({
  id: "spell-animal-shapes",
  name: "Animal Shapes",
  targeting: "multi",
  forms: { options: [WOLF, EAGLE], perTarget: true }
});
const ENLARGE_REDUCE = action({
  id: "spell-enlargereduce",
  name: "Enlarge/Reduce",
  targeting: "single",
  options: [
    { id: "enlarge", name: "Enlarge" },
    { id: "reduce", name: "Reduce" }
  ]
});

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

beforeEach(() => {
  vi.clearAllMocks();
  emit.mockImplementation((_event: string, _payload: unknown, ack?: (result: unknown) => void) => ack?.({ ok: true }));
});
afterEach(() => act(() => clearTargeting()));

describe("the picks a shape-shift asks for in a fight", () => {
  it("waits for Wild Shape's form, then sends it with the gear melded", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(WILD_SHAPE, HERO));
    render(<Picker />);
    const roll = screen.getByRole("button", { name: "Roll Wild Shape" }) as HTMLButtonElement;
    expect(roll.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("Form"), "wolf");
    expect((screen.getByLabelText("Gear") as HTMLSelectElement).value).toBe("merged");
    await user.selectOptions(screen.getByLabelText("Gear"), "worn");
    await user.click(roll);
    expect(sent("action:resolve")).toEqual([
      { actorId: HERO, actionId: "wild-shape", form: "wolf", gear: "worn", commit: true }
    ]);
  });

  it("lists each form with its Challenge Rating and size, and says which fly", () => {
    act(() => beginTargeting(WILD_SHAPE, HERO));
    render(<Picker />);
    const labels = [...(screen.getByLabelText("Form") as HTMLSelectElement).options].map((option) => option.text);
    expect(labels).toEqual(["Choose a form", "Wolf · CR 1/4 · Medium", "Cat · CR 0 · Tiny"]);
  });

  it("asks Animal Shapes for a form for each target it names", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(ANIMAL_SHAPES, HERO));
    render(<Picker />);
    expect(screen.getByText("Choose the targets first, then a form for each.")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: /Goblin/ }));
    await user.selectOptions(screen.getByLabelText("Form for Goblin"), "giant-eagle");
    await user.click(screen.getByRole("button", { name: "Roll Animal Shapes" }));
    expect(sent("action:resolve")).toEqual([
      {
        actorId: HERO,
        actionId: "spell-animal-shapes",
        targetIds: [FOE],
        targetForms: [{ targetId: FOE, form: "giant-eagle" }],
        commit: true
      }
    ]);
  });

  it("sends Enlarge/Reduce's effect, Enlarge until another is picked", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(ENLARGE_REDUCE, HERO));
    render(<Picker />);
    expect((screen.getByLabelText("Effect") as HTMLSelectElement).value).toBe("enlarge");
    await user.click(screen.getByRole("radio", { name: /Goblin/ }));
    await user.selectOptions(screen.getByLabelText("Effect"), "reduce");
    await user.click(screen.getByRole("button", { name: "Roll Enlarge/Reduce" }));
    expect(sent("action:resolve")).toEqual([
      { actorId: HERO, actionId: "spell-enlargereduce", targetIds: [FOE], option: "reduce", commit: true }
    ]);
  });
});

describe("a shape-shift outside a fight", () => {
  it("asks for the form, and for Polymorph's target, before it is used", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const polymorph = action({ id: "spell-polymorph", name: "Polymorph", forms: { options: [WOLF, EAGLE] } });
    render(
      <ShapeShiftDialog
        shift={{ action: polymorph, aims: "single" }}
        candidates={[
          { id: HERO, name: "Maelin" },
          { id: FOE, name: "Goblin" }
        ]}
        defaultId={HERO}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );
    const use = screen.getByRole("button", { name: "Use" }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Goblin" }));
    await user.selectOptions(screen.getByLabelText("Form"), "wolf");
    await user.click(use);
    expect(onConfirm).toHaveBeenCalledWith({ targetIds: [FOE], form: "wolf" });
  });
});

describe("Wild Shape's known forms", () => {
  it("lets the Druid pick forms up to its limit and saves them", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <KnownForms actorId={HERO} role="player" name="Wild Shape" forms={WILD_SHAPE.forms!} known={[]} />
      </ToastProvider>
    );
    expect(screen.getByText("Wild Shape forms · 0 of 4 known")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Choose forms" }));
    expect(screen.getByText("Choose 4 more.")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Wolf · CR 1/4 · Medium" }));
    await user.click(screen.getByRole("checkbox", { name: "Giant Eagle · CR 1 · Large · flies" }));
    await user.click(screen.getByRole("button", { name: "Save forms" }));
    expect(sent("character:set-known-forms")).toEqual([{ actorId: HERO, formIds: ["wolf", "giant-eagle"] }]);
  });

  it("says a full list may change one form after a Long Rest", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <KnownForms
          actorId={HERO}
          role="player"
          name="Wild Shape"
          forms={{ ...WILD_SHAPE.forms!, knownLimit: 2 }}
          known={["wolf", "cat"]}
        />
      </ToastProvider>
    );
    expect(screen.getByText("Wolf · CR 1/4 · Medium")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change forms" }));
    expect(screen.getByText("You may replace one after a Long Rest.")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Giant Eagle · CR 1 · Large · flies" }) as HTMLInputElement).disabled
    ).toBe(true);
  });
});

describe("a sheet in a form", () => {
  it("says the character is in its form and the sheet shows the form's statistics", () => {
    const druid = {
      id: HERO,
      name: "Maelin",
      kind: "player-character",
      visibility: "public",
      hp: { current: 20, maximum: 20, temporary: 11 },
      ownerSessionId: null,
      presence: null,
      conditions: [],
      effects: [
        {
          id: "cmd-1:form",
          name: "Wild Shape (Wolf)",
          tags: [],
          sourceActorId: HERO,
          sourceName: "Maelin",
          sourceActionId: "wild-shape",
          startedRound: 1,
          duration: { type: "minutes", remaining: 60 },
          endsWhenSourceDefeated: false,
          voidWhileIncapacitated: false,
          concentration: false,
          endsWithTag: null,
          modifiers: [],
          linkedConditionIds: [],
          escapeDc: null,
          onEnd: [],
          form: { name: "Wolf", statBlockId: "wolf", keeps: ["mental", "features"], gear: "merged" }
        }
      ],
      deathSaves: null,
      actionUses: {},
      choiceOverrides: {},
      conditionImmunities: [],
      hitDice: null,
      lastLongRestAt: null,
      spellSlots: null,
      pactSlots: null,
      preparedSpellIds: [],
      inventory: [],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      archived: false,
      sheetPreview: false
    } as unknown as GmActor;
    render(
      <ToastProvider>
        <CharacterSheet actor={druid} role="gm" onClose={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByText("Maelin is in Wolf form. The sheet shows the form's statistics.")).toBeTruthy();
  });
});
