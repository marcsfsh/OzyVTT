import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingSave, PlayerPendingReaction } from "@vtt/domain";

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
import { ReactionPrompt } from "./ReactionPrompt";
import { SavePrompt } from "./SavePrompt";

// A shown roll's answers (Bardic Inspiration, Indomitable, Improve Fate): each is a button on the roll that names what
// it does, sent to the server with the held die; another creature's answer comes as a reaction prompt, and a roll
// waiting on one holds its Confirm.

const SAVE: PendingSave = {
  id: "60000000-0000-4000-8000-000000000001",
  targetActorId: "10000000-0000-4000-8000-000000000002",
  ability: "wis",
  dc: 15,
  sourceActorId: "10000000-0000-4000-8000-000000000001",
  sourceName: "Ghoul",
  actionName: "Scary Face",
  proposedDamage: 0,
  halfOnSuccess: false,
  conditionIds: ["frightened"],
  saveBonus: 0,
  createdAt: 0
};

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const calls = (event: string) =>
  (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls.filter(([name]) => name === event);
const sent = (event: string) => calls(event).map(([, { commandId: _commandId, ...payload }]) => payload);
const answerLast = (event: string, reply: unknown) => calls(event).at(-1)![2](reply);

const preview = (outcome: Record<string, unknown> = {}) => ({
  ok: true,
  outcome: {
    success: false,
    total: 12,
    natural: 10,
    dc: 15,
    appliedDamage: 0,
    conditionApplied: true,
    committed: false,
    ...outcome
  }
});

const mountSave = (save: PendingSave = SAVE) =>
  render(
    <SavePrompt
      save={save}
      targetName="Borin"
      canDismiss={false}
      onFeedback={() => {}}
      rollMode="manual"
      viewer="player"
    />
  );

describe("answers on a shown saving throw", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offer each answer as a button that names what it does and what it spends", async () => {
    const user = userEvent.setup();
    mountSave();
    await user.click(screen.getByRole("button", { name: "Roll" }));
    answerLast(
      "save:answer",
      preview({
        answers: [
          { id: "bardic-inspiration", name: "Bardic Inspiration", does: "+1d8", cost: null },
          { id: "indomitable", name: "Indomitable", does: "Reroll +9", cost: "a use", rerolls: true }
        ]
      })
    );
    const inspiration = await screen.findByRole("button", { name: "Bardic Inspiration · +1d8" });
    expect(screen.getByRole("button", { name: "Indomitable · Reroll +9" }).getAttribute("title")).toBe("Spends a use");
    await user.click(inspiration);
    expect(sent("save:answer").at(-1)).toEqual({
      saveId: SAVE.id,
      method: "roll",
      commit: false,
      answer: { id: "bardic-inspiration" }
    });
    answerLast(
      "save:answer",
      preview({ success: true, total: 17, answered: [{ name: "Bardic Inspiration", change: "+5" }] })
    );
    expect(await screen.findByText("Bardic Inspiration: +5")).toBeTruthy();
  });

  it("offer a die that can go either way as two buttons", async () => {
    const user = userEvent.setup();
    mountSave();
    await user.click(screen.getByRole("button", { name: "Roll" }));
    answerLast(
      "save:answer",
      preview({
        answers: [{ id: "boon-of-fate", name: "Improve Fate", does: "+2d4 or -2d4", cost: "a use", either: true }]
      })
    );
    await user.click(await screen.findByRole("button", { name: "Improve Fate · -2d4" }));
    expect(sent("save:answer").at(-1)).toMatchObject({ answer: { id: "boon-of-fate", subtract: true } });
  });

  it("hold the Confirm while another creature's answer is awaited", async () => {
    mountSave({ ...SAVE, confirmed: { asked: [] } } as PendingSave);
    expect(screen.getByRole("status").textContent).toBe("Waiting on an answer to the roll.");
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Roll" })).toBeNull();
  });
});

const CUTTING_WORDS: PlayerPendingReaction = {
  id: "60000000-0000-4000-8000-000000000002",
  kind: "roll-answer",
  actorId: "10000000-0000-4000-8000-000000000003",
  actionId: "cutting-words",
  actionName: "Cutting Words",
  targetActorId: "10000000-0000-4000-8000-000000000002",
  sourceName: "Goblin",
  triggerCommandId: "50000000-0000-4000-8000-000000000001",
  proposedDamage: 0,
  proposedDamageParts: [],
  critical: false,
  weighed: null,
  acBonus: null,
  rollsAttack: false,
  rollKind: "attack",
  answerDoes: "-1d8",
  createdAt: 0
};

const mountReaction = (reaction: PlayerPendingReaction) =>
  render(
    <ReactionPrompt
      reaction={reaction}
      actorName="Lyra"
      canDismiss={false}
      onFeedback={() => {}}
      rollMode="auto"
      viewer="player"
    />
  );

describe("another creature's roll waiting on an answer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the roll and what the answer does, and Use sends it", async () => {
    const user = userEvent.setup();
    mountReaction(CUTTING_WORDS);
    expect(screen.getByText(/Goblin's attack roll: -1d8/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use Cutting Words" }));
    expect(sent("reaction:answer")).toEqual([{ reactionId: CUTTING_WORDS.id, use: true }]);
  });

  it("adds or takes off a die that can go either way", async () => {
    const user = userEvent.setup();
    mountReaction({
      ...CUTTING_WORDS,
      actionId: "boon-of-fate",
      actionName: "Improve Fate",
      rollKind: "save",
      answerDoes: "+2d4 or -2d4",
      answerEither: true
    });
    await user.click(screen.getByRole("button", { name: "Improve Fate · -2d4" }));
    expect(sent("reaction:answer")).toEqual([{ reactionId: CUTTING_WORDS.id, use: true, subtract: true }]);
  });

  it("offers a rolled reduction of held damage", () => {
    mountReaction({
      ...CUTTING_WORDS,
      kind: "hit-by-attack",
      actionId: "deflect-attacks",
      actionName: "Deflect Attacks",
      proposedDamage: 9,
      proposedDamageParts: [{ amount: 9, type: "slashing" }],
      damageResponse: { kind: "reduce", formula: "1d10 + 6" }
    });
    expect(screen.getByRole("button", { name: "Use Deflect Attacks · -1d10 + 6" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take 9" })).toBeTruthy();
  });

  it("sends the creature a reduction to 0 redirects the force at", async () => {
    const user = userEvent.setup();
    const orc = { actorId: "10000000-0000-4000-8000-0000000000aa", name: "Orc" };
    mountReaction({
      ...CUTTING_WORDS,
      kind: "hit-by-attack",
      actionId: "deflect-attacks",
      actionName: "Deflect Attacks",
      proposedDamage: 9,
      proposedDamageParts: [{ amount: 9, type: "slashing" }],
      damageResponse: { kind: "reduce", formula: "1d10 + 6" },
      redirectChoices: [orc]
    });
    const force = within(screen.getByRole("group", { name: "Redirect the force at 0 damage" }));
    expect(force.getByRole("button", { name: "No one" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(force.getByRole("button", { name: "Orc" }));
    await user.click(screen.getByRole("button", { name: "Use Deflect Attacks · -1d10 + 6" }));
    expect(sent("reaction:answer")).toEqual([{ reactionId: CUTTING_WORDS.id, use: true, redirectTo: orc.actorId }]);
  });
});
