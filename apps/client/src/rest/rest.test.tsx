import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

// The Codex calendar the dialog reads its date from: Deepwinter 3, 1491, until a test clears it.
const calendarDate = vi.hoisted(() => ({ current: { year: 1491, month: 0, day: 3 } as object | null }));
vi.mock("../codex/api", () => ({
  calendarApi: {
    get: async () => ({
      yearName: "DR",
      eras: [],
      months: [
        { name: "Deepwinter", days: 30 },
        { name: "The Claw", days: 30 }
      ],
      weekdays: [],
      currentDate: calendarDate.current,
      publishedDate: null
    })
  }
}));

import { GameStateSchema, type GmView, type PlayerView } from "@vtt/domain";
import {
  CraftingHelpSchema,
  CraftingWorkSchema,
  RestAnswerSchema,
  RestAskSchema,
  RestFinishSchema,
  RestInterruptSchema,
  RestMarkDoneSchema,
  RestPartySchema,
  RestResumeSchema,
  TimePassSchema,
  TimeSetDawnSchema
} from "@vtt/domain/commands";
import { ToastProvider } from "@vtt/ui";
import { socket } from "../socket";
import { RestButtons } from "../sheet/PlayTab";
import { PartyRest as RestDialog } from "./PartyRest";
import { RestPrompt } from "./RestPrompt";

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const COMMAND = { commandId: "10000000-0000-4000-8000-0000000000aa" };
const TORVA = "10000000-0000-4000-8000-000000000001";
const BRYN = "10000000-0000-4000-8000-000000000002";

function gmView(
  rest: Record<string, unknown> = {},
  bryn: Record<string, unknown> = {},
  more: Record<string, unknown> = {}
): GmView {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: TORVA, name: "Torva", kind: "player-character", hp: { current: 30, maximum: 75 } },
      { id: BRYN, name: "Bryn", kind: "player-character", hp: { current: 12, maximum: 40 }, ...bryn }
    ],
    rest,
    ...more
  });
  return { ...state, actors: state.actors.map((actor) => ({ ...actor, presence: null })) };
}

const PartyRest = (props: Readonly<{ state: GmView }>) => <RestDialog {...props} token="gm-token" />;

