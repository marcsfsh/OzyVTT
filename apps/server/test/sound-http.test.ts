import { randomUUID } from "node:crypto";
import { GameStateSchema, type SoundBoardView } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { bootServer } from "./boot-server.js";
import { mp3, wav } from "./audio-fixtures.js";
import { png } from "./image-fixtures.js";

// The sound board end to end, through the real server: the GM's library and commands, what a table screen may
// see and fetch, and that players get none of it (ADR-0024).

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function boot() {
  const booted = await bootServer(GameStateSchema.parse({ schemaVersion: 1 }));
  cleanups.push(booted.close);
  const { base, gmToken } = booted;
  const gm = { authorization: `Bearer ${gmToken}` };
  const json = async (response: Response) => (await response.json()) as Record<string, any>;
  const upload = async (bytes: Buffer<ArrayBuffer>, filename: string, headers: Record<string, string> = gm) =>
    fetch(`${base}/api/v1/sound-assets?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/octet-stream" },
      body: bytes
    });
  const command = (path: string, body: unknown, token = gmToken) =>
    fetch(`${base}/api/v1/game/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  const playerToken = (await json(await fetch(`${base}/api/v1/sessions/player`, { method: "POST" }))).data
    .token as string;
  /** Pairs a table screen and returns its cookie. */
  const pairScreen = async (name = "Living room TV") => {
    const pairing = await json(
      await fetch(`${base}/api/v1/viewer/pairings`, {
        method: "POST",
        headers: { ...gm, "content-type": "application/json" },
        body: "{}"
      })
    );
    const exchange = await fetch(`${base}/api/v1/viewer/pairings/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairing.data.pairing.code, name })
    });
    return exchange.headers.get("set-cookie")!.split(";", 1)[0]!;
  };
  return { ...booted, gm, json, upload, command, playerToken, pairScreen };
}

/** A joined socket; with `expect`, also waits for the first such event the join brings. `heard` collects the name
 *  of every event the socket is sent, from before it joins. */
async function joinSocket(base: string, token: string, options: Readonly<{ expect?: string; heard?: string[] }> = {}) {
  const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  if (options.heard) socket.onAny((event: string) => options.heard!.push(event));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  const arrived = options.expect ? new Promise((resolve) => socket.once(options.expect!, resolve)) : Promise.resolve();
  await new Promise((resolve) => socket.emit("session:join", { token }, resolve));
  // A GM's join brings the board straight away, so the device never waits for the next change to see it.
  await arrived;
  cleanups.push(() => void socket.close());
  return socket;
}

/** Reads `presentation` events off a table screen's event stream as they arrive. */
async function openStream(base: string, cookie: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/v1/viewer/events`, { headers: { cookie }, signal: controller.signal });
  cleanups.push(() => controller.abort());
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return async function next(): Promise<Record<string, any>> {
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end >= 0) {
        const event = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const data = event.split("\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6));
        continue;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error("The event stream closed.");
      buffered += decoder.decode(chunk.value, { stream: true });
    }
  };
}

describe("the sound library", () => {
  it("takes the GM's uploads, checked, named and once per file; nobody else's", async () => {
    const test = await boot();
    const created = await test.upload(mp3(60), "Tavern Song.mp3");
    expect(created.status).toBe(201);
    const { sound } = (await test.json(created)).data;
    expect(sound).toMatchObject({
      name: "Tavern Song",
      originalName: "Tavern Song.mp3",
      format: "mp3",
      durationMs: 1567
    });
    expect((await test.upload(mp3(60), "again.mp3")).status).toBe(200);

    const broken = await test.upload(mp3(60).subarray(0, 5_000), "half.mp3");
    expect(broken.status).toBe(400);
    expect((await test.json(broken)).error.message).toContain("incomplete");
    const image = await test.upload(png(4, 4), "song.mp3");
    expect((await test.json(image)).error.message).toContain("This file is an image");

    expect((await test.upload(mp3(10), "x.mp3", { authorization: `Bearer ${test.playerToken}` })).status).toBe(401);
    expect(
      (await fetch(`${test.base}/api/v1/sound-assets`, { headers: { authorization: `Bearer ${test.playerToken}` } }))
        .status
    ).toBe(401);

    const renamed = await fetch(`${test.base}/api/v1/sound-assets/${sound.id}`, {
      method: "PATCH",
      headers: { ...test.gm, "content-type": "application/json" },
      body: JSON.stringify({ name: "  The Prancing Pony " })
    });
    expect((await test.json(renamed)).data.sound.name).toBe("The Prancing Pony");
    const list = await test.json(await fetch(`${test.base}/api/v1/sound-assets`, { headers: test.gm }));
    expect(list.data.sounds.map((entry: { name: string }) => entry.name)).toEqual(["The Prancing Pony"]);
  });
});

describe("the sound board", () => {
  it("is the GM's: commands and the board read refuse a player, and leave the game revision alone", async () => {
    const test = await boot();
    const { sound } = (await test.json(await test.upload(mp3(60), "Tavern.mp3"))).data;
    const revision = test.server.store.revision;
    const arranged = await test.command("sound/arrange", {
      music: { tracks: [{ assetId: sound.id, volume: 0.7 }], shuffle: false }
    });
    expect(arranged.status).toBe(200);
    expect((await test.json(arranged)).data).toMatchObject({ revision, soundRevision: 1, duplicate: false });
    const played = await test.json(await test.command("sound/play", { target: "music" }));
    expect(played.data).toMatchObject({ revision, soundRevision: 2 });
    expect(test.server.store.revision).toBe(revision);

    const refused = await test.command("sound/play", { target: "music" }, test.playerToken);
    expect(refused.status).toBe(403);
    const read = await fetch(`${test.base}/api/v1/game/sound`, {
      headers: { authorization: `Bearer ${test.playerToken}` }
    });
    expect(read.status).toBe(403);
    const board = await test.json(await fetch(`${test.base}/api/v1/game/sound`, { headers: test.gm }));
    expect(board.data.view.board.music.current).toMatchObject({ assetId: sound.id, volume: 0.7 });

    const unknown = await test.command("sound/arrange", { effects: [{ assetId: randomUUID(), volume: 1 }] });
    expect(unknown.status).toBe(409);
    expect((await test.json(unknown)).error.message).toBe("That sound is no longer in the library.");
  });

  it("reaches the GM's devices only: a player's socket is never sent it", async () => {
    const test = await boot();
    const gm = await joinSocket(test.base, test.gmToken, { expect: "sound:changed" });
    const playerHeard: string[] = [];
    const player = await joinSocket(test.base, test.playerToken, { heard: playerHeard });
    const playerBoard = await new Promise<Record<string, unknown>>((resolve) =>
      (player as Socket).emit("sound:board", {}, resolve)
    );
    expect(playerBoard).toMatchObject({ ok: false });
    expect(playerBoard).not.toHaveProperty("view");

    const { sound } = (await test.json(await test.upload(wav(2), "Rain.wav"))).data;
    const heard = new Promise<SoundBoardView>((resolve) => gm.once("sound:changed" as never, resolve));
    await test.command("sound/arrange", { ambient: [{ assetId: sound.id, volume: 0.5 }] });
    expect((await heard).board.ambient).toEqual([expect.objectContaining({ assetId: sound.id, playing: null })]);
    await test.command("sound/play", { target: "ambient", assetId: sound.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The player's socket heard the game, never the sound board.
    expect(playerHeard).toContain("state:updated");
    expect(playerHeard.filter((event) => event.startsWith("sound"))).toEqual([]);
  });
});

describe("the table screen's sound", () => {
  it("receives only what is playing, follows each change at once, and may fetch only those files", async () => {
    const test = await boot();
    const tavern = (await test.json(await test.upload(mp3(200), "Tavern.mp3"))).data.sound;
    const crypt = (await test.json(await test.upload(mp3(150), "Crypt.mp3"))).data.sound;
    const rain = (await test.json(await test.upload(wav(3), "Rain.wav"))).data.sound;
    await test.command("sound/arrange", {
      masterVolume: 0.6,
      music: {
        tracks: [
          { assetId: tavern.id, volume: 0.8 },
          { assetId: crypt.id, volume: 0.5 }
        ],
        shuffle: false
      },
      ambient: [{ assetId: rain.id, volume: 0.4 }]
    });
    const cookie = await test.pairScreen();
    const next = await openStream(test.base, cookie);
    const first = await next();
    expect(first.sound).toMatchObject({ masterVolume: 0.6, music: null, ambient: [], effects: [] });

    await test.command("sound/play", { target: "music" });
    const playing = await next();
    expect(playing.sound.music).toMatchObject({ assetId: tavern.id, volume: 0.8 });
    expect(Object.keys(playing.sound.music).sort()).toEqual(["assetId", "playId", "positionMs", "volume"]);
    // The rest of the playlist, the ambient layer that is off, and every name stay with the GM.
    const sent = JSON.stringify(playing);
    for (const hidden of [crypt.id, rain.id, "Tavern", "Crypt", "Rain"]) expect(sent).not.toContain(hidden);

    const content = (id: string, headers: Record<string, string>) =>
      fetch(`${test.base}/api/v1/sound-assets/${id}/content`, { headers });
    const fetched = await content(tavern.id, { cookie });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("audio/mpeg");
    expect(fetched.headers.get("cache-control")).toBe("private, no-store");
    const ranged = await content(tavern.id, { cookie, range: "bytes=0-99" });
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);
    expect((await content(crypt.id, { cookie })).status).toBe(403);
    expect((await content(tavern.id, { authorization: `Bearer ${test.playerToken}` })).status).toBe(403);
    expect((await content(tavern.id, {})).status).toBe(403);
    expect((await content(crypt.id, test.gm)).status).toBe(200);

    // A late joiner: a second screen connecting now is told how far into the track the table is.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const late = await test.json(await fetch(`${test.base}/api/v1/viewer/presentation`, { headers: { cookie } }));
    expect(late.data.presentation.sound.music.positionMs).toBeGreaterThanOrEqual(250);

    await test.command("sound/stop", { target: "all" });
    expect((await next()).sound.music).toBeNull();
    expect((await content(tavern.id, { cookie })).status).toBe(403);
  });

  it("tells the GM whether each screen is playing or waiting for a tap", async () => {
    const test = await boot();
    const cookie = await test.pairScreen("Den TV");
    await openStream(test.base, cookie).then((next) => next());
    const report = (sound: string) =>
      fetch(`${test.base}/api/v1/viewer/sound-status`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ sound, unplayable: [] })
      });
    const screens = async () =>
      (await test.json(await fetch(`${test.base}/api/v1/game/sound`, { headers: test.gm }))).data.view.screens;
    expect(await screens()).toEqual([expect.objectContaining({ name: "Den TV", sound: "unknown" })]);
    expect((await report("blocked")).status).toBe(200);
    expect(await screens()).toEqual([expect.objectContaining({ name: "Den TV", sound: "blocked" })]);
    await report("on");
    const access = await test.json(await fetch(`${test.base}/api/v1/viewer/access`, { headers: test.gm }));
    expect(access.data.connections).toEqual([expect.objectContaining({ name: "Den TV", sound: "on" })]);
    // Only a paired screen speaks for itself.
    const forged = await fetch(`${test.base}/api/v1/viewer/sound-status`, {
      method: "POST",
      headers: { authorization: `Bearer ${test.playerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ sound: "on" })
    });
    expect(forged.status).toBe(401);
  });

  it("moves the playlist on by itself when a track ends", async () => {
    const test = await boot();
    const short = (await test.json(await test.upload(wav(0.4), "Sting.wav"))).data.sound;
    const other = (await test.json(await test.upload(wav(0.5), "Other.wav"))).data.sound;
    await test.command("sound/arrange", {
      music: {
        tracks: [
          { assetId: short.id, volume: 1 },
          { assetId: other.id, volume: 1 }
        ],
        shuffle: false
      }
    });
    await test.command("sound/play", { target: "music" });
    const started = test.server.sound.view().board.music.current!;
    expect(started.assetId).toBe(short.id);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const now = test.server.sound.view().board.music.current!;
    expect(now.assetId).toBe(other.id);
    // The next track starts where the last one ended, not when the timer happened to run.
    expect(now.startedAt).toBe(started.startedAt + 400);
  });

  it("starts a scene's sound when the scene goes live, unless the GM turned that off", async () => {
    const test = await boot();
    const map = await test.json(
      await fetch(`${test.base}/api/v1/map-assets?name=Cave&kind=battlemap`, {
        method: "POST",
        headers: { ...test.gm, "content-type": "image/png" },
        body: png(400, 300)
      })
    );
    const scene = async (name: string) => {
      const created = await test.json(
        await test.command("scenes", { name, mapAssetId: map.data.asset.id, combatantIds: [] })
      );
      return created.data.sceneId as string;
    };
    const cave = await scene("Cave");
    const camp = await scene("Camp");
    const drip = (await test.json(await test.upload(wav(2), "Drip.wav"))).data.sound;
    await test.command("sound/arrange", { ambient: [{ assetId: drip.id, volume: 0.5 }] });
    await test.command("sound/play", { target: "ambient", assetId: drip.id });
    expect((await test.command(`scenes/${cave}/sound`, { preset: "save-current" })).status).toBe(200);
    expect((await test.command(`scenes/${camp}/sound`, { preset: "save-current", autoplay: false })).status).toBe(200);
    await test.command("sound/stop", { target: "all" });

    await test.command(`scenes/${camp}/activate`, {});
    expect(test.server.sound.view().board.ambient[0]!.playing).toBeNull();
    await test.command(`scenes/${cave}/activate`, {});
    expect(test.server.sound.view().board.ambient[0]!.playing).not.toBeNull();
  });
});
