import { vi } from "vitest";
import { CODEX_PATHS } from "@vtt/api-contract";
import { GameStateSchema, SceneSchema, type GmView, type Scene } from "@vtt/domain";
import type { MapAsset } from "../src/maps/map-catalog";

/**
 * A small campaign for the Scenes tab's tests: three maps (one with its grid), a party of two, two goblins, and the
 * scenes a test asks for. `serveScenes` answers the HTTP reads the tab makes on mount.
 */

export const IDS = {
  crypt: "20000000-0000-5000-8000-0000000000c1",
  tunnels: "20000000-0000-5000-8000-0000000000c2",
  town: "20000000-0000-5000-8000-0000000000c3",
  ambush: "30000000-0000-4000-8000-0000000000c1",
  chase: "30000000-0000-4000-8000-0000000000c2",
  camp: "30000000-0000-4000-8000-0000000000c3",
  lyra: "10000000-0000-4000-8000-0000000000c1",
  borin: "10000000-0000-4000-8000-0000000000c2",
  goblin: "10000000-0000-4000-8000-0000000000c3",
  boss: "10000000-0000-4000-8000-0000000000c4",
  wall: "40000000-0000-4000-8000-0000000000c1",
  door: "40000000-0000-4000-8000-0000000000c2",
  session: "50000000-0000-4000-8000-0000000000c1"
} as const;

const DAY = "2026-10-17T09:00:00.000Z";

export function mapAsset(id: string, name: string, overrides: Partial<MapAsset> = {}): MapAsset {
  return {
    id,
    name,
    kind: "battlemap",
    folder: null,
    originalName: `${name.toLowerCase().replace(/\s+/g, "-")}.png`,
    format: "png",
    mediaType: "image/png",
    width: 700,
    height: 500,
    byteLength: 26_000,
    importedAt: DAY,
    updatedAt: DAY,
    calibration: null,
    scale: null,
    ...overrides
  };
}

export const CALIBRATED: MapAsset["calibration"] = {
  calibration: { origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
  verificationErrorPx: 0
};

export const MAPS: readonly MapAsset[] = [
  mapAsset(IDS.crypt, "Sunken crypt", { folder: "Dungeons", calibration: CALIBRATED }),
  mapAsset(IDS.tunnels, "Old tunnels", { folder: "Dungeons", updatedAt: "2026-10-16T09:00:00.000Z" }),
  mapAsset(IDS.town, "Saltmere", { kind: "regional", width: 800, height: 600, updatedAt: "2026-10-15T09:00:00.000Z" })
];

const actor = (id: string, name: string, kind: "player-character" | "monster") => ({
  id,
  name,
  kind,
  visibility: "public",
  hp: { current: 10, maximum: 10, temporary: 0 },
  conditions: [],
  effects: [],
  presence: null,
  archived: false
});

export const ACTORS = [
  actor(IDS.lyra, "Lyra Emberwise", "player-character"),
  actor(IDS.borin, "Borin Stoneguard", "player-character"),
  actor(IDS.goblin, "Goblin Warrior", "monster"),
  actor(IDS.boss, "Goblin Boss", "monster")
];

const token = (actorId: string, position: { x: number; y: number } | null) => ({
  actorId,
  position,
  sizePx: 41,
  gridSizePx: 50
});

/** A scene with whoever it names in its tray, the placed ones at a spot. */
export function scene(
  id: string,
  name: string,
  mapAssetId: string,
  cast: ReadonlyArray<readonly [actorId: string, position: { x: number; y: number } | null]> = [],
  extra: Readonly<{ combat?: Record<string, unknown>; stamps?: Partial<Scene> }> = {}
): Scene {
  return SceneSchema.parse({
    id,
    name,
    mapAssetId,
    combat: {
      initiative: cast.map(([actorId], index) => ({ actorId, score: 20 - index })),
      tokens: cast.map(([actorId, position]) => token(actorId, position)),
      ...extra.combat
    },
    createdAt: Date.parse(DAY),
    updatedAt: Date.parse(DAY),
    ...extra.stamps
  });
}

/** The ambush: the party and a goblin on the map, the boss in the tray, vision on with a wall and a door. */
export const AMBUSH = scene(
  IDS.ambush,
  "Crypt ambush",
  IDS.crypt,
  [
    [IDS.lyra, { x: 75, y: 75 }],
    [IDS.borin, { x: 125, y: 75 }],
    [IDS.goblin, { x: 425, y: 125 }],
    [IDS.boss, null]
  ],
  {
    combat: {
      vision: {
        enabled: true,
        ambient: "dim",
        walls: [
          { id: IDS.wall, kind: "wall", a: { x: 300, y: 0 }, b: { x: 300, y: 100 } },
          { id: IDS.door, kind: "door", a: { x: 300, y: 100 }, b: { x: 300, y: 150 } }
        ]
      }
    }
  }
);
/** The chase: on the map with no grid, the party still in the tray. */
export const CHASE = scene(IDS.chase, "Tunnel chase", IDS.tunnels, [
  [IDS.lyra, null],
  [IDS.borin, null]
]);
/** The camp: nobody in it yet, and changed last. */
export const CAMP = scene(IDS.camp, "Camp at the ford", IDS.crypt, [], {
  stamps: { updatedAt: Date.parse("2026-10-17T12:00:00.000Z") }
});

/** The GM's view of these scenes. A live scene's combat moves to the table, as the server keeps it. */
export function gmView(
  scenes: readonly Scene[] = [AMBUSH, CHASE, CAMP],
  activeEncounterId: string | null = null
): GmView {
  const live = scenes.find((candidate) => candidate.id === activeEncounterId);
  const stored = scenes.map((candidate) =>
    candidate.id === activeEncounterId ? SceneSchema.parse({ ...candidate, combat: {} }) : candidate
  );
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    revision: 7,
    combat: { ...live?.combat, mapAssetId: live?.mapAssetId ?? null, encounters: stored, activeEncounterId }
  });
  return { ...state, actors: ACTORS } as unknown as GmView;
}

