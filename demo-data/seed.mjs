// Fills a fresh OzyVTT server with the "Ashen Reach" demo campaign, entirely through the public HTTP API so
// every record passes the same validation the app applies. Run it against an EMPTY data folder:
//
//   node demo-data/seed.mjs --url http://localhost:3001 --password "your GM password"
//
// If the server has no GM password yet, the script sets the one given (it must run on the host machine).
// Fights are played turn by turn with the server's own dice, so every run produces different combat logs.
import { randomUUID } from "node:crypto";
import { BANNERS, CALENDAR, CONNECTIONS, FOLDERS, PAGES, PLAYERS, QUESTS, SESSIONS, date } from "./campaign.mjs";
import { CELL_PX, atlasMap, gridMap, tokenDisc } from "./images.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const BASE = (args.get("--url") ?? "http://localhost:3001").replace(/\/$/, "");
const PASSWORD = args.get("--password");
if (!PASSWORD) {
  console.error('Usage: node demo-data/seed.mjs --url http://localhost:3001 --password "GM password"');
  process.exit(1);
}

let token = "";

class ApiError extends Error {
  constructor(message, status, error) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

async function request(method, path, body, contentType) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = contentType ?? "application/json";
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined || contentType ? body : JSON.stringify(body)
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false)
    throw new ApiError(
      `${method} ${path} failed (${response.status}): ${JSON.stringify(json?.error ?? json)}`,
      response.status,
      json?.error
    );
  return json?.data;
}
const get = (path) => request("GET", path);
const post = (path, body = {}) => request("POST", path, body);
const put = (path, body) => request("PUT", path, body);
const patch = (path, body) => request("PATCH", path, body);
const upload = (path, bytes) => request("POST", path, bytes, "image/png");

const step = (label) => console.log(`- ${label}`);
const game = async () => (await get("/api/v1/game")).game;
const center = ([column, row]) => ({ x: column * CELL_PX + CELL_PX / 2, y: row * CELL_PX + CELL_PX / 2 });

// ---------------------------------------------------------------------------------------------------------
// Sign in

async function signIn() {
  const setup = await get("/api/v1/host/setup");
  if (!setup.bootstrapped) await post("/api/v1/host/setup", { password: PASSWORD });
  token = (await post("/api/v1/host/gm/sign-in", { password: PASSWORD })).token;
  const state = await game();
  if (state.revision > 0)
    throw new Error("This server already has a campaign in it. Point the seed at an empty data folder.");
  step("signed in as GM");
}

// ---------------------------------------------------------------------------------------------------------
// Battlemaps, atlas maps and tokens

const BATTLEMAPS = [
  { key: "road", name: "Forest Road Ambush", columns: 24, rows: 16, floor: "#CFD8C4", line: "#4F5B47" },
  { key: "crypt", name: "Crypt of the Ashen Saint", columns: 20, rows: 20, floor: "#BDB8B0", line: "#45413B" },
  { key: "warehouse", name: "Port Varrow Warehouse", columns: 22, rows: 14, floor: "#D8C9A8", line: "#5C4A30" },
  { key: "tower", name: "Ruined Watchtower", columns: 16, rows: 16, floor: "#C7C3D6", line: "#4A465C" }
];
const ATLAS = [
  { key: "world", name: "The Ashen Reach", kind: "world", width: 2000, height: 1400, miles: 6 },
  { key: "vale", name: "Gloamshire Vale", kind: "regional", width: 1600, height: 1100, miles: 0.5 },
  { key: "port", name: "Port Varrow", kind: "regional", width: 1400, height: 1000, miles: 0.05 }
];
const ATLAS_COLORS = {
  world: { field: "#C9D6C1", line: "#7A8C72" },
  vale: { field: "#D6D9B8", line: "#8A8C62" },
  port: { field: "#C4D3DA", line: "#6C8490" }
};

async function uploadMaps() {
  const maps = {};
  for (const map of BATTLEMAPS) {
    const bytes = gridMap({ columns: map.columns, rows: map.rows, floor: map.floor, line: map.line, title: map.name });
    const query = `filename=${map.key}.png&name=${encodeURIComponent(map.name)}&kind=battlemap`;
    const { asset } = await upload(`/api/v1/map-assets?${query}`, bytes);
    // The same 3-by-3 drag a GM makes in the calibration wizard, five feet to a square.
    const wizard = await post(`/api/v1/map-assets/${asset.id}/calibration/wizards`, {
      start: { x: 0, y: 0 },
      end: { x: CELL_PX * 3, y: CELL_PX * 3 },
      cellsAcross: 3,
      cellsDown: 3,
      distancePerCell: 5
    });
    await post(`/api/v1/map-assets/${asset.id}/calibration/wizards/${wizard.wizardId}/complete`, {});
    maps[map.key] = { ...map, id: asset.id };
  }
  for (const map of ATLAS) {
    const bytes = atlasMap({ width: map.width, height: map.height, ...ATLAS_COLORS[map.key], title: map.name });
    const query = `filename=${map.key}.png&name=${encodeURIComponent(map.name)}&kind=${map.kind}`;
    const { asset } = await upload(`/api/v1/map-assets?${query}`, bytes);
    await put(`/api/v1/map-assets/${asset.id}/scale`, {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      knownDistance: map.miles * 100,
      unit: "miles"
    });
    maps[map.key] = { ...map, id: asset.id };
  }
  step(`${BATTLEMAPS.length} battlemaps (calibrated) and ${ATLAS.length} atlas maps uploaded`);
  return maps;
}

const TEAM_COLORS = { party: "#2F6FB2", ally: "#3C8D5A", foe: "#B23A48", neutral: "#B98A2E" };
const TOKEN_FOLDERS = { party: "Party", ally: "Allies", foe: "Monsters", neutral: "NPCs" };

async function setToken(actor, team) {
  const initials = actor.name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
  const label = /\d+$/.test(actor.name) ? actor.name[0] + actor.name.match(/\d+$/)[0].slice(-1) : initials;
  const bytes = tokenDisc({ color: TEAM_COLORS[team], label });
  const query = `filename=${encodeURIComponent(actor.name)}.png&name=${encodeURIComponent(actor.name)}&folder=${encodeURIComponent(TOKEN_FOLDERS[team])}`;
  const uploaded = await upload(`/api/v1/token-assets?${query}`, bytes);
  const assetId = uploaded.token?.id ?? uploaded.asset?.id ?? uploaded.id;
  await post(`/api/v1/game/actors/${actor.id}/token-image`, { tokenAssetId: assetId });
}

