import { z } from "zod";
import { MAP_ASSET_PATHS, SOUND_ASSET_PATHS, TOKEN_ASSET_PATHS } from "../index.js";
import {
  AssetFolderRenameRequestSchema,
  AssetIdSchema,
  MapCalibrationActionRequestSchema,
  MapCalibrationStartRequestSchema,
  MapCalibrationWizardDataSchema,
  MapCatalogEntrySchema,
  MapDetailsRequestSchema,
  MapScaleRequestSchema,
  MapUploadQuerySchema,
  PublicMapAssetSchema,
  PublicSoundAssetSchema,
  SoundRenameRequestSchema,
  SoundUploadQuerySchema,
  TokenAssetSchema,
  TokenCatalogEntrySchema,
  TokenDetailsRequestSchema,
  TokenFolderVisibilityRequestSchema,
  TokenListQuerySchema,
  TokenUploadQuerySchema
} from "../schemas/assets.js";
import { named } from "./components.js";
import { binary, bytes, defineRoute, GM_SESSION, json, noBody, ok, refused } from "./define.js";

/**
 * The image and sound libraries (`map-http.ts`, `token-http.ts`, `sound-http.ts`). Files are content-addressed:
 * the same bytes get the same id, and uploading them again answers the stored file.
 */

const assetId = (what: string) => z.object({ id: AssetIdSchema.describe(`The ${what}'s id, derived from its bytes.`) });
const RANGES =
  "Answers with an ETag (a matching `If-None-Match` gets a 304) and serves byte ranges (206, or 416 for a range outside the file). Every answer carries `Cache-Control: private, no-store`, since access can end at any time.";
const CONTENT_RESPONSES = (what: string) => ({
  206: noBody("Part of the file, for a byte-range request."),
  304: noBody("Not modified: the ETag sent in `If-None-Match` is still current."),
  400: refused("The id is malformed."),
  401: refused(),
  403: refused(`This caller may not load this ${what} now.`),
  404: refused(),
  416: noBody("The requested range is outside the file.")
});

const FolderRenamedSchema = named("AssetFolderRenamedData", z.strictObject({ renamed: z.literal(true) }));
named("AssetFolderRenameRequest", AssetFolderRenameRequestSchema);

// ----- Map assets -----

const MapAssetUploadDataSchema = named(
  "MapAssetUploadData",
  z.strictObject({
    asset: PublicMapAssetSchema,
    duplicate: z.boolean().describe("True when these bytes were already stored and no copy was made.")
  })
);
const MapAssetListDataSchema = named("MapAssetListData", z.strictObject({ assets: z.array(PublicMapAssetSchema) }));
const MapAssetDataSchema = named("MapAssetData", z.strictObject({ asset: PublicMapAssetSchema }));
const MapCatalogEntryDataSchema = named("MapCatalogEntryData", z.strictObject({ map: MapCatalogEntrySchema }));
const MapGridDataSchema = named(
  "MapGridData",
  z.strictObject({
    calibration: z
      .custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null)
      .nullable()
      .describe(
        "The map's square grid: its origin, cell size and rotation in image pixels. Null on an uncalibrated map."
      )
  })
);
named("MapDetailsRequest", MapDetailsRequestSchema);
named("MapScaleRequest", MapScaleRequestSchema);
named("MapCalibrationStartRequest", MapCalibrationStartRequestSchema);
named("MapCalibrationActionRequest", MapCalibrationActionRequestSchema);
named("MapCalibrationWizardData", MapCalibrationWizardDataSchema);

export const uploadMapAsset = defineRoute({
  method: "post",
  path: MAP_ASSET_PATHS.collection,
  operationId: "uploadMapAsset",
  tag: "Map assets",
  summary: "Upload a map image",
  description:
    "Takes the image's bytes as the request body, at most 50 MiB, with its file name, display name, kind and folder as query parameters. The bytes are checked to be a real image. Bytes already stored answer the stored map with `duplicate: true`, which keeps its own name, kind and folder.",
  access: GM_SESSION,
  query: MapUploadQuerySchema,
  body: binary("image/*", "The image file's bytes."),
  responses: {
    200: ok(MapAssetUploadDataSchema, "These bytes were already stored. The stored map."),
    201: ok(MapAssetUploadDataSchema, "The new map."),
    400: refused("The body is not an image this server reads, or the folder is not one level."),
    401: refused(),
    403: refused(),
    413: refused("The file is over 50 MiB.")
  }
});

