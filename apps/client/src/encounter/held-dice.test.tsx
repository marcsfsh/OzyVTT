import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView, PendingSave, PlayerView } from "@vtt/domain";

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
import { ToastProvider } from "@vtt/ui";
import { followTable } from "../dice/roll-preference";
import { SettingsPage } from "../settings/SettingsPage";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { DyingTracker } from "./DyingTracker";
import { SavePrompt } from "./SavePrompt";
import type { TargetingSession } from "./targeting";

// The server throws a prompt's die and holds it, so Confirm applies the die shown (ADR-0012). A player types a face
// (only while the table lets players type), never a total or a mode, and rerolls only with Heroic Inspiration; the
// GM may force a mode and reroll freely.

const SAVE: PendingSave = {
  id: "60000000-0000-4000-8000-000000000001",
  targetActorId: "10000000-0000-4000-8000-000000000002",
  ability: "dex",
  dc: 15,
  sourceActorId: "10000000-0000-4000-8000-000000000001",
  sourceName: "Dragon",
  actionName: "Fire Breath",
  proposedDamage: 0,
  halfOnSuccess: false,
  conditionIds: [],
  saveBonus: 0,
  createdAt: 0
};

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const calls = (event: string) =>
  (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls.filter(([name]) => name === event);
/** The payloads sent for `event`, without the id every command carries. */
const sent = (event: string) => calls(event).map(([, { commandId: _commandId, ...payload }]) => payload);
const answerLast = (event: string, reply: unknown) => calls(event).at(-1)![2](reply);

const savePreview = (outcome: Record<string, unknown> = {}) => ({
  ok: true,
  outcome: {
    success: false,
    total: 9,
    natural: 7,
    dc: 15,
    appliedDamage: 0,
    conditionApplied: false,
    committed: false,
    rollMode: { mode: "disadvantage", advantage: [], disadvantage: ["Poisoned"] },
    ...outcome
  }
});

const mountSave = (viewer: "gm" | "player", inspired = false) =>
  render(
    <SavePrompt
      save={SAVE}
      targetName="Borin"
      canDismiss={viewer === "gm"}
      onFeedback={() => {}}
      rollMode="manual"
      viewer={viewer}
      inspired={inspired}
    />
  );

const openTable = { builderPolicy: { typedRolls: "open" } } as unknown as PlayerView;
const closedTable = { builderPolicy: { typedRolls: "gm-only" } } as unknown as PlayerView;

describe("a player's saving throw", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says why it had Disadvantage and confirms the die shown, with no mode and no free reroll", async () => {
    const user = userEvent.setup();
    mountSave("player");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    expect(sent("save:answer")).toEqual([{ saveId: SAVE.id, method: "roll", commit: false }]);
    answerLast("save:answer", savePreview());
    expect(await screen.findByText("Rolled 9 (d20 7) · Disadvantage (Poisoned) - Failure")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Adv" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reroll/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent("save:answer").at(-1)).toEqual({ saveId: SAVE.id, method: "roll", commit: true });
  });

  it("spends Heroic Inspiration to reroll the die", async () => {
    const user = userEvent.setup();
    mountSave("player", true);
    await user.click(screen.getByRole("button", { name: "Roll" }));
    answerLast("save:answer", savePreview());
    await user.click(await screen.findByRole("button", { name: "Reroll · Heroic Inspiration" }));
    expect(sent("save:answer").at(-1)).toEqual({ saveId: SAVE.id, method: "roll", commit: false, reroll: true });
  });

  it("types a face, and types the reroll of a typed die", async () => {
    const user = userEvent.setup();
    mountSave("player", true);
    await user.type(screen.getByLabelText("Your save d20"), "4");
    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(sent("save:answer").at(-1)).toEqual({ saveId: SAVE.id, method: "roll", commit: false, face: 4 });
    answerLast("save:answer", savePreview({ total: 4, natural: 4, rollMode: undefined }));
    await user.type(await screen.findByLabelText("The rerolled d20"), "15");
    await user.click(screen.getByRole("button", { name: "Reroll · Heroic Inspiration" }));
    expect(sent("save:answer").at(-1)).toEqual({
      saveId: SAVE.id,
      method: "roll",
      commit: false,
      face: 15,
      reroll: true
    });
  });

  it("refuses a number that is not a d20's face", async () => {
    const user = userEvent.setup();
    const feedback = vi.fn();
    render(
      <SavePrompt
        save={SAVE}
        targetName="Borin"
        canDismiss={false}
        onFeedback={feedback}
        rollMode="manual"
        viewer="player"
      />
    );
    await user.type(screen.getByLabelText("Your save d20"), "21");
    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(sent("save:answer")).toEqual([]);
    expect(feedback).toHaveBeenCalledWith("Type the d20's face, a whole number from 1 to 20.");
  });
});