// ---------------------------------------------------------------------------------------------------------
// Homebrew: one or more of every type, copied from SRD records and reworked

const HOMEBREW = [
  {
    from: "fireball",
    name: "Cinderburst",
    edit: (body) => ({
      ...body,
      level: 2,
      damage: { ...body.damage, roll: "4d6" },
      effect: { ...body.effect, damage: [{ formula: "4d6", type: "fire" }] },
      description:
        "A cinder streaks from your hand and bursts into a cloud of burning ash. Each creature in a 15-foot-radius Sphere makes a Dexterity saving throw, taking 4d6 Fire damage on a failed save or half as much on a success. Undead have Disadvantage on the save."
    }),
    visible: true
  },
  {
    from: "sacred-flame",
    name: "Saint's Ember",
    edit: (body) => ({
      ...body,
      description:
        "A mote of the Ashen Saint's fire settles on a creature you can see within range. It makes a Dexterity saving throw or takes 1d8 Radiant damage. An Undead target that fails can't regain Hit Points until the start of your next turn."
    }),
    visible: true
  },
  {
    from: "flame-tongue",
    name: "Ember-Etched Blade",
    edit: (body) => ({
      ...body,
      description:
        "Runes along the fuller of this longsword glow like banked coals. While attuned, you deal an extra 1d4 Fire damage on a hit, and the blade sheds Dim Light in a 10-foot radius."
    }),
    visible: true
  },
  {
    from: "trident",
    name: "Saltmarsh Harpoon",
    edit: (body) => ({
      ...body,
      description: "A barbed harpoon used by Port Varrow's eel fishers, tied to 30 feet of tarred rope."
    }),
    visible: true
  },
  {
    from: "alert",
    name: "Lantern-Bearer",
    edit: (body) => ({
      ...body,
      description:
        "You have stood watch over shrines in the dark. You can't be surprised while you carry a lit lantern or torch, and you add your Proficiency Bonus to Initiative rolls."
    }),
    visible: true
  },
  {
    from: "sage",
    name: "Cartographer of the Reach",
    edit: (body) => ({
      ...body,
      description:
        "You mapped the bogs and backroads of the Ashen Reach for a lord who never paid you. You know where the old roads go and which ones the fog swallows."
    }),
    visible: true
  },
  {
    from: "goliath",
    name: "Ashborn",
    edit: (body) => ({
      ...body,
      description:
        "Ashborn are people born on the night a shrine flame is relit. Their skin is ember-grey and warm to the touch, and old ash clings to their hair however often they wash it."
    }),
    visible: true
  },
  {
    from: "fighter",
    name: "Ashwarden",
    edit: (body) => ({
      ...body,
      summary: "A holy sentinel of the Ember Wardens who fights to keep the dead in their graves.",
      description:
        "Ashwardens are the shield-bearers of the Ember Wardens. They train with blade and lantern and learn the rites that quiet restless graves."
    }),
    visible: false
  },
  {
    from: "champion",
    name: "Lanternbearer",
    classOf: "Ashwarden",
    edit: (body) => ({
      ...body,
      description:
        "Lanternbearers carry the Saint's flame at the front of the line. Their lanterns burn brighter the closer the dead come."
    }),
    visible: false
  },
  {
    from: "oath-of-devotion",
    name: "Oath of the Cold Ash",
    edit: (body) => ({
      ...body,
      description:
        "Paladins of the Cold Ash swear to carry the Saint's flame into places where it has gone out. Their oath binds them to finish the work of the dead."
    }),
    visible: true
  },
  {
    from: "wight",
    name: "Ash Wight",
    edit: (body) => ({
      ...body,
      summary: "Medium undead, neutral evil - CR 3",
      description: "A crypt guardian whose bones are packed with cold saint's-ash. It hums the Pale Choir's hymn."
    }),
    visible: true
  },
  {
    from: "hell-hound",
    name: "Cinder Hound",
    edit: (body) => ({
      ...body,
      summary: "Medium fiend, lawful evil - CR 3",
      description: "A gaunt hound of smoke and embers bred by the Pale Choir to guard the watchtower."
    }),
    visible: false
  },
  {
    from: "cultist",
    name: "Pale Choir Initiate",
    edit: (body) => ({
      ...body,
      description: "A grey-robed initiate of the Pale Choir. Hums constantly; never blinks."
    }),
    visible: false,
    draft: true
  }
];

async function seedHomebrew() {
  const created = {};
  for (const entry of HOMEBREW) {
    const copy = (await post(`/api/v1/homebrew/content/${entry.from}/duplicate`, { name: entry.name })).record;
    const body = entry.edit({ ...copy.record, name: entry.name });
    if (entry.classOf) body.classId = created[entry.classOf].id;
    const updated = (
      await patch(`/api/v1/homebrew/content/${copy.id}`, {
        record: { ...body, type: copy.type },
        expectedRev: copy.rev
      })
    ).record;
    created[entry.name] = { id: copy.id, type: copy.type, rev: updated.rev };
  }
  // Published only once everything exists: a homebrew class needs its subclass to be there first.
  for (const entry of HOMEBREW.filter((candidate) => !candidate.draft)) {
    const target = created[entry.name];
    let record = (await post(`/api/v1/homebrew/content/${target.id}/publish`, { expectedRev: target.rev })).record;
    if (entry.visible)
      record = (
        await post(`/api/v1/homebrew/content/${target.id}/visibility`, {
          visibleToPlayers: true,
          expectedRev: record.rev
        })
      ).record;
    target.rev = record.rev;
  }
  // A published spell with an unpublished edit waiting, the state a GM sees mid-revision.
  const ember = created["Saint's Ember"];
  const current = (await get(`/api/v1/homebrew/content/${ember.id}`)).record;
  await patch(`/api/v1/homebrew/content/${ember.id}`, {
    record: {
      ...current.record,
      type: current.type,
      description: `${current.record.description} (Draft change: also sheds bright light for a round.)`
    },
    expectedRev: current.rev
  });
  const counts = {};
  for (const value of Object.values(created)) counts[value.type] = (counts[value.type] ?? 0) + 1;
  step(
    `homebrew: ${Object.entries(counts)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ")}`
  );
  return created;
}

