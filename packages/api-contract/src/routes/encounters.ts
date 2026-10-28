import { z } from "zod";
import {
  ENCOUNTER_ARCHIVE_PATHS,
  EncounterArchiveDeletedSchema,
  EncounterArchiveDocumentSchema,
  EncounterArchiveListSchema,
  EncounterArchiveNameRequestSchema,
  EncounterArchiveNameSchema,
  EncounterArchiveVisibilityRequestSchema,
  EncounterArchiveVisibilitySchema
} from "../index.js";
import { defineRoute, gmGrade, json, ok, refused } from "./define.js";

/**
 * Permanent records of ended fights (`game-http.ts`). The GM-grade reads hold the full state; a player reads only a
 * replay the GM shared, rebuilt from an allow-list. Launching a moment onto the table is the `replay.launch`
 * command, generated with the others.
 */

/** An archive's id: the integer the archive was stored under. */
export const EncounterArchiveIdParamsSchema = z.object({
  id: z.coerce.number().int().min(1).max(999_999_999_999).describe("The archive's id.")
});

const NOT_SHARED = "An archive the caller may not read is a 404, the same as one that does not exist.";

export const listEncounterArchives = defineRoute({
  method: "get",
  path: ENCOUNTER_ARCHIVE_PATHS.collection,
  operationId: "listReplays",
  tag: "Replays",
  summary: "List the recorded encounters",
  description:
    "Every recorded encounter, newest first. A GM-grade caller sees all of them; a player session sees only the ones the GM shared (`playerVisible`), each without the encounter's name.",
  access: { gm: true, player: true, scope: "combat:read" },
  responses: {
    200: ok(EncounterArchiveListSchema, "The recorded encounters."),
    401: refused(),
    403: refused()
  }
});

export const getEncounterArchive = defineRoute({
  method: "get",
  path: ENCOUNTER_ARCHIVE_PATHS.byId,
  operationId: "getReplay",
  tag: "Replays",
  summary: "Read one recorded encounter",
  description: `One archive, projected for the caller. A GM-grade caller receives the stored document (archiveSchemaVersion 3): the full state at each turn, the combat log, the command journal, the final state and the state after the encounter, every die roll and the stat blocks used. A player session receives a replay built for players: each turn's player projection and the public rolls, with no journal, raw state, stat block or session id. ${NOT_SHARED}`,
  access: { gm: true, player: true, scope: "combat:read" },
  params: EncounterArchiveIdParamsSchema,
  responses: {
    200: ok(EncounterArchiveDocumentSchema, "The archive, or its player replay."),
    400: refused("The id is not a positive integer."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const deleteEncounterArchive = defineRoute({
  method: "delete",
  path: ENCOUNTER_ARCHIVE_PATHS.byId,
  operationId: "deleteReplay",
  tag: "Replays",
  summary: "Delete a recorded encounter",
  description: "Deletes one archive for good. A GM session, or a credential with the `admin` scope.",
  access: gmGrade("admin"),
  params: EncounterArchiveIdParamsSchema,
  responses: {
    200: ok(EncounterArchiveDeletedSchema, "The archive is gone."),
    400: refused("The id is not a positive integer."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const setEncounterArchiveVisibility = defineRoute({
  method: "post",
  path: ENCOUNTER_ARCHIVE_PATHS.visibility,
  operationId: "setReplayVisibility",
  tag: "Replays",
  summary: "Share a recorded encounter with players",
  description:
    "Shares one archive with players, or takes it back. An ended encounter is the GM's record until the GM shares it. Sharing lists it in a player's `GET /replays` and lets `GET /replays/{id}` answer them with the player replay; taking it back removes both.",
  access: gmGrade("combat:write"),
  params: EncounterArchiveIdParamsSchema,
  body: json(EncounterArchiveVisibilityRequestSchema, { example: { playerVisible: true } }),
  responses: {
    200: ok(EncounterArchiveVisibilitySchema, "The archive's sharing."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const renameEncounterArchive = defineRoute({
  method: "post",
  path: ENCOUNTER_ARCHIVE_PATHS.name,
  operationId: "renameReplay",
  tag: "Replays",
  summary: "Name a recorded encounter",
  description:
    "Gives one archive the GM's own name, up to 80 characters. Null or an empty name takes it away, and the replay is called by its encounter and date again. A player sees the name on a replay the GM shared, and never the encounter's.",
  access: gmGrade("combat:write"),
  params: EncounterArchiveIdParamsSchema,
  body: json(EncounterArchiveNameRequestSchema, { example: { name: "The bridge ambush" } }),
  responses: {
    200: ok(EncounterArchiveNameSchema, "The archive's name."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const ENCOUNTER_ROUTES = [
  listEncounterArchives,
  getEncounterArchive,
  deleteEncounterArchive,
  setEncounterArchiveVisibility,
  renameEncounterArchive
] as const;
