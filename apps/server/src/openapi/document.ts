import {
  API_NAMESPACE,
  API_VERSION,
  CODEX_ASSET_PATHS,
  CODEX_PATHS,
  CONTENT_PATHS,
  ENCOUNTER_ARCHIVE_PATHS,
  GAME_PATHS,
  HOMEBREW_PATHS,
  HOST_PATHS,
  HomebrewContentStateSchema,
  HomebrewContentTypeSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  MAP_ASSET_PATHS,
  OPENAPI_DOCUMENT_PATH,
  SESSION_PATHS,
  SOUND_ASSET_PATHS,
  SYSTEM_PATHS,
  VIEWER_PAIRING_COOKIE,
  VIEWER_PATHS,
  VIEWER_SESSION_COOKIE
} from "@vtt/api-contract";
import { generatedDocs } from "./components.js";
import { gameSecurity, gameSecurityWithPlayer, mutationResponses } from "./game-commands.js";

const generated = generatedDocs();

const envelopeSchema = (dataRef: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["ok", "apiVersion", "data"],
  properties: {
    ok: { const: true },
    apiVersion: { const: API_VERSION },
    data: { $ref: dataRef }
  }
});

// Builders for the live-game operations, which share one response/security shape.
const apiError = { $ref: "#/components/responses/ApiError" } as const;
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const jsonBody = (schemaRef: string, required = true) => ({
  required,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } }
});

/** A bundled-content catalog read: public SRD rules reference, so it also accepts a player session. The bestiary
 * is the exception and uses the GM-only `gameSecurity`. */
const contentCatalogOperation = (operationId: string, description: string, responseRef: string) => ({
  operationId,
  security: gameSecurityWithPlayer("game:read"),
  description,
  responses: {
    "200": {
      description: "Catalog entries",
      content: { "application/json": { schema: { $ref: `#/components/schemas/${responseRef}` } } }
    },
    "401": apiError,
    "403": apiError
  }
});

/** Identity ids are open slugs, never closed enums, so homebrew stays additive. */
const contentSlug = { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 } as const;

// Codex operation builders. An integration credential acts at GM grade, as on the game surface; a player-grade
// bot uses a player session token from `POST /api/v1/sessions/player`.
const codexJson = (schemaRef: string) => ({
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } }
});
/** Writes: a GM session, or a `codex:write` credential. There is no player write anywhere in the Codex. */
const codexWrite = [{ bearerAuth: ["codex:write"] }, { gmAuth: [] }] as const;
/** Role-projected reads: GM session, `codex:read` credential (GM grade), or player session (revealed-only). */
const codexRead = [{ bearerAuth: ["codex:read"] }, { gmAuth: [] }, { playerAuth: [] }] as const;
/** GM-grade reads (folders, revision history, settings, the reveal audit, export): no player branch. */
const codexGmRead = [{ bearerAuth: ["codex:read"] }, { gmAuth: [] }] as const;
/** No credential branch: `POST /codex/preview-session` mints a real player session token, and only the GM's own UI
 * needs it (to preview the player Codex). */
const codexGmSessionOnly = [{ gmAuth: [] }] as const;
// Reusable codex schema fragments for the envelopes.
const codexUuid = { type: "string", format: "uuid" } as const;
const codexNullableUuid = { type: ["string", "null"], format: "uuid" } as const;
const codexInWorldDateOrNull = {
  oneOf: [{ $ref: "#/components/schemas/CodexInWorldDate" }, { type: "null" }]
} as const;
const codexArrayRef = (schemaRef: string) => ({ type: "array", items: { $ref: `#/components/schemas/${schemaRef}` } });
const codexDataObject = (key: string, valueSchema: unknown) => ({
  type: "object",
  additionalProperties: false,
  required: [key],
  properties: { [key]: valueSchema }
});
/**
 * A role-projected read: `Codex<X>` for a GM-grade caller, `Codex<X>Player` for a player session. Each branch is
 * `additionalProperties: false` with every key required, and the GM branch requires a key the player branch
 * does not declare, so exactly one branch matches (`test/contract.test.ts` checks this for every pair). The
 * rule is one-sided because several player shapes are strict key-subsets of their GM twin.
 */
const codexProjected = (base: string) => ({
  description: `Role-projected. A GM session or a \`codex:read\` credential receives \`${base}\`; a player session receives \`${base}Player\`, the revealed-only projection. Exactly one branch matches any response body.`,
  oneOf: [{ $ref: `#/components/schemas/${base}` }, { $ref: `#/components/schemas/${base}Player` }]
});
/**
 * One codex operation. `bad`/`notFound`/`conflict` select the error responses the route can return; `notModified`
 * marks a GET that answers conditional requests. 401 and 403 are always documented because every route accepts a
 * bearer credential. `conflict` takes a description because only one kind of codex 409 carries
 * `error.currentRevision`.
 */
const codexOp = (
  operationId: string,
  security: readonly unknown[],
  okRef: string,
  options: {
    ok?: string;
    params?: readonly unknown[];
    body?: string;
    description?: string;
    bad?: boolean;
    notFound?: boolean;
    conflict?: string;
    notModified?: boolean;
    tooLarge?: boolean;
  } = {}
) => ({
  operationId,
  security,
  ...(options.description ? { description: options.description } : {}),
  ...(options.params ? { parameters: options.params } : {}),
  ...(options.body ? { requestBody: { required: true, ...codexJson(options.body) } } : {}),
  responses: {
    [options.ok ?? "200"]: { description: "Success", ...codexJson(okRef) },
    ...(options.notModified
      ? { "304": { description: "Not modified - the weak `ETag` you sent as `If-None-Match` is still current." } }
      : {}),
    ...(options.bad === false ? {} : { "400": apiError }),
    "401": apiError,
    "403": apiError,
    ...(options.notFound ? { "404": apiError } : {}),
    ...(options.conflict
      ? {
          "409": {
            description: options.conflict,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } }
          }
        }
      : {}),
    ...(options.tooLarge ? { "413": apiError } : {})
  }
});

// Homebrew operation builders. Unlike codexOp, security is fixed (the surface is GM-only) and `conflict` takes a
// description so each route documents what its own 409 carries.
const homebrewGmOnly = [{ gmAuth: [] }] as const;
const homebrewJson = (schemaRef: string) => ({
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } }
});
/** A persisted homebrew id, capped at 60 (not `contentSlug`'s 80): persisted ActorDefinition ids cap at 60 and a
 * longer one would fail `GameStateSchema.parse` on the next boot. */