// ---------------------------------------------------------------------------------------------------------
// Characters and NPCs

async function importNpc({ from, name, summary, disposition, visibility, team }) {
  const { definition } = await get(`/api/v1/content/monsters/${from}`);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const result = await post("/api/v1/game/definitions/import", {
    definition: {
      ...definition,
      name,
      summary,
      source: { name: "Ashen Reach demo", version: "1.0.0", externalId: `demo-${slug}` },
      token: { ...definition.token, disposition }
    },
    visibility
  });
  const actor = (await game()).actors.find((candidate) => candidate.id === result.actorId);
  await setToken(actor, team);
  return actor;
}

async function seedCharacters() {
  const roster = {};
  // A new server starts with an example party; this campaign rolls its own instead.
  for (const actor of (await game()).actors) await request("DELETE", `/api/v1/game/actors/${actor.id}`, {});
  for (const [name, classId] of [
    ["Rook Ashgrave", "fighter"],
    ["Maelis Thorn", "cleric"],
    ["Ivo Quillfeather", "wizard"],
    ["Tamsin Vey", "rogue"],
    ["Corwin Hale", "ranger"]
  ])
    await post("/api/v1/game/characters/random", { level: 7, classId, name });
  // A retired character, archived so the roster shows that state.
  const retired = await post("/api/v1/game/characters/random", { level: 5, classId: "bard", name: "Osric Fenn" });
  const state = await game();
  for (const actor of state.actors.filter((candidate) => candidate.kind === "player-character")) {
    await setToken(actor, "party");
    roster[actor.name] = actor;
  }
  await post(`/api/v1/game/actors/${retired.actorId}/archived`, { archived: true });

  const npcs = [
    {
      from: "knight",
      name: "Captain Hessa Marrow",
      summary: "Captain of the Varrow Watch",
      disposition: "friendly",
      visibility: "public",
      team: "ally"
    },
    {
      from: "spy",
      name: "Mags Thimble",
      summary: "Fence and information broker",
      disposition: "neutral",
      visibility: "public",
      team: "neutral"
    },
    {
      from: "goblin-boss",
      name: "Grub",
      summary: "Chief of the Mudfoot goblins",
      disposition: "hostile",
      visibility: "gm-only",
      team: "foe"
    },
    {
      from: "priest",
      name: "Brother Aldous Vane",
      summary: "Keeper of the crypt, secretly with the Pale Choir",
      disposition: "neutral",
      visibility: "gm-only",
      team: "neutral"
    },
    {
      from: "mage",
      name: "Vessa the Pale",
      summary: "Choirmistress of the Pale Choir",
      disposition: "hostile",
      visibility: "gm-only",
      team: "foe"
    },
    {
      from: "druid",
      name: "Old Wren",
      summary: "Hedge witch of the Gloomwood",
      disposition: "friendly",
      visibility: "gm-only",
      team: "ally"
    }
  ];
  for (const npc of npcs) roster[npc.name] = await importNpc(npc);
  step(`characters: ${Object.keys(roster).length} on the roster (Osric Fenn archived)`);
  return roster;
}

/** Instances of a monster for one fight, each with a token image. */
async function spawn(definitionId, count, team = "foe") {
  const actors = [];
  for (let index = 0; index < count; index += 1) {
    const { actorId } = await post("/api/v1/game/actors", { definitionId, visibility: "gm-only" });
    const actor = (await game()).actors.find((candidate) => candidate.id === actorId);
    await setToken(actor, team);
    actors.push(actor);
  }
  return actors;
}

// ---------------------------------------------------------------------------------------------------------
// Fights

const isFoeOf = (actor, other, foeIds) => foeIds.has(actor.id) !== foeIds.has(other.id);
const cellOf = (position) => [Math.floor(position.x / CELL_PX), Math.floor(position.y / CELL_PX)];
const distanceCells = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

async function moveNextTo(state, mover, target) {
  const tokens = new Map(state.combat.tokens.map((entry) => [entry.actorId, entry]));
  const from = cellOf(tokens.get(mover.id).position);
  const goal = cellOf(tokens.get(target.id).position);
  const occupied = new Set([...tokens.values()].map((entry) => cellOf(entry.position).join(",")));
  const options = [];
  for (let dx = -1; dx <= 1; dx += 1)
    for (let dy = -1; dy <= 1; dy += 1) {
      const cell = [goal[0] + dx, goal[1] + dy];
      if ((dx || dy) && !occupied.has(cell.join(",")) && cell[0] >= 0 && cell[1] >= 0) options.push(cell);
    }
  options.sort((a, b) => distanceCells(a, from) - distanceCells(b, from));
  if (!options[0]) return false;
  try {
    await post(`/api/v1/game/tokens/${mover.id}/move`, { position: center(options[0]) });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await post(`/api/v1/game/tokens/${mover.id}/move`, {
      position: center(options[0]),
      override: { reason: "Charged across the room", families: ["movement"] }
    });
  }
  return true;
}

/** Applies a resolved hit the way the app's Apply button does. */
async function applyHit(attacker, resolution, targetId) {
  const parts = [
    ...(resolution.damage ?? []).map((part) => ({ amount: part.total, type: part.type })),
    ...(resolution.bonusDamage ?? []).map((part) => ({ amount: part.amount, type: part.type }))
  ].filter((part) => part.amount > 0);
  const amount = parts.reduce((sum, part) => sum + part.amount, 0);
  if (amount <= 0) return;
  await post(`/api/v1/game/actors/${targetId}/damage`, {
    amount,
    parts,
    sourceActorId: attacker.id,
    sourceName: `${attacker.name}'s ${resolution.actionName}`,
    critical: Boolean(resolution.crit)
  });
}