describe("the GM's saving throw", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forces a mode, which rides the reroll and the Confirm", async () => {
    const user = userEvent.setup();
    mountSave("gm");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    answerLast("save:answer", savePreview());
    await user.click(await screen.findByRole("button", { name: "Adv" }));
    expect(sent("save:answer").at(-1)).toEqual({
      saveId: SAVE.id,
      method: "roll",
      commit: false,
      rollMode: "advantage"
    });
    answerLast(
      "save:answer",
      savePreview({
        success: true,
        total: 17,
        natural: 15,
        rollMode: { mode: "advantage", advantage: ["GM's choice"], disadvantage: [] }
      })
    );
    expect(await screen.findByText("Rolled 17 (d20 15) · Advantage (GM's choice) - Success")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reroll" }));
    expect(sent("save:answer").at(-1)).toMatchObject({ reroll: true, rollMode: "advantage" });
    answerLast("save:answer", savePreview({ success: true }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(sent("save:answer").at(-1)).toEqual({
      saveId: SAVE.id,
      method: "roll",
      commit: true,
      rollMode: "advantage"
    });
  });
});

describe("typing dice at the table", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => followTable(openTable));

  it("is offered to a player only while the table lets players type their dice", () => {
    followTable(closedTable);
    const { unmount } = render(
      <SavePrompt
        save={{ ...SAVE, proposedDamage: 17 }}
        targetName="Borin"
        canDismiss={false}
        onFeedback={() => {}}
        rollMode="manual"
        viewer="player"
      />
    );
    expect(screen.queryByLabelText("Your save d20")).toBeNull();
    // Typed damage stands in for dice too.
    expect(screen.queryByLabelText(/Damage on a failure/)).toBeNull();
    unmount();
    // The GM may always type.
    followTable({ ...closedTable, definitions: [] } as unknown as GmView);
    mountSave("gm");
    expect(screen.getByLabelText("Your save d20")).toBeTruthy();
  });

  it("tells a player at such a table why there is no choice of how to roll", () => {
    followTable(closedTable);
    render(<SettingsPage role="player" state={null} />, { wrapper: ToastProvider });
    expect(screen.getByText("At this table the server rolls players' dice. The GM can change that.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "How you roll" })).toBeNull();
    followTable(openTable);
  });
});

describe("a death save", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the total with Bless's d4 and confirms the held die without naming it", async () => {
    const user = userEvent.setup();
    render(
      <DyingTracker
        actorId={SAVE.targetActorId}
        name="Borin"
        deathSaves={{ successes: 0, failures: 1, stable: false }}
        canRoll
        onFeedback={() => {}}
        rollMode="manual"
        isActingTurn
        viewer="player"
      />
    );
    await user.click(screen.getByRole("button", { name: "Roll" }));
    expect(sent("death-save:roll")).toEqual([{ actorId: SAVE.targetActorId, commit: false }]);
    answerLast("death-save:roll", {
      ok: true,
      deathSave: {
        naturalRoll: 8,
        total: 11,
        outcome: "success",
        successes: 1,
        failures: 1,
        stable: false,
        dead: false,
        regainedConsciousness: false,
        committed: false
      }
    });
    expect(await screen.findByText("Rolled 8 (total 11) - Success")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent("death-save:roll").at(-1)).toEqual({ actorId: SAVE.targetActorId, commit: true });
  });
});

describe("an attack's typed d20", () => {
  it("goes with the Roll from the target picker", async () => {
    const user = userEvent.setup();
    const onRoll = vi.fn();
    const picking = {
      action: { id: "swing", name: "Longsword", attackBonus: 5 },
      attackerId: SAVE.targetActorId,
      mode: "single",
      selected: [SAVE.sourceActorId],
      template: null
    } as unknown as TargetingSession;
    render(
      <ActionTargetPicker
        picking={picking}
        targets={[{ id: SAVE.sourceActorId!, label: "Dragon" }]}
        busy={false}
        onRoll={onRoll}
      />
    );
    await user.type(screen.getByLabelText("Attack d20 for Longsword"), "17");
    await user.click(screen.getByRole("button", { name: "Use" }));
    expect(onRoll).toHaveBeenCalledWith(17);
  });
});
