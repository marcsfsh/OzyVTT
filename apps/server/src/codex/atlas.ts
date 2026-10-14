import { freshId, stamp, write, type CodexDb } from "./db.js";
import { indexMap, indexMarker, unindex } from "./search.js";
import {
  CodexNotFoundError,
  CodexValidationError,
  coord,
  hexColor,
  iconId,
  id,
  idArray,
  isId,
  mapKind,
  mapName,
  markerLabel,
  optionalId,
  parseStringArray,
  tags,
  type CodexMapKind
} from "./validate.js";

/** The atlas: a tree of maps (`codex_maps`) and the pins on them (`codex_markers`). */

export type { CodexMapKind } from "./validate.js";
export type CodexMapRow = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId: string | null;
  revealedToPlayers: boolean;
  sortKey: number;
  tags: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
export type CodexMarkerLinks = Readonly<{
  pageIds: string[];
  subMapId: string | null;
  sceneIds: string[];
  actorId: string | null;
}>;
export type CodexMarkerRow = Readonly<
  {
    id: string;
    mapId: string;
    x: number;
    y: number;
    iconId: string;
    iconColor: string;
    label: string | null;
    revealedToPlayers: boolean;
    tags: readonly string[];
    /** At most one party pin atlas-wide. Player-facing, but grants no visibility. */
    isParty: boolean;
  } & CodexMarkerLinks & { createdAt: string; updatedAt: string }
>;
export type CodexMapCreateInput = Readonly<{
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId?: string | null;
  revealedToPlayers?: boolean;
  tags?: readonly string[];
}>;
export type CodexMarkerCreateInput = Readonly<{
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label?: string | null;
  revealedToPlayers?: boolean;
  pageIds?: readonly string[];
  subMapId?: string | null;
  sceneIds?: readonly string[];
  actorId?: string | null;
  tags?: readonly string[];
}>;
export type CodexMarkerUpdateInput = Partial<CodexMarkerCreateInput>;

type MapRowRaw = {
  id: string;
  asset_id: string;
  name: string;
  kind: string;
  parent_map_id: string | null;
  revealed: number;
  sort_key: number;
  tags_json: string;
  created_at: string;
  updated_at: string;
};
const MAP_COLUMNS = "id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at";
type MarkerRowRaw = {
  id: string;
  map_id: string;
  x: number;
  y: number;
  icon_id: string;
  icon_color: string;
  label: string | null;
  revealed: number;
  page_ids_json: string;
  sub_map_id: string | null;
  scene_ids_json: string;
  actor_id: string | null;
  tags_json: string;
  is_party: number;
  created_at: string;
  updated_at: string;
};
const MARKER_COLUMNS =
  "id, map_id, x, y, icon_id, icon_color, label, revealed, page_ids_json, sub_map_id, scene_ids_json, actor_id, tags_json, is_party, created_at, updated_at";