/** Answers every open saving throw with a server roll and clears offered reactions, so the next turn can start. */
async function settlePrompts() {
  let state = await game();
  for (const save of state.combat.pendingSaves ?? [])
    await post(`/api/v1/game/saves/${save.id}/answer`, { method: "roll" }).catch(() =>
      post(`/api/v1/game/saves/${save.id}/dismiss`, {})
    );
  state = await game();
  for (const reaction of state.combat.pendingReactions ?? [])
    await post(`/api/v1/game/reactions/${reaction.id}/dismiss`, {}).catch(() => {});
  for (const proposal of state.combat.pendingDamage ?? [])
    await post("/api/v1/game/damage/resolve", { proposalId: proposal.id, apply: true }).catch(() => {});
}

async function useAction(actor, actionId, targetIds, extra = {}) {
  try {
    const result = await post("/api/v1/game/actions/use", { actorId: actor.id, actionId, targetIds, ...extra });
    return result.resolution ?? null;
  } catch (error) {
    if (error instanceof ApiError) {
      console.log(`    (${actor.name} could not use ${actionId}: ${error.error?.message ?? error.message})`);
      return null;
    }
    throw error;
  }
}

/**
 * Plays one fight on a prepared scene: the party against `foes`, turn by turn with server dice, until the foes
 * are down or `maxRounds` pass. `tactics(actor, context)` may return a planned action for a turn; anything it
 * leaves alone attacks the nearest enemy.
 */
async function runFight({
  maps,
  scene,
  mapKey,
  party,
  foes,
  partyCells,
  foeCells,
  maxRounds,
  tactics,
  isOver,
  onStart
}) {
  const combatants = [...party, ...foes];
  const sceneId = randomUUID();
  await post("/api/v1/game/scenes", {
    commandId: sceneId,
    name: scene,
    mapAssetId: maps[mapKey].id,
    combatantIds: combatants.map((actor) => actor.id)
  });
  for (const [index, actor] of party.entries())
    await post(`/api/v1/game/tokens/${actor.id}/move`, { position: center(partyCells[index]), sceneId });
  for (const [index, actor] of foes.entries())
    await post(`/api/v1/game/tokens/${actor.id}/move`, { position: center(foeCells[index]), sceneId });
  await post(`/api/v1/game/scenes/${sceneId}/activate`, {});
  await post("/api/v1/game/encounter/start", {
    mapAssetId: maps[mapKey].id,
    entries: combatants.map((actor) => ({ actorId: actor.id }))
  });
  if (onStart) await onStart();

  const foeIds = new Set(foes.map((actor) => actor.id));
  // Foes in `memory.spared` have surrendered: nobody targets them and they take no turns.
  const memory = { spared: new Set() };
  for (let turn = 0; turn < 200; turn += 1) {
    let state = await game();
    if (state.combat.round > maxRounds) break;
    const living = (ids) => state.actors.filter((actor) => ids.has(actor.id) && actor.hp.current > 0);
    if (living(foeIds).length === 0) break;
    const actor = state.actors.find((candidate) => candidate.id === state.combat.turnActorId);
    const context = { state, round: state.combat.round, foeIds, memory, party, foes };
    if (isOver?.(context)) break;

    if (actor.hp.current <= 0) {
      if (actor.kind === "player-character" && actor.deathSaves)
        await post(`/api/v1/game/actors/${actor.id}/death-save`, {}).catch(() => {});
      await post("/api/v1/game/turn/end", {});
      continue;
    }

    const planned = memory.spared.has(actor.id) ? "skip" : tactics ? await tactics(actor, context) : undefined;
    if (planned !== "skip") {
      const enemies = state.actors.filter(
        (other) =>
          combatants.some((entry) => entry.id === other.id) &&
          isFoeOf(actor, other, foeIds) &&
          other.hp.current > 0 &&
          !memory.spared.has(other.id)
      );
      const tokens = new Map(state.combat.tokens.map((entry) => [entry.actorId, entry]));
      const here = cellOf(tokens.get(actor.id).position);
      enemies.sort(
        (a, b) =>
          distanceCells(cellOf(tokens.get(a.id).position), here) -
          distanceCells(cellOf(tokens.get(b.id).position), here)
      );
      const target = planned?.targets?.[0] ?? enemies[0];
      if (target) {
        const { actions } = await get(`/api/v1/game/actors/${actor.id}/available-actions`);
        // A planned spell lists id fragments in order of preference; a character with none of them, or whose
        // cast is refused, makes an ordinary attack instead.
        const spell = [planned?.actionId ?? []]
          .flat()
          .map((fragment) => actions.find((candidate) => candidate.available && candidate.id.includes(fragment)))
          .find(Boolean);
        let resolution = spell
          ? await useAction(
              actor,
              spell.id,
              (planned.targets ?? [target]).map((entry) => entry.id),
              planned.extra ?? {}
            )
          : null;
        if (!resolution) {
          const attacks = actions.filter(
            (candidate) => candidate.attackBonus != null && candidate.activation === "action" && candidate.available
          );
          const feet = distanceCells(cellOf(tokens.get(target.id).position), here) * 5;
          const reach = feet <= 5;
          const inRange = attacks
            .filter((candidate) => (candidate.rangeNormalFeet ?? candidate.rangeFeet ?? 0) >= feet && !reach)
            .sort((a, b) => (b.rangeFeet ?? 0) - (a.rangeFeet ?? 0));
          const attack =
            (reach ? attacks.find((candidate) => candidate.reachFeet) : inRange[0]) ??
            attacks.find((candidate) => candidate.reachFeet) ??
            attacks[0];
          if (attack && !inRange.includes(attack) && !reach) {
            await moveNextTo(state, actor, target);
            state = await game();
          }
          if (attack) resolution = await useAction(actor, attack.id, [target.id]);
        }
        if (resolution?.attack && ["hit", "crit"].includes(resolution.attack.outcome))
          await applyHit(actor, resolution, resolution.attack.targetId);
        await settlePrompts();
        if (planned?.after) await planned.after(resolution);
      }
    }
    await post("/api/v1/game/turn/end", {});
  }
  const final = await game();
  const fallen = foes.filter((foe) => final.actors.find((actor) => actor.id === foe.id)?.hp.current <= 0).length;
  await post("/api/v1/game/encounter/end", {});
  step(`fight "${scene}": ${final.combat.round} rounds, ${fallen} of ${foes.length} foes down`);
  return sceneId;
}