/** The Codex's links: session 6 stages the ambush. */
export const LINKS = [
  {
    encounterId: IDS.ambush,
    sessions: [{ id: IDS.session, sessionNumber: 6, status: "planned", via: "session" }],
    pins: []
  }
];

/**
 * Answers the tab's HTTP reads with this campaign: the map library, the Codex's scene links, sessions and atlas maps.
 * An upload adds `uploaded` to the library and a PATCH changes a map. Every other path fails, so a test sees a read it
 * did not expect. `calls` records each request with its body.
 */
export function serveScenes(
  options: Readonly<{ maps?: readonly MapAsset[]; uploaded?: MapAsset; links?: readonly unknown[] }> = {}
) {
  let maps = [...(options.maps ?? MAPS)];
  const calls: Array<Readonly<{ method: string; path: string; search: string; body: unknown }>> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://ozyvtt.test");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, path: url.pathname, search: url.search, body });
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(status < 300 ? { ok: true, apiVersion: "1", data } : data), { status });
    if (url.pathname === "/api/v1/map-assets" && method === "POST" && options.uploaded) {
      maps = [options.uploaded, ...maps];
      return reply({ asset: options.uploaded, duplicate: false });
    }
    if (url.pathname === "/api/v1/map-assets") return reply({ assets: maps });
    const patched = /^\/api\/v1\/map-assets\/([^/]+)$/.exec(url.pathname);
    if (patched && method === "PATCH") {
      maps = maps.map((map) => (map.id === patched[1] ? { ...map, ...(body as Partial<MapAsset>) } : map));
      return reply({ asset: maps.find((map) => map.id === patched[1]) });
    }
    if (url.pathname === CODEX_PATHS.maps) return reply({ maps: [{ name: "The Saltmere coast", assetId: IDS.town }] });
    if (url.pathname === CODEX_PATHS.sceneLinks) return reply({ links: options.links ?? LINKS });
    if (url.pathname === CODEX_PATHS.sessions) return reply({ sessions: [] });
    return reply({ ok: false, apiVersion: "1", error: { code: "not_found", message: "Not here." } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
