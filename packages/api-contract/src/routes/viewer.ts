import { z } from "zod";
import { VIEWER_PAIRING_COOKIE, VIEWER_PATHS, VIEWER_SESSION_COOKIE } from "../index.js";
import {
  ScreenPairingApproveRequestSchema,
  ScreenPairingSchema,
  ViewerAccessMetadataSchema,
  ViewerCommandRequestSchema,
  ViewerConnectionMetadataSchema,
  ViewerPairingExchangeRequestSchema,
  ViewerPairingRequestSchema,
  ViewerPairingSchema,
  ViewerSoundStatusRequestSchema
} from "../schemas/viewer.js";
import { named } from "./components.js";
import { defineRoute, GM_SESSION, json, ok, PUBLIC, refused, stream } from "./define.js";

/**
 * The shared table screen (`viewer-http.ts`, ADR-0028). A screen pairs once and then reads the presentation, the
 * player-safe projection of what the table shows, through its HttpOnly viewer cookie.
 */

const ViewerPairingDataSchema = named("ViewerPairingData", z.strictObject({ pairing: ViewerPairingSchema }));
const ViewerSessionDataSchema = named("ViewerSessionData", z.strictObject({ viewer: ViewerAccessMetadataSchema }));
const ViewerAccessListDataSchema = named(
  "ViewerAccessListData",
  z.strictObject({
    viewers: z.array(ViewerAccessMetadataSchema).describe("Every paired screen and preview, revoked ones included."),
    connections: z.array(ViewerConnectionMetadataSchema).describe("The screens connected right now.")
  })
);
const ViewerPresentationDataSchema = named(
  "ViewerPresentationData",
  z.strictObject({
    presentation: z
      .record(z.string(), z.unknown())
      .describe(
        "The player-safe presentation: the map, camera, measurement, pings, initiative and encounter scene, what the sound board plays, and `latestRoll`: the newest public roll by a creature the table can see, made since the screen last changed what it shows and within ten minutes (who, what, total, dice, modifier), or null. The event stream sends the same shape."
      )
  })
);
const ViewerCommandDataSchema = named(
  "ViewerCommandData",
  z.strictObject({
    revision: z.number().int().min(0).describe("The presentation's revision after the command."),
    duplicate: z.boolean().describe("True when this command id was already applied, so nothing changed.")
  })
);
const ViewerSoundStatusDataSchema = named("ViewerSoundStatusData", z.strictObject({ received: z.literal(true) }));
named("ViewerConnection", ViewerConnectionMetadataSchema);
named("ViewerPairingRequest", ViewerPairingRequestSchema);
named("ViewerPairingExchangeRequest", ViewerPairingExchangeRequestSchema);
named("ViewerCommandRequest", ViewerCommandRequestSchema);
named("ViewerSoundStatusRequest", ViewerSoundStatusRequestSchema);
named("ScreenPairing", ScreenPairingSchema);
named("ScreenPairingApproveRequest", ScreenPairingApproveRequestSchema);
const ScreenPairingOpenDataSchema = named("ScreenPairingOpenData", z.strictObject({ pairing: ScreenPairingSchema }));
const ScreenPairingStatusDataSchema = named(
  "ScreenPairingStatusData",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("waiting"), pairing: ScreenPairingSchema }),
    z.strictObject({ status: z.literal("paired"), viewer: ViewerAccessMetadataSchema })
  ])
);
const ScreenPairingApproveDataSchema = named(
  "ScreenPairingApproveData",
  z.strictObject({ approved: z.strictObject({ name: z.string() }) })
);

export const createViewerPairing = defineRoute({
  method: "post",
  path: VIEWER_PATHS.pairings,
  operationId: "createViewerPairing",
  tag: "Table viewer",
  summary: "Issue a pairing code",
  description:
    "Issues a one-time code a table screen exchanges for its viewer credential. It lasts 5 minutes unless `ttlMs` asks for less, down to 30 seconds.",
  access: GM_SESSION,
  body: json(ViewerPairingRequestSchema, { required: false }),
  responses: {
    201: ok(ViewerPairingDataSchema, "The code and when it runs out."),
    400: refused("A malformed body, a lifetime out of bounds, or too many codes open at once."),
    401: refused(),
    403: refused()
  }
});

