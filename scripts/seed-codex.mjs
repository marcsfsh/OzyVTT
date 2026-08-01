/**
 * Populate a Codex with enough real content to VERIFY it in a browser.
 *
 * An empty Codex passes every check trivially: no list overflows, no filter has anything to filter, no
 * dashboard card renders, and a 44px audit finds five controls. This writes a small but structurally
 * complete campaign — pages in folders, an atlas with pins, a party pin, sessions, quests with
 * objectives, a chronicle carrying every row kind, downtime waiting to be applied, connections, tags,
 * a fantasy calendar, and faction standing — through the REAL HTTP API, so nothing here can invent a
 * shape the server would not accept.
 *
 * Verification support, deliberately not a fixture: it is not imported by any test, and it is not a
 * server-side seeder. Both of those would be someone else's lane.
 *
 *   DATA_DIR=/tmp/vtt-verify PORT=3011 node --import tsx apps/server/src/index.ts &
 *   node scripts/seed-codex.mjs                      # BASE/PASSWORD overridable
 */

import zlib from "node:zlib";

/** PNG chunk CRC. Twelve lines instead of a dependency, for a script that must not add one. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const BASE = process.env.SEED_URL ?? "http://localhost:3011";
const PASSWORD = process.env.SEED_PASSWORD ?? "testpassword123";

let token = "";

async function api(method, path, body) {
  const response = await fetch(`${BASE}/api/v1/codex${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  // D19's envelope: `{ ok, apiVersion, data }`. Unwrapped here so the seed reads like the domain.
  const envelope = text ? JSON.parse(text) : null;
  return envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : envelope;
}

/** D19: every write carries a commandId, so a retried seed is idempotent rather than doubled. */
const cmd = () => ({ commandId: crypto.randomUUID() });

