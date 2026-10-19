import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { CODEX_PATHS, GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type CodexInWorldDate, type GameState, type GmCodexCalendar } from "@vtt/domain";
import { bootServer } from "./boot-server.js";
import { travelLine } from "../src/commands/resting.js";

// One game clock: the game keeps the hour (`rest.clockHours`, the 16-hour rule's clock) and the Codex calendar keeps
// the day, so a rest or Pass time that crosses midnight moves the Codex date. And the notices a first evening needs:
// a player's Long Rest ask reaches the GM wherever they are, and the GM hears no echo of a roll they called.

const LYRA = "10000000-0000-4000-8000-0000000000e1";
const BORIN = "10000000-0000-4000-8000-0000000000e2";

function game(): GameState {
  const hero = (id: string, name: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 20, maximum: 30 },
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  });
  return GameStateSchema.parse({ schemaVersion: 1, actors: [hero(LYRA, "Lyra"), hero(BORIN, "Borin")] });
}

type Booted = Awaited<ReturnType<typeof bootServer>>;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function boot(): Promise<Booted> {
  const booted = await bootServer(game());
  cleanups.push(booted.close);
  return booted;
}

async function calendar(booted: Booted): Promise<GmCodexCalendar> {
  const response = await fetch(booted.base + CODEX_PATHS.calendar, {
    headers: { authorization: `Bearer ${booted.gmToken}` }
  });
  return (await response.json()).data.calendar as GmCodexCalendar;
}