const homebrewId = { ...contentSlug, maxLength: 60 } as const;
const homebrewIdParam = { name: "id", in: "path", required: true, schema: homebrewId } as const;
const homebrewContentType = { type: "string", enum: HomebrewContentTypeSchema.options } as const;
const homebrewState = { type: "string", enum: HomebrewContentStateSchema.options } as const;
/** One homebrew operation; security is always `homebrewGmOnly`. */
const homebrewOp = (
  operationId: string,
  okRef: string,
  options: {
    ok?: string;
    params?: readonly unknown[];
    body?: string;
    bodyRequired?: boolean;
    description?: string;
    bad?: boolean;
    notFound?: boolean;
    conflict?: string;
    tooLarge?: boolean;
  } = {}
) => ({
  operationId,
  security: homebrewGmOnly,
  ...(options.description ? { description: options.description } : {}),
  ...(options.params ? { parameters: options.params } : {}),
  ...(options.body ? { requestBody: { required: options.bodyRequired ?? true, ...homebrewJson(options.body) } } : {}),
  responses: {
    [options.ok ?? "200"]: { description: "Success", ...homebrewJson(okRef) },
    ...(options.bad === false ? {} : { "400": apiError }),
    "401": apiError,
    // A player session is a valid credential without the role: 403, never 401.
    "403": apiError,
    ...(options.notFound ? { "404": apiError } : {}),
    ...(options.conflict
      ? {
          "409": {
            description: options.conflict,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } }
          }
        }
      : {}),
    ...(options.tooLarge ? { "413": apiError } : {})
  }
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Combat-First VTT Integration API",
    version: API_VERSION,
    // Described per surface: only game writes accept an optional `commandId`; codex and homebrew bodies are strict.
    description:
      "Versioned, recipient-safe integration contract for a self-hosted VTT. Game writes accept an optional `commandId` (UUID) executed exactly once - supply your own and resend it to retry safely, and the server replays the stored outcome with `duplicate: true`; codex JSON-body writes accept one too - a replay carries `x-idempotent-replay: true` - while codex body-less POSTs, codex DELETEs and every homebrew write carry none and rely on `expectedRev` plus their own conflict rules instead. Stale-revision writes are rejected with 409 + `error.currentRevision` (`expectedRevision` targets the global game revision; `expectedRev` targets one record's revision). A missing, malformed, expired or revoked credential is 401; a valid credential without the role or scope is 403 (ADR-0027); and the existence of a secret record always reads as 404."
  },
  servers: [{ url: API_NAMESPACE }],
  paths: {
    [SYSTEM_PATHS.health]: {
      get: {
        operationId: "getSystemHealth",
        security: [],
        responses: {
          "200": {
            description: "Server is live",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SystemHealthResponse" } } }
          }
        }
      }
    },
    [SYSTEM_PATHS.version]: {
      get: {
        operationId: "getSystemVersion",
        security: [],
        responses: {
          "200": {
            description: "Public protocol versions",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SystemVersionResponse" } } }
          }
        }
      }
    },
    [SYSTEM_PATHS.capabilities]: {
      get: {
        operationId: "getSystemCapabilities",
        security: [{ bearerAuth: ["system:read"] }],
        responses: {
          "200": {
            description: "Authorized server capabilities",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SystemCapabilitiesResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    // ===== The host's GM account (host-http.ts). Same-origin only: these routes send no CORS headers, so a
    // web page can't relay password guesses. Not reachable with an integration credential. =====
    [HOST_PATHS.setup]: {
      get: {
        operationId: "getHostSetup",
        security: [],
        description: "Whether the GM password has been set on this host.",
        responses: {
          "200": {
            description: "The setup state",
            content: { "application/json": { schema: { $ref: "#/components/schemas/HostSetupResponse" } } }
          }
        }
      },
      post: {
        operationId: "setGmPassword",
        security: [],
        description:
          "Sets the first GM password (at least 12 characters). Accepted only from the host machine itself (loopback); refused once a password is set.",
        requestBody: jsonBody("HostPasswordRequest"),
        responses: {
          "201": {
            description: "The password is set",
            content: { "application/json": { schema: { $ref: "#/components/schemas/HostSetupResponse" } } }
          },
          "400": apiError,
          "403": apiError,
          "409": apiError
        }
      }
    },
    [HOST_PATHS.gmSignIn]: {
      post: {
        operationId: "signInGm",
        security: [],
        description:
          "Exchanges the GM password for a GM session token (12 hours). Repeated failures from one address are rate-limited with 429 and Retry-After.",
        requestBody: jsonBody("HostPasswordRequest"),
        responses: {
          "200": {
            description: "A GM session token",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GmSignInResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "429": apiError
        }
      }
    },
    [HOST_PATHS.gmSignOut]: {
      post: {
        operationId: "signOutGm",
        security: [{ gmAuth: [] }],
        description: "Revokes the GM session that sends it.",
        responses: {
          "200": {
            description: "Signed out",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GmSignOutResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [HOST_PATHS.gmRevokeAll]: {
      post: {
        operationId: "revokeAllGmSessions",
        security: [{ gmAuth: [] }],
        description: "Revokes every GM session, this one included.",
        responses: {
          "200": {
            description: "Every GM session revoked",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GmRevokeAllResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [HOST_PATHS.gmPassword]: {
      post: {
        operationId: "changeGmPassword",
        security: [{ gmAuth: [] }],
        description:
          "Replaces the GM password after checking the current one (at least 12 characters). Every GM session issued before the change ends; the response carries a new token for the caller. Failed attempts count toward the sign-in rate limit.",
        requestBody: jsonBody("GmPasswordChangeRequest"),
        responses: {
          "200": {
            description: "The password is changed; a new GM session token",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GmSignInResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "429": apiError
        }
      }
    },
    [HOST_PATHS.joinUrls]: {
      get: {
        operationId: "listJoinUrls",
        security: [{ gmAuth: [] }],
        description:
          "The addresses players open on the home network to join, one per network interface, and the host's own localhost address.",
        responses: {
          "200": {
            description: "Join addresses",
            content: { "application/json": { schema: { $ref: "#/components/schemas/JoinUrlsResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [HOST_PATHS.viewerUrls]: {
      get: {
        operationId: "listViewerUrls",
        security: [{ gmAuth: [] }],
        description: "The addresses a table viewer on the LAN can open, one per configured host address.",
        responses: {
          "200": {
            description: "Viewer addresses",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerUrlsResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [OPENAPI_DOCUMENT_PATH]: {
      get: {
        operationId: "getOpenApiDocument",
        security: [],
        responses: {
          "200": {
            description: "This exact OpenAPI 3.1 document, served from the running instance",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    },
    [INTEGRATION_CREDENTIAL_PATHS.collection]: {
      post: {
        operationId: "createIntegrationCredential",
        security: [{ gmAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateIntegrationCredentialRequest" } }
          }
        },
        responses: {
          "201": {
            description: "Credential created; the token is shown exactly once",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialIssuedResponse" } }
            }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      },
      get: {
        operationId: "listIntegrationCredentials",
        security: [{ gmAuth: [] }],
        responses: {
          "200": {
            description: "Safe metadata for every credential; never includes a secret",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialListResponse" } }
            }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [INTEGRATION_CREDENTIAL_PATHS.rotate]: {
      post: {
        operationId: "rotateIntegrationCredential",
        security: [{ gmAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RotateIntegrationCredentialRequest" } }
          }
        },
        responses: {
          "200": {
            description: "Credential rotated; the new token is shown exactly once",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialIssuedResponse" } }
            }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" },
          "409": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [INTEGRATION_CREDENTIAL_PATHS.revoke]: {
      post: {
        operationId: "revokeIntegrationCredential",
        security: [{ gmAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Credential revoked; access denied immediately",
            content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [INTEGRATION_CREDENTIAL_PATHS.audit]: {
      get: {
        operationId: "getIntegrationCredentialAudit",
        security: [{ gmAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Safe audit history: no secrets, only usage/lifecycle metadata",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialAuditResponse" } }
            }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [MAP_ASSET_PATHS.collection]: {
      post: {
        operationId: "uploadMapAsset",
        security: [{ gmAuth: [] }],
        description:
          "Uploads raw image bytes as the request body. `filename`, `name`, and `kind` (battlemap/regional/world) are query parameters, not a JSON body. Content-addressed: uploading identical bytes again returns the existing asset with `duplicate: true` instead of creating a copy.",
        parameters: [
          { name: "filename", in: "query", schema: { type: "string" } },
          { name: "name", in: "query", schema: { type: "string" } },
          { name: "kind", in: "query", schema: { type: "string", enum: ["battlemap", "regional", "world"] } }
        ],
        requestBody: { required: true, content: { "image/*": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "201": {
            description: "New map asset stored",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetUploadResponse" } } }
          },
          "200": {
            description: "Identical bytes already stored; the existing asset is returned",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetUploadResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "413": { $ref: "#/components/responses/ApiError" }
        }
      },
      get: {
        operationId: "listMapAssets",
        security: [{ gmAuth: [] }],
        responses: {
          "200": {
            description: "Safe metadata for every stored map asset",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetListResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [MAP_ASSET_PATHS.byId]: {
      get: {
        operationId: "getMapAsset",
        security: [{ gmAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Safe metadata for one map asset",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" }
        }
      },
      patch: {
        operationId: "updateMapAssetDetails",
        security: [{ gmAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  kind: { type: "string", enum: ["battlemap", "regional", "world"] }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Updated map catalog entry",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [MAP_ASSET_PATHS.content]: {
      get: {
        operationId: "getMapAssetContent",
        description:
          "Renderer-safe original image bytes. Authorized for the GM, a player in the active encounter on this map, or a paired viewer session (cookie) - any one is sufficient. Supports ETag/If-None-Match (304), byte-range requests (206/416), and is always sent with `Cache-Control: private, no-store` since access can be revoked at any time.",
        security: [{ gmAuth: [] }, { viewerCookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Full image bytes" },
          "206": { description: "Partial content for a byte-range request" },
          "304": { description: "Not modified" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" },
          "416": { description: "Range not satisfiable" }
        }
      }
    },
    [MAP_ASSET_PATHS.scale]: {
      put: {
        operationId: "setMapAssetScale",
        security: [{ gmAuth: [] }],
        description: "Gridless real-world scale, derived from two image points and a known distance.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["start", "end", "knownDistance", "unit"],
                properties: {
                  start: { $ref: "#/components/schemas/ImagePoint" },
                  end: { $ref: "#/components/schemas/ImagePoint" },
                  knownDistance: { type: "number", exclusiveMinimum: 0 },
                  unit: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Updated map catalog entry with the new scale",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [MAP_ASSET_PATHS.calibrationWizards]: {
      post: {
        operationId: "startMapCalibrationWizard",
        security: [{ gmAuth: [] }],
        description:
          "Starts a server-held, TTL-bounded calibration wizard session from either a fixed 3x3 area drag or a known-axis segment measurement, and returns its ID plus a viewport-clipped grid overlay preview.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "201": {
            description: "Wizard session started",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapCalibrationWizardResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [MAP_ASSET_PATHS.calibrationWizardActions]: {
      post: {
        operationId: "actOnMapCalibrationWizard",
        security: [{ gmAuth: [] }],
        description:
          "Applies one adjust/undo/redo/verify action to an in-progress wizard session, owned by the same GM bearer token that started it.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "wizardId", in: "path", required: true, schema: { type: "string", format: "uuid" } }
        ],
        responses: {
          "200": {
            description: "Updated wizard state and overlay",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapCalibrationWizardResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [MAP_ASSET_PATHS.calibrationWizardComplete]: {
      post: {
        operationId: "completeMapCalibrationWizard",
        security: [{ gmAuth: [] }],
        description:
          "Saves the wizard's current calibration to the map catalog and discards the wizard session. Verification is optional reassurance, not a requirement.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "wizardId", in: "path", required: true, schema: { type: "string", format: "uuid" } }
        ],
        responses: {
          "200": {
            description: "Saved calibration",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "404": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [SOUND_ASSET_PATHS.collection]: {
      post: {
        operationId: "uploadSoundAsset",
        security: [{ gmAuth: [] }],
        description:
          "Uploads one sound file as the raw request body (MP3, Ogg Vorbis or Opus, WAV, M4A or ADTS AAC, WebM audio, or FLAC; at most 50 MB). `filename` and `name` are query parameters. The format is read from the bytes, not the name, and the file is walked far enough to read its length and refuse one cut short or holding video. Content-addressed: identical bytes return the existing sound with `duplicate: true`.",
        parameters: [
          { name: "filename", in: "query", schema: { type: "string" } },
          { name: "name", in: "query", schema: { type: "string" } }
        ],
        requestBody: { required: true, content: { "audio/*": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "201": {
            description: "New sound stored",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SoundAssetUploadResponse" } } }
          },
          "200": {
            description: "Identical bytes already stored; the existing sound is returned",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SoundAssetUploadResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "413": apiError
        }
      },
      get: {
        operationId: "listSoundAssets",
        security: [{ gmAuth: [] }],
        description: "The GM's sound library: each sound's name, format and length.",
        responses: {
          "200": {
            description: "Every sound in the library",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SoundAssetListResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [SOUND_ASSET_PATHS.byId]: {
      patch: {
        operationId: "renameSoundAsset",
        security: [{ gmAuth: [] }],
        parameters: [uuidParam("id")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["name"],
                properties: { name: { type: "string", minLength: 1, maxLength: 120 } }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "The renamed sound",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SoundAssetResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      },
      delete: {
        operationId: "deleteSoundAsset",
        security: [{ gmAuth: [] }],
        description:
          "Deletes a sound from the library. It is taken off the sound board and every scene's sound first, and stops if it is playing.",
        parameters: [uuidParam("id")],
        responses: {
          "200": {
            description: "Deleted",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SoundAssetDeletedResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [SOUND_ASSET_PATHS.content]: {
      get: {
        operationId: "getSoundAssetContent",
        description:
          "The sound file's bytes. Authorized for the GM, or for a paired table screen (cookie) only while the sound is playing on it; never for a player. Supports ETag/If-None-Match (304) and byte ranges (206/416), and is sent with `Cache-Control: private, no-store`.",
        security: [{ gmAuth: [] }, { viewerCookieAuth: [] }],
        parameters: [uuidParam("id")],
        responses: {
          "200": { description: "The whole file" },
          "206": { description: "Partial content for a byte-range request" },
          "304": { description: "Not modified" },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError,
          "416": { description: "Range not satisfiable" }
        }
      }
    },
    [VIEWER_PATHS.pairings]: {
      post: {
        operationId: "createViewerPairing",
        security: [{ gmAuth: [] }],
        description:
          "Issues a short-lived, one-time pairing code for a second-screen display to exchange for a session.",
        responses: {
          "201": {
            description: "Pairing code issued",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerPairingResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "429": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.pairingsExchange]: {
      post: {
        operationId: "exchangeViewerPairing",
        security: [],
        description: `Exchanges a pairing code for an HttpOnly, SameSite=Strict \`${VIEWER_SESSION_COOKIE}\` cookie. No request auth: the code itself is the credential.`,
        responses: {
          "201": {
            description: "Paired; session cookie set",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerSessionResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "429": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.screenPairings]: {
      post: {
        operationId: "openScreenPairing",
        security: [],
        description: `A table screen asks to pair. It gets a six-digit code to show and an HttpOnly \`${VIEWER_PAIRING_COOKIE}\` cookie that holds the request's secret. The code lasts ten minutes. Open requests are capped and rate-limited (429).`,
        responses: {
          "201": {
            description: "The code to show",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenPairingOpenResponse" } } }
          },
          "429": apiError
        }
      }
    },
    [VIEWER_PATHS.screenPairingsCurrent]: {
      get: {
        operationId: "getScreenPairing",
        security: [],
        description: `The screen's poll, read from its \`${VIEWER_PAIRING_COOKIE}\` cookie: still waiting with its code, or paired. Pairing sets the \`${VIEWER_SESSION_COOKIE}\` cookie and closes the request, so it pairs once.`,
        responses: {
          "200": {
            description: "Waiting or paired",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenPairingStatusResponse" } } }
          },
          "404": apiError
        }
      }
    },
    [VIEWER_PATHS.screenPairingsApprove]: {
      post: {
        operationId: "approveScreenPairing",
        security: [{ gmAuth: [] }],
        description:
          "Lets in the screen showing this code. A code no screen is showing is a 404. Wrong codes count toward the pairing rate limit (429).",
        requestBody: jsonBody("ScreenPairingApproveRequest"),
        responses: {
          "200": {
            description: "The screen is let in and pairs on its next poll",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenPairingApproveResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError,
          "429": apiError
        }
      }
    },
    [VIEWER_PATHS.access]: {
      get: {
        operationId: "listViewerAccess",
        security: [{ gmAuth: [] }],
        responses: {
          "200": {
            description: "Every paired viewer plus which are currently connected",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerAccessListResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.accessById]: {
      delete: {
        operationId: "revokeViewerAccess",
        security: [{ gmAuth: [] }],
        description: "Revokes one paired display and immediately disconnects its live event stream.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Revoked",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerSessionResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.presentation]: {
      get: {
        operationId: "getViewerPresentation",
        security: [{ gmAuth: [] }, { viewerCookieAuth: [] }],
        responses: {
          "200": {
            description:
              "Current player-safe presentation state (map, camera, measurement, pings, initiative, encounter, and what the sound board is playing)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerPresentationResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.presentationCommands]: {
      post: {
        operationId: "sendViewerPresentationCommand",
        security: [{ gmAuth: [] }],
        description:
          "GM-only optimistic-concurrency command (present/pause map, set camera, ping, set/clear measurement). `expectedRevision` mismatches return 409.",
        responses: {
          "200": {
            description: "Command applied",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerCommandResponse" } } }
          },
          "400": { $ref: "#/components/responses/ApiError" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" },
          "409": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.previewSession]: {
      post: {
        operationId: "createViewerPreviewSession",
        security: [{ gmAuth: [] }],
        description:
          "Sets a read-only viewer cookie for the GM's own preview of the shared screen. It reads the presentation like a paired display.",
        responses: {
          "201": {
            description: "Preview cookie set",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerSessionResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [VIEWER_PATHS.soundStatus]: {
      post: {
        operationId: "reportViewerSoundStatus",
        security: [{ viewerCookieAuth: [] }],
        description:
          "A paired table screen says whether its browser lets it play sound yet (`blocked` until someone taps it; `muted` for the GM's silent preview) and which sounds it could not play. The GM's sound board shows it.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["sound"],
                properties: {
                  sound: { type: "string", enum: ["on", "blocked", "muted"] },
                  unplayable: { type: "array", maxItems: 20, items: { type: "string", format: "uuid" } }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Received",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerSoundStatusResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError
        }
      }
    },
    [VIEWER_PATHS.events]: {
      get: {
        operationId: "streamViewerPresentation",
        security: [{ viewerCookieAuth: [] }],
        description:
          "Server-Sent Events stream of presentation updates for a paired viewer session; not a normal JSON response.",
        responses: {
          "200": { description: "text/event-stream of `presentation` events" },
          "401": { $ref: "#/components/responses/ApiError" },
          "403": { $ref: "#/components/responses/ApiError" }
        }
      }
    },
    [GAME_PATHS.snapshot]: {
      get: {
        operationId: "getGameSnapshot",
        security: gameSecurityWithPlayer("game:read"),
        description:
          "The authoritative game state, projected for the caller: GM sessions and integration credentials get the full GM view (hidden combatants, notes, turn-history metadata) unless `view=player` asks for the player-safe projection; player session tokens always get the player-safe view. Sends a weak ETag derived from the revision - poll with If-None-Match for cheap 304s (presence and timed-annotation expiry do not bump the revision, so re-fetch when you need those fresh).",
        parameters: [
          { name: "view", in: "query", required: false, schema: { type: "string", enum: ["gm", "player"] } }
        ],
        responses: {
          "200": {
            description: "The projected game state, with `revision` for optimistic concurrency and polling",
            headers: { ETag: { schema: { type: "string" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/GameSnapshotResponse" } } }
          },
          "304": { description: "Unchanged since the revision in If-None-Match" },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [GAME_PATHS.sound]: {
      get: {
        operationId: "getSoundBoard",
        security: gameSecurity("scene:read"),
        description:
          "The sound board (GM-grade only): the playlist, ambient layers, effect pads and scene sounds, what is playing and from when (on `serverTime`'s clock), and each connected table screen's sound state. Players are never sent any of it; table screens receive only what is playing, through the viewer event stream.",
        responses: {
          "200": {
            description: "The board",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SoundBoardResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [GAME_PATHS.log]: {
      get: {
        operationId: "getCombatLog",
        security: gameSecurityWithPlayer("combat:read"),
        description:
          "The persistent combat log, oldest first. GM sessions and integration credentials receive GM-only lines; player sessions only public ones.",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 1000, default: 250 }
          }
        ],
        responses: {
          "200": {
            description: "Chronological log entries",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GameLogResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError
        }
      }
    },
    [GAME_PATHS.builderOffers]: {
      get: {
        operationId: "getBuilderOffers",
        security: gameSecurityWithPlayer("game:read"),
        description:
          "What the content asks a character-builder draft to pick, worked out by the same survey `POST /game/characters` validates against, so a builder offers exactly what a create accepts. Each offer names its builder step, its options (named, with spell levels), its capacity after every feature that raises it, the level its rows are stamped with (one offer per grant level, so each Ability Score Improvement is its own), and the options this build cannot usefully take. The reply also carries the answers the build still accepts (an answer it no longer offers is dropped) and the ledger rows they make, which a create sends as `choices`. Send the answers by offer key, or a stored ledger as `choices` to read a character back for a rebuild. A multiclass draft adds `classLevels`, the class each level went to (index 0 is level 1, the starting class); a later class's own picks are filed under keys suffixed with its id (`class-cantrips:wizard`) and stamped with the level it reached them at. The GM always; a player session while the table's builder policy lets players build.",
        parameters: [
          {
            name: "draft",
            in: "query",
            required: true,
            description: "The draft, JSON-encoded.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/BuilderOffersDraft" } } }
          }
        ],
        responses: {
          "200": {
            description: "The draft's offers, its accepted answers, and their ledger rows",
            content: { "application/json": { schema: { $ref: "#/components/schemas/BuilderOffersResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "409": apiError
        }
      }
    },
    [GAME_PATHS.commands]: {
      get: {
        operationId: "listGameCommands",
        security: gameSecurityWithPlayer("system:read"),
        description:
          "The full catalog of command types accepted by the tunnel, each with the credential scope it requires.",
        responses: {
          "200": {
            description: "Supported command types",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GameCommandCatalogResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      },
      post: {
        operationId: "submitGameCommand",
        security: [{ bearerAuth: [] }, { gmAuth: [] }, { playerAuth: [] }],
        description:
          "Generic command tunnel: submits any cataloged command type with its Socket.IO payload shape, dispatched through the exact same validation/authorization/execution path as the built-in UI. The required credential scope depends on the type (see the GET catalog). Omit `commandId` to have one minted; resend the same `commandId` to retry idempotently.",
        requestBody: jsonBody("GameCommandEnvelope"),
        responses: { ...mutationResponses, "404": apiError }
      }
    },
    ...generated.paths,
    [GAME_PATHS.actorAvailableActions]: {
      get: {
        operationId: "getActorAvailableActions",
        security: gameSecurityWithPlayer("combat:read"),
        description:
          "Server-computed action availability for one combatant: per stat-block action, whether strict mode would allow resolving it right now, every violated rule (machine-readable rule ids + messages), and the remaining limited uses / open compound-action rolls. Runs the exact evaluation `action.resolve` enforces, so this report can never drift from enforcement. GM-grade any combatant; a player session only their claimed character. Target-specific rules (e.g. grapple targeting) need a target and are not pre-checked here.",
        parameters: [uuidParam("actorId")],
        responses: {
          "200": {
            description: "Per-action availability with explanations",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ActorAvailableActionsResponse" } } }
          },
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [GAME_PATHS.characterDraft]: {
      get: {
        operationId: "getCharacterDraft",
        security: gameSecurityWithPlayer("game:read"),
        description:
          "The caller's parked character build, or null: the wizard's choices so far, as `POST /game/characters/draft/save` left it, and when. A player session reads its own; the GM reads the GM's, whichever device signed in. Nobody reads anyone else's.",
        responses: {
          "200": {
            description: "The caller's parked build",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CharacterDraftResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [GAME_PATHS.actorMovement]: {
      get: {
        operationId: "getActorMovement",
        security: gameSecurityWithPlayer("combat:read"),
        description:
          "How much of this turn's movement a combatant has left: whether a move is counted at all (combat running, its turn, movement rules on), its movement budget after exhaustion, Slow, Dash and the like, the feet already spent, and whether going over is refused or only warned. The same budget `token.move` charges against; a move's cost is the cheapest grid path, with difficult terrain and enemies' spaces costing double. GM-grade any combatant; a player session only their claimed character.",
        parameters: [uuidParam("actorId")],
        responses: {
          "200": {
            description: "The combatant's movement this turn",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ActorMovementResponse" } } }
          },
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [GAME_PATHS.visionPreview]: {
      get: {
        operationId: "previewVision",
        security: gameSecurity("scene:read"),
        description:
          "What one creature sees on the live scene, or with no `actorId` the whole party (ADR-0023): the area as image-pixel polygons (`[x0, y0, x1, y1, ...]`) whose union is what it sees, and the creatures it perceives. The same computation that decides what each player and the table screen receive. GM-grade only; empty while the scene's dynamic vision is off.",
        parameters: [{ name: "actorId", in: "query", required: false, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Where the creature or the party sees now",
            content: { "application/json": { schema: { $ref: "#/components/schemas/VisionPreviewResponse" } } }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [SESSION_PATHS.player]: {
      post: {
        operationId: "issuePlayerSession",
        security: [],
        description:
          "Issues a player session token - the HTTP mirror of the socket's open join, for headless or custom player clients. LAN-trust by design: no credentials required, but the host must have completed GM setup. The token then authenticates player-limited calls across this API.",
        responses: {
          "201": {
            description: "Player session issued",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PlayerSessionIssuedResponse" } } }
          },
          "409": apiError
        }
      }
    },
    [CONTENT_PATHS.monsters]: {
      get: {
        operationId: "listContentMonsters",
        security: gameSecurity("game:read"),
        description: "Browse the bundled SRD bestiary (GM-grade only). Includes the CC BY 4.0 attribution line.",
        responses: {
          "200": {
            description: "Monster summaries + attribution",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContentMonstersResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [CONTENT_PATHS.monsterBenchmarks]: {
      get: {
        operationId: "listContentMonsterBenchmarks",
        security: gameSecurity("game:read"),
        description:
          "What the bundled SRD stat blocks of each challenge rating have (GM-grade only): how many there are, and the lowest, median and highest armor class, hit points, attack bonus, save DC and damage in one turn at average rolls. The homebrew monster wizard compares a new creature against these. Includes the CC BY 4.0 attribution line.",
        responses: {
          "200": {
            description: "Benchmarks by challenge rating + attribution",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ContentMonsterBenchmarksResponse" } }
            }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [CONTENT_PATHS.monsterById]: {
      get: {
        operationId: "getContentMonster",
        security: gameSecurity("game:read"),
        description:
          "One full stat block (GM-grade only). Imported definitions shadow bundled ids, matching the live server's resolution.",
        parameters: [
          {
            name: "definitionId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 200 }
          }
        ],
        responses: {
          "200": {
            description: "The full ActorDefinition",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContentMonsterSheetResponse" } } }
          },
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [CONTENT_PATHS.monsterActions]: {
      get: {
        operationId: "getContentMonsterActions",
        security: gameSecurity("game:read"),
        description:
          "A stat block's actions flattened for running them (GM-grade only): attack bonus, reach/range, save DC, damage formulas, parsed area.",
        parameters: [
          {
            name: "definitionId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 200 }
          }
        ],
        responses: {
          "200": {
            description: "Runnable action summaries",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContentMonsterActionsResponse" } } }
          },
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [CONTENT_PATHS.glossary]: {
      get: {
        operationId: "listContentGlossary",
        security: gameSecurityWithPlayer("game:read"),
        description:
          "The SRD 5.2.1 Rules Glossary, one entry per term with its bracketed tag (public information - any GM, player, or integration session). Includes the CC BY 4.0 attribution line.",
        responses: {
          "200": {
            description: "Rules Glossary entries",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContentGlossaryResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [CONTENT_PATHS.conditions]: {
      get: {
        operationId: "listContentConditions",
        security: gameSecurityWithPlayer("game:read"),
        description:
          "The bundled SRD condition reference (public information - any GM, player, or integration session). Includes the CC BY 4.0 attribution line.",
        responses: {
          "200": {
            description: "Condition reference entries",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContentConditionsResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [CONTENT_PATHS.skills]: {
      get: contentCatalogOperation(
        "listContentSkills",
        "The skill catalog: reference text plus the ability each check uses, as data - the source the builder and sheet read instead of a hardcoded client list, so a homebrew skill is one catalog row. Includes the CC BY 4.0 attribution line.",
        "ContentSkillsResponse"
      )
    },
    [CONTENT_PATHS.languages]: {
      get: contentCatalogOperation(
        "listContentLanguages",
        "The language catalog: the SRD's Standard and Rare language tables as data, each row tagged with the table it is printed in. The builder's \"Common plus two languages\" budget resolves against this - as prose it could not be offered at all. Includes the CC BY 4.0 attribution line.",
        "ContentLanguagesResponse"
      )
    },
    [CONTENT_PATHS.spells]: {
      get: contentCatalogOperation(
        "listContentSpells",
        "The bundled SRD spell list with the fields a sheet needs to cast from: level, school, casting time, range, components, duration, concentration/ritual flags, description, the spell-list tags (`classes`) the builder filters on, and the upcast (`castingOptions`) rows keyed by slot level. Includes the CC BY 4.0 attribution line.",
        "ContentSpellsResponse"
      )
    },
    [CONTENT_PATHS.equipment]: {
      get: contentCatalogOperation(
        "listContentEquipment",
        "The bundled SRD equipment catalog - gear, weapons, and armor folded into one browse-and-add list, with the weapon/armor blocks populated for those categories. Includes the CC BY 4.0 attribution line.",
        "ContentEquipmentResponse"
      )
    },
    [CONTENT_PATHS.classes]: {
      get: contentCatalogOperation(
        "listContentClasses",
        "The character-builder class catalog: hit die, primary abilities, saving-throw and skill proficiency choices, the spellcasting ability where the class has one, and the class features as data. `source` distinguishes bundled SRD records from GM homebrew merged into the same catalog. Includes the CC BY 4.0 attribution line the builder must display.",
        "ContentClassesResponse"
      )
    },
    [CONTENT_PATHS.subclasses]: {
      get: contentCatalogOperation(
        "listContentSubclasses",
        "The character-builder subclass catalog, each keyed to its parent `classId` and the level it unlocks at, with its features as data. Includes the CC BY 4.0 attribution line.",
        "ContentSubclassesResponse"
      )
    },
    [CONTENT_PATHS.species]: {
      get: contentCatalogOperation(
        "listContentSpecies",
        "The character-builder species catalog: creature size, walking speed, and the species traits as data. Includes the CC BY 4.0 attribution line.",
        "ContentSpeciesResponse"
      )
    },
    [CONTENT_PATHS.backgrounds]: {
      get: contentCatalogOperation(
        "listContentBackgrounds",
        "The character-builder background catalog: granted skill/tool proficiencies, languages, starting-equipment prose, and the background feat where one applies. Includes the CC BY 4.0 attribution line.",
        "ContentBackgroundsResponse"
      )
    },
    [CONTENT_PATHS.feats]: {
      get: contentCatalogOperation(
        "listContentFeats",
        "The character-builder feat catalog, with each feat's category and human-readable prerequisite. The server, not the client, is the authority on whether a prerequisite is met. Includes the CC BY 4.0 attribution line.",
        "ContentFeatsResponse"
      )
    },
    [CONTENT_PATHS.names]: {
      get: contentCatalogOperation(
        "listContentNames",
        "Per-species name pools for the builder's random generator. Pool `kind` is an open slug and pool order comes from the data, so new pools are additive. Includes the CC BY 4.0 attribution line.",
        "ContentNamesResponse"
      )
    },
    [ENCOUNTER_ARCHIVE_PATHS.collection]: {
      get: {
        operationId: "listEncounterArchives",
        security: gameSecurity("combat:read"),
        description:
          "Permanent records of ended encounters, newest first. ROLE-AWARE: a GM sees every archive, a player session sees only the ones the GM has shared (`playerVisible`).",
        responses: {
          "200": {
            description: "Archive summaries",
            content: { "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveListResponse" } } }
          },
          "401": apiError,
          "403": apiError
        }
      }
    },
    [ENCOUNTER_ARCHIVE_PATHS.byId]: {
      get: {
        operationId: "getEncounterArchive",
        security: gameSecurity("combat:read"),
        description:
          "One archive, projected for the caller. A GM receives the full machine-readable document (archiveSchemaVersion 3): per-turn full states, combat log, complete per-command journal, final state, the post-encounter aftermath state, all dice rolls, and the stat blocks used. A PLAYER session receives a computed player replay instead - per-turn player projections, public rolls only, no journal, no raw states, no stat blocks, no session ids - and only for an archive the GM has shared; an unshared or missing archive is 404 either way, never 403.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        responses: {
          "200": {
            description: "The stored document, verbatim",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveDocumentResponse" } }
            }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      },
      delete: {
        operationId: "deleteEncounterArchive",
        security: gameSecurity("admin"),
        description: "Permanently deletes one archived encounter (GM session or an admin-scoped credential).",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveDeletedResponse" } }
            }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [ENCOUNTER_ARCHIVE_PATHS.visibility]: {
      post: {
        operationId: "setEncounterArchiveVisibility",
        security: gameSecurity("combat:write"),
        description:
          "Shares (or un-shares) one archived encounter with players (GM sessions and integration credentials only). Hidden by default - an ended fight is the GM's record until the GM says otherwise. Sharing makes the archive appear in a player's `GET /encounters` list and lets `GET /encounters/{id}` answer them with the computed player replay; un-sharing takes both away again.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveVisibilityRequest" } }
          }
        },
        responses: {
          "200": {
            description: "The stored visibility",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveVisibilityResponse" } }
            }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    [ENCOUNTER_ARCHIVE_PATHS.name]: {
      post: {
        operationId: "renameEncounterArchive",
        security: gameSecurity("combat:write"),
        description:
          "Names one archived encounter (GM sessions and integration credentials only); null or an empty name takes the name away, and the replay is called by its scene and date again. A player sees the name on a replay the GM has shared, never the scene's.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveNameRequest" } }
          }
        },
        responses: {
          "200": {
            description: "The stored name",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveNameResponse" } }
            }
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    // ===== Codex: worldbuilding wiki / atlas / journal / calendar (codex-http.ts). Reads project per role; writes
    // are GM-grade. Scoped credentials act at GM grade except on `POST /codex/preview-session`. Every codex GET
    // answers a conditional request with 304. =====
    [CODEX_PATHS.pages]: {
      get: codexOp("listCodexPages", codexRead, "CodexPageListResponse", {
        notModified: true,
        bad: false,
        description:
          "Every page's summary (a player sees only revealed pages). Optional `folder` (empty string = top level) and `tag` filters.",
        params: [
          { name: "folder", in: "query", schema: { type: "string" } },
          { name: "tag", in: "query", schema: { type: "string" } }
        ]
      }),
      post: codexOp("createCodexPage", codexWrite, "CodexPageResponse", {
        ok: "201",
        body: "CodexPageCreateRequest",
        description: "Creates a page."
      })
    },
    [CODEX_PATHS.search]: {
      get: codexOp("searchCodex", codexRead, "CodexSearchResponse", {
        notModified: true,
        bad: false,
        description:
          "Suite-wide full-text search across pages, journal entries, maps and markers, role-scoped. `q` is the query. Deliberately ONE search route rather than one per record type: `hits` is a single ranked list discriminated by `kind`.",
        params: [{ name: "q", in: "query", schema: { type: "string" } }]
      })
    },
    [CODEX_PATHS.pageById]: {
      get: codexOp("getCodexPage", codexRead, "CodexPageDocumentResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description:
          "One page with its connections - one list where backlinks and typed relationships used to be two, projected for the caller."
      }),
      patch: codexOp("updateCodexPage", codexWrite, "CodexPageResponse", {
        body: "CodexPageUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        conflict: "A stale `expectedRev`; `error.currentRevision` carries the page's current revision.",
        description: "Edits a page. `expectedRev` rejects a stale write with 409."
      }),
      delete: codexOp("deleteCodexPage", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description: "Deletes a page; idempotent."
      })
    },
    [CODEX_PATHS.pageReveal]: {
      post: codexOp("revealCodexPage", codexWrite, "CodexPageResponse", {
        body: "CodexRevealRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Shows/hides a page to players."
      })
    },
    [CODEX_PATHS.pageConnections]: {
      post: codexOp("createCodexConnection", codexWrite, "CodexConnectionResponse", {
        ok: "201",
        body: "CodexConnectionCreateRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          'Declares a connection from this page to another. Counts as an edit of BOTH pages for "recently updated" - but neither page\'s `rev` changes, so an open editor is not forced into a conflict. Idempotent on `(from, to, label)`, and on the reverse pair too for a symmetric label ("ally of", "enemy of", "rival of", "related to"), so declaring the same edge twice returns the existing one rather than doubling it.'
      })
    },
    [CODEX_PATHS.pageMarkers]: {
      get: codexOp("listCodexPageMarkers", codexRead, "CodexMarkerListResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description:
          "The reverse of `/codex/maps/{id}/markers`: every atlas marker that links THIS page, so an open page can point back at the map. Role-scoped by exactly the forward route's predicate - a player must be able to see the page itself (an unrevealed page 404s), and then receives only revealed pins whose MAP is also revealed, with each pin's links filtered to the revealed subset and scene/actor ids stripped."
      })
    },
    [CODEX_PATHS.pageRevisions]: {
      get: codexOp("listCodexPageRevisions", codexGmRead, "CodexRevisionListResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description: "Autosaved revision history for a page."
      })
    },
    [CODEX_PATHS.pageRevisionRestore]: {
      post: codexOp("restoreCodexPageRevision", codexWrite, "CodexPageResponse", {
        params: [
          uuidParam("id"),
          { name: "revisionId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }
        ],
        notFound: true,
        description: "Restores a page to a prior revision."
      })
    },
    [CODEX_PATHS.previewSession]: {
      post: codexOp("createCodexPreviewSession", codexGmSessionOnly, "CodexPreviewSessionResponse", {
        ok: "201",
        bad: false,
        description:
          "Mints a short-lived PLAYER session token so the GM can preview the player Codex truthfully. Deliberately a real player principal rather than a role flag on the GM's session - every read then walks the same authorization and projection path a genuine player gets, so the preview can never show what a player could not see."
      })
    },
    [CODEX_PATHS.folders]: {
      get: codexOp("listCodexFolders", codexGmRead, "CodexFolderListResponse", {
        notModified: true,
        bad: false,
        description: "Every explicitly-created folder path; lets an empty folder persist."
      }),
      post: codexOp("createCodexFolder", codexWrite, "CodexFolderCreatedResponse", {
        ok: "201",
        body: "CodexFolderPathRequest",
        description: "Creates (or keeps) an empty folder."
      })
    },
    [CODEX_PATHS.foldersMove]: {
      post: codexOp("moveCodexFolder", codexWrite, "CodexFolderMovedResponse", {
        body: "CodexFolderMoveRequest",
        description: "Renames/moves a folder subtree, re-pathing every page under it. Returns how many pages moved."
      })
    },
    [CODEX_PATHS.foldersDelete]: {
      post: codexOp("deleteCodexFolder", codexWrite, "CodexDeletedResponse", {
        body: "CodexFolderPathRequest",
        description: "Deletes a folder and its subfolders; every page under it drops to the top level - never deleted."
      })
    },
    [CODEX_PATHS.connections]: {
      get: codexOp("listCodexConnections", codexRead, "CodexConnectionListResponse", {
        notModified: true,
        bad: false,
        description:
          "Every connection in the codex - ONE edge kind for the whole graph. A typed relationship and a `[[wiki link]]` are the same thing with a different `origin`; a connection may carry an optional `label`. Role-scoped by three gates, all of which must hold for a player: the target page is revealed, the SOURCE record is revealed by its own kind's player rule, and the connection sits on the `player` layer (a link written in a GM body is a GM note about a connection, not a connection the party has been shown)."
      })
    },
    [CODEX_PATHS.connectionById]: {
      patch: codexOp("updateCodexConnection", codexWrite, "CodexConnectionResponse", {
        body: "CodexConnectionUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          "Relabels a DECLARED connection or moves it between layers. A `mention` connection has no id - it is derived from a body's text - and is edited by editing that text."
      }),
      delete: codexOp("deleteCodexConnection", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description:
          'Removes one declared connection; idempotent. Counts as an edit of both endpoints for "recently updated" without moving either record\'s `rev`.'
      })
    },
    [CODEX_PATHS.maps]: {
      get: codexOp("listCodexMaps", codexRead, "CodexMapListResponse", {
        notModified: true,
        bad: false,
        description:
          "The atlas map tree, role-scoped (a player sees only revealed maps; a revealed map keeps its parent link only when that parent is itself revealed)."
      }),
      post: codexOp("createCodexMap", codexWrite, "CodexMapResponse", {
        ok: "201",
        body: "CodexMapCreateRequest",
        notFound: true,
        description: "Turns an uploaded map asset into an atlas map node."
      })
    },
    [CODEX_PATHS.mapById]: {
      patch: codexOp("updateCodexMap", codexWrite, "CodexMapResponse", {
        body: "CodexMapUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Renames/retypes a map."
      }),
      delete: codexOp("deleteCodexMap", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description: "Deletes a map and its markers; idempotent."
      })
    },
    [CODEX_PATHS.mapParent]: {
      post: codexOp("setCodexMapParent", codexWrite, "CodexMapResponse", {
        body: "CodexMapParentRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Re-parents a map in the atlas tree (null = a root map)."
      })
    },
    [CODEX_PATHS.mapReveal]: {
      post: codexOp("revealCodexMap", codexWrite, "CodexMapResponse", {
        body: "CodexRevealRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Shows/hides a map to players."
      })
    },
    [CODEX_PATHS.mapMarkers]: {
      get: codexOp("listCodexMarkers", codexRead, "CodexMarkerListResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description:
          "Markers on a map, role-scoped (a player only for a revealed map, and each pin's links filtered to the revealed subset)."
      }),
      post: codexOp("createCodexMarker", codexWrite, "CodexMarkerResponse", {
        ok: "201",
        body: "CodexMarkerCreateRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Drops a marker on a map."
      })
    },
    [CODEX_PATHS.party]: {
      get: codexOp("getCodexPartyLocation", codexRead, "CodexPartyLocationResponse", {
        notModified: true,
        bad: false,
        description:
          'Where the party pin is, and the name of the map it sits on - one read for the dashboard\'s "party is here" card and the atlas jump, replacing a client-side scan of every map. `party` is null when no pin carries the flag. For a player it is ALSO null when the party pin fails the ordinary compound reveal gate (the pin revealed AND its map revealed) - null rather than 404, so a hidden party pin is indistinguishable from no party pin at all. `isParty` grants no visibility and never enters a reveal predicate.'
      })
    },
    [CODEX_PATHS.markerById]: {
      get: codexOp("getCodexMarker", codexRead, "CodexMarkerProjectedResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description:
          'One pin, projected for the caller. A player receives it only when the pin is revealed AND its map is revealed - the CD-6 compound gate, the same predicate `GET /codex/maps/{id}/markers` applies before it projects anything - with `pageIds` filtered to the revealed subset and scene/actor links stripped. Either half failing is a 404, never a 403: a pin id must not become a probe for "is there something here?". This is what lets a reader resolve a pin without walking every map.'
      }),
      patch: codexOp("updateCodexMarker", codexWrite, "CodexMarkerResponse", {
        body: "CodexMarkerUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Edits a marker's icon/label/links."
      }),
      delete: codexOp("deleteCodexMarker", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description: "Deletes a marker; idempotent."
      })
    },
    [CODEX_PATHS.markerMove]: {
      post: codexOp("moveCodexMarker", codexWrite, "CodexMarkerResponse", {
        body: "CodexMarkerMoveRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Repositions a marker in normalized map coordinates."
      })
    },
    [CODEX_PATHS.markerReveal]: {
      post: codexOp("revealCodexMarker", codexWrite, "CodexMarkerResponse", {
        body: "CodexRevealRequest",
        params: [uuidParam("id")],
        notFound: true,
        description: "Shows/hides a marker to players."
      })
    },
    [CODEX_PATHS.markerParty]: {
      put: codexOp("setCodexPartyMarker", codexWrite, "CodexMarkerResponse", {
        body: "CodexMarkerPartyRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          'Marks this pin as where the party is, or clears the flag from it. **Exactly one marker in the whole atlas** carries it, so setting a new one clears the old in a single step - the party is in exactly one place, and one-pin-per-map would leave "which pin is real?" unanswerable. `isParty: false` clears the flag from THIS marker only and never disturbs a different party pin. The flag is the pin\'s ONLY party-specific surface: it is moved, relabelled, linked, revealed and deleted through the ordinary marker routes, because the party marker is an ordinary marker with a flag rather than a marker type of its own. It is player-facing - the party pin is for the players - but it grants no visibility: a hidden party pin, or one on a hidden map, stays hidden exactly like any other pin.'
      })
    },
    [CODEX_PATHS.timeline]: {
      get: codexOp("listCodexTimeline", codexRead, "CodexChronicleListResponse", {
        notModified: true,
        bad: false,
        description:
          "The ONE chronicle: every journal entry and every dated `event` page, interleaved in one in-world chronological order and returned in one row shape (`kind` discriminates - `entry`, `combat`, `event`). The client's \"by session\" lens is a regrouping of these same records, never a second fetch. Role-scoped: a player receives only revealed entries and revealed event pages, with GM-only text (`gmText`, an event's GM body), the replay linkage and the raw sort key stripped - the projection delegates to the journal and page player projections rather than restating them, so this read can never be weaker than either."
      })
    },
    [CODEX_PATHS.journal]: {
      get: codexOp("listCodexJournal", codexRead, "CodexJournalListResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        description:
          "The campaign timeline, or a location's mini-timeline via `markerId`/`pageId`, role-scoped (a player only for a revealed marker/page, and only revealed entries).",
        params: [
          { name: "markerId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "pageId", in: "query", schema: { type: "string", format: "uuid" } }
        ]
      }),
      post: codexOp("createCodexJournalEntry", codexWrite, "CodexJournalEntryResponse", {
        ok: "201",
        body: "CodexJournalCreateRequest",
        notFound: true,
        description:
          "Adds a journal/timeline entry. A `sessionId` naming no session is a **404**, not a 400 - the body is well-formed and the record it points at is gone."
      })
    },
    [CODEX_PATHS.journalDeadline]: {
      post: codexOp("createCodexDeadline", codexWrite, "CodexJournalEntryResponse", {
        ok: "201",
        body: "CodexDeadlineCreateRequest",
        notFound: true,
        description:
          'Adds a DEADLINE - a thing that will happen at an in-world date, which the campaign clock can reach. Its own text is the "what" and its own `inWorldDate` is the "when", so a deadline stores no extra payload at all; `fired` is DERIVED from that date against the clock on every read and never stored, which is why rewinding the clock correctly un-fires one. `inWorldDate` is REQUIRED and may not be null - an undated deadline can never fire, so it is a note, not a deadline. Created HIDDEN like any other entry and published by the ordinary `POST /codex/journal/{id}/reveal`: there is no kind-specific reveal and no kind-based visibility rule anywhere.'
      })
    },
    [CODEX_PATHS.journalDowntime]: {
      post: codexOp("createCodexDowntime", codexWrite, "CodexDowntimeCreatedResponse", {
        ok: "201",
        body: "CodexDowntimeCreateRequest",
        notFound: true,
        description:
          "Records DOWNTIME - who spent how many days doing what between adventures. Creating it NEVER moves the campaign clock; it answers with `proposedDate`, the date the clock WOULD move to, so the GM's confirm affordance can state what it will do before it does it. `POST /codex/journal/{id}/apply-downtime` is the only thing that moves the clock. Dated at the GM's current campaign date when no `inWorldDate` is given, the same rule an auto-logged battle follows, so the record lands where it happened."
      })
    },
    [CODEX_PATHS.journalMilestone]: {
      post: codexOp("createCodexMilestone", codexWrite, "CodexJournalEntryResponse", {
        ok: "201",
        body: "CodexMilestoneCreateRequest",
        notFound: true,
        description:
          "Records a MILESTONE - the party reached a level, and why. `level` is the level REACHED, not a step, so a deleted record cannot silently change what level the party is on (a delta would make the current level a sum over the whole timeline). There is no XP: progression here is milestone-based by design and the record carries no arithmetic. Created HIDDEN like any other entry and published by the ordinary `POST /codex/journal/{id}/reveal` - there is no kind-specific reveal. Dated at the GM's current campaign date when no `inWorldDate` is given, the rule an auto-logged battle and a downtime record already follow."
      })
    },
    [CODEX_PATHS.journalById]: {
      patch: codexOp("updateCodexJournalEntry", codexWrite, "CodexJournalEntryResponse", {
        body: "CodexJournalUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          "Edits a journal entry; an omitted field is left alone. A `downtime` group edits a downtime record's own `who`/`activity`/`characterPageId` - **400** on any other kind of entry, and `days` is immutable (sending it is a 400, because it is what the campaign clock already moved by)."
      }),
      delete: codexOp("deleteCodexJournalEntry", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description: "Deletes a journal entry; idempotent."
      })
    },
    [CODEX_PATHS.journalReveal]: {
      post: codexOp("revealCodexJournalEntry", codexWrite, "CodexJournalEntryResponse", {
        body: "CodexRevealRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          "Shows/hides a journal entry to players. Works on EVERY journal kind, deadlines and downtime included - there is deliberately no kind-specific reveal route, because a second gate is a second thing to keep in step with the first."
      })
    },
    [CODEX_PATHS.journalApplyDowntime]: {
      post: codexOp("applyCodexDowntime", codexWrite, "CodexDowntimeAppliedResponse", {
        params: [uuidParam("id")],
        notFound: true,
        conflict:
          "The downtime was already applied. A state-machine refusal rather than a lost race, so it carries NO `error.currentRevision`. An entry that is not a downtime record at all is a **400**, not this - the request named the wrong kind of thing rather than losing a race.",
        description:
          "Confirms a downtime record's time cost and ADVANCES the campaign clock by its `days`. The GM's explicit yes - the owner asked to be asked rather than have the clock move itself. Entry and calendar move together in one transaction and are returned together, so a client cannot render a moved clock beside an unapplied record. Applying an already-applied downtime, or any entry that is not downtime, is refused and moves nothing. Advancing the clock does NOT publish it: players keep seeing the published date until `POST /codex/calendar/publish`."
      })
    },
    [CODEX_PATHS.sessions]: {
      get: codexOp("listCodexSessions", codexRead, "CodexSessionListResponse", {
        notModified: true,
        bad: false,
        description:
          "Every play session - the GM's prep-and-recap record of one evening at the table. Numbered sessions first in number order, then the unnumbered ones oldest-first (the same tier-separator idiom the chronicle uses for undated records). Role-scoped: a GM receives the whole record for every session plus `activeSessionId`; a player receives only REVEALED sessions, reduced to the recap layer (`id`, `sessionNumber`, `realDate`, `recap`), and `activeSessionId` is always null for a player because it can name a session they cannot see."
      }),
      post: codexOp("createCodexSession", codexWrite, "CodexSessionResponse", {
        ok: "201",
        body: "CodexSessionCreateRequest",
        description:
          "Creates a session. Every field is optional - an empty POST opens a blank `planned` session to prep into. A `sessionNumber` another session already carries is refused with 400: the journal's by-session lens resolves a number to at most one session, so numbers are unique."
      })
    },
    [CODEX_PATHS.sessionById]: {
      get: codexOp("getCodexSession", codexRead, "CodexSessionProjectedResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description:
          'One session, projected for the caller. An unrevealed session is **404** to a player - the same 404 an absent session gets, and never 403, because a 403 would confirm the record exists and its very existence ("session 14 is being prepped") is GM information.'
      }),
      patch: codexOp("updateCodexSession", codexWrite, "CodexSessionResponse", {
        body: "CodexSessionUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        conflict: "A stale `expectedRev`; `error.currentRevision` carries the session's current revision.",
        description:
          "Edits a session; an omitted field is left alone. `expectedRev` rejects a stale write with 409. A `sessionNumber` another session already carries is a 400, not a 409 - it is a bad value, not a lost race."
      }),
      delete: codexOp("deleteCodexSession", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description:
          "Deletes a session; idempotent. If it was the active session the pointer is cleared in the same transaction, so `activeSessionId` can never name a record that is gone. Journal entries that carry its `sessionNumber` are NOT deleted or renumbered - the number on an entry is a label, not a foreign key."
      })
    },
    [CODEX_PATHS.sessionReveal]: {
      post: codexOp("revealCodexSession", codexWrite, "CodexSessionResponse", {
        body: "CodexRevealRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          "Publishes/retracts a session's recap to players. Revealing is not an edit: it moves neither `rev` nor `updatedAt`, so an open console is not forced into a conflict and a reveal sweep cannot light the players' recap badge for text nobody changed."
      })
    },
    [CODEX_PATHS.sessionActivate]: {
      post: codexOp("activateCodexSession", codexWrite, "CodexSessionActiveResponse", {
        params: [uuidParam("id")],
        notFound: true,
        description:
          'Marks this session the ACTIVE one - the single session new journal entries (including the ones combat writes automatically at `encounter.end`) are stamped with when the caller supplies no `sessionNumber` of its own. Exactly one session is active at a time: the pointer lives on the codex metadata row, not as a flag on each session, so "two active sessions" is unrepresentable. Answers with the POINTER alone, never the session: activating is a statement about the TABLE, not an edit of the record, and it moves neither `rev` nor `updatedAt` - returning the row would imply otherwise.'
      })
    },
    [CODEX_PATHS.quests]: {
      get: codexOp("listCodexQuests", codexRead, "CodexQuestListResponse", {
        notModified: true,
        bad: false,
        description:
          "Every quest - what the party is chasing, and whether it is still open. Role-scoped: a GM receives the whole record for every quest; a player receives only REVEALED quests, reduced to the player layer (`id`, `title`, `status`, `body`, `objectives`, `entityIds`). `status` IS player-facing here, unlike a session's: \"what is still open\" is the point of the feature, and a revealed quest whose state the player cannot see is useless. `entityIds` is filtered to the revealed subset, exactly as a marker's `pageIds` is."
      }),
      post: codexOp("createCodexQuest", codexWrite, "CodexQuestResponse", {
        ok: "201",
        body: "CodexQuestCreateRequest",
        description:
          "Creates a quest, and appends its first history record in the SAME transaction - a quest starting is an event, so its initial status is recorded exactly as a later change would be. That record is a hidden `quest` journal entry with empty player text, dated at the GM's clock and filed under the active session; revealing it publishes nothing unless the quest itself is revealed. Only `title` is required - everything else opens empty, so the GM can name a lead the moment it appears at the table and fill it in later."
      })
    },
    [CODEX_PATHS.questById]: {
      get: codexOp("getCodexQuest", codexRead, "CodexQuestProjectedResponse", {
        notModified: true,
        bad: false,
        notFound: true,
        params: [uuidParam("id")],
        description:
          'One quest, projected for the caller. An unrevealed quest is **404** to a player - the same 404 an absent quest gets, and never 403, because a 403 would confirm the record exists and its very existence ("there is a quest about the duke") is GM information.'
      }),
      patch: codexOp("updateCodexQuest", codexWrite, "CodexQuestResponse", {
        body: "CodexQuestUpdateRequest",
        params: [uuidParam("id")],
        notFound: true,
        conflict: "A stale `expectedRev`; `error.currentRevision` carries the quest's current revision.",
        description:
          "Edits a quest; an omitted field is left alone. **A status change also appends a hidden `quest` history record** in the same transaction - editing prose does not, because that is not something that happened in the world. `expectedRev` rejects a stale write with 409. `objectives` is REPLACED wholesale and stored in exactly the order given - order is content here, not incidental, so the array is never sorted, deduped, or re-keyed by position."
      }),
      delete: codexOp("deleteCodexQuest", codexWrite, "CodexDeletedResponse", {
        bad: false,
        params: [uuidParam("id")],
        description:
          "Deletes a quest; idempotent. The pages named by `entityIds` are untouched - the link is a reference, not ownership."
      })
    },
    [CODEX_PATHS.questReveal]: {
      post: codexOp("revealCodexQuest", codexWrite, "CodexQuestResponse", {
        body: "CodexRevealRequest",
        params: [uuidParam("id")],
        notFound: true,
        description:
          "Shows/hides a quest to players. Revealing is not an edit: it moves neither `rev` nor `updatedAt`, so an open console is not forced into a conflict and a reveal sweep cannot make an untouched quest look freshly changed."
      })
    },
    [CODEX_PATHS.standing]: {
      get: codexOp("listCodexStanding", codexRead, "CodexStandingListResponse", {
        notModified: true,
        bad: false,
        description:
          "Where the party stands with each faction, ROLE-SCOPED. A GM receives every standing; a player receives only those that are BOTH revealed themselves AND whose faction page is itself revealed, reduced to `factionPageId` and `value`. The second gate is not belt-and-braces: a standing row carries no title of its own (the faction's live page is the one name, so a rename cannot go stale), so a reader NAMES it by resolving `factionPageId` - and a standing published for a secret faction would hand the party a page id they cannot open beside a bar they cannot label. `value` is SIGNED, -100 (hostile) to +100 (allied), because a faction can be actively against the party and an unsigned favour scale cannot say so; a reader shows the word beside the bar, never the bar alone."
      })
    },
    [CODEX_PATHS.standingByFaction]: {
      put: codexOp("setCodexStanding", codexWrite, "CodexStandingResponse", {
        body: "CodexStandingSetRequest",
        params: [{ name: "factionPageId", in: "path", required: true, schema: codexUuid }],
        notFound: true,
        description:
          "Sets where the party stands with one faction, and appends the `standing` chronicle record for the change - in ONE transaction, so the table (where things stand) and the timeline (what happened) can never disagree. Creates the standing on first use: `faction_page_id` is unique, so there is exactly one row per faction and nothing to create separately. `value` is the RESULTING value and is clamped to -100..100; the chronicle record carries the DELTA, because the record says what happened while the table says where things stand. 404 when no page with that id exists. **400** when the page exists but is not a `faction`: standing is tracked against factions, and the store enforces the entity type that the spec asks for as a foreign key (SQLite cannot express it - a CHECK may not subquery). The GM Codex only offers faction pages, so this is reachable mainly by a direct API caller, or by a page whose type was changed to something else after it had a standing row."
      })
    },
    [CODEX_PATHS.standingReveal]: {
      post: codexOp("revealCodexStanding", codexWrite, "CodexStandingResponse", {
        body: "CodexRevealRequest",
        params: [{ name: "factionPageId", in: "path", required: true, schema: codexUuid }],
        notFound: true,
        description:
          "Shows/hides a faction's standing to players. The ordinary reveal shape every codex record uses; revealing a standing does NOT reveal the faction page, and a player sees the standing only once both are revealed."
      })
    },
    [CODEX_PATHS.revealAudit]: {
      get: codexOp("getCodexRevealAudit", codexGmRead, "CodexRevealAuditResponse", {
        notModified: true,
        bad: false,
        description:
          'One GM view of everything the party can currently see, across every reveal surface in the Codex - the published campaign date, pages, maps, markers, journal (all six kinds), sessions, quests and standing. GM-only, and READ-ONLY: it is an AGGREGATION of the existing player projections, not a second opinion about visibility, so it lists exactly what the corresponding player-facing endpoints would return - a marker flagged revealed on a HIDDEN map is absent here, because the party cannot see it either. Every section is always present, empty ones included with `revealed: 0`, so "nothing is revealed here" cannot be mistaken for "this did not load". Each row carries the id its own kind\'s EXISTING reveal route takes, which is how un-revealing works from this surface: there is deliberately no unreveal route and no bulk operation. Table-side exposure (tokens, fog, the shared viewer) is deliberately out of scope - that system has its own visibility rules, and folding it in would make this the second place that decides what a player can see.'
      })
    },
    [CODEX_PATHS.calendar]: {
      get: codexOp("getCodexCalendar", codexRead, "CodexCalendarProjectedResponse", {
        notModified: true,
        bad: false,
        description:
          "The world's calendar (months, weekdays, era, current date), ROLE-PROJECTED. The campaign has two clocks: the GM's, which they run ahead while prepping, and the PUBLISHED one the party sees. A GM receives their own clock as `currentDate` plus `publishedDate` so they can tell whether the table is behind them; a player receives `currentDate` sourced ONLY from the published date, and never `publishedDate` (for a player the two are the same value) and never the GM's clock by any path. Months, weekdays and era are the world's own and are player-facing on both."
      }),
      put: codexOp("setCodexCalendar", codexWrite, "CodexCalendarResponse", {
        body: "CodexCalendarRequest",
        description:
          "Replaces the world calendar and reflows every dated record's sort instant and label from the raw dates. Moves the GM's clock only: advancing NEVER publishes, so the party's `currentDate` does not move until `POST /codex/calendar/publish`. `publishedDate` is deliberately not settable here - this body replaces the whole calendar, and a player-facing value inside a wholesale replacement is one careless PUT from being cleared."
      })
    },
    [CODEX_PATHS.calendarPublish]: {
      post: codexOp("publishCodexCampaignDate", codexWrite, "CodexCalendarResponse", {
        description:
          "Publishes the GM's clock: the party's `currentDate` becomes the GM's. Takes no body - \"publish\" means exactly \"the table now sees where I am\", and an arbitrary settable published date would be a third clock to keep in step. This is the ONLY thing that moves the players' date; neither editing the calendar nor applying downtime does it. Publishing while the GM has no current date clears the published one. The 400 is not reachable through any input today - the handler routes every failure through the shared codex error mapper, and documenting only the statuses currently reachable would make the document wrong the moment that changes."
      })
    },
    [CODEX_PATHS.calendarCheck]: {
      post: codexOp("checkCodexCalendar", codexGmRead, "CodexCalendarCheckResponse", {
        body: "CodexCalendarRequest",
        description:
          "Says what saving this calendar (the same body `PUT /codex/calendar` takes) would do to records the players can see, and changes nothing. A dated record keeps its raw date, but a calendar with fewer months or shorter ones resolves a date it lacks to another day, and a deadline measured against the published date can read as approaching again after players saw it pass. The GM's calendar editor calls this before saving and asks first when anything would move. GM-only; a read, so it takes no `commandId` and pings nobody."
      })
    },
    [CODEX_PATHS.calendarUnpublish]: {
      post: codexOp("unpublishCodexCampaignDate", codexWrite, "CodexCalendarResponse", {
        description:
          "Takes the published date away from the players: their `currentDate` reads null until the GM publishes again. Takes no body, and leaves the GM's own clock and the calendar's structure alone. Deadlines a player could see as passed read as not yet fired while no date is published, since `fired` is measured against the published date. The reveal audit's date row hides through this route."
      })
    },
    [CODEX_PATHS.settings]: {
      get: codexOp("getCodexSettings", codexGmRead, "CodexSettingsResponse", {
        notModified: true,
        bad: false,
        description:
          "Every codex-WIDE setting, plus what the kept revision history COSTS (`versionCount` / `versionBytes`, both server-computed and read-only). GM-only on the read as well as the write, unlike the calendar: nothing here is player-facing - these values describe how the GM's own authoring history is kept, they gate no content, and they put nothing on a player's screen. An out-of-range or unrepresentable stored value reads back as the default rather than propagating, so this route always answers with a usable setting."
      }),
      put: codexOp("setCodexSettings", codexWrite, "CodexSettingsResponse", {
        body: "CodexSettingsRequest",
        description:
          "Replaces the codex-wide settings and answers with the full READ shape (usage figures included), never with what was sent - so a caller whose `windowMinutes` was clamped or truncated sees the real value rather than believing its own number took, and needs no second request to refresh the screen. The body carries the two SETTABLE fields only: `versionCount` / `versionBytes` are facts about a table the caller cannot see, so sending either is a **400** rather than a silently ignored key, and no path stores them. `windowMinutes` outside 0..10080 is likewise a **400** (the GM's control cannot produce one, so a caller that does is malformed, which is the router-rejects / store-clamps arrangement every bounded field in this surface uses); a fractional value INSIDE the range is truncated rather than rejected, because that is a slider artefact and not a mistake about what was meant. Changing these settings never deletes a revision: switching history off stops new checkpoints being written and nothing else, and the existing history stays listable and restorable."
      })
    },
    [CODEX_PATHS.pageRevisionsCollection]: {
      delete: codexOp("deleteCodexPageRevisions", codexWrite, "CodexRevisionsDeletedResponse", {
        body: "CodexRevisionsDeleteRequest",
        description:
          'Deletes every page revision authored more than `olderThanDays` ago, and answers with how many rows really went. The ONE destructive route in the Codex surface, and deliberately unforgiving: `olderThanDays` must be a whole number from 0 to 36500, and a negative or fractional value is a **400** rather than a clamp - the exact opposite of `windowMinutes`, because that is a slider the GM drags while this destroys data, and a malformed destructive request must not be interpreted generously. **`0` deletes EVERY revision**, which is arithmetic rather than a magic value: nothing is younger than zero days old. "Old" is measured against `authoredAt` - when the checkpointed content was authored - which is the same clock the write-side throttle uses, so age means one thing in this store. It works regardless of the `enabled` setting, because a GM who switched history off is exactly the GM reclaiming the space. It touches the revision table and NOTHING else: no page, no body and no `rev` moves, because a page as it stands now is not a version of itself.'
      })
    },
    [CODEX_PATHS.export]: {
      get: codexOp("exportCodex", codexGmRead, "CodexExportResponse", {
        notModified: true,
        bad: false,
        description:
          "A full codex backup bundle. Carries whatever revision rows exist, verbatim - the 2026-07-30 revision throttle bounds the WRITES, never this export, and nothing prunes the table, so a backup never lies about how much history it holds. Round-trips through `POST /codex/import`."
      })
    },
    [CODEX_PATHS.import]: {
      post: codexOp("importCodex", codexWrite, "CodexImportedResponse", {
        body: "CodexImportRequest",
        tooLarge: true,
        description:
          "Restores a full backup bundle. REPLACE-ONLY and all-or-nothing: every codex table is wiped and reloaded from the bundle inside ONE transaction, so a bad row aborts the lot with a 400 and nothing is written. Accepts the `data` of a `GET /codex/export` response verbatim - `exportedAt` is accepted and ignored, so a saved export file POSTs unchanged. `bundleVersion` is OPTIONAL: absent means a pre-versioning export of the same v1 shape (every backup taken before this feature existed lacks the key and MUST restore), and a value other than 1 is a 400. This is the one genuinely destructive route in the Codex - the guardrails are GM/`codex:write` authorization and the caller's own confirmation, and the honest advice is to export first."
      })
    },
    [CODEX_ASSET_PATHS.collection]: {
      post: {
        operationId: "uploadCodexAsset",
        security: codexWrite,
        description:
          "Uploads a page image (banner or inline) as raw bytes in the request body; `filename` is a query parameter. Content-addressed: identical bytes return the existing asset with 200 instead of 201. The body limit on this route is 11 MB and an oversized upload is a **413**.",
        parameters: [{ name: "filename", in: "query", schema: { type: "string" } }],
        requestBody: { required: true, content: { "image/*": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "201": { description: "New image stored", ...codexJson("CodexAssetUploadResponse") },
          "200": {
            description: "Identical bytes already stored; the existing asset is returned",
            ...codexJson("CodexAssetUploadResponse")
          },
          "400": apiError,
          "401": apiError,
          "403": apiError,
          "413": apiError
        }
      }
    },
    [CODEX_ASSET_PATHS.content]: {
      get: {
        operationId: "getCodexAssetContent",
        security: codexRead,
        description:
          "Original image bytes for a page banner/inline image. GM always; a player only when the asset is used by a revealed page. Supports ETag/If-None-Match (304); sent with `Cache-Control: private, no-store`.",
        parameters: [uuidParam("id")],
        responses: {
          "200": { description: "Full image bytes" },
          "304": { description: "Not modified" },
          "401": apiError,
          "403": apiError,
          "404": apiError
        }
      }
    },
    // ===== Homebrew authoring (homebrew-http.ts). GM-only end to end: no player read, no integration scope. =====
    [HOMEBREW_PATHS.content]: {
      get: homebrewOp("listHomebrewContent", "HomebrewContentListResponse", {
        description:
          'The GM\'s homebrew library as flat summaries - the authored body stays out of the list, so a few-hundred-record library is a small payload. Filters compose; "all types" is simply `type` omitted. Soft-deleted rows are hidden from this listing too unless `includeDeleted` is set. Paging is keyset, not offset (the GM publishing mid-scroll must not skip or duplicate a row): `cursor` is OPAQUE - never construct or parse one - and `nextCursor: null` means this was the last page. `total` counts every row matching the filter, ignoring `limit`/`cursor`.',
        params: [
          {
            name: "type",
            in: "query",
            required: false,
            schema: homebrewContentType,
            description: "Single-valued; omit for every type."
          },
          { name: "state", in: "query", required: false, schema: homebrewState },
          { name: "visibleToPlayers", in: "query", required: false, schema: { type: "boolean" } },
          {
            name: "q",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 120 },
            description: "Case-insensitive name substring. Deliberately not full-text search."
          },
          { name: "includeDeleted", in: "query", required: false, schema: { type: "boolean", default: false } },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 }
          },
          { name: "cursor", in: "query", required: false, schema: { type: "string", maxLength: 200 } }
        ]
      }),
      post: homebrewOp("createHomebrewContent", "HomebrewContentResponse", {
        ok: "201",
        body: "HomebrewCreateRequest",
        conflict: "The record's id collides with an existing one (`error.details.collidesWith`)",
        description:
          'Creates a homebrew record. It always lands as `state: "draft"`, `visibleToPlayers: false`: a draft is allowed to be invalid, and nothing reaches a player until it is BOTH published and made visible.'
      })
    },
    [HOMEBREW_PATHS.contentById]: {
      get: homebrewOp("getHomebrewContent", "HomebrewContentResponse", {
        bad: false,
        notFound: true,
        params: [homebrewIdParam],
        description:
          "One record with its row state and its full validity report (`validity.issues`), so an editor can show what still blocks publishing without a round-trip per field."
      }),
      patch: homebrewOp("updateHomebrewContent", "HomebrewContentResponse", {
        body: "HomebrewUpdateRequest",
        params: [homebrewIdParam],
        notFound: true,
        conflict: "A stale `expectedRev`; `error.currentRevision` carries the row's revision",
        description:
          "Replaces the authored `record` and leaves `state`, `visibleToPlayers`, and `deletedAt` alone - correct PATCH semantics on the ROW, even though the `record` value it carries is complete. A partial merge into a polymorphic body under `additionalProperties: false` is unspecifiable, so the body is always the whole record. On a published record the edit is held as pending (`pendingChanges: true`): the live body stays in the catalogs, so an edit mid-session never pulls content from the players, until `/publish` validates the pending body and puts it live or `/discard` drops it."
      }),
      delete: homebrewOp("deleteHomebrewContent", "HomebrewDeletedResponse", {
        bad: false,
        params: [homebrewIdParam],
        description:
          "Soft-deletes a record (sets `deletedAt`); idempotent, so deleting an unknown or already-deleted id is still a 200. A soft-deleted record leaves the merged catalogs immediately and is restorable via `/restore`."
      })
    },
    [HOMEBREW_PATHS.contentRestore]: {
      post: homebrewOp("restoreHomebrewContent", "HomebrewContentResponse", {
        bad: false,
        params: [homebrewIdParam],
        notFound: true,
        description:
          "Clears `deletedAt`. Soft delete is a one-way state transition rather than an ordinary field, so this is its explicit inverse - never a PATCH of `deletedAt: null`."
      })
    },
    [HOMEBREW_PATHS.contentDuplicate]: {
      post: homebrewOp("duplicateHomebrewContent", "HomebrewContentResponse", {
        ok: "201",
        body: "HomebrewDuplicateRequest",
        bodyRequired: false,
        params: [homebrewIdParam],
        notFound: true,
        description:
          "Deep-copies a record under a freshly minted homebrew id. `{id}` may be an SRD id (`wizard`), which is what makes a 20-row class table tractable to author: the server reads the full bundled record and mints a namespaced homebrew copy. The copy lands as a draft, invisible to players."
      })
    },
    [HOMEBREW_PATHS.contentPublish]: {
      post: homebrewOp("publishHomebrewContent", "HomebrewContentResponse", {
        body: "HomebrewStateChangeRequest",
        bodyRequired: false,
        params: [homebrewIdParam],
        notFound: true,
        conflict:
          "The draft is not valid: `error.details.invalid.issues` lists every blocking issue with its machine-addressable `path`",
        description:
          'Moves a record to `state: "published"`, which requires it to be valid. On a published record with `pendingChanges`, validates the pending body and puts it live; refused, the live body is unchanged. Publishing does NOT show it to players - that is `/visibility`, deliberately a separate endpoint. A publish REQUEST that is itself malformed is a 400; a well-formed request against a body the stored state refuses is a 409.'
      })
    },
    [HOMEBREW_PATHS.contentDiscard]: {
      post: homebrewOp("discardHomebrewChanges", "HomebrewContentResponse", {
        body: "HomebrewStateChangeRequest",
        bodyRequired: false,
        params: [homebrewIdParam],
        notFound: true,
        description:
          "Drops a published record's pending edits, leaving the live body as it is. A no-op when nothing is pending."
      })
    },
    [HOMEBREW_PATHS.contentUnpublish]: {
      post: homebrewOp("unpublishHomebrewContent", "HomebrewContentResponse", {
        body: "HomebrewStateChangeRequest",
        bodyRequired: false,
        params: [homebrewIdParam],
        notFound: true,
        description:
          'Returns a record to `state: "draft"`. It leaves the merged catalogs at once and may be invalid again while the GM reworks it. Pending edits become the draft\'s body, since a draft is edited in place.'
      })
    },
    [HOMEBREW_PATHS.contentVisibility]: {
      post: homebrewOp("setHomebrewContentVisibility", "HomebrewContentResponse", {
        body: "HomebrewVisibilityRequest",
        params: [homebrewIdParam],
        notFound: true,
        conflict: "The record is still a draft; publish it first",
        description:
          "Sets whether players may see a published record. `state` and `visibleToPlayers` are orthogonal, but the COMBINATION draft + visible is meaningless: asking for it on a draft is a loud 409, never a silent no-op, which is what keeps `visibleToPlayers` from becoming a lie."
      })
    },
    [HOMEBREW_PATHS.contentUsages]: {
      get: homebrewOp("getHomebrewContentUsages", "HomebrewUsagesResponse", {
        bad: false,
        params: [homebrewIdParam],
        notFound: true,
        description:
          "Which characters took this record, computed on demand from the character choice ledger (no persisted reverse index at this data volume), and which published records depend on it. A built character carries a flattened, self-contained ActorDefinition, so removing a homebrew record never breaks one. A published record can break: `dependents.ifRemoved` names those that publish now and would not once this one is removed or unpublished (`safeToDelete` is false when any do), and `dependents.ifUpdated` those its pending edits would break once live."
      })
    },
    [HOMEBREW_PATHS.packsExport]: {
      get: homebrewOp("exportHomebrewPack", "HomebrewPackExportResponse", {
        description:
          "Exports published, non-deleted records as a shareable pack. Optional `type` and repeatable `id` narrow it to one class rather than the whole table. The pack carries authored bodies ONLY - no `state`, `visibleToPlayers`, `deletedAt`, or `rev` - so an importing table can never inherit this one's visibility policy.",
        params: [
          { name: "type", in: "query", required: false, schema: homebrewContentType },
          {
            name: "id",
            in: "query",
            required: false,
            style: "form",
            explode: true,
            schema: { type: "array", maxItems: 500, items: homebrewId },
            description: "Repeatable: `?id=a&id=b`. Omit for every published record."
          }
        ]
      })
    },
    [HOMEBREW_PATHS.packsImport]: {
      post: homebrewOp("importHomebrewPack", "HomebrewPackImportResponse", {
        body: "HomebrewPackImportRequest",
        conflict:
          "One or more records failed validation after id rewriting; `error.details.invalid.issues` carries each issue with its `recordId`, and nothing was written",
        tooLarge: true,
        description:
          'Imports a pack. Everything lands as `state: "draft"`, `visibleToPlayers: false`, which makes importing an invalid pack harmless. Ids that collide with an SRD id are ALWAYS re-minted; ids colliding with existing homebrew follow `onIdCollision`. `dryRun` runs the whole collision + cross-reference-rewrite + re-validate pass and returns the identical report without writing - use it to see the plan before the only destructive path in the feature runs. This route mounts its own body parser above the server\'s 512kb default (about 4mb); a larger pack is a 413.'
      })
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT integration token" },
      gmAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT GM session token" },
      playerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "VTT player session token",
        description:
          "Player sessions keep exactly the table's player limits: player-safe projections only, own claimed character only."
      },
      viewerCookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: VIEWER_SESSION_COOKIE,
        description:
          "Also accepted as a Bearer token; the cookie is what the paired second-screen browser actually sends."
      }
    },
    responses: {
      ApiError: {
        description: "Stable API error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } }
      }
    },
    schemas: {
      ...generated.schemas,
      HostSetup: {
        type: "object",
        additionalProperties: false,
        required: ["bootstrapped"],
        properties: { bootstrapped: { type: "boolean" } }
      },
      HostSetupResponse: envelopeSchema("#/components/schemas/HostSetup"),
      HostPasswordRequest: {
        type: "object",
        additionalProperties: false,
        required: ["password"],
        properties: { password: { type: "string", maxLength: 256 } }
      },
      GmSignIn: {
        type: "object",
        additionalProperties: false,
        required: ["token"],
        properties: { token: { type: "string" } }
      },
      GmSignInResponse: envelopeSchema("#/components/schemas/GmSignIn"),
      GmSignOut: {
        type: "object",
        additionalProperties: false,
        required: ["signedOut"],
        properties: { signedOut: { const: true } }
      },
      GmSignOutResponse: envelopeSchema("#/components/schemas/GmSignOut"),
      GmRevokeAll: {
        type: "object",
        additionalProperties: false,
        required: ["revoked"],
        properties: { revoked: { const: true } }
      },
      GmRevokeAllResponse: envelopeSchema("#/components/schemas/GmRevokeAll"),
      ViewerUrls: {
        type: "object",
        additionalProperties: false,
        required: ["viewerUrls"],
        properties: { viewerUrls: { type: "array", items: { type: "string", format: "uri" } } }
      },
      ViewerUrlsResponse: envelopeSchema("#/components/schemas/ViewerUrls"),
      GmPasswordChangeRequest: {
        type: "object",
        additionalProperties: false,
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string", maxLength: 256 },
          newPassword: { type: "string", minLength: 12, maxLength: 256 }
        }
      },
      JoinUrls: {
        type: "object",
        additionalProperties: false,
        required: ["joinUrls", "hostUrl"],
        properties: {
          joinUrls: { type: "array", items: { type: "string", format: "uri" } },
          hostUrl: { type: "string", format: "uri" }
        }
      },
      JoinUrlsResponse: envelopeSchema("#/components/schemas/JoinUrls"),
      ScreenPairing: {
        type: "object",
        additionalProperties: false,
        required: ["code", "expiresAt"],
        properties: {
          code: { type: "string", pattern: "^[0-9]{6}$" },
          expiresAt: { type: "string", format: "date-time" }
        }
      },
      ScreenPairingOpenData: {
        type: "object",
        additionalProperties: false,
        required: ["pairing"],
        properties: { pairing: { $ref: "#/components/schemas/ScreenPairing" } }
      },
      ScreenPairingOpenResponse: envelopeSchema("#/components/schemas/ScreenPairingOpenData"),
      ScreenPairingStatusData: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["status", "pairing"],
            properties: { status: { const: "waiting" }, pairing: { $ref: "#/components/schemas/ScreenPairing" } }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["status", "viewer"],
            properties: { status: { const: "paired" }, viewer: { $ref: "#/components/schemas/ViewerAccess" } }
          }
        ]
      },
      ScreenPairingStatusResponse: envelopeSchema("#/components/schemas/ScreenPairingStatusData"),
      ScreenPairingApproveRequest: {
        type: "object",
        additionalProperties: false,
        required: ["code"],
        properties: { code: { type: "string", maxLength: 32 }, name: { type: "string", maxLength: 100 } }
      },
      ScreenPairingApproveData: {
        type: "object",
        additionalProperties: false,
        required: ["approved"],
        properties: {
          approved: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: { name: { type: "string" } }
          }
        }
      },
      ScreenPairingApproveResponse: envelopeSchema("#/components/schemas/ScreenPairingApproveData"),

      ImagePoint: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y"],
        properties: { x: { type: "number" }, y: { type: "number" } }
      },
      MapAssetUploadResponse: envelopeSchema("#/components/schemas/MapAssetUploadData"),
      MapAssetUploadData: {
        type: "object",
        additionalProperties: false,
        required: ["asset", "duplicate"],
        properties: { asset: { $ref: "#/components/schemas/MapAssetMetadata" }, duplicate: { type: "boolean" } }
      },
      MapAssetListResponse: envelopeSchema("#/components/schemas/MapAssetListData"),
      MapAssetListData: {
        type: "object",
        additionalProperties: false,
        required: ["assets"],
        properties: { assets: { type: "array", items: { $ref: "#/components/schemas/MapAssetMetadata" } } }
      },
      MapAssetResponse: envelopeSchema("#/components/schemas/MapAssetData"),
      MapAssetData: {
        type: "object",
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["asset"],
            properties: { asset: { $ref: "#/components/schemas/MapAssetMetadata" } }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["map"],
            properties: { map: { $ref: "#/components/schemas/MapCatalogEntry" } }
          }
        ],
        description:
          "GET responses use `asset` (full asset metadata); PATCH/scale/calibration-complete responses use `map` (catalog entry only)."
      },
      MapCalibrationWizardResponse: envelopeSchema("#/components/schemas/MapCalibrationWizardData"),
      // The wizard's state and overlay stay flexible objects; the geometry lives in `grid-calibration*.ts`.
      MapCalibrationWizardData: {
        type: "object",
        additionalProperties: false,
        required: ["wizardId", "state", "overlay", "overlayWarning"],
        properties: {
          wizardId: { type: "string", format: "uuid" },
          state: { type: "object", additionalProperties: true },
          overlay: { type: "array", items: { type: "object", additionalProperties: true } },
          overlayWarning: { type: ["string", "null"] }
        }
      },
      ViewerPairingResponse: envelopeSchema("#/components/schemas/ViewerPairingData"),
      ViewerSessionResponse: envelopeSchema("#/components/schemas/ViewerSessionData"),
      ViewerSessionData: {
        type: "object",
        additionalProperties: false,
        required: ["viewer"],
        properties: { viewer: { $ref: "#/components/schemas/ViewerAccess" } }
      },
      ViewerAccessListResponse: envelopeSchema("#/components/schemas/ViewerAccessListData"),
      ViewerPresentationResponse: envelopeSchema("#/components/schemas/ViewerPresentationData"),
      ViewerPresentationData: {
        type: "object",
        additionalProperties: false,
        required: ["presentation"],
        properties: {
          presentation: {
            type: "object",
            additionalProperties: true,
            description: "The player-safe presentation projection; the same shape the event stream sends."
          }
        }
      },
      ViewerSoundStatusResponse: envelopeSchema("#/components/schemas/ViewerSoundStatusData"),
      ViewerSoundStatusData: {
        type: "object",
        additionalProperties: false,
        required: ["received"],
        properties: { received: { const: true } }
      },
      SoundAssetUploadResponse: envelopeSchema("#/components/schemas/SoundAssetUploadData"),
      SoundAssetUploadData: {
        type: "object",
        additionalProperties: false,
        required: ["sound", "duplicate"],
        properties: { sound: { $ref: "#/components/schemas/SoundAsset" }, duplicate: { type: "boolean" } }
      },
      SoundAssetListResponse: envelopeSchema("#/components/schemas/SoundAssetListData"),
      SoundAssetListData: {
        type: "object",
        additionalProperties: false,
        required: ["sounds"],
        properties: { sounds: { type: "array", items: { $ref: "#/components/schemas/SoundAsset" } } }
      },
      SoundAssetResponse: envelopeSchema("#/components/schemas/SoundAssetData"),
      SoundAssetData: {
        type: "object",
        additionalProperties: false,
        required: ["sound"],
        properties: { sound: { $ref: "#/components/schemas/SoundAsset" } }
      },
      SoundAssetDeletedResponse: envelopeSchema("#/components/schemas/SoundAssetDeletedData"),
      SoundAssetDeletedData: {
        type: "object",
        additionalProperties: false,
        required: ["deleted"],
        properties: { deleted: { const: true } }
      },
      SoundBoardResponse: envelopeSchema("#/components/schemas/SoundBoardData"),
      SoundBoardData: {
        type: "object",
        additionalProperties: false,
        required: ["view"],
        properties: { view: { $ref: "#/components/schemas/SoundBoardView" } }
      },
      ViewerCommandResponse: envelopeSchema("#/components/schemas/ViewerCommandData"),
      ViewerCommandData: {
        type: "object",
        additionalProperties: false,
        required: ["revision", "duplicate"],
        properties: {
          revision: { type: "integer", minimum: 0 },
          duplicate: { type: "boolean", description: "True when this command id was already applied." }
        }
      },
      ActorAvailableActionsResponse: envelopeSchema("#/components/schemas/ActorAvailableActionsData"),
      ActorMovementResponse: envelopeSchema("#/components/schemas/ActorMovementData"),
      VisionPreviewResponse: envelopeSchema("#/components/schemas/VisionPreviewData"),
      CharacterDraftResponse: envelopeSchema("#/components/schemas/CharacterDraftData"),
      BuilderOffersDraft: {
        type: "object",
        additionalProperties: false,
        required: ["level"],
        description:
          "A character-builder draft: the identity chosen so far, and the answers by offer key or a stored ledger (not both).",
        properties: {
          speciesId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 },
          backgroundId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 },
          classId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 },
          level: { type: "integer", minimum: 1, maximum: 20 },
          classLevels: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 },
            description:
              "A multiclass draft: the class each level went to, in order. Index 0 is level 1 and is `classId`; absent for one class."
          },
          picks: {
            type: "object",
            maxProperties: 200,
            additionalProperties: {
              type: "array",
              maxItems: 40,
              items: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 }
            },
            description: "Offer key -> the option ids chosen for it."
          },
          asiIncreases: {
            type: "object",
            maxProperties: 40,
            additionalProperties: { $ref: "#/components/schemas/BuilderAbilityIncreases" },
            description: "Offer key -> the +2 split, for an Ability Score Improvement answered with `asi`."
          },
          choices: {
            type: "array",
            maxItems: 200,
            items: { $ref: "#/components/schemas/BuilderChoiceRow" },
            description: "A stored choice ledger, read back onto the offers it answers."
          },
          sheet: {
            type: "object",
            additionalProperties: false,
            required: ["level", "abilityScores"],
            description:
              "With `choices`: the stored sheet's own level and ability scores, so the reply's `abilities` can say how those scores were made.",
            properties: {
              level: { type: "integer", minimum: 1, maximum: 20 },
              abilityScores: {
                type: "object",
                additionalProperties: false,
                required: ["str", "dex", "con", "int", "wis", "cha"],
                properties: Object.fromEntries(
                  ["str", "dex", "con", "int", "wis", "cha"].map((ability) => [
                    ability,
                    { type: "integer", minimum: 1, maximum: 30 }
                  ])
                )
              }
            }
          }
        }
      },
      BuilderOffersResponse: envelopeSchema("#/components/schemas/BuilderOffersData"),
      ContentMonstersResponse: envelopeSchema("#/components/schemas/ContentMonstersData"),
      ContentMonsterBenchmarksResponse: envelopeSchema("#/components/schemas/ContentMonsterBenchmarksData"),
      ContentMonsterSheetData: {
        type: "object",
        additionalProperties: false,
        required: ["definition"],
        properties: {
          definition: { type: "object", additionalProperties: true, description: "The full canonical ActorDefinition" }
        }
      },
      ContentMonsterSheetResponse: envelopeSchema("#/components/schemas/ContentMonsterSheetData"),
      ContentMonsterActionsData: {
        type: "object",
        additionalProperties: false,
        required: ["actions"],
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              description:
                "id, name, activation, description, attackBonus, reachFeet, rangeFeet, saveAbility, saveDc, damage[], area"
            }
          }
        }
      },
      ContentMonsterActionsResponse: envelopeSchema("#/components/schemas/ContentMonsterActionsData"),
      ContentConditionsResponse: envelopeSchema("#/components/schemas/ContentConditionsData"),
      ContentGlossaryResponse: envelopeSchema("#/components/schemas/ContentGlossaryData"),
      ContentSkillsResponse: envelopeSchema("#/components/schemas/ContentSkillsData"),
      ContentLanguagesResponse: envelopeSchema("#/components/schemas/ContentLanguagesData"),
      ContentSpellsResponse: envelopeSchema("#/components/schemas/ContentSpellsData"),
      ContentEquipmentResponse: envelopeSchema("#/components/schemas/ContentEquipmentData"),
      ContentClassesResponse: envelopeSchema("#/components/schemas/ContentClassesData"),
      ContentSubclassesResponse: envelopeSchema("#/components/schemas/ContentSubclassesData"),
      ContentSpeciesResponse: envelopeSchema("#/components/schemas/ContentSpeciesData"),
      ContentBackgroundsResponse: envelopeSchema("#/components/schemas/ContentBackgroundsData"),
      ContentFeatsResponse: envelopeSchema("#/components/schemas/ContentFeatsData"),
      ContentNamesResponse: envelopeSchema("#/components/schemas/ContentNamesData"),
      EncounterArchiveVisibilityRequest: {
        type: "object",
        additionalProperties: false,
        required: ["playerVisible"],
        properties: {
          playerVisible: {
            type: "boolean",
            description: "true shares this archived fight with players; false hides it again (the default)"
          }
        }
      },
      // ===== Codex (codex-http.ts): the role-projected reads and the response envelopes. The records themselves
      // are generated from `@vtt/domain`'s codex-wire schemas. =====
      CodexPageProjected: codexProjected("CodexPage"),
      CodexPageSummaryProjected: codexProjected("CodexPageSummary"),
      CodexMapProjected: codexProjected("CodexMap"),
      CodexMarkerProjected: codexProjected("CodexMarker"),
      CodexJournalEntryProjected: codexProjected("CodexJournalEntry"),
      CodexChronicleRecordProjected: codexProjected("CodexChronicleRecord"),
      CodexSessionProjected: codexProjected("CodexSession"),
      CodexQuestProjected: codexProjected("CodexQuest"),
      CodexStandingProjected: codexProjected("CodexStanding"),
      CodexCalendarProjected: codexProjected("CodexCalendar"),
      CodexDeletedData: {
        type: "object",
        additionalProperties: false,
        required: ["deleted"],
        properties: { deleted: { const: true } }
      },
      CodexDeletedResponse: envelopeSchema("#/components/schemas/CodexDeletedData"),
      // ---- Response envelopes. A role-projected read's `*Data` names the `*Projected` wrapper; GM-only reads and
      // writes keep the direct GM ref. Edge lists are role-uniform (players just get fewer rows), so need no wrapper.
      CodexPageListData: codexDataObject("pages", codexArrayRef("CodexPageSummaryProjected")),
      CodexPageListResponse: envelopeSchema("#/components/schemas/CodexPageListData"),
      CodexSearchResponse: envelopeSchema("#/components/schemas/CodexSearchData"),
      CodexConnectionProjected: codexProjected("CodexConnection"),
      CodexConnectionData: codexDataObject("connection", { $ref: "#/components/schemas/CodexConnection" }),
      CodexConnectionResponse: envelopeSchema("#/components/schemas/CodexConnectionData"),
      CodexConnectionListData: codexDataObject("connections", codexArrayRef("CodexConnectionProjected")),
      CodexConnectionListResponse: envelopeSchema("#/components/schemas/CodexConnectionListData"),
      CodexPageConnectionProjected: codexProjected("CodexPageConnection"),
      CodexPageDocumentData: {
        type: "object",
        additionalProperties: false,
        required: ["page", "connections"],
        properties: {
          page: { $ref: "#/components/schemas/CodexPageProjected" },
          connections: codexArrayRef("CodexPageConnectionProjected")
        }
      },
      CodexPageDocumentResponse: envelopeSchema("#/components/schemas/CodexPageDocumentData"),
      CodexPageData: codexDataObject("page", { $ref: "#/components/schemas/CodexPage" }),
      CodexPageResponse: envelopeSchema("#/components/schemas/CodexPageData"),
      CodexFolderListData: codexDataObject("folders", { type: "array", items: { type: "string" } }),
      CodexFolderListResponse: envelopeSchema("#/components/schemas/CodexFolderListData"),
      CodexPreviewSessionData: codexDataObject("token", { type: "string" }),
      CodexPreviewSessionResponse: envelopeSchema("#/components/schemas/CodexPreviewSessionData"),
      CodexFolderCreatedData: codexDataObject("path", { type: "string" }),
      CodexFolderCreatedResponse: envelopeSchema("#/components/schemas/CodexFolderCreatedData"),
      CodexFolderMovedData: codexDataObject("moved", { type: "integer", minimum: 0 }),
      CodexFolderMovedResponse: envelopeSchema("#/components/schemas/CodexFolderMovedData"),
      CodexRevisionListData: codexDataObject("revisions", codexArrayRef("CodexPageRevision")),
      CodexRevisionListResponse: envelopeSchema("#/components/schemas/CodexRevisionListData"),
      CodexMapListData: codexDataObject("maps", codexArrayRef("CodexMapProjected")),
      CodexMapListResponse: envelopeSchema("#/components/schemas/CodexMapListData"),
      CodexMapData: codexDataObject("map", { $ref: "#/components/schemas/CodexMap" }),
      CodexMapResponse: envelopeSchema("#/components/schemas/CodexMapData"),
      CodexMarkerListData: codexDataObject("markers", codexArrayRef("CodexMarkerProjected")),
      CodexMarkerListResponse: envelopeSchema("#/components/schemas/CodexMarkerListData"),
      CodexMarkerData: codexDataObject("marker", { $ref: "#/components/schemas/CodexMarker" }),
      // The role-projected single-pin read; `CodexMarkerData` above stays GM-shaped because only writes use it.
      CodexMarkerProjectedData: codexDataObject("marker", { $ref: "#/components/schemas/CodexMarkerProjected" }),
      CodexMarkerProjectedResponse: envelopeSchema("#/components/schemas/CodexMarkerProjectedData"),
      CodexPartyLocation: {
        type: "object",
        additionalProperties: false,
        description:
          "The party pin and the map it is on. `marker.mapId` is the jump target; `mapName` rides along so a caller needs no second fetch to label the card.",
        required: ["marker", "mapName"],
        properties: { marker: { $ref: "#/components/schemas/CodexMarkerProjected" }, mapName: { type: "string" } }
      },
      CodexPartyLocationData: {
        type: "object",
        additionalProperties: false,
        required: ["party"],
        properties: {
          party: {
            oneOf: [{ $ref: "#/components/schemas/CodexPartyLocation" }, { type: "null" }],
            description:
              "Null when there is no party pin - or, for a player, when the party pin is not visible to them."
          }
        }
      },
      CodexPartyLocationResponse: envelopeSchema("#/components/schemas/CodexPartyLocationData"),
      CodexMarkerResponse: envelopeSchema("#/components/schemas/CodexMarkerData"),
      CodexJournalListData: codexDataObject("entries", codexArrayRef("CodexJournalEntryProjected")),
      CodexJournalListResponse: envelopeSchema("#/components/schemas/CodexJournalListData"),
      CodexChronicleListData: codexDataObject("records", codexArrayRef("CodexChronicleRecordProjected")),
      CodexChronicleListResponse: envelopeSchema("#/components/schemas/CodexChronicleListData"),
      CodexJournalEntryData: codexDataObject("entry", { $ref: "#/components/schemas/CodexJournalEntry" }),
      CodexJournalEntryResponse: envelopeSchema("#/components/schemas/CodexJournalEntryData"),
      // Payloads with a sibling beside the record, so neither uses `codexDataObject`. Creating downtime returns the
      // date it proposes (so the GM can confirm it); applying returns the calendar, since one operation moved both.
      CodexDowntimeCreatedData: {
        type: "object",
        additionalProperties: false,
        required: ["entry", "proposedDate"],
        properties: {
          entry: { $ref: "#/components/schemas/CodexJournalEntry" },
          proposedDate: {
            ...codexInWorldDateOrNull,
            description:
              "Where the campaign clock WOULD land if the GM confirms. Null when there is no current date to advance from. Nothing has moved yet."
          }
        }
      },
      CodexDowntimeCreatedResponse: envelopeSchema("#/components/schemas/CodexDowntimeCreatedData"),
      CodexDowntimeAppliedData: {
        type: "object",
        additionalProperties: false,
        required: ["entry", "calendar"],
        properties: {
          entry: { $ref: "#/components/schemas/CodexJournalEntry" },
          calendar: { $ref: "#/components/schemas/CodexCalendar" }
        },
        description:
          "The confirmed downtime and the moved calendar, together - they changed in one transaction and are returned in one payload so a reader cannot hold one without the other. The calendar is the GM projection; the party's published date has NOT moved."
      },
      CodexDowntimeAppliedResponse: envelopeSchema("#/components/schemas/CodexDowntimeAppliedData"),
      // Carries the active-session pointer beside the array, so it cannot use `codexDataObject`.
      CodexSessionListData: {
        type: "object",
        additionalProperties: false,
        required: ["sessions", "activeSessionId"],
        properties: {
          sessions: codexArrayRef("CodexSessionProjected"),
          activeSessionId: {
            ...codexNullableUuid,
            description:
              "The session new journal entries are stamped from. GM-only: always `null` for a player, because the active session is frequently the unrevealed one being prepped and naming it would leak that it exists."
          }
        }
      },
      CodexSessionListResponse: envelopeSchema("#/components/schemas/CodexSessionListData"),
      CodexSessionData: codexDataObject("session", { $ref: "#/components/schemas/CodexSession" }),
      CodexSessionResponse: envelopeSchema("#/components/schemas/CodexSessionData"),
      // The session read projects per role while writes are GM-grade, so the read gets its own envelope.
      CodexSessionProjectedData: codexDataObject("session", { $ref: "#/components/schemas/CodexSessionProjected" }),
      CodexSessionProjectedResponse: envelopeSchema("#/components/schemas/CodexSessionProjectedData"),
      // Activate returns only the pointer: activation changes nothing on the session row.
      CodexSessionActiveData: codexDataObject("activeSessionId", codexNullableUuid),
      CodexSessionActiveResponse: envelopeSchema("#/components/schemas/CodexSessionActiveData"),
      // Open quests are answered by each row's `status`, so this is a plain `codexDataObject`.
      CodexQuestListData: codexDataObject("quests", codexArrayRef("CodexQuestProjected")),
      CodexQuestListResponse: envelopeSchema("#/components/schemas/CodexQuestListData"),
      CodexQuestData: codexDataObject("quest", { $ref: "#/components/schemas/CodexQuest" }),
      CodexQuestResponse: envelopeSchema("#/components/schemas/CodexQuestData"),
      CodexQuestProjectedData: codexDataObject("quest", { $ref: "#/components/schemas/CodexQuestProjected" }),
      CodexQuestProjectedResponse: envelopeSchema("#/components/schemas/CodexQuestProjectedData"),
      CodexStandingListData: codexDataObject("standing", codexArrayRef("CodexStandingProjected")),
      CodexStandingListResponse: envelopeSchema("#/components/schemas/CodexStandingListData"),
      CodexStandingData: codexDataObject("standing", { $ref: "#/components/schemas/CodexStanding" }),
      CodexStandingResponse: envelopeSchema("#/components/schemas/CodexStandingData"),
      CodexRevealAuditData: codexDataObject("audit", { $ref: "#/components/schemas/CodexRevealAudit" }),
      CodexRevealAuditResponse: envelopeSchema("#/components/schemas/CodexRevealAuditData"),
      CodexCalendarData: codexDataObject("calendar", { $ref: "#/components/schemas/CodexCalendar" }),
      CodexCalendarResponse: envelopeSchema("#/components/schemas/CodexCalendarData"),
      CodexCalendarCheckData: codexDataObject("moves", codexArrayRef("CodexCalendarMove")),
      CodexCalendarCheckResponse: envelopeSchema("#/components/schemas/CodexCalendarCheckData"),
      // The GET projects per role; calendar writes and the apply-downtime payload keep the GM shape.
      CodexCalendarProjectedData: codexDataObject("calendar", { $ref: "#/components/schemas/CodexCalendarProjected" }),
      CodexCalendarProjectedResponse: envelopeSchema("#/components/schemas/CodexCalendarProjectedData"),
      CodexSettingsData: codexDataObject("settings", { $ref: "#/components/schemas/CodexSettings" }),
      CodexSettingsResponse: envelopeSchema("#/components/schemas/CodexSettingsData"),
      // A count rather than `CodexDeletedData`'s `deleted: true`: the real number of rows removed.
      CodexRevisionsDeletedData: codexDataObject("deleted", {
        type: "integer",
        minimum: 0,
        description: "How many revision rows were actually removed - the database's own count, not what was requested."
      }),
      CodexRevisionsDeletedResponse: envelopeSchema("#/components/schemas/CodexRevisionsDeletedData"),
      CodexExportData: {
        type: "object",
        additionalProperties: false,
        required: ["codex", "exportedAt", "bundleVersion"],
        properties: {
          codex: {
            type: "object",
            additionalProperties: true,
            description: "Opaque backup bundle; round-trips through `POST /codex/import`."
          },
          exportedAt: { type: "string", format: "date-time" },
          bundleVersion: {
            const: 1,
            description:
              "The bundle FORMAT version - a fact about the file, not about the world, which is why it sits beside `codex` rather than inside it. `POST /codex/import` refuses anything else."
          }
        }
      },
      CodexImportedData: {
        type: "object",
        additionalProperties: false,
        required: ["replaced", "counts"],
        properties: { replaced: { const: true }, counts: { $ref: "#/components/schemas/CodexImportCounts" } }
      },
      CodexImportedResponse: envelopeSchema("#/components/schemas/CodexImportedData"),
      CodexExportResponse: envelopeSchema("#/components/schemas/CodexExportData"),
      CodexAssetUploadData: codexDataObject("asset", { $ref: "#/components/schemas/CodexAsset" }),
      CodexAssetUploadResponse: envelopeSchema("#/components/schemas/CodexAssetUploadData")
    }
  }
} as const;