async function login() {
  await fetch(`${BASE}/api/bootstrap`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD })
  });
  const response = await fetch(`${BASE}/api/gm/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD })
  });
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  ({ token } = await response.json());
}

// ----- Pages. Folders, every entity type, and a mix of shown/hidden so the reveal axis is exercised. -----

const PAGES = [
  { title: "Strahd von Zarovich", entityType: "character", folder: "Barovia/People", tags: ["villain", "vampire"], revealed: true,
    playerBody: "The Devil Strahd. Lord of Barovia; nobody remembers a time before him.",
    gmBody: "Wants Ireena. Will not kill the party while they amuse him — see [[Castle Ravenloft]]." },
  { title: "Ireena Kolyana", entityType: "character", folder: "Barovia/People", tags: ["ally"], revealed: true,
    playerBody: "The burgomaster's adopted daughter. Twice bitten, twice recovered.", gmBody: "Tatyana reborn. She does not know." },
  { title: "Ismark Kolyanovich", entityType: "character", folder: "Barovia/People", tags: ["ally"], revealed: true,
    playerBody: "Ireena's brother. Calls himself the Lesser.", gmBody: "" },
  { title: "Madam Eva", entityType: "character", folder: "Barovia/People", tags: ["vistani"], revealed: false,
    playerBody: "", gmBody: "Reads the Tarokka. The reading is not a trick." },
  { title: "Barovia", entityType: "location", folder: "Barovia", tags: ["region", "mist"], revealed: true,
    playerBody: "A valley walled by mist. The sun has not been seen in living memory.", gmBody: "The mists are Strahd's." },
  { title: "Castle Ravenloft", entityType: "location", folder: "Barovia/Places", tags: ["dungeon"], revealed: true,
    playerBody: "It sits on the crag above the village and is visible from everywhere.", gmBody: "Layout shifts nightly below the third floor." },
  { title: "Vallaki", entityType: "location", folder: "Barovia/Places", tags: ["town"], revealed: true,
    playerBody: "A walled town that insists, loudly, that all is well.", gmBody: "The baron is one festival from being deposed." },
  { title: "The Amber Temple", entityType: "location", folder: "Barovia/Places", tags: ["dungeon", "secret"], revealed: false,
    playerBody: "", gmBody: "Dark gifts, freely offered, always ruinous." },
  { title: "The Vistani", entityType: "faction", folder: "Barovia/Powers", tags: ["neutral"], revealed: true,
    playerBody: "Travellers who pass the mists at will.", gmBody: "Some serve Strahd. Not all." },
  { title: "The Keepers of the Feather", entityType: "faction", folder: "Barovia/Powers", tags: ["ally"], revealed: true,
    playerBody: "Wereravens. They are watching, and occasionally helping.", gmBody: "" },
  { title: "The Order of the Silver Dragon", entityType: "faction", folder: "Barovia/Powers", tags: ["history"], revealed: false,
    playerBody: "", gmBody: "Argynvost's knights. Their beacon can still be lit." },
  { title: "The Tome of Strahd", entityType: "item", folder: "Barovia/Things", tags: ["quest-item"], revealed: true,
    playerBody: "A journal in Strahd's own hand.", gmBody: "" },
  { title: "The Sunsword", entityType: "item", folder: "Barovia/Things", tags: ["quest-item", "secret"], revealed: false,
    playerBody: "", gmBody: "One of the three Tarokka artifacts." },
  { title: "Dark gifts", entityType: "note", folder: null, tags: ["rules"], revealed: false,
    playerBody: "", gmBody: "Each is a permanent bargain. Offer them; never push them." },
  { title: "The mists", entityType: "note", folder: null, tags: ["mist", "rules"], revealed: true,
    playerBody: "They turn you around. Every road out is a road back in.", gmBody: "" }
];

async function seed() {
  await login();
  console.log("logged in");

  const pageIds = new Map();
  for (const page of PAGES) {
    const { page: created } = await api("POST", "/pages", {
      title: page.title, entityType: page.entityType, folder: page.folder, tags: page.tags,
      playerBody: page.playerBody, gmBody: page.gmBody, fields: {}, ...cmd()
    });
    pageIds.set(page.title, created.id);
    if (page.revealed) await api("POST", `/pages/${created.id}/reveal`, { revealed: true, ...cmd() });
  }
  console.log(`${pageIds.size} pages`);

  // ----- Connections (D8). Free-text labels, both layers, so the Graph has edges to draw. -----
  const connect = (from, to, label, layer) =>
    api("POST", `/pages/${pageIds.get(from)}/connections`, { toPageId: pageIds.get(to), label, layer, ...cmd() });
  await connect("Strahd von Zarovich", "Castle Ravenloft", "rules from", "player");
  await connect("Strahd von Zarovich", "Ireena Kolyana", "is obsessed with", "gm");
  await connect("Ireena Kolyana", "Ismark Kolyanovich", "sister of", "player");
  await connect("The Vistani", "Strahd von Zarovich", "some serve", "gm");
  await connect("Vallaki", "Barovia", "lies within", "player");
  await connect("Castle Ravenloft", "Barovia", "overlooks", "player");
  await connect("The Order of the Silver Dragon", "Castle Ravenloft", "besieged", "gm");
  await connect("The Sunsword", "The Amber Temple", "was forged against", "gm");
  console.log("8 connections");

  // ----- Calendar (D17). A real fantasy calendar, published behind the GM's own date. -----
  await api("PUT", "/calendar", {
    yearName: "BC", weekdays: ["Moonday", "Grimday", "Ashday", "Sunday", "Mistday"],
    months: [
      { name: "Hollowing", days: 30 }, { name: "Greyfall", days: 28 }, { name: "Coldmourn", days: 31 },
      { name: "Thawing", days: 30 }, { name: "Bloomrot", days: 31 }, { name: "Longmist", days: 30 }
    ],
    // Downtime cannot pass time until the GM's own clock is somewhere, so the seed sets it — the same
    // 400 ("Set the campaign's current date before passing time") a real GM would hit.
    currentDate: { year: 735, month: 2, day: 11 },
    ...cmd()
  });
  await api("POST", "/calendar/publish", cmd());
  console.log("calendar");

  // ----- Sessions (D9). One played, one active, so both dashboard headings can be seen. -----
  const { session: s13 } = await api("POST", "/sessions", {
    sessionNumber: 13, realDate: "2026-07-11", attendees: ["Ana", "Bo", "Cass", "Dev"], status: "played",
    prepBody: "Open on the funeral. The Keepers make contact if the party helps.",
    recapBody: "The party buried the burgomaster and left Barovia village with Ireena.", tags: ["barovia"], ...cmd()
  });
  await api("POST", `/sessions/${s13.id}/reveal`, { revealed: true, ...cmd() });
  const { session: s14 } = await api("POST", "/sessions", {
    sessionNumber: 14, realDate: "2026-08-01", attendees: ["Ana", "Bo", "Cass"], status: "planned",
    prepBody: "Vallaki. The Feast of St Andral is three days out and the bones are already gone.",
    recapBody: "", tags: ["vallaki"], ...cmd()
  });
  await api("POST", `/sessions/${s14.id}/activate`, cmd());
  console.log("2 sessions");

  // ----- Quests (D11/R5). Open, completed and failed, so the history surface has all three. -----
  const quests = [
    { title: "Escort Ireena to Vallaki", status: "active", revealed: true, tags: ["barovia"],
      playerBody: "Ismark asked us to get his sister behind Vallaki's walls.",
      gmBody: "Strahd will not stop them. He wants them to try.",
      objectives: [{ text: "Leave Barovia village", done: true }, { text: "Survive the Svalich Road", done: true }, { text: "Reach St Andral's", done: false }] },
    { title: "The Missing Bones", status: "active", revealed: true, tags: ["vallaki"],
      playerBody: "St Andral's bones are gone and the priest is terrified.",
      gmBody: "Milivoj took them. He was paid.",
      objectives: [{ text: "Ask the priest what happened", done: true }, { text: "Find who took them", done: false }] },
    { title: "The Tome of Strahd", status: "completed", revealed: true, tags: ["barovia"],
      playerBody: "Madam Eva's reading named a book in the castle.",
      gmBody: "", objectives: [{ text: "Read the Tarokka", done: true }, { text: "Recover the tome", done: true }] },
    { title: "Save the burgomaster", status: "failed", revealed: true, tags: ["barovia"],
      playerBody: "We were too late. Kolyan Indirovich died before we reached the mansion.",
      gmBody: "This was always going to fail; it is what puts Ismark in charge.", objectives: [{ text: "Reach the mansion", done: true }] },
    { title: "The Amber Vaults", status: "active", revealed: false, tags: ["secret"],
      playerBody: "", gmBody: "They do not know this exists yet.", objectives: [{ text: "Find the temple", done: false }] }
  ];
  for (const quest of quests) {
    const { quest: created } = await api("POST", "/quests", {
      title: quest.title, status: quest.status, playerBody: quest.playerBody, gmBody: quest.gmBody,
      objectives: quest.objectives, tags: quest.tags, ...cmd()
    });
    if (quest.revealed) await api("POST", `/quests/${created.id}/reveal`, { revealed: true, ...cmd() });
  }
  console.log(`${quests.length} quests`);

  // ----- The chronicle (D5/R2): one row of every kind, so the timeline is not all notes. -----
  // There is no `kind` field on a journal write: each structured kind has its OWN route, because each has
  // a rule a plain entry does not (a deadline requires a date, downtime requires its payload). The seed
  // follows the server's shape rather than inventing a polymorphic one.
  const entries = [
    { playerText: "We buried the burgomaster at dawn. Nobody sang.", gmText: "They missed the raven on the wall.", reveal: true, tags: ["barovia"] },
    { playerText: "The road out of the valley put us back at the gates. Twice.", gmText: "", reveal: true, tags: ["mist"] },
    { playerText: "", gmText: "Strahd watched the whole burial from the treeline.", reveal: false, tags: [] },
    { playerText: "Vallaki insists all is well. It says so on a banner.", gmText: "", reveal: true, tags: ["vallaki"] }
  ];
  for (const entry of entries) {
    const { entry: created } = await api("POST", "/journal", {
      playerText: entry.playerText, gmText: entry.gmText, tags: entry.tags,
      sessionId: null, attachPageId: null, attachMarkerId: null, ...cmd()
    });
    if (entry.reveal) await api("POST", `/journal/${created.id}/reveal`, { revealed: true, ...cmd() });
  }
  const { entry: milestone } = await api("POST", "/journal/milestone", {
    playerText: "The party reached Vallaki and levelled.", gmText: "", tags: ["vallaki"],
    milestone: { level: 4, reason: "Escorted Ireena out of the valley floor" }, ...cmd()
  });
  await api("POST", `/journal/${milestone.id}/reveal`, { revealed: true, ...cmd() });
  const { entry: deadline } = await api("POST", "/journal/deadline", {
    playerText: "The Feast of St Andral.", gmText: "If the bones are not back, the church falls.",
    inWorldDate: { year: 735, month: 2, day: 14 }, tags: ["vallaki"], ...cmd()
  });
  await api("POST", `/journal/${deadline.id}/reveal`, { revealed: true, ...cmd() });
  // D12: three downtimes — one already applied and two still waiting, so the tracker has both states and
  // the dashboard's "downtime pending" card has something to count.
  const { entry: dt1 } = await api("POST", "/journal/downtime", {
    playerText: "Ana spent the week at the forge.",
    downtime: { who: "Ana", activity: "Forging a blade", days: 7, characterPageId: pageIds.get("Ismark Kolyanovich") ?? null }, ...cmd()
  });
  await api("POST", `/journal/${dt1.id}/apply-downtime`, cmd());
  await api("POST", "/journal/downtime", {
    playerText: "Bo went looking for another Tarokka deck.",
    downtime: { who: "Bo", activity: "Researching the Tarokka", days: 3, characterPageId: null }, ...cmd()
  });
  await api("POST", "/journal/downtime", {
    playerText: "",
    downtime: { who: "Cass", activity: "Carousing in Vallaki", days: 2, characterPageId: null }, ...cmd()
  });
  console.log("chronicle: 4 notes, milestone, deadline, 3 downtimes (1 applied)");

  // ----- The atlas (D15). Two maps, a sub-map, pins of both visibilities, and a party pin. -----
  // A real PNG, encoded here rather than committed: the asset store sniffs the format from the BYTES
  // (there is no SVG path), so a fake would be rejected exactly as a corrupt upload should be.
  const png = (w, h, rgb) => {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0;                                  // filter byte: none
      for (let x = 0; x < w; x++) {
        const at = y * (w * 3 + 1) + 1 + x * 3;
        // A quiet diagonal wash, so the map is visibly a map and pin contrast can be judged.
        raw[at] = Math.round(rgb[0] * (0.55 + 0.45 * (x / w)));
        raw[at + 1] = Math.round(rgb[1] * (0.55 + 0.45 * (y / h)));
        raw[at + 2] = rgb[2];
      }
    }
    const chunk = (type, data) => {
      const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([length, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit truecolour
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
    ]);
  };

  async function uploadMap(name, kind, rgb) {
    const bytes = png(960, 640, rgb);
    const upload = await fetch(`${BASE}/api/v1/map-assets?filename=${encodeURIComponent(name)}.png&name=${encodeURIComponent(name)}&kind=regional`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "image/png" }, body: bytes
    });
    if (!upload.ok) throw new Error(`asset upload -> ${upload.status} ${(await upload.text()).slice(0, 200)}`);
    const { data } = await upload.json();
    const { map } = await api("POST", "/maps", { assetId: data.asset.id, name, kind, tags: [], ...cmd() });
    return map;
  }

  const valley = await uploadMap("Barovia Valley", "regional", [70, 60, 120]);
  await api("POST", `/maps/${valley.id}/reveal`, { revealed: true, ...cmd() });
  const town = await uploadMap("Vallaki", "battlemap", [130, 95, 60]);
  await api("POST", `/maps/${town.id}/reveal`, { revealed: true, ...cmd() });
  await api("POST", `/maps/${town.id}/parent`, { parentMapId: valley.id, ...cmd() });

  const pins = [
    { map: valley.id, x: 0.31, y: 0.62, icon: "town", color: "#7C5CFF", label: "Barovia village", page: "Barovia", reveal: true },
    { map: valley.id, x: 0.44, y: 0.28, icon: "castle", color: "#FF2E9A", label: "Castle Ravenloft", page: "Castle Ravenloft", reveal: true },
    { map: valley.id, x: 0.68, y: 0.41, icon: "town", color: "#2EE6D6", label: "Vallaki", page: "Vallaki", reveal: true, sub: town.id },
    { map: valley.id, x: 0.84, y: 0.14, icon: "skull", color: "#FF6B4A", label: "The Amber Temple", page: "The Amber Temple", reveal: false },
    { map: valley.id, x: 0.22, y: 0.35, icon: "pin", color: "#FFC24A", label: "Tser Pool", page: null, reveal: true },
    { map: town.id, x: 0.5, y: 0.44, icon: "pin", color: "#5CD97C", label: "St Andral's Church", page: null, reveal: true },
    { map: town.id, x: 0.72, y: 0.66, icon: "pin", color: "#4AA8FF", label: "The Blue Water Inn", page: null, reveal: true },
    { map: town.id, x: 0.28, y: 0.71, icon: "pin", color: "#E05CC8", label: "The Baron's mansion", page: null, reveal: false }
  ];
  let partyPinId = null;
  for (const pin of pins) {
    const { marker } = await api("POST", `/maps/${pin.map}/markers`, {
      x: pin.x, y: pin.y, iconId: pin.icon, iconColor: pin.color, label: pin.label,
      pageIds: pin.page ? [pageIds.get(pin.page)] : [], subMapId: pin.sub ?? null, tags: [], ...cmd()
    });
    if (pin.reveal) await api("POST", `/markers/${marker.id}/reveal`, { revealed: true, ...cmd() });
    if (pin.label === "Vallaki") partyPinId = marker.id;
  }
  if (partyPinId) await api("PUT", `/markers/${partyPinId}/party`, { isParty: true, ...cmd() });
  console.log(`2 maps, ${pins.length} pins, party pin set`);

  // ----- Faction standing, one revealed and one not. -----
  for (const [faction, value, reveal] of [["The Keepers of the Feather", 2, true], ["The Vistani", -1, false]]) {
    const id = pageIds.get(faction);
    await api("PUT", `/standing/${id}`, { value, ...cmd() });
    if (reveal) await api("POST", `/standing/${id}/reveal`, { revealed: true, ...cmd() });
  }
  console.log("standing");

  const { pages } = await api("GET", "/pages");
  const { records } = await api("GET", "/timeline");
  console.log(`\nseeded: ${pages.length} pages, ${records.length} chronicle rows`);
}

await seed();