function toMap(row: MapRowRaw): CodexMapRow {
  return {
    id: row.id,
    assetId: row.asset_id,
    name: row.name,
    kind: mapKind(row.kind),
    parentMapId: row.parent_map_id,
    revealedToPlayers: row.revealed === 1,
    sortKey: row.sort_key,
    tags: parseStringArray(row.tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function toMarker(row: MarkerRowRaw): CodexMarkerRow {
  return {
    id: row.id,
    mapId: row.map_id,
    x: row.x,
    y: row.y,
    iconId: row.icon_id,
    iconColor: row.icon_color,
    label: row.label,
    revealedToPlayers: row.revealed === 1,
    pageIds: parseStringArray(row.page_ids_json),
    subMapId: row.sub_map_id,
    sceneIds: parseStringArray(row.scene_ids_json),
    actorId: row.actor_id,
    tags: parseStringArray(row.tags_json),
    isParty: row.is_party === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function mapRow(db: CodexDb, mapId: string): MapRowRaw | undefined {
  if (!isId(mapId)) return undefined;
  return db.database.prepare(`SELECT ${MAP_COLUMNS} FROM codex_maps WHERE id = ?`).get(mapId) as MapRowRaw | undefined;
}
function markerRow(db: CodexDb, markerId: string): MarkerRowRaw | undefined {
  if (!isId(markerId)) return undefined;
  return db.database.prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE id = ?`).get(markerId) as
    MarkerRowRaw | undefined;
}

/** Leaf write of a whole, already-validated map row (create and restore). */
export function insertMap(db: CodexDb, map: CodexMapRow): void {
  db.database
    .prepare(`INSERT INTO codex_maps (${MAP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      map.id,
      map.assetId,
      map.name,
      map.kind,
      map.parentMapId,
      map.revealedToPlayers ? 1 : 0,
      map.sortKey,
      JSON.stringify(map.tags),
      map.createdAt,
      map.updatedAt
    );
  indexMap(db, map.id, map.name, map.tags);
}

/** Leaf write of a whole, already-validated marker row (create and restore). */
export function insertMarker(db: CodexDb, marker: CodexMarkerRow): void {
  db.database
    .prepare(`INSERT INTO codex_markers (${MARKER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      marker.id,
      marker.mapId,
      marker.x,
      marker.y,
      marker.iconId,
      marker.iconColor,
      marker.label,
      marker.revealedToPlayers ? 1 : 0,
      JSON.stringify(marker.pageIds),
      marker.subMapId,
      JSON.stringify(marker.sceneIds),
      marker.actorId,
      JSON.stringify(marker.tags),
      marker.isParty ? 1 : 0,
      marker.createdAt,
      marker.updatedAt
    );
  indexMarker(db, marker.id, marker.label, marker.tags);
}

// Maps

export function createMap(db: CodexDb, input: CodexMapCreateInput): CodexMapRow {
  const parentMapId = optionalId(input.parentMapId);
  if (parentMapId && !mapRow(db, parentMapId)) throw new CodexNotFoundError("The parent map no longer exists.");
  const sortKey =
    ((db.database.prepare("SELECT MAX(sort_key) AS m FROM codex_maps").get() as { m: number | null }).m ?? 0) + 1;
  const now = stamp(db);
  const map: CodexMapRow = {
    id: freshId(),
    assetId: id(input.assetId),
    name: mapName(input.name),
    kind: mapKind(input.kind),
    parentMapId,
    revealedToPlayers: input.revealedToPlayers === true,
    sortKey,
    tags: tags(input.tags),
    createdAt: now,
    updatedAt: now
  };
  write(db, () => insertMap(db, map));
  return getMap(db, map.id)!;
}

export function updateMap(
  db: CodexDb,
  mapId: string,
  input: Readonly<{ name?: string; kind?: CodexMapKind; tags?: readonly string[] }>
): CodexMapRow {
  const existing = getMap(db, mapId);
  if (!existing) throw new CodexNotFoundError("That map no longer exists.");
  const name = input.name === undefined ? existing.name : mapName(input.name);
  const kind = input.kind === undefined ? existing.kind : mapKind(input.kind);
  const mapTags = input.tags === undefined ? existing.tags : tags(input.tags);
  write(db, () => {
    db.database
      .prepare("UPDATE codex_maps SET name = ?, kind = ?, tags_json = ?, updated_at = ? WHERE id = ?")
      .run(name, kind, JSON.stringify(mapTags), stamp(db), mapId);
    indexMap(db, mapId, name, mapTags);
  });
  return getMap(db, mapId)!;
}

/** Re-parent a map, rejecting self-parenting and cycles so world, region and city stay a tree. */
export function setMapParent(db: CodexDb, mapId: string, parentMapId: string | null): CodexMapRow {
  if (!mapRow(db, mapId)) throw new CodexNotFoundError("That map no longer exists.");
  const parent = optionalId(parentMapId);
  if (parent !== null) {
    if (parent === mapId) throw new CodexValidationError("A map cannot be its own parent.");
    let cursor: string | null = parent;
    const seen = new Set<string>([mapId]);
    while (cursor !== null) {
      if (seen.has(cursor)) throw new CodexValidationError("That would create a loop in the map tree.");
      seen.add(cursor);
      const row: MapRowRaw | undefined = mapRow(db, cursor);
      if (!row) throw new CodexNotFoundError("The parent map no longer exists.");
      cursor = row.parent_map_id;
    }
  }
  write(db, () => {
    db.database
      .prepare("UPDATE codex_maps SET parent_map_id = ?, updated_at = ? WHERE id = ?")
      .run(parent, stamp(db), mapId);
  });
  return getMap(db, mapId)!;
}

export function setMapRevealed(db: CodexDb, mapId: string, revealed: boolean): CodexMapRow {
  if (!mapRow(db, mapId)) throw new CodexNotFoundError("That map no longer exists.");
  write(db, () => {
    db.database
      .prepare("UPDATE codex_maps SET revealed = ?, updated_at = ? WHERE id = ?")
      .run(revealed ? 1 : 0, stamp(db), mapId);
  });
  return getMap(db, mapId)!;
}

export function markerIdsOnMap(db: CodexDb, mapId: string): string[] {
  return (db.database.prepare("SELECT id FROM codex_markers WHERE map_id = ?").all(mapId) as Array<{ id: string }>).map(
    (row) => row.id
  );
}

/**
 * Leaf delete. Pins elsewhere that drilled into this map become label-only; its own pins cascade (their index
 * rows are removed here, or they would keep matching with no live row) and child maps move to the top level.
 */
export function deleteMap(db: CodexDb, mapId: string): void {
  db.database
    .prepare("UPDATE codex_markers SET sub_map_id = NULL, updated_at = ? WHERE sub_map_id = ?")
    .run(stamp(db), mapId);
  for (const markerId of markerIdsOnMap(db, mapId)) unindex(db, "marker", markerId);
  unindex(db, "map", mapId);
  db.database.prepare("DELETE FROM codex_maps WHERE id = ?").run(mapId);
}

export function getMap(db: CodexDb, mapId: string): CodexMapRow | null {
  const row = mapRow(db, mapId);
  return row ? toMap(row) : null;
}

export function listMaps(db: CodexDb): CodexMapRow[] {
  return (
    db.database
      .prepare(`SELECT ${MAP_COLUMNS} FROM codex_maps ORDER BY sort_key, name COLLATE NOCASE`)
      .all() as MapRowRaw[]
  ).map(toMap);
}

// Markers

export function createMarker(db: CodexDb, mapId: string, input: CodexMarkerCreateInput): CodexMarkerRow {
  if (!mapRow(db, mapId)) throw new CodexNotFoundError("That map no longer exists.");
  const now = stamp(db);
  const marker: CodexMarkerRow = {
    id: freshId(),
    mapId,
    x: coord(input.x),
    y: coord(input.y),
    iconId: iconId(input.iconId),
    iconColor: hexColor(input.iconColor),
    label: markerLabel(input.label),
    revealedToPlayers: input.revealedToPlayers === true,
    pageIds: idArray(input.pageIds),
    subMapId: optionalId(input.subMapId),
    sceneIds: idArray(input.sceneIds),
    actorId: optionalId(input.actorId),
    tags: tags(input.tags),
    isParty: false,
    createdAt: now,
    updatedAt: now
  };
  write(db, () => insertMarker(db, marker));
  return getMarker(db, marker.id)!;
}

export function updateMarker(db: CodexDb, markerId: string, input: CodexMarkerUpdateInput): CodexMarkerRow {
  const existing = getMarker(db, markerId);
  if (!existing) throw new CodexNotFoundError("That marker no longer exists.");
  const next = {
    x: input.x === undefined ? existing.x : coord(input.x),
    y: input.y === undefined ? existing.y : coord(input.y),
    iconId: input.iconId === undefined ? existing.iconId : iconId(input.iconId),
    iconColor: input.iconColor === undefined ? existing.iconColor : hexColor(input.iconColor),
    label: input.label === undefined ? existing.label : markerLabel(input.label),
    revealedToPlayers: input.revealedToPlayers ?? existing.revealedToPlayers,
    pageIds: input.pageIds === undefined ? existing.pageIds : idArray(input.pageIds),
    subMapId: input.subMapId === undefined ? existing.subMapId : optionalId(input.subMapId),
    sceneIds: input.sceneIds === undefined ? existing.sceneIds : idArray(input.sceneIds),
    actorId: input.actorId === undefined ? existing.actorId : optionalId(input.actorId),
    tags: input.tags === undefined ? existing.tags : tags(input.tags)
  };
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_markers SET x = ?, y = ?, icon_id = ?, icon_color = ?, label = ?, revealed = ?, page_ids_json = ?, sub_map_id = ?, scene_ids_json = ?, actor_id = ?, tags_json = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        next.x,
        next.y,
        next.iconId,
        next.iconColor,
        next.label,
        next.revealedToPlayers ? 1 : 0,
        JSON.stringify(next.pageIds),
        next.subMapId,
        JSON.stringify(next.sceneIds),
        next.actorId,
        JSON.stringify(next.tags),
        stamp(db),
        markerId
      );
    indexMarker(db, markerId, next.label, next.tags);
  });
  return getMarker(db, markerId)!;
}

/** The drag path: position only. */
export function moveMarker(db: CodexDb, markerId: string, x: number, y: number): CodexMarkerRow {
  if (!markerRow(db, markerId)) throw new CodexNotFoundError("That marker no longer exists.");
  write(db, () => {
    db.database
      .prepare("UPDATE codex_markers SET x = ?, y = ?, updated_at = ? WHERE id = ?")
      .run(coord(x), coord(y), stamp(db), markerId);
  });
  return getMarker(db, markerId)!;
}

export function setMarkerRevealed(db: CodexDb, markerId: string, revealed: boolean): CodexMarkerRow {
  if (!markerRow(db, markerId)) throw new CodexNotFoundError("That marker no longer exists.");
  write(db, () => {
    db.database
      .prepare("UPDATE codex_markers SET revealed = ?, updated_at = ? WHERE id = ?")
      .run(revealed ? 1 : 0, stamp(db), markerId);
  });
  return getMarker(db, markerId)!;
}

/** Leaf delete. */
export function deleteMarker(db: CodexDb, markerId: string): void {
  unindex(db, "marker", markerId);
  db.database.prepare("DELETE FROM codex_markers WHERE id = ?").run(markerId);
}

/** Leaf write: a deleted page leaves every pin that linked it, so no pin points at nothing. */
export function unlinkPageFromMarkers(db: CodexDb, pageId: string): void {
  // `json_group_array` over no rows is NULL, hence the COALESCE.
  db.database
    .prepare(
      "UPDATE codex_markers SET page_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(codex_markers.page_ids_json) WHERE value != ?), '[]'), updated_at = ? WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.page_ids_json) WHERE value = ?)"
    )
    .run(pageId, stamp(db), pageId);
}

export function getMarker(db: CodexDb, markerId: string): CodexMarkerRow | null {
  const row = markerRow(db, markerId);
  return row ? toMarker(row) : null;
}

export function listMarkers(db: CodexDb, mapId: string): CodexMarkerRow[] {
  if (!isId(mapId)) return [];
  return (
    db.database
      .prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE map_id = ? ORDER BY created_at`)
      .all(mapId) as MarkerRowRaw[]
  ).map(toMarker);
}

/** Pins linking this page. Ungated: `projectPlayerPageMarker` is the only gate. */
export function markersForPage(db: CodexDb, pageId: string): CodexMarkerRow[] {
  if (!isId(pageId)) return [];
  return (
    db.database
      .prepare(
        `SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.page_ids_json) WHERE value = ?) ORDER BY created_at`
      )
      .all(pageId) as MarkerRowRaw[]
  ).map(toMarker);
}

/** The location pin linked to a prepared scene, if any: a logged fight is pinned there. */
export function markerForScene(db: CodexDb, sceneId: string): CodexMarkerRow | null {
  if (!isId(sceneId)) return null;
  const row = db.database
    .prepare(
      `SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.scene_ids_json) WHERE value = ?) ORDER BY updated_at DESC, created_at DESC LIMIT 1`
    )
    .get(sceneId) as MarkerRowRaw | undefined;
  return row ? toMarker(row) : null;
}

/** Sets the party pin atlas-wide (`null` clears). Reveal state is untouched: `isParty` is in no visibility rule. */
export function setPartyMarker(db: CodexDb, markerId: string | null): CodexMarkerRow | null {
  if (markerId !== null && !markerRow(db, markerId)) throw new CodexNotFoundError("That marker no longer exists.");
  write(db, () => {
    // Clear first: with the partial unique index, setting first fails.
    db.database.prepare("UPDATE codex_markers SET is_party = 0 WHERE is_party = 1").run();
    if (markerId !== null) db.database.prepare("UPDATE codex_markers SET is_party = 1 WHERE id = ?").run(markerId);
  });
  return markerId === null ? null : getMarker(db, markerId);
}

/** Ungated; `projectPlayerPageMarker` is the gate. */
export function partyMarker(db: CodexDb): CodexMarkerRow | null {
  const row = db.database.prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE is_party = 1 LIMIT 1`).get() as
    MarkerRowRaw | undefined;
  return row ? toMarker(row) : null;
}