async function restParty(party) {
  for (const actor of party) {
    const current = (await game()).actors.find((candidate) => candidate.id === actor.id);
    for (const condition of current.conditions ?? [])
      await post(`/api/v1/game/actors/${actor.id}/conditions`, {
        conditionId: condition.id ?? condition,
        active: false
      }).catch(() => {});
    await post(`/api/v1/game/actors/${actor.id}/rest`, { kind: "long" });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Codex

async function setDate(day) {
  await put("/api/v1/codex/calendar", { ...CALENDAR, currentDate: date(day) });
}

async function seedCodexBasics() {
  await put("/api/v1/codex/settings", {
    revisionHistory: { enabled: true, windowMinutes: 0 },
    autosave: { enabled: true, intervalSeconds: 5 }
  });
  await put("/api/v1/codex/calendar", { ...CALENDAR, currentDate: date(2) });
  await post("/api/v1/codex/calendar/publish");
  for (const path of FOLDERS) await post("/api/v1/codex/folders", { path });

  const banners = {};
  const bannerColors = ["#3A4B3F", "#2F4A5C", "#4B3A3A", "#3F3A4B", "#4B463A"];
  for (const [index, key] of BANNERS.entries()) {
    const bytes = atlasMap({ width: 1200, height: 300, field: bannerColors[index], line: "#6A7080", title: "" });
    const asset = await upload(`/api/v1/codex-assets?filename=banner-${key}.png`, bytes);
    banners[key] = asset.asset?.id ?? asset.id;
  }
  const pages = {};
  for (const page of PAGES) {
    const { key, revealed, ...body } = page;
    const created = await post("/api/v1/codex/pages", {
      ...body,
      revealedToPlayers: Boolean(revealed),
      ...(banners[key] ? { bannerAssetId: banners[key] } : {})
    });
    pages[key] = created.page ?? created;
  }
  for (const [from, to, label, layer] of CONNECTIONS)
    await post(`/api/v1/codex/pages/${pages[from].id}/connections`, { toPageId: pages[to].id, label, layer });
  step(`codex: ${PAGES.length} pages in ${FOLDERS.length} folders, ${CONNECTIONS.length} connections`);
  return pages;
}

async function seedQuests(pages) {
  const quests = {};
  for (const quest of QUESTS) {
    const created = await post("/api/v1/codex/quests", {
      title: quest.title,
      status: "not-started",
      playerBody: quest.playerBody,
      gmBody: quest.gmBody,
      objectives: quest.objectives.map((objective) => ({ ...objective, done: false })),
      entityIds: quest.pages.map((key) => pages[key].id),
      tags: quest.tags,
      revealedToPlayers: quest.revealed
    });
    quests[quest.key] = { ...quest, record: created.quest ?? created };
  }
  return quests;
}

async function updateQuest(quest, changes) {
  const current = (await get(`/api/v1/codex/quests/${quest.record.id}`)).quest;
  quest.record = (
    await patch(`/api/v1/codex/quests/${quest.record.id}`, { ...changes, expectedRev: current.rev })
  ).quest;
}

async function journal(path, { reveal, ...body }) {
  const created = await post(`/api/v1/codex/journal${path}`, body);
  const entry = created.entry ?? created;
  if (reveal) await post(`/api/v1/codex/journal/${entry.id}/reveal`, { revealed: true });
  return entry;
}

async function setStanding(pages, key, value, reason, reveal) {
  await put(`/api/v1/codex/standing/${pages[key].id}`, { value, reason });
  if (reveal) await post(`/api/v1/codex/standing/${pages[key].id}/reveal`, { revealed: true });
}

async function createSession(session, sceneIds) {
  const created = await post("/api/v1/codex/sessions", {
    sessionNumber: session.number,
    realDate: session.realDate,
    attendees: session.status === "played" ? PLAYERS : [],
    prepBody: session.prepBody,
    recapBody: session.recapBody,
    status: session.status,
    tags: session.tags,
    sceneIds,
    revealedToPlayers: session.status === "played"
  });
  const record = created.session ?? created;
  await post(`/api/v1/codex/sessions/${record.id}/activate`);
  return record;
}

// ---------------------------------------------------------------------------------------------------------
// The campaign, in the order it happened

const PARTY_NAMES = ["Rook Ashgrave", "Maelis Thorn", "Ivo Quillfeather", "Tamsin Vey", "Corwin Hale"];
const PARTY_CELLS = (column, row) => [
  [column, row],
  [column - 1, row + 1],
  [column - 2, row - 1],
  [column - 1, row - 2],
  [column - 2, row + 2]
];

function partyDown(context) {
  return context.party.find((member) => context.state.actors.find((actor) => actor.id === member.id).hp.current <= 0);
}

/** Maelis heals anyone who is down and opens with a cantrip; Ivo may open with an area spell on a knot of foes. */
function partyTactics(fireballTargets) {
  return async (actor, context) => {
    if (actor.name === "Maelis Thorn") {
      const down = partyDown(context);
      if (down) {
        // Cure Wounds has no automated effect, so the GM applies the healing by hand, as at the table.
        await post(`/api/v1/game/actors/${down.id}/heal`, { amount: 11 });
        return "skip";
      }
      // Characters are rolled at random, so these are preferences; Divine Spark comes with the class.
      if (context.round === 1)
        return { actionId: ["saint-s-ember", "sacred-flame", "toll-the-dead", "guiding-bolt", "divine-spark"] };
    }
    if (actor.name === "Ivo Quillfeather" && context.round === 1 && !context.memory.opened) {
      context.memory.opened = true;
      const targets = fireballTargets?.(context) ?? [];
      if (targets.length)
        return { actionId: ["fireball", "cinderburst", "shatter", "thunderwave", "burning-hands"], targets };
      return { actionId: ["fire-bolt", "ray-of-frost", "chill-touch", "poison-spray", "blight"] };
    }
    return undefined;
  };
}

const livingFoes = (context) =>
  context.foes.filter((foe) => context.state.actors.find((actor) => actor.id === foe.id).hp.current > 0);

async function main() {
  await signIn();
  const maps = await uploadMaps();
  const homebrew = await seedHomebrew();
  const roster = await seedCharacters();
  const party = PARTY_NAMES.map((name) => roster[name]);
  const pages = await seedCodexBasics();
  const quests = await seedQuests(pages);
  const scenes = {};
  const sessions = {};

  // A letter from before the campaign opened.
  await journal("", {
    playerText:
      "A rider brings a sealed letter from Lord Corvin Ashdown: every shrine flame in the vale went out at midnight. He offers 200 gp to anyone who can find out why.",
    gmText: "Ashdown already suspects theft. He leaves that out.",
    inWorldDate: date(1),
    attachPageId: pages.corvin.id,
    tags: ["hook"],
    reveal: true
  });
  for (const [page, text, when] of [
    ["reckoning", "Saint Ilvara walked into the pyre at Emberhold. The dead lay down.", { year: 1, month: 9, day: 32 }],
    ["harbor-fire", "Fire on the Varrow docks. Three hundred lost.", { year: 1339, month: 7, day: 14 }],
    ["burning", "Bog raiders burn half of Hollowmere.", { year: 1342, month: 4, day: 9 }]
  ])
    await journal("", {
      playerText: text,
      inWorldDate: when,
      attachPageId: pages[page].id,
      tags: ["history"],
      reveal: true
    });

  // Session 1: the forest road.
  sessions[1] = await createSession(SESSIONS[0], []);
  await setDate(2);
  await updateQuest(quests["cold-ash"], { status: "active" });
  await updateQuest(quests.cart, { status: "active" });
  await updateQuest(quests["drowned-road"], { status: "active" });
  const goblins = await spawn("goblin-warrior", 6);
  const grub = roster.Grub;
  scenes.road = await runFight({
    maps,
    scene: "Ambush at the Ford",
    mapKey: "road",
    party,
    foes: [...goblins, grub],
    partyCells: PARTY_CELLS(9, 7),
    foeCells: [
      [10, 6],
      [10, 8],
      [11, 7],
      [14, 4],
      [15, 10],
      [8, 11],
      [13, 7]
    ],
    maxRounds: 8,
    tactics: partyTactics(null),
    isOver: (context) => {
      // Grub surrenders once he is bloodied, or once his warriors are down.
      const current = context.state.actors.find((actor) => actor.id === grub.id);
      const alone = livingFoes(context).every((foe) => foe.id === grub.id);
      if (current.hp.current <= current.hp.maximum / 2 || alone) context.memory.spared.add(grub.id);
      return livingFoes(context).every((foe) => context.memory.spared.has(foe.id));
    }
  });
  const grubAfter = (await game()).actors.find((actor) => actor.id === grub.id);
  if (grubAfter.hp.current <= 0) await post(`/api/v1/game/actors/${grub.id}/heal`, { amount: 4 });
  await restParty(party);
  await journal("", {
    playerText:
      "Grub threw down his cleaver and begged. The Mudfoot goblins are running from 'walking bones' in the Gloomwood.",
    gmText: "Grub keeps his word if the party returns his drum.",
    attachPageId: pages.grub.id,
    tags: ["goblins"],
    reveal: true
  });
  await setStanding(pages, "mudfoot", -30, "Ambushed the party at the ford", true);
  await setStanding(pages, "mudfoot", -10, "The party spared Grub", true);
  await updateQuest(quests["drowned-road"], {
    status: "completed",
    objectives: quests["drowned-road"].objectives
  });
  await updateQuest(quests.cart, { status: "failed" });
  await journal("/milestone", { milestone: { level: 6, reason: "Survived the ford" }, reveal: true });

  // Session 2: the crypt.
  sessions[2] = await createSession(SESSIONS[1], []);
  await setDate(6);
  const skeletons = await spawn("skeleton", 3);
  const zombies = await spawn("zombie", 2);
  const wight = (await spawn(homebrew["Ash Wight"].id, 1))[0];
  const tamsin = roster["Tamsin Vey"];
  scenes.crypt = await runFight({
    maps,
    scene: "The Saint's Ossuary",
    mapKey: "crypt",
    party,
    foes: [...skeletons, ...zombies, wight],
    partyCells: PARTY_CELLS(8, 10),
    foeCells: [
      [9, 9],
      [9, 11],
      [10, 10],
      [11, 8],
      [11, 12],
      [9, 10]
    ],
    maxRounds: 8,
    onStart: async () => {
      await post("/api/v1/game/annotations", {
        kind: "shape",
        shape: "circle",
        geometry: { origin: center([10, 10]), target: center([13, 10]) },
        visibility: "public",
        color: "#FF2E9A"
      });
      await post("/api/v1/game/annotations", {
        kind: "measurement",
        geometry: { origin: center([6, 10]), target: center([11, 8]) },
        visibility: "gm-only",
        color: "#2DE2FF"
      });
    },
    tactics: async (actor, context) => {
      if (actor.id === wight.id && !context.memory.drained) {
        context.memory.drained = true;
        return {
          targets: [tamsin],
          after: async () => {
            // The claw that drops Tamsin, so the log shows a character dying and being brought back.
            const current = (await game()).actors.find((candidate) => candidate.id === tamsin.id);
            if (current.hp.current > 0)
              await post(`/api/v1/game/actors/${tamsin.id}/damage`, {
                amount: current.hp.current,
                parts: [{ amount: current.hp.current, type: "necrotic" }],
                sourceActorId: wight.id,
                sourceName: "Ash Wight's Withering Claw"
              });
            await post(`/api/v1/game/actors/${roster["Rook Ashgrave"].id}/conditions`, {
              conditionId: "frightened",
              active: true
            });
          }
        };
      }
      return partyTactics((ctx) => livingFoes(ctx).slice(0, 3))(actor, context);
    }
  });
  await restParty(party);
  await journal("", {
    playerText:
      "The reliquary niche was empty and the candles had burned down days ago. The skeletons hummed a hymn as they fell apart.",
    gmText: "The hymn is the Pale Choir's. Ivo can recognize it with DC 14 History.",
    attachPageId: pages.crypt.id,
    tags: ["clue", "pale-choir"],
    reveal: true
  });
  await journal("", {
    playerText: "Rook claimed the Ember-Etched Blade from the guardian alcove.",
    attachPageId: pages.blade.id,
    tags: ["loot"],
    reveal: true
  });
  await setStanding(pages, "wardens", 25, "Reported the theft to Emberhold", true);
  await updateQuest(quests["cold-ash"], {
    objectives: quests["cold-ash"].objectives.map((objective, index) => ({ ...objective, done: index < 2 }))
  });
  await journal("/milestone", {
    milestone: { level: 7, reason: "Cleared the Crypt of the Ashen Saint" },
    reveal: true
  });

  // Session 3: Port Varrow.
  sessions[3] = await createSession(SESSIONS[2], []);
  await setDate(10);
  await journal("/deadline", {
    playerText: "The harbor tithe is due to the guild.",
    gmText: "The party is not on the hook for it, but Mags is.",
    inWorldDate: date(10),
    attachPageId: pages.guild.id,
    tags: ["port-varrow"],
    reveal: true
  });
  await setDate(11);
  await updateQuest(quests.shipment, { status: "active" });
  await updateQuest(quests.informant, { status: "active" });
  const captain = (await spawn("bandit-captain", 1))[0];
  const bandits = await spawn("bandit", 4);
  const pirate = (await spawn("pirate", 1))[0];
  const corwin = roster["Corwin Hale"];
  scenes.warehouse = await runFight({
    maps,
    scene: "Smugglers in the Warehouse",
    mapKey: "warehouse",
    party,
    foes: [captain, ...bandits, pirate],
    partyCells: PARTY_CELLS(8, 7),
    foeCells: [
      [10, 7],
      [9, 6],
      [9, 8],
      [11, 5],
      [11, 9],
      [12, 7]
    ],
    maxRounds: 8,
    tactics: async (actor, context) => {
      if (actor.id === captain.id && !context.memory.shoved) {
        context.memory.shoved = true;
        return {
          targets: [corwin],
          after: () => post(`/api/v1/game/actors/${corwin.id}/conditions`, { conditionId: "prone", active: true })
        };
      }
      return partyTactics((ctx) => livingFoes(ctx).slice(1, 4))(actor, context);
    }
  });
  await restParty(party);
  await journal("", {
    playerText:
      "Among the smugglers' crates: grave goods from the crypt, and a ledger written half in cipher. Captain Marrow let the party keep it.",
    gmText: "The ledger names Harbormaster Dunmore and three shipments 'to the tower'.",
    attachPageId: pages.ledger.id,
    tags: ["clue", "port-varrow"],
    reveal: true
  });
  await updateQuest(quests.shipment, {
    objectives: quests.shipment.objectives.map((objective, index) => ({ ...objective, done: index < 2 }))
  });
  await updateQuest(quests.informant, { status: "canceled" });
  await setStanding(pages, "guild", -15, "Raided a guild warehouse", true);
  await setStanding(pages, "choir", -50, "Took back the Choir's grave goods", false);

  // Downtime after session 3: one applied (the clock moves a day), one still waiting for the GM.
  const training = await journal("/downtime", {
    playerText: "Rook drills with the Ember Wardens' sergeant at the Varrow chapter house.",
    downtime: { who: "Rook Ashgrave", activity: "Training with the Ember Wardens", days: 1 },
    tags: ["downtime"],
    reveal: true
  });
  await post(`/api/v1/codex/journal/${training.id}/apply-downtime`);
  await journal("/downtime", {
    playerText: "Ivo copies Cinderburst from the crypt scroll into the spellbook.",
    downtime: { who: "Ivo Quillfeather", activity: "Transcribing a spell", days: 2 },
    tags: ["downtime"],
    reveal: true
  });
  await journal("/downtime", {
    playerText: "Tamsin works the dice tables at the Brine and Barrel, listening for rumors.",
    gmText: "She hears rumor 3 (lights in the watchtower).",
    downtime: { who: "Tamsin Vey", activity: "Carousing", days: 1 },
    tags: ["downtime"]
  });
  await journal("/deadline", {
    playerText: "The Pale Choir's rite at the watchtower completes.",
    gmText: "If the party is not at the tower by Harvestide 20, the reliquary cracks and the drowned dead rise.",
    inWorldDate: date(20),
    attachPageId: pages.tower.id,
    tags: ["pale-choir", "clock"]
  });

  // Session 4 is still being prepped: its scene waits on the live table with fog and rubble.
  const initiates = await spawn("cultist", 4);
  const hounds = await spawn(homebrew["Cinder Hound"].id, 2);
  const vessa = roster["Vessa the Pale"];
  const towerScene = randomUUID();
  const towerFoes = [...initiates, ...hounds, vessa];
  await post("/api/v1/game/scenes", {
    commandId: towerScene,
    name: "Assault on the Watchtower",
    mapAssetId: maps.tower.id,
    combatantIds: [...party, ...towerFoes].map((actor) => actor.id)
  });
  for (const [index, actor] of party.entries())
    await post(`/api/v1/game/tokens/${actor.id}/move`, {
      position: center(PARTY_CELLS(4, 12)[index]),
      sceneId: towerScene
    });
  for (const [index, actor] of towerFoes.entries())
    await post(`/api/v1/game/tokens/${actor.id}/move`, {
      position: center(
        [
          [8, 6],
          [10, 6],
          [8, 8],
          [10, 8],
          [7, 4],
          [11, 4],
          [9, 2]
        ][index]
      ),
      sceneId: towerScene
    });
  await post("/api/v1/game/fog/paint", {
    op: "hide",
    rect: { x: 0, y: 0, width: 16 * CELL_PX, height: 16 * CELL_PX },
    sceneId: towerScene
  });
  await post("/api/v1/game/fog/paint", {
    op: "reveal",
    rect: { x: 0, y: 9 * CELL_PX, width: 8 * CELL_PX, height: 7 * CELL_PX },
    sceneId: towerScene
  });
  await post("/api/v1/game/terrain/paint", {
    op: "difficult",
    rect: { x: 5 * CELL_PX, y: 9 * CELL_PX, width: 3 * CELL_PX, height: 2 * CELL_PX },
    sceneId: towerScene
  });
  await post(`/api/v1/game/scenes/${towerScene}/activate`, {});
  scenes.tower = towerScene;
  sessions[4] = await createSession(SESSIONS[3], [towerScene]);
  for (const number of [1, 2, 3]) {
    const key = ["road", "crypt", "warehouse"][number - 1];
    await patch(`/api/v1/codex/sessions/${sessions[number].id}`, { sceneIds: [scenes[key]] });
  }
  step("4 sessions (3 played, 1 planned) with recaps, prep and scenes");

  // Clock: the GM is on Harvestide 12 after Rook's training; players see it once published.
  await post("/api/v1/codex/calendar/publish");

  await seedAtlas(maps, pages, scenes, roster);

  // Share two of the three fights with players.
  const { encounters } = await get("/api/v1/encounters");
  for (const encounter of encounters.slice(-2))
    await post(`/api/v1/encounters/${encounter.id}/visibility`, { playerVisible: true });
  step(`${encounters.length} fights archived, ${Math.min(2, encounters.length)} shared with players`);

  // The server files fights, standing changes and quest history as hidden entries. Show players the ones
  // that match what they already know: the shared fights, revealed standings and revealed quests.
  const sharedFights = new Set(encounters.slice(-2).map((encounter) => encounter.id));
  const revealedQuests = new Set(
    Object.values(quests)
      .filter((quest) => quest.revealed)
      .map((quest) => quest.record.id)
  );
  const hiddenFaction = pages.choir.id;
  for (const entry of (await get("/api/v1/codex/journal")).entries) {
    const show =
      (entry.kind === "combat" && sharedFights.has(entry.sourceEncounterId)) ||
      (entry.kind === "standing" && entry.payload?.factionPageId !== hiddenFaction) ||
      (entry.kind === "quest" && revealedQuests.has(entry.payload?.questId));
    if (show && !entry.revealedToPlayers) await post(`/api/v1/codex/journal/${entry.id}/reveal`, { revealed: true });
  }

  // A few edits to a page so its revision history has entries, then the default revision window again.
  for (const status of ["Missing (seen in Port Varrow?)", "Missing - believed to be with the Pale Choir"]) {
    const current = (await get(`/api/v1/codex/pages/${pages.aldous.id}`)).page;
    await patch(`/api/v1/codex/pages/${pages.aldous.id}`, {
      fields: { ...current.fields, status },
      expectedRev: current.rev
    });
  }
  await put("/api/v1/codex/settings", {
    revisionHistory: { enabled: true, windowMinutes: 90 },
    autosave: { enabled: true, intervalSeconds: 5 }
  });
  console.log("\nDone. Open the app, sign in as GM, and look around.");
}

async function seedAtlas(maps, pages, scenes, roster) {
  const node = async (key, kind, parentMapId, revealed) => {
    const created = await post("/api/v1/codex/maps", {
      assetId: maps[key].id,
      name: maps[key].name,
      kind,
      parentMapId,
      revealedToPlayers: revealed
    });
    return created.map ?? created;
  };
  const world = await node("world", "world", null, true);
  const vale = await node("vale", "regional", world.id, true);
  const port = await node("port", "regional", world.id, true);
  const road = await node("road", "battlemap", vale.id, true);
  const crypt = await node("crypt", "battlemap", vale.id, true);
  const tower = await node("tower", "battlemap", vale.id, false);
  const warehouse = await node("warehouse", "battlemap", port.id, true);

  const marker = async (map, x, y, iconId, iconColor, label, links, revealed = true) => {
    const created = await post(`/api/v1/codex/maps/${map.id}/markers`, {
      x,
      y,
      iconId,
      iconColor,
      label,
      revealedToPlayers: revealed,
      ...links
    });
    return created.marker ?? created;
  };
  const pageIds = (...keys) => ({ pageIds: keys.map((key) => pages[key].id) });
  await marker(world, 620, 520, "hills", "#57E39A", "Gloamshire Vale", { ...pageIds("vale"), subMapId: vale.id });
  await marker(world, 1380, 760, "city", "#2DE2FF", "Port Varrow", { ...pageIds("port"), subMapId: port.id });
  await marker(world, 900, 300, "temple", "#FFB020", "Emberhold Abbey", pageIds("wardens", "saint"));
  await marker(world, 420, 820, "forest", "#57E39A", "Gloomwood", pageIds("gloomwood", "moths"));
  await marker(world, 1600, 1100, "water", "#2DE2FF", "The Drowned Coast", pageIds("mother", "harbor-fire"));

  await marker(vale, 700, 560, "village", "#E8ECF4", "Hollowmere", pageIds("hollowmere", "corvin"));
  await marker(vale, 820, 220, "dungeon", "#FF2D5E", "Crypt of the Ashen Saint", {
    ...pageIds("crypt", "aldous"),
    subMapId: crypt.id,
    sceneIds: [scenes.crypt]
  });
  await marker(vale, 360, 700, "battle", "#FF2E9A", "The Ford", { subMapId: road.id, sceneIds: [scenes.road] });
  await marker(
    vale,
    1260,
    300,
    "watchtower",
    "#A45CFF",
    "Ruined Watchtower",
    { ...pageIds("tower", "vessa"), subMapId: tower.id, sceneIds: [scenes.tower] },
    false
  );
  await marker(
    vale,
    260,
    380,
    "forest",
    "#57E39A",
    "Old Wren's Hut",
    {
      ...pageIds("wren"),
      actorId: roster["Old Wren"].id
    },
    false
  );

  const brine = await marker(port, 520, 640, "flag", "#FFB020", "The Brine and Barrel", pageIds("brine", "mags"));
  await marker(port, 860, 700, "treasure", "#FF2D5E", "Guild Warehouse", {
    ...pageIds("warehouse", "ledger"),
    subMapId: warehouse.id,
    sceneIds: [scenes.warehouse]
  });
  await marker(port, 700, 380, "fort", "#2DE2FF", "Watch House", {
    ...pageIds("hessa"),
    actorId: roster["Captain Hessa Marrow"].id
  });
  await marker(port, 980, 300, "capital", "#94A3B8", "Guild Hall", pageIds("guild"));
  await marker(port, 300, 820, "shrine", "#E8ECF4", "Shrine of the Drowned Mother", pageIds("mother"));
  await put(`/api/v1/codex/markers/${brine.id}/party`, { isParty: true });
  await journal("", {
    playerText: "The party takes rooms above the Brine and Barrel.",
    attachMarkerId: brine.id,
    tags: ["port-varrow"],
    reveal: true
  });
  step("atlas: 7 maps nested world > region > battlemap, 15 markers, party pin in Port Varrow");
}

await main();