export const exchangeViewerPairing = defineRoute({
  method: "post",
  path: VIEWER_PATHS.pairingsExchange,
  operationId: "exchangeViewerPairing",
  tag: "Table viewer",
  summary: "Exchange a pairing code for a screen credential",
  description: `Sets an HttpOnly, SameSite=Strict \`${VIEWER_SESSION_COOKIE}\` cookie for the screen. The code is the credential, so the request carries none. Wrong codes are counted, and after too many in a short time every attempt is refused for a while.`,
  access: PUBLIC,
  body: json(ViewerPairingExchangeRequestSchema),
  responses: {
    201: ok(ViewerSessionDataSchema, "The screen is paired and its cookie is set."),
    400: refused(),
    401: refused("The code is wrong or has run out."),
    429: refused("Too many wrong codes in a short time.")
  }
});

export const openScreenPairing = defineRoute({
  method: "post",
  path: VIEWER_PATHS.screenPairings,
  operationId: "openScreenPairing",
  tag: "Table viewer",
  summary: "Ask to pair this screen",
  description: `A table screen asks to pair. It gets a six-digit code to show, which lasts ten minutes, and an HttpOnly \`${VIEWER_PAIRING_COOKIE}\` cookie that holds the request's secret. The GM types the code on their own device to let the screen in.`,
  access: PUBLIC,
  responses: {
    201: ok(ScreenPairingOpenDataSchema, "The code to show."),
    429: refused("Too many screens are asking to pair. Try again in a minute.")
  }
});

export const getScreenPairing = defineRoute({
  method: "get",
  path: VIEWER_PATHS.screenPairingsCurrent,
  operationId: "getScreenPairing",
  tag: "Table viewer",
  summary: "Check whether this screen is let in",
  description: `The screen's poll, read from its \`${VIEWER_PAIRING_COOKIE}\` cookie: still waiting with its code, or paired. Pairing sets the \`${VIEWER_SESSION_COOKIE}\` cookie and closes the request, so it pairs once.`,
  access: PUBLIC,
  responses: {
    200: ok(ScreenPairingStatusDataSchema, "Waiting, or paired."),
    404: refused("This screen has no open request.")
  }
});

