import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { createServer } from "../src/server.js";

/**
 * Characters built through the real builder against the shipped catalog, at a table with one foe, for the
 * equipment rules: what a player equips, and what the engine then does with it.
 */

export const library = new ContentLibrary().forAudience("gm");
export const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});

export const IDS = {
  fighter: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  wizard: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d11",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

type Input = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & {
  choices: Array<CharacterCreateRequestInput["choices"][number]>;
};

/** Fighter 5 (Champion), Str 19 Dex 13, the Defense fighting style; `kit` picks the class equipment option. */
export const fighterInput = (kit: "fighter-a" | "fighter-b" | "fighter-c" = "fighter-a"): Input =>
  ({
    name: "Borin",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "fighter",
    level: 5,
    subclassId: "champion",
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      {
        level: 1,
        classId: "fighter",
        kind: "fighting-style",
        id: "defense",
        payload: { featureId: "fighting-style" }
      },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
      { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
      { level: 4, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: kit },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as Input;

/** Wizard 3, Str 10 Dex 14, no armor or shield training. */
export const wizardInput = (): Input =>
  ({
    name: "Ilyana",
    speciesId: "elf",
    backgroundId: "sage",
    classId: "wizard",
    level: 3,
    subclassId: "evoker",
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "int", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
      { level: 1, classId: "wizard", kind: "skill", id: "insight" },
      { level: 1, kind: "skill", id: "perception", payload: { featureId: "elf-keen-senses" } },
      { level: 1, kind: "lineage", id: "high-elf" },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "elf-lineage" } },
      { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
      { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
      { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
      { level: 3, kind: "spell", id: "thunderwave", payload: { featureId: "evocation-savant" } },
      { level: 1, kind: "cantrip", id: "fire-bolt" },
      { level: 1, kind: "cantrip", id: "light" },
      { level: 1, kind: "cantrip", id: "mage-hand" },
      { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile" },
      { level: 1, kind: "spell", id: "mage-armor" },
      { level: 1, kind: "spell", id: "detect-magic" },
      { level: 2, kind: "spell", id: "misty-step" },
      { level: 1, kind: "equipment", id: "wizard-a" },
      { level: 1, kind: "equipment", id: "sage-a" }
    ]
  }) as Input;

export type Table = Readonly<{
  state: GameState;
  resolve: (definitionId: string) => ActorDefinition | undefined;
  actor: (actorId: string) => GameState["actors"][number];
  definition: (actorId: string) => ActorDefinition;
}>;

/** A table holding the given built characters (keyed by actor id) and, with `foe`, an AC 10 monster. */
export function tableOf(characters: Readonly<Record<string, Input>>, foe = true): Table {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  for (const [actorId, input] of Object.entries(characters)) {
    importActorDefinition(state, buildCharacterDefinition(input, library, policy), actorId, "public", catalog);
  }
  if (foe)
    state.actors.push(
      GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          {
            id: IDS.foe,
            name: "Foe",
            kind: "monster",
            visibility: "public",
            hp: { current: 60, maximum: 60 },
            armorClass: 10
          }
        ]
      }).actors[0]
    );
  const resolve = (definitionId: string) => storedDefinition(state, definitionId);
  return {
    state,
    resolve,
    actor: (actorId) => state.actors.find((candidate) => candidate.id === actorId)!,
    definition: (actorId) => storedDefinition(state, `import-${actorId}`)!
  };
}

/** The row the sheet's catalog picker sends for one record. */
export function catalogRow(id: string, over: Partial<InventoryItem> = {}): InventoryItem {
  const record = library.equipmentRecord(id)!;
  return InventoryItemSchema.parse({
    id,
    name: record.name,
    quantity: 1,
    equipped: true,
    attuned: false,
    category: record.category,
    ...over
  });
}

/** Writes one row as the given role would. A player attunes or ends attunement during a Short Rest, as the rules
 *  ask, so a write that changes it is made in one. */
export function write(table: Table, actorId: string, item: InventoryItem, role: "gm" | "player" = "player"): void {
  const stored = table.state.actors.find((actor) => actor.id === actorId)?.inventory.find((row) => row.id === item.id);
  const rest = table.state.rest;
  if (role === "player" && item.attuned !== (stored?.attuned ?? false))
    table.state.rest = { ...rest, shortRest: { actorIds: [actorId], done: [] } };
  try {
    setInventoryItem(table.state, actorId, item, table.resolve, { catalog, role });
  } finally {
    table.state.rest = rest;
  }
}

/** The stored row, changed by `over` (Equip, Attune, quantity). */
export function edit(table: Table, actorId: string, id: string, over: Partial<InventoryItem>): InventoryItem {
  const row = table.actor(actorId).inventory.find((entry) => entry.id === id);
  if (!row) throw new Error(`no ${id} row`);
  return { ...row, ...over };
}

/** Starts a fight with `actorId` on turn and the foe 5 feet away (unmeasured: no map distances). */
export function fight(table: Table, actorId: string): void {
  startEncounter(
    table.state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
}

/** The effective action with this id, as the resolver would read it, else the generic action of that id. */
export function actionOf(table: Table, actorId: string, actionId: string) {
  const action =
    effectiveActions(table.definition(actorId), table.actor(actorId), catalog).find((entry) => entry.id === actionId) ??
    builtinActionFor(table.definition(actorId), actionId, table.actor(actorId));
  if (!action) throw new Error(`no ${actionId} action`);
  return action;
}

/** Whether the action with this id is a generic one, which the resolver takes with its special cases. */
const isBuiltin = (table: Table, actorId: string, actionId: string) =>
  !effectiveActions(table.definition(actorId), table.actor(actorId), catalog).some((entry) => entry.id === actionId);

let command = 0;
/** Resolves one action at the foe with queued dice faces; `distanceFeet` puts every pair of combatants that far apart. */
export function resolveAt(
  table: Table,
  actorId: string,
  actionId: string,
  faces: number[],
  input: Partial<ResolveInput> = {},
  distanceFeet?: number
) {
  let roll = 0;
  command += 1;
  const deps: ResolveDependencies = {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-${String(command).padStart(6, "0")}${String(roll++).padStart(6, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-10-16T00:00:00.000Z",
    definition: table.definition(actorId),
    catalog,
    resolveDefinition: table.resolve,
    ...(distanceFeet !== undefined ? { distanceFeet: () => distanceFeet } : {})
  };
  return resolveDefinitionAction(
    table.state,
    actionOf(table, actorId, actionId),
    {
      actorId,
      targetIds: [IDS.foe],
      commandId: `50000000-0000-4000-8000-${String(command).padStart(12, "0")}`,
      ...(isBuiltin(table, actorId, actionId) ? { builtin: true } : {}),
      ...input
    },
    deps
  );
}

/** A real server holding the table's state, for commands only the HTTP route runs; `close` cleans it up. */
export async function serve(table: Table) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-equipment-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: table.state
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const close = async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  };
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("The server did not bind.");
  const post = (path: string, token: string, body: object) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  const log = async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}${GAME_PATHS.log}`, {
      headers: { authorization: `Bearer ${gmToken}` }
    });
    return ((await response.json()).data.entries as ReadonlyArray<{ text: string }>).map((entry) => entry.text);
  };
  return { server, gmToken, post, log, close };
}