async function setDate(booted: Booted, currentDate: CodexInWorldDate) {
  const { publishedDate: _published, ...structure } = await calendar(booted);
  const response = await fetch(booted.base + CODEX_PATHS.calendar, {
    method: "PUT",
    headers: { authorization: `Bearer ${booted.gmToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ...structure, currentDate })
  });
  expect(response.status).toBe(200);
}

const passHours = (booted: Booted, hours: number) =>
  booted.post(GAME_PATHS.timePass, booted.gmToken, { commandId: randomUUID(), hours });

describe("one game clock", () => {
  it("moves the Codex date by each midnight the game clock crosses, and the players' date with it when it matched", async () => {
    const booted = await boot();
    await setDate(booted, { year: 1491, month: 0, day: 3 });
    expect((await booted.post(CODEX_PATHS.calendarPublish, booted.gmToken, {})).status).toBe(200);

    // 20 hours stays on the same day; 5 more cross midnight.
    expect((await passHours(booted, 20)).status).toBe(200);
    expect((await calendar(booted)).currentDate).toEqual({ year: 1491, month: 0, day: 3 });
    expect((await passHours(booted, 5)).status).toBe(200);
    expect(booted.server.store.snapshot.rest.clockHours).toBe(25);
    expect(await calendar(booted)).toMatchObject({
      currentDate: { year: 1491, month: 0, day: 4 },
      publishedDate: { year: 1491, month: 0, day: 4 }
    });

    // The GM runs ahead of the party: a Long Rest from 01:00 to 09:00 crosses no midnight, so nothing moves.
    await setDate(booted, { year: 1491, month: 0, day: 10 });
    const rest = await booted.post(GAME_PATHS.restParty, booted.gmToken, {
      commandId: randomUUID(),
      kind: "long",
      actorIds: [LYRA, BORIN]
    });
    expect(rest.status).toBe(200);
    expect(booted.server.store.snapshot.rest.clockHours).toBe(33);
    expect((await calendar(booted)).currentDate).toEqual({ year: 1491, month: 0, day: 10 });

    // 60 hours from 09:00 ends at 21:00 two days on; the players' date, a different day, stays put.
    expect((await passHours(booted, 60)).status).toBe(200);
    expect(await calendar(booted)).toMatchObject({
      currentDate: { year: 1491, month: 0, day: 12 },
      publishedDate: { year: 1491, month: 0, day: 4 }
    });
  });

  it("crosses into the next month on the calendar's own lengths", async () => {
    const booted = await boot();
    await setDate(booted, { year: 1491, month: 0, day: 30 });
    expect((await passHours(booted, 24)).status).toBe(200);
    expect((await calendar(booted)).currentDate).toEqual({ year: 1491, month: 1, day: 1 });
  });

  it("leaves a Codex with no date alone", async () => {
    const booted = await boot();
    expect((await passHours(booted, 48)).status).toBe(200);
    expect(await calendar(booted)).toMatchObject({ currentDate: null, publishedDate: null });
  });
});

function emitCommand(socket: Socket, event: string, payload: unknown) {
  return new Promise<{ ok: boolean; message?: string }>((resolve) =>
    (socket.emit as (...args: unknown[]) => void)(event, payload, resolve)
  );
}

async function joinSocket(base: string, token: string) {
  const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  cleanups.push(() => void socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit("session:join", { token }, resolve));
  expect(joined.ok).toBe(true);
  return socket;
}

/** Collects every table notice a socket hears. */
function notices(socket: Socket): string[] {
  const heard: string[] = [];
  socket.on("table:event", (event: { text: string }) => heard.push(event.text));
  return heard;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("travel", () => {
  it("goes 4, 3 or 2 miles an hour by pace, and says what the pace does to the party's checks", async () => {
    expect(travelLine(8, "normal")).toBe(
      "The party travels 24 miles at a Normal pace, with Disadvantage on Dexterity (Stealth) checks on the way."
    );
    expect(travelLine(1, "fast")).toContain("4 miles at a Fast pace");
    expect(travelLine(3, "slow")).toContain(
      "6 miles at a Slow pace, with Advantage on Wisdom (Perception or Survival)"
    );
    expect(travelLine(1.5, "normal")).toContain("4.5 miles at a Normal pace");
    const booted = await boot();
    const travelled = await booted.post(GAME_PATHS.timePass, booted.gmToken, {
      commandId: randomUUID(),
      hours: 8,
      pace: "fast"
    });
    expect(travelled.status).toBe(200);
    expect(booted.server.store.snapshot.rest.clockHours).toBe(8);
  });
});

describe("notices on the GM's devices", () => {
  it("a player's Long Rest ask reaches the GM as a notice, and no other player hears it", async () => {
    const booted = await boot();
    const lyraPlayer = booted.server.auth.issuePlayerSession();
    const borinPlayer = booted.server.auth.issuePlayerSession();
    expect((await booted.post(GAME_PATHS.claims, lyraPlayer, { commandId: randomUUID(), actorId: LYRA })).status).toBe(
      200
    );
    expect(
      (await booted.post(GAME_PATHS.claims, borinPlayer, { commandId: randomUUID(), actorId: BORIN })).status
    ).toBe(200);
    const gm = notices(await joinSocket(booted.base, booted.gmToken));
    const other = notices(await joinSocket(booted.base, borinPlayer));
    const asker = await joinSocket(booted.base, lyraPlayer);

    expect((await emitCommand(asker, "rest:ask", { commandId: randomUUID(), actorId: LYRA })).ok).toBe(true);
    await settle();
    expect(gm).toEqual(["Lyra asks for a Long Rest. Answer it under Needs you on the Table."]);
    expect(other).toEqual([]);

    // Taking the ask back is not news.
    expect((await emitCommand(asker, "rest:ask", { commandId: randomUUID(), actorId: LYRA, withdraw: true })).ok).toBe(
      true
    );
    await settle();
    expect(gm).toHaveLength(1);
  });

  it("a call for a roll reaches the players it names, and the GM who made it hears no echo", async () => {
    const booted = await boot();
    const lyraPlayer = booted.server.auth.issuePlayerSession();
    expect((await booted.post(GAME_PATHS.claims, lyraPlayer, { commandId: randomUUID(), actorId: LYRA })).status).toBe(
      200
    );
    const gmSocket = await joinSocket(booted.base, booted.gmToken);
    const gm = notices(gmSocket);
    const player = notices(await joinSocket(booted.base, lyraPlayer));

    const called = await emitCommand(gmSocket, "roll-call:start", {
      commandId: randomUUID(),
      kind: "check",
      ability: "int",
      dc: 12,
      actorIds: [LYRA, BORIN]
    });
    expect(called.ok).toBe(true);
    await settle();
    expect(player).toEqual(["The GM calls for an Intelligence check (DC 12)."]);
    expect(gm).toEqual([]);
  });
});
