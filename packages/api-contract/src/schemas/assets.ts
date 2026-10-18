import { z } from "zod";

/**
 * The image and sound libraries' HTTP shapes: map assets with their catalog entries and grid calibration, token
 * images and the GM's sound files. The routers parse their bodies with these, and the route registry documents them.
 */

/** Calibration and scale are versioned with the grid tools, so the document shows them as objects. */
const opaqueObject = () => z.custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null);
const timestamp = () => z.iso.datetime();

/** An uploaded file's id: a UUID derived from its bytes, so the same file always gets the same one. */
export const AssetIdSchema = z.uuid({ version: "v5" });

// ----- Map assets -----

export const MapKindSchema = z.enum(["battlemap", "regional", "world"]);
export type MapKind = z.infer<typeof MapKindSchema>;

/** One map's catalog entry: the GM's name for it, its kind and folder, and its grid. */
export const MapCatalogEntrySchema = z.strictObject({
  assetId: z.uuid(),
  name: z.string(),
  kind: MapKindSchema,
  folder: z.string().nullable().describe("The map library folder this map is filed under; null when it is unfiled."),
  calibration: opaqueObject().nullable(),
  scale: opaqueObject().nullable(),
  createdAt: timestamp(),
  updatedAt: timestamp()
});

/** A map image as the map routes report it: the stored file's facts, with its catalog entry's name, filing and grid. */
export const PublicMapAssetSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  kind: MapKindSchema,
  folder: z.string().nullable().describe("The map library folder this map is filed under; null when it is unfiled."),
  originalName: z.string(),
  format: z.string(),
  mediaType: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  byteLength: z.number().int().min(1),
  importedAt: timestamp(),
  calibration: MapCatalogEntrySchema.shape.calibration,
  scale: MapCatalogEntrySchema.shape.scale,
  updatedAt: timestamp()
});

/** A point in the map image's own pixels. */
export const ImagePointSchema = z.object({ x: z.number(), y: z.number() }).strict();

export const MapUploadQuerySchema = z.object({
  filename: z.string().optional(),
  name: z.string().optional(),
  kind: MapKindSchema.optional(),
  folder: z
    .string()
    .optional()
    .describe("The folder to file the map in: one level, up to 60 characters. Absent or empty files it in none.")
});

export const MapDetailsRequestSchema = z
  .object({
    name: z.string().optional(),
    kind: MapKindSchema.optional(),
    folder: z.string().nullable().optional()
  })
  .strict();

export const AssetFolderRenameRequestSchema = z.object({ from: z.string(), to: z.string().nullable() }).strict();

export const MapScaleRequestSchema = z
  .object({ start: ImagePointSchema, end: ImagePointSchema, knownDistance: z.number().positive(), unit: z.string() })
  .strict();

export const MapCalibrationStartRequestSchema = z.union([
  z
    .object({
      start: ImagePointSchema,
      end: ImagePointSchema,
      cellsAcross: z.literal(3),
      cellsDown: z.literal(3),
      distancePerCell: z.number().positive().optional()
    })
    .strict(),
  z
    .object({
      start: ImagePointSchema,
      end: ImagePointSchema,
      cellsBetween: z.number().int(),
      axis: z.enum(["horizontal", "vertical"]),
      distancePerCell: z.number().positive().optional()
    })
    .strict()
]);

export const MapCalibrationActionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("adjust"),
      adjustment: z
        .object({
          originDelta: ImagePointSchema.optional(),
          cellSizeDeltaPx: z.number().optional(),
          rotationDeltaRadians: z.number().optional(),
          distancePerCell: z.number().positive().optional()
        })
        .strict()
    })
    .strict(),
  z.object({ action: z.literal("undo") }).strict(),
  z.object({ action: z.literal("redo") }).strict(),
  z
    .object({
      action: z.literal("verify"),
      imagePoint: ImagePointSchema,
      tolerancePx: z.number().positive().optional()
    })
    .strict()
]);

export const MapCalibrationWizardDataSchema = z.strictObject({
  wizardId: z.uuid(),
  state: opaqueObject(),
  overlay: z.array(opaqueObject()),
  overlayWarning: z.string().nullable()
});

// ----- Token images -----

/** A token image as the token routes list it: the stored file's facts with its catalog name, folder and shelf state. */
export const TokenAssetSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  folder: z.string().nullable(),
  mediaType: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  byteLength: z.number().int().min(1),
  importedAt: timestamp(),
  lastUsedAt: timestamp().nullable(),
  hidden: z.boolean()
});

/** A token image's catalog entry, as an edit answers it. */
export const TokenCatalogEntrySchema = z.strictObject({
  assetId: z.uuid(),
  name: z.string(),
  folder: z.string().nullable(),
  createdAt: timestamp(),
  lastUsedAt: timestamp().nullable(),
  hidden: z.boolean()
});

export const TokenUploadQuerySchema = z.object({
  filename: z.string().optional(),
  name: z.string().optional(),
  folder: z.string().optional()
});

export const TokenListQuerySchema = z.object({ definitionId: z.string().optional() });

export const TokenDetailsRequestSchema = z
  .object({ name: z.string().optional(), folder: z.string().nullable().optional(), hidden: z.boolean().optional() })
  .strict();

export const TokenFolderVisibilityRequestSchema = z
  .object({ folder: z.string().nullable(), hidden: z.boolean() })
  .strict();

// ----- Sound files -----

/** A sound in the GM's library as the sound routes report it: the stored file's facts and the GM's name for it. */
export const PublicSoundAssetSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  originalName: z.string(),
  format: z.enum(["mp3", "aac", "m4a", "ogg", "wav", "webm", "flac"]),
  codec: z.enum(["mp3", "aac", "vorbis", "opus", "pcm", "flac"]),
  mediaType: z.string(),
  durationMs: z.number().int().min(1),
  byteLength: z.number().int().min(1),
  importedAt: timestamp(),
  updatedAt: timestamp()
});

export const SoundUploadQuerySchema = z.object({ filename: z.string().optional(), name: z.string().optional() });

export const SoundRenameRequestSchema = z.object({ name: z.string() }).strict();