export const approveScreenPairing = defineRoute({
  method: "post",
  path: VIEWER_PATHS.screenPairingsApprove,
  operationId: "approveScreenPairing",
  tag: "Table viewer",
  summary: "Let in the screen showing a code",
  description:
    "Lets in the screen showing this code, under the name given (Table screen by default). It pairs on its next poll. Wrong codes count toward the pairing limit.",
  access: GM_SESSION,
  body: json(ScreenPairingApproveRequestSchema, { example: { code: "042917", name: "Living room TV" } }),
  responses: {
    200: ok(ScreenPairingApproveDataSchema, "The screen is let in."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("No screen is showing that code."),
    429: refused("Too many wrong codes.")
  }
});

export const listViewerAccess = defineRoute({
  method: "get",
  path: VIEWER_PATHS.access,
  operationId: "listViewerAccess",
  tag: "Table viewer",
  summary: "List the paired screens",
  description: "Every paired screen and the GM's previews, and which screens are connected now.",
  access: GM_SESSION,
  responses: {
    200: ok(ViewerAccessListDataSchema, "The paired screens and the connected ones."),
    401: refused(),
    403: refused()
  }
});

export const revokeViewerAccess = defineRoute({
  method: "delete",
  path: VIEWER_PATHS.accessById,
  operationId: "revokeViewerAccess",
  tag: "Table viewer",
  summary: "Revoke a paired screen",
  description: "Revokes one paired screen and closes its event stream at once.",
  access: GM_SESSION,
  params: z.object({ id: z.uuid().describe("The paired screen's id.") }),
  responses: {
    200: ok(ViewerSessionDataSchema, "The revoked screen."),
    400: refused("The id names no paired screen."),
    401: refused(),
    403: refused()
  }
});

export const createViewerPreviewSession = defineRoute({
  method: "post",
  path: VIEWER_PATHS.previewSession,
  operationId: "createViewerPreviewSession",
  tag: "Table viewer",
  summary: "Preview the table screen",
  description:
    "Sets a viewer cookie for the GM's own preview of the shared screen, good for 12 hours. It reads the presentation as a paired screen does.",
  access: GM_SESSION,
  responses: {
    201: ok(ViewerSessionDataSchema, "The preview's cookie is set."),
    401: refused(),
    403: refused()
  }
});

export const getViewerPresentation = defineRoute({
  method: "get",
  path: VIEWER_PATHS.presentation,
  operationId: "getViewerPresentation",
  tag: "Table viewer",
  summary: "Read what the table screen shows",
  description:
    "The player-safe presentation: the map, camera, measurement, pings, initiative and encounter scene, what the sound board plays, and the latest public roll. Nothing is shown while the GM has paused the screen.",
  access: { gm: true, viewer: true },
  responses: {
    200: ok(ViewerPresentationDataSchema, "The presentation."),
    401: refused(),
    403: refused()
  }
});

export const sendViewerPresentationCommand = defineRoute({
  method: "post",
  path: VIEWER_PATHS.presentationCommands,
  operationId: "sendViewerPresentationCommand",
  tag: "Table viewer",
  summary: "Change what the table screen shows",
  description:
    "One presentation command: switch the screen on or off, present a map, move the camera, set or clear a measurement, ping, or set the initiative and encounter scene. A repeated command id changes nothing, and a stale `expectedRevision` is a 409.",
  access: GM_SESSION,
  body: json(ViewerCommandRequestSchema),
  responses: {
    200: ok(ViewerCommandDataSchema, "The command is applied."),
    400: refused(),
    401: refused(),
    403: refused(),
    409: refused("`expectedRevision` is stale.")
  }
});

export const reportViewerSoundStatus = defineRoute({
  method: "post",
  path: VIEWER_PATHS.soundStatus,
  operationId: "reportViewerSoundStatus",
  tag: "Table viewer",
  summary: "Report whether this screen can play sound",
  description:
    "A paired table screen says whether its browser lets it play sound yet (`blocked` until someone taps it, `muted` for the GM's silent preview) and which sounds it could not play. The GM's sound board shows it.",
  access: { viewer: true },
  body: json(ViewerSoundStatusRequestSchema, { example: { sound: "blocked", unplayable: [] } }),
  responses: {
    200: ok(ViewerSoundStatusDataSchema, "Received."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const streamViewerPresentation = defineRoute({
  method: "get",
  path: VIEWER_PATHS.events,
  operationId: "streamViewerPresentation",
  tag: "Table viewer",
  summary: "Follow the table screen's presentation",
  description:
    "A Server-Sent Events stream: each `presentation` event carries the presentation as `GET /viewer/presentation` answers it, and a comment every 15 seconds keeps the connection open. It closes when the screen is revoked.",
  access: { gm: true, viewer: true },
  responses: {
    200: stream("text/event-stream", "The stream of `presentation` events."),
    401: refused(),
    403: refused()
  }
});

export const VIEWER_ROUTES = [
  createViewerPairing,
  exchangeViewerPairing,
  openScreenPairing,
  getScreenPairing,
  approveScreenPairing,
  listViewerAccess,
  revokeViewerAccess,
  createViewerPreviewSession,
  getViewerPresentation,
  sendViewerPresentationCommand,
  reportViewerSoundStatus,
  streamViewerPresentation
] as const;
