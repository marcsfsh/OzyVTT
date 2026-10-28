/**
 * The saved-data half of ADR-0041: names the app sent and stored for a "scene" are named for the encounter now.
 * The stores' numbered migrations call these once on everything they saved before the rename. Frozen with those
 * migrations: a later rename gets its own helper rather than a change here.
 */

const KEYS: Readonly<Record<string, string>> = {
  sceneId: "encounterId",
  sceneIds: "encounterIds",
  activeSceneId: "activeEncounterId",
  replaySceneId: "replayEncounterId",
  sceneName: "encounterName",
  fightEndedAt: "endedAt"
};

const COMMANDS = new Set([
  "activate",
  "create",
  "set-combatants",
  "set-initiative-defaults",
  "rename",
  "remove",
  "reorder",
  "duplicate",
  "preview"
]);

/** A copy of a saved JSON value with every scene-named key renamed, at any depth. `scenes` is renamed only as the
 *  combat's list, the one place it named prepared encounters. */
export function renameEncounterKeys(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => renameEncounterKeys(item));
  if (value === null || typeof value !== "object") return value;
  const renamed: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const name = key === "scenes" && parentKey === "combat" ? "encounters" : (KEYS[key] ?? key);
    renamed[name] = renameEncounterKeys(child, key);
  }
  return renamed;
}

/** The same, for a JSON document stored as text. */
export function renameEncounterJson(json: string): string {
  return JSON.stringify(renameEncounterKeys(JSON.parse(json)));
}

/** A saved command type or socket event under its new name: `scene.activate` is `encounter.activate`. */
export function renameEncounterCommand(type: string): string {
  if (type === "sound.set-scene-preset" || type === "sound:set-scene-preset") return type.replace("scene", "encounter");
  const match = /^scene([.:])(.+)$/.exec(type);
  return match && COMMANDS.has(match[2]!) ? `encounter${match[1]}${match[2]}` : type;
}

/** A saved integration scope under its new name. */
export function renameEncounterScope(scope: string): string {
  return scope === "scene:read" ? "encounter:read" : scope === "scene:write" ? "encounter:write" : scope;
}