export const listMapAssets = defineRoute({
  method: "get",
  path: MAP_ASSET_PATHS.collection,
  operationId: "listMapAssets",
  tag: "Map assets",
  summary: "List the map library",
  description: "Every map's file facts with its name, kind, folder, grid and scale, the most recently changed first.",
  access: GM_SESSION,
  responses: {
    200: ok(MapAssetListDataSchema, "Every map."),
    401: refused(),
    403: refused()
  }
});

export const getMapAsset = defineRoute({
  method: "get",
  path: MAP_ASSET_PATHS.byId,
  operationId: "getMapAsset",
  tag: "Map assets",
  summary: "Read one map",
  access: GM_SESSION,
  params: assetId("map"),
  responses: {
    200: ok(MapAssetDataSchema, "The map."),
    400: refused("The id is malformed."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const updateMapAssetDetails = defineRoute({
  method: "patch",
  path: MAP_ASSET_PATHS.byId,
  operationId: "updateMapAssetDetails",
  tag: "Map assets",
  summary: "Rename, retype or refile a map",
  description:
    "Changes the fields sent and leaves the rest. A name is 1 to 120 printable characters. A folder is one level of up to 60 printable characters with no slash, and an empty one or `null` unfiles the map.",
  access: GM_SESSION,
  params: assetId("map"),
  body: json(MapDetailsRequestSchema),
  responses: {
    200: ok(MapCatalogEntryDataSchema, "The map's catalog entry."),
    400: refused("A malformed id or body, a value out of bounds, or an id the library does not hold."),
    401: refused(),
    403: refused()
  }
});

export const renameMapFolder = defineRoute({
  method: "post",
  path: MAP_ASSET_PATHS.foldersRename,
  operationId: "renameMapFolder",
  tag: "Map assets",
  summary: "Rename a map folder",
  description: "Moves every map in folder `from` to folder `to`. A `to` of `null` or an empty one unfiles them.",
  access: GM_SESSION,
  body: json(AssetFolderRenameRequestSchema),
  responses: {
    200: ok(FolderRenamedSchema, "The folder is renamed."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const getMapAssetContent = defineRoute({
  method: "get",
  path: MAP_ASSET_PATHS.content,
  operationId: "getMapAssetContent",
  tag: "Map assets",
  summary: "Load a map's image",
  description: `The original image bytes. The GM may load any map; a player and a paired table screen only a map the table is showing them now. ${RANGES}`,
  access: { gm: true, player: true, viewer: true },
  params: assetId("map"),
  responses: { 200: bytes("image/*", "The whole image."), ...CONTENT_RESPONSES("map") }
});

export const getMapAssetGrid = defineRoute({
  method: "get",
  path: MAP_ASSET_PATHS.grid,
  operationId: "getMapAssetGrid",
  tag: "Map assets",
  summary: "Read a map's grid",
  description:
    "The map's square grid, for previewing measurements, to whoever may load its image. The server still measures every mark itself.",
  access: { gm: true, player: true, viewer: true },
  params: assetId("map"),
  responses: {
    200: ok(MapGridDataSchema, "The grid, or null."),
    400: refused("The id is malformed."),
    401: refused(),
    403: refused("This caller may not load this map now."),
    404: refused()
  }
});

export const setMapAssetScale = defineRoute({
  method: "put",
  path: MAP_ASSET_PATHS.scale,
  operationId: "setMapAssetScale",
  tag: "Map assets",
  summary: "Set a gridless map's scale",
  description: "Derives the map's real-world scale from two points in the image and the known distance between them.",
  access: GM_SESSION,
  params: assetId("map"),
  body: json(MapScaleRequestSchema),
  responses: {
    200: ok(MapCatalogEntryDataSchema, "The map's catalog entry with its new scale."),
    400: refused("A malformed id or body, two points too close together, or an id the library does not hold."),
    401: refused(),
    403: refused()
  }
});

const wizard = z.object({
  id: AssetIdSchema.describe("The map's id, derived from its bytes."),
  wizardId: z.uuid().describe("The calibration session's id.")
});

export const startMapCalibrationWizard = defineRoute({
  method: "post",
  path: MAP_ASSET_PATHS.calibrationWizards,
  operationId: "startMapCalibrationWizard",
  tag: "Map assets",
  summary: "Start calibrating a map's grid",
  description:
    "Starts a calibration session from a drag across a 3 by 3 block of printed cells, or across a known number of cells along one axis. The server holds the session for 30 minutes after its last use, for the GM session that started it. The answer has its id, its state and a preview of the grid lines it would draw.",
  access: GM_SESSION,
  params: assetId("map"),
  body: json(MapCalibrationStartRequestSchema),
  responses: {
    201: ok(MapCalibrationWizardDataSchema, "The new session."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const actOnMapCalibrationWizard = defineRoute({
  method: "post",
  path: MAP_ASSET_PATHS.calibrationWizardActions,
  operationId: "actOnMapCalibrationWizard",
  tag: "Map assets",
  summary: "Adjust a grid calibration",
  description:
    "Applies one step to a calibration session: nudge the grid, undo, redo, or check one grid intersection against the image. Only the GM session that started the session may act on it.",
  access: GM_SESSION,
  params: wizard,
  body: json(MapCalibrationActionRequestSchema),
  responses: {
    200: ok(MapCalibrationWizardDataSchema, "The session after the step."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("No session by that id is open on this map for this GM session.")
  }
});

export const completeMapCalibrationWizard = defineRoute({
  method: "post",
  path: MAP_ASSET_PATHS.calibrationWizardComplete,
  operationId: "completeMapCalibrationWizard",
  tag: "Map assets",
  summary: "Save a grid calibration",
  description:
    "Saves the session's grid to the map and closes the session. A checked intersection is saved with it; checking one is optional.",
  access: GM_SESSION,
  params: wizard,
  responses: {
    200: ok(MapCatalogEntryDataSchema, "The map's catalog entry with its grid."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("No session by that id is open on this map for this GM session.")
  }
});

// ----- Token images -----

const TokenAssetUploadDataSchema = named(
  "TokenAssetUploadData",
  z.strictObject({
    token: TokenAssetSchema,
    duplicate: z.boolean().describe("True when these bytes were already stored and no copy was made.")
  })
);
const TokenAssetListDataSchema = named(
  "TokenAssetListData",
  z.strictObject({
    tokens: z.array(TokenAssetSchema),
    rememberedAssetId: z
      .uuid()
      .nullable()
      .describe(
        "The image last used for the stat block named by `definitionId`. Null without one, and always null for a player: that memory is the GM's prep."
      )
  })
);
const TokenAssetDataSchema = named("TokenAssetData", z.strictObject({ token: TokenCatalogEntrySchema }));
const TokenRemovedSchema = named("TokenAssetRemovedData", z.strictObject({ removed: z.literal(true) }));
const TokenFolderVisibilityDataSchema = named(
  "TokenFolderVisibilityData",
  z.strictObject({ folder: z.string().nullable(), hidden: z.boolean() })
);
named("TokenDetailsRequest", TokenDetailsRequestSchema);
named("TokenFolderVisibilityRequest", TokenFolderVisibilityRequestSchema);

export const uploadTokenAsset = defineRoute({
  method: "post",
  path: TOKEN_ASSET_PATHS.collection,
  operationId: "uploadTokenAsset",
  tag: "Token assets",
  summary: "Upload a token image",
  description:
    "Takes the image's bytes as the request body, at most 6 MiB, with its file name, display name and folder as query parameters. A player may upload too: a player's upload lands in the Player uploads folder whatever the query says, and one player session may upload 20 images a day. Bytes already stored answer the stored image with `duplicate: true`.",
  access: { gm: true, player: true },
  query: TokenUploadQuerySchema,
  body: binary("image/*", "The image file's bytes."),
  responses: {
    200: ok(TokenAssetUploadDataSchema, "These bytes were already stored. The stored image."),
    201: ok(TokenAssetUploadDataSchema, "The new image."),
    400: refused("The body is not an image this server reads."),
    401: refused(),
    403: refused("A GM preview of the players' view only reads."),
    413: refused("The file is over 6 MiB."),
    429: refused("This player session has uploaded 20 images today.")
  }
});

export const listTokenAssets = defineRoute({
  method: "get",
  path: TOKEN_ASSET_PATHS.collection,
  operationId: "listTokenAssets",
  tag: "Token assets",
  summary: "List the token library",
  description:
    "The token images to choose from. A player's list leaves out the images and folders the GM has hidden from the shelf.",
  access: { gm: true, player: true },
  query: TokenListQuerySchema,
  responses: {
    200: ok(TokenAssetListDataSchema, "The token images."),
    401: refused(),
    403: refused("A GM preview of the players' view only reads.")
  }
});

export const updateTokenAsset = defineRoute({
  method: "patch",
  path: TOKEN_ASSET_PATHS.byId,
  operationId: "updateTokenAsset",
  tag: "Token assets",
  summary: "Rename, refile or hide a token image",
  description:
    "Changes the fields sent and leaves the rest. A hidden image stays in the GM's library and leaves the players' shelf.",
  access: GM_SESSION,
  params: assetId("token image"),
  body: json(TokenDetailsRequestSchema),
  responses: {
    200: ok(TokenAssetDataSchema, "The image's catalog entry."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const deleteTokenAsset = defineRoute({
  method: "delete",
  path: TOKEN_ASSET_PATHS.byId,
  operationId: "deleteTokenAsset",
  tag: "Token assets",
  summary: "Delete a token image",
  description: "Removes the image and its file. Deleting one that is gone changes nothing.",
  access: GM_SESSION,
  params: assetId("token image"),
  responses: {
    200: ok(TokenRemovedSchema, "The image is gone."),
    400: refused("The id is malformed."),
    401: refused(),
    403: refused()
  }
});

export const renameTokenFolder = defineRoute({
  method: "post",
  path: TOKEN_ASSET_PATHS.foldersRename,
  operationId: "renameTokenFolder",
  tag: "Token assets",
  summary: "Rename a token folder",
  description: "Moves every image in folder `from` to folder `to`. A `to` of `null` or an empty one unfiles them.",
  access: GM_SESSION,
  body: json(AssetFolderRenameRequestSchema),
  responses: {
    200: ok(FolderRenamedSchema, "The folder is renamed."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const setTokenFolderVisibility = defineRoute({
  method: "post",
  path: TOKEN_ASSET_PATHS.foldersVisibility,
  operationId: "setTokenFolderVisibility",
  tag: "Token assets",
  summary: "Hide or show a token folder",
  description:
    "Hides every image in a folder from the players' shelf, or offers them again. `null` names the unfiled images.",
  access: GM_SESSION,
  body: json(TokenFolderVisibilityRequestSchema),
  responses: {
    200: ok(TokenFolderVisibilityDataSchema, "The folder and its new state."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const getTokenAssetContent = defineRoute({
  method: "get",
  path: TOKEN_ASSET_PATHS.content,
  operationId: "getTokenAssetContent",
  tag: "Token assets",
  summary: "Load a token image",
  description:
    "The image's bytes. The GM may load any image; a player only one a creature in that player's view wears, and a paired table screen one the screen shows. Answers with an ETag (a matching `If-None-Match` gets a 304) and `Cache-Control: private, no-store`.",
  access: { gm: true, player: true, viewer: true },
  params: assetId("token image"),
  responses: {
    200: bytes("image/*", "The image."),
    304: noBody("Not modified: the ETag sent in `If-None-Match` is still current."),
    400: refused("The id is malformed."),
    401: refused(),
    403: refused("This caller may not load this image now."),
    404: refused()
  }
});

// ----- Sound files -----

const SoundAssetUploadDataSchema = named(
  "SoundAssetUploadData",
  z.strictObject({
    sound: PublicSoundAssetSchema,
    duplicate: z.boolean().describe("True when these bytes were already stored and no copy was made.")
  })
);
const SoundAssetListDataSchema = named(
  "SoundAssetListData",
  z.strictObject({ sounds: z.array(PublicSoundAssetSchema) })
);
const SoundAssetDataSchema = named("SoundAssetData", z.strictObject({ sound: PublicSoundAssetSchema }));
const SoundAssetDeletedDataSchema = named("SoundAssetDeletedData", z.strictObject({ deleted: z.literal(true) }));
named("SoundRenameRequest", SoundRenameRequestSchema);

export const uploadSoundAsset = defineRoute({
  method: "post",
  path: SOUND_ASSET_PATHS.collection,
  operationId: "uploadSoundAsset",
  tag: "Sound assets",
  summary: "Upload a sound file",
  description:
    "Takes one sound file's bytes as the request body, at most 50 MB: MP3, Ogg Vorbis or Opus, WAV, M4A or ADTS AAC, WebM audio, or FLAC. Its file name and display name are query parameters. The format is read from the bytes, whatever the name says, and the file is read far enough to learn its length, so one cut short or holding video is refused. Bytes already stored answer the stored sound with `duplicate: true`.",
  access: GM_SESSION,
  query: SoundUploadQuerySchema,
  body: binary("audio/*", "The sound file's bytes."),
  responses: {
    200: ok(SoundAssetUploadDataSchema, "These bytes were already stored. The stored sound."),
    201: ok(SoundAssetUploadDataSchema, "The new sound."),
    400: refused("The body is not a sound file this server plays."),
    401: refused(),
    403: refused(),
    413: refused("The file is over 50 MB.")
  }
});

export const listSoundAssets = defineRoute({
  method: "get",
  path: SOUND_ASSET_PATHS.collection,
  operationId: "listSoundAssets",
  tag: "Sound assets",
  summary: "List the sound library",
  description: "Every sound's name, format and length.",
  access: GM_SESSION,
  responses: {
    200: ok(SoundAssetListDataSchema, "Every sound."),
    401: refused(),
    403: refused()
  }
});

export const renameSoundAsset = defineRoute({
  method: "patch",
  path: SOUND_ASSET_PATHS.byId,
  operationId: "renameSoundAsset",
  tag: "Sound assets",
  summary: "Rename a sound",
  description: "A name is 1 to 120 printable characters.",
  access: GM_SESSION,
  params: assetId("sound"),
  body: json(SoundRenameRequestSchema),
  responses: {
    200: ok(SoundAssetDataSchema, "The renamed sound."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const deleteSoundAsset = defineRoute({
  method: "delete",
  path: SOUND_ASSET_PATHS.byId,
  operationId: "deleteSoundAsset",
  tag: "Sound assets",
  summary: "Delete a sound",
  description:
    "Deletes a sound from the library. It is first taken off the sound board and every encounter's sound, and stops if it is playing.",
  access: GM_SESSION,
  params: assetId("sound"),
  responses: {
    200: ok(SoundAssetDeletedDataSchema, "The sound is gone."),
    400: refused("The id is malformed."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const getSoundAssetContent = defineRoute({
  method: "get",
  path: SOUND_ASSET_PATHS.content,
  operationId: "getSoundAssetContent",
  tag: "Sound assets",
  summary: "Load a sound file",
  description: `The sound file's bytes. The GM may load any sound, and a paired table screen only one playing on it now; a player never. ${RANGES}`,
  access: { gm: true, viewer: true },
  params: assetId("sound"),
  responses: { 200: bytes("audio/*", "The whole file."), ...CONTENT_RESPONSES("sound") }
});

export const MAP_ASSET_ROUTES = [
  uploadMapAsset,
  listMapAssets,
  getMapAsset,
  updateMapAssetDetails,
  renameMapFolder,
  getMapAssetContent,
  getMapAssetGrid,
  setMapAssetScale,
  startMapCalibrationWizard,
  actOnMapCalibrationWizard,
  completeMapCalibrationWizard
] as const;
export const TOKEN_ASSET_ROUTES = [
  uploadTokenAsset,
  listTokenAssets,
  updateTokenAsset,
  deleteTokenAsset,
  renameTokenFolder,
  setTokenFolderVisibility,
  getTokenAssetContent
] as const;
export const SOUND_ASSET_ROUTES = [
  uploadSoundAsset,
  listSoundAssets,
  renameSoundAsset,
  deleteSoundAsset,
  getSoundAssetContent
] as const;
