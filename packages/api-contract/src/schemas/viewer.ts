import { z } from "zod";
import { ScreenSoundSchema } from "@vtt/domain";

/**
 * The table screen's HTTP shapes (`viewer-http.ts`): pairing, the paired screens, and the GM's presentation commands.
 * The router parses its bodies with these, and the route registry documents them.
 */

const timestamp = () => z.iso.datetime();

/** A paired table screen, or the GM's preview of one. Never carries the screen's secret. */
export const ViewerAccessMetadataSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  createdAt: timestamp(),
  expiresAt: timestamp().nullable(),
  lastUsedAt: timestamp().nullable(),
  revokedAt: timestamp().nullable()
});

/** A one-time code a table screen exchanges for its viewer credential. */
export const ViewerPairingSchema = z.strictObject({ code: z.string(), expiresAt: timestamp() });

/** What a table screen shows while it waits for the GM: its six-digit code and when the code runs out. */
export const ScreenPairingSchema = z.strictObject({ code: z.string().regex(/^[0-9]{6}$/), expiresAt: timestamp() });

/** A table screen connected right now, under the viewer credential it paired with, and whether it can play sound. */
export const ViewerConnectionMetadataSchema = z.strictObject({
  connectionId: z.string(),
  viewerId: z.uuid(),
  name: z.string(),
  connectedAt: timestamp(),
  sound: ScreenSoundSchema
});

export const ViewerPairingRequestSchema = z.object({ ttlMs: z.number().int().optional() }).strict();

export const ViewerPairingExchangeRequestSchema = z
  .object({ code: z.string(), name: z.string(), expiresInMs: z.number().int().positive().nullable().optional() })
  .strict();

export const ScreenPairingApproveRequestSchema = z
  .object({
    code: z.string().max(32).describe("The code the screen shows."),
    name: z
      .string()
      .optional()
      .describe("What to call the screen, up to 100 printable characters. Default: Table screen.")
  })
  .strict();

/** A screen's word on its own sound: `blocked` until someone taps it, `muted` for the GM's silent preview. */
export const ViewerSoundStatusRequestSchema = z
  .object({ sound: z.enum(["on", "blocked", "muted"]), unplayable: z.array(z.uuid()).max(20).default([]) })
  .strict();

const PointSchema = z.object({ x: z.number(), y: z.number() }).strict();
const CameraSchema = z.object({ center: PointSchema, zoom: z.number() }).strict();
const InitiativeSchema = z
  .object({
    visible: z.boolean(),
    round: z.number().int().nonnegative(),
    hiddenTurn: z.boolean().default(false),
    entries: z
      .array(z.object({ actorId: z.string(), name: z.string(), initiative: z.number(), active: z.boolean() }).strict())
      .max(200)
  })
  .strict();
const EncounterSceneSchema = z
  .object({
    mapAssetId: z.string().nullable(),
    tokens: z
      .array(
        z
          .object({
            actorId: z.string(),
            name: z.string(),
            kind: z.enum(["player-character", "monster", "npc"]),
            position: PointSchema,
            sizePx: z.number().positive(),
            active: z.boolean()
          })
          .strict()
      )
      .max(200)
  })
  .strict();
const ViewerCommandPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("viewer.enabled.set"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("viewer.presentation.begin"),
      assetId: z.string(),
      altText: z.string(),
      camera: CameraSchema
    })
    .strict(),
  z
    .object({ type: z.literal("viewer.map.set"), assetId: z.string(), altText: z.string(), camera: CameraSchema })
    .strict(),
  z.object({ type: z.literal("viewer.camera.set"), camera: CameraSchema }).strict(),
  z
    .object({
      type: z.literal("viewer.measurement.set"),
      measurement: z.object({ id: z.string(), points: z.array(PointSchema), distanceLabel: z.string() }).strict()
    })
    .strict(),
  z.object({ type: z.literal("viewer.measurement.clear") }).strict(),
  z
    .object({
      type: z.literal("viewer.ping"),
      id: z.string(),
      point: PointSchema,
      label: z.string().optional(),
      durationMs: z.number().int().optional()
    })
    .strict(),
  z.object({ type: z.literal("viewer.initiative.set"), initiative: InitiativeSchema }).strict(),
  z
    .object({ type: z.literal("viewer.encounter.set"), initiative: InitiativeSchema, encounter: EncounterSceneSchema })
    .strict()
]);
export const ViewerCommandRequestSchema = z
  .object({
    id: z.string(),
    expectedRevision: z.number().int().nonnegative().optional(),
    payload: ViewerCommandPayloadSchema
  })
  .strict();