describe("the GM's rest panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calendarDate.current = { year: 1491, month: 0, day: 3 };
    // The server accepts, so a control frees itself for the next tap.
    (socket.emit as unknown as { mockImplementation: (run: (...args: EmitCall) => void) => void }).mockImplementation(
      (_event, _payload, ack) => ack({ ok: true, revision: 1 })
    );
  });

  it("shows the Codex date with the game's hour, the 16-hour wait, and rests the picked characters", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ clockHours: 38 }, { lastLongRestAt: 30 })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const dialog = screen.getByRole("dialog", { name: "Rest" });
    expect(await within(dialog).findByText("Deepwinter 3, 1491 DR · 14:00")).toBeTruthy();
    expect(within(dialog).getByText("12/40 HP · Long Rest in 8 h")).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: /Bryn/ }));
    await user.click(within(dialog).getByRole("button", { name: "Long Rest" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:party");
    expect(RestPartySchema.parse({ ...payload, ...COMMAND })).toMatchObject({ kind: "long", actorIds: [TORVA] });
  });

  it("passes time on the road at the pace the GM picks", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ clockHours: 38 })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const dialog = screen.getByRole("dialog", { name: "Rest" });
    await user.click(within(dialog).getByRole("button", { name: "Normal" }));
    await user.click(within(dialog).getByRole("button", { name: "Travel 8 hours" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("time:pass");
    expect(TimePassSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ hours: 8, pace: "normal" });
  });

  it("shows the clock's minutes and passes hours and minutes together", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ clockHours: 9, clockMinutes: 30 })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const dialog = screen.getByRole("dialog", { name: "Rest" });
    expect(await within(dialog).findByText("Deepwinter 3, 1491 DR · 09:30")).toBeTruthy();
    const hours = within(dialog).getByRole("group", { name: "Hours to pass" });
    const minutes = within(dialog).getByRole("group", { name: "Minutes to pass" });
    for (let step = 0; step < 7; step += 1) await user.click(within(hours).getByRole("button", { name: "Decrease" }));
    await user.click(within(minutes).getByRole("button", { name: "Increase" }));
    await user.click(within(minutes).getByRole("button", { name: "Increase" }));
    expect(within(minutes).getByText("5 min")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Pass 1 hour 5 minutes" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("time:pass");
    expect(TimePassSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ hours: 1, minutes: 5 });
  });

  it("offers no pass when no time is chosen", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView()} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const hours = screen.getByRole("group", { name: "Hours to pass" });
    for (let step = 0; step < 8; step += 1) await user.click(within(hours).getByRole("button", { name: "Decrease" }));
    expect(screen.getByRole("button", { name: "Pass time" })).toBeDisabled();
  });

  it("answers a player's request from the button's badge", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ requests: [BRYN] })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: /Rest\s*1 asked/ }));
    const request = within(screen.getByRole("region", { name: "Long Rest requests" })).getByRole("listitem");
    expect(within(request).getByText("Bryn")).toBeTruthy();
    await user.click(within(request).getByRole("button", { name: "Approve" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:answer");
    expect(RestAnswerSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ actorId: BRYN, approve: true });
  });

  it("while a Short Rest is open, shows who is done and finishes it", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ shortRest: { actorIds: [TORVA, BRYN], done: [BRYN] } })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Short Rest open" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Done")).toBeTruthy();
    expect(within(dialog).getByText("No player")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Finish Short Rest" }));
    expect(emitted().at(-1)!.slice(0, 2)).toEqual(["rest:finish", expect.objectContaining({ apply: true })]);
    // Finishing is the end of the dialog's work.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("while a Long Rest is under way, interrupts and resumes members and finishes it", async () => {
    const user = userEvent.setup();
    const longRest = {
      startedAt: 0,
      members: [{ actorId: TORVA }, { actorId: BRYN, interrupted: true, shortRestEarned: true }]
    };
    render(
      <ToastProvider>
        <PartyRest state={gmView({ clockHours: 2, longRest })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Long Rest open" }));
    const section = screen.getByRole("region", { name: "Long Rest under way" });
    expect(within(section).getByText("Long Rest under way · 2 h so far")).toBeTruthy();
    const [torva, bryn] = within(section).getAllByRole("listitem");
    expect(within(torva!).getByText("Needs 8 h")).toBeTruthy();
    expect(within(bryn!).getByText("Interrupted · has a Short Rest's benefits")).toBeTruthy();
    await user.click(within(torva!).getByRole("button", { name: "Interrupt" }));
    expect(emitted().at(-1)![0]).toBe("rest:interrupt");
    expect(RestInterruptSchema.parse({ ...emitted().at(-1)![1], ...COMMAND })).toMatchObject({ actorId: TORVA });
    await user.click(within(bryn!).getByRole("button", { name: "Resume" }));
    expect(emitted().at(-1)![0]).toBe("rest:resume");
    expect(RestResumeSchema.parse({ ...emitted().at(-1)![1], ...COMMAND })).toMatchObject({ actorId: BRYN });
    await user.click(screen.getByRole("button", { name: "Finish Long Rest" }));
    expect(emitted().at(-1)![0]).toBe("rest:finish");
    expect(RestFinishSchema.parse({ ...emitted().at(-1)![1], ...COMMAND })).toMatchObject({
      apply: true,
      kind: "long"
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("passes downtime and works the party's crafting projects", async () => {
    const user = userEvent.setup();
    const project = {
      id: "10000000-0000-4000-8000-0000000000c1",
      crafterId: TORVA,
      itemId: "shortsword",
      itemName: "Shortsword",
      kind: "item",
      toolId: "smiths-tools",
      workMinutes: 960,
      doneMinutes: 480,
      paidCp: 500,
      startedAt: 0
    };
    render(
      <ToastProvider>
        <PartyRest state={gmView({}, {}, { crafting: { projects: [project] } })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const crafting = screen.getByRole("region", { name: "Crafting" });
    expect(within(crafting).getByText("Shortsword · 5 GP paid")).toBeTruthy();
    expect(within(crafting).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await user.click(within(crafting).getByRole("button", { name: "Log a day" }));
    expect(emitted().at(-1)![0]).toBe("crafting:work");
    expect(CraftingWorkSchema.parse({ ...emitted().at(-1)![1], ...COMMAND })).toMatchObject({
      projectId: project.id,
      days: 1
    });
    await user.click(within(crafting).getByRole("button", { name: "Add helper" }));
    expect(CraftingHelpSchema.parse({ ...emitted().at(-1)![1], ...COMMAND })).toMatchObject({
      projectId: project.id,
      actorId: BRYN,
      helping: true
    });
    await user.click(screen.getByRole("switch", { name: "Downtime: crafters work on their projects" }));
    await user.click(screen.getByRole("button", { name: "Pass 8 hours" }));
    expect(emitted().at(-1)![0]).toBe("time:pass");
    expect(TimePassSchema.parse({ ...emitted().at(-1)![1], ...COMMAND })).toMatchObject({ hours: 8, downtime: true });
  });

  it("says Choosing only for a character with a player, and No player for one without", async () => {
    const user = userEvent.setup();
    const state = gmView({ shortRest: { actorIds: [TORVA, BRYN], done: [] } }, { ownerSessionId: COMMAND.commandId });
    render(
      <ToastProvider>
        <PartyRest state={state} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Short Rest open" }));
    const rows = within(screen.getByRole("region", { name: "Short Rest under way" })).getAllByRole("listitem");
    expect(within(rows[0]).getByText("No player")).toBeTruthy();
    expect(within(rows[1]).getByText("Choosing")).toBeTruthy();
    expect(screen.getByText(/A character with no player gets the rest when you finish it\./)).toBeTruthy();
  });

  it("leaves a character at 0 HP unticked, so a Short Rest starts without them", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({}, { hp: { current: 0, maximum: 40 } })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    expect(screen.getByRole("checkbox", { name: /Torva/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Bryn/ })).not.toBeChecked();
    expect(screen.getByText("0/40 HP · Needs 1 HP to rest")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Short Rest" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:party");
    expect(RestPartySchema.parse({ ...payload, ...COMMAND })).toMatchObject({ kind: "short", actorIds: [TORVA] });
  });

  it("with no Codex date shows the hour and the way to set one", async () => {
    calendarDate.current = null;
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ clockHours: 9 })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    expect(await screen.findByRole("button", { name: "Set the date" })).toBeTruthy();
    expect(screen.getByText("09:00", { selector: "p" })).toBeTruthy();
  });

  it("sets the hour dawn comes, or leaves it to each Long Rest", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PartyRest state={gmView({ dawnHour: null })} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Rest" }));
    const dawn = screen.getByLabelText("Dawn");
    expect((dawn as HTMLSelectElement).value).toBe("");
    await user.selectOptions(dawn, "06:00");
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("time:set-dawn");
    expect(TimeSetDawnSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ hour: 6 });
  });
});

describe("a player's rests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The server accepts, so a control frees itself for the next tap.
    (socket.emit as unknown as { mockImplementation: (run: (...args: EmitCall) => void) => void }).mockImplementation(
      (_event, _payload, ack) => ack({ ok: true, revision: 1 })
    );
  });

  it("the sheet asks the GM for a Long Rest instead of taking one, and can take the ask back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RestButtons actorId={TORVA} role="player" asked={false} onFeedback={() => {}} />);
    expect(screen.queryByRole("button", { name: "Long Rest" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ask for a Long Rest" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:ask");
    expect(RestAskSchema.parse({ ...payload, ...COMMAND })).toEqual({ ...COMMAND, actorId: TORVA });
    rerender(<RestButtons actorId={TORVA} role="player" asked onFeedback={() => {}} />);
    expect(screen.getByText("Long Rest asked")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(emitted().at(-1)![1]).toMatchObject({ actorId: TORVA, withdraw: true });
  });

  it("the party's Short Rest shows the player's Hit Point Dice and a Done button", async () => {
    const user = userEvent.setup();
    const view = {
      revision: 3,
      actors: [
        {
          id: TORVA,
          name: "Torva",
          kind: "player-character",
          hp: { kind: "exact", current: 30, maximum: 75, temporary: 0 },
          hitDice: { die: "d12", maximum: 7, remaining: 3, entries: [{ die: "d12", maximum: 7, remaining: 3 }] }
        }
      ],
      rest: { requests: [], shortRest: { actorIds: [TORVA], done: [] } }
    } as unknown as PlayerView;
    render(
      <ToastProvider>
        <RestPrompt state={view} />
      </ToastProvider>
    );
    const prompt = screen.getByRole("region", { name: "Short Rest for Torva" });
    expect(within(prompt).getByText("3 of 7 d12")).toBeTruthy();
    await user.click(within(prompt).getByRole("button", { name: "Done" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:mark-done");
    expect(RestMarkDoneSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ actorId: TORVA, done: true });
  });

  it("an interrupted Long Rest offers Hit Point Dice after an hour of rest, and Resume", async () => {
    const user = userEvent.setup();
    const view = {
      revision: 3,
      actors: [
        {
          id: TORVA,
          name: "Torva",
          kind: "player-character",
          hp: { kind: "exact", current: 30, maximum: 75, temporary: 0 },
          hitDice: { die: "d12", maximum: 7, remaining: 3, entries: [{ die: "d12", maximum: 7, remaining: 3 }] }
        }
      ],
      rest: {
        requests: [],
        shortRest: null,
        longRest: { actorIds: [TORVA], interrupted: [TORVA], shortRestEarned: [TORVA] }
      }
    } as unknown as PlayerView;
    render(
      <ToastProvider>
        <RestPrompt state={view} />
      </ToastProvider>
    );
    const prompt = screen.getByRole("region", { name: "Long Rest for Torva" });
    expect(within(prompt).getByText("3 of 7 d12")).toBeTruthy();
    await user.click(within(prompt).getByRole("button", { name: "Resume" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rest:resume");
    expect(RestResumeSchema.parse({ ...payload, ...COMMAND })).toEqual({ ...COMMAND, actorId: TORVA });
  });

  it("a Long Rest under way says the GM ends it, with no buttons", () => {
    const view = {
      revision: 1,
      actors: [{ id: TORVA, name: "Torva", kind: "player-character", hp: { kind: "band", band: "healthy" } }],
      rest: { requests: [], shortRest: null, longRest: { actorIds: [TORVA], interrupted: [], shortRestEarned: [] } }
    } as unknown as PlayerView;
    render(
      <ToastProvider>
        <RestPrompt state={view} />
      </ToastProvider>
    );
    const prompt = screen.getByRole("region", { name: "Long Rest for Torva" });
    expect(within(prompt).getByText("Resting. The GM ends the rest after 8 hours.")).toBeTruthy();
    expect(within(prompt).queryByRole("button")).toBeNull();
  });

  it("shows nothing when no Short Rest includes the player's character", () => {
    const view = { revision: 1, actors: [], rest: { requests: [], shortRest: null } } as unknown as PlayerView;
    const { container } = render(<RestPrompt state={view} />);
    expect(container.textContent).toBe("");
  });
});
