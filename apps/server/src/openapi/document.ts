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
  SYSTEM_PATHS,
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

// Reusable fragments for the character-builder catalogs.
/** Identity ids are open slugs, never closed enums, so homebrew stays additive. */
const contentSlug = { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 } as const;
/** The discriminator that lets one merged catalog serve bundled SRD and GM homebrew. */
const contentSource = { type: "string", enum: ["srd", "homebrew"] } as const;
const contentAbilities = {
  type: "array",
  items: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] }
} as const;
const contentFeatures = { type: "array", items: { $ref: "#/components/schemas/ContentFeature" } } as const;
/** A starting-equipment bundle with resolvable contents (a label alone can't become inventory). Shared by classes and backgrounds, which offer the identical choice. */
const contentStartingEquipmentOptions = {
  type: "array",
  description:
    "Starting-equipment bundles with their items and the \"or take N gp\" alternative; the chosen option's id is recorded in the character's choice ledger",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "items", "goldPieces"],
    properties: {
      id: contentSlug,
      label: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "quantity"],
          properties: {
            id: contentSlug,
            name: { type: "string" },
            quantity: { type: "integer", minimum: 1, maximum: 99 }
          }
        }
      },
      goldPieces: { type: "integer", minimum: 0, maximum: 1000 }
    }
  }
} as const;
/** A "choose N from this list" proficiency grant, or null when the record offers none. Shared by class tool choices and background skill/tool/language choices. */
const contentChoiceList = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["choose", "from", "fromCatalog"],
      properties: {
        choose: { type: "integer", minimum: 0, maximum: 10 },
        from: { type: "array", items: contentSlug },
        fromCatalog: {
          type: ["string", "null"],
          description:
            'An open catalog slug supplying the options instead of (or beside) `from` - the same grammar a feature\'s `fromCatalog` uses, resolved by the same function on both sides. Species language choices use "standard-languages"; null when `from` names the options outright'
        }
      }
    },
    { type: "null" }
  ]
} as const;
/** A class's (or third-caster subclass's) spellcasting header; null for a non-caster. `spellListId` pairs with each spell's `classes` tags to restore the class->spell-list link on the wire. */
const contentSpellcastingSummary = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["ability", "prepares", "ritual", "focus", "progression", "spellListId"],
      properties: {
        ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
        prepares: {
          type: "string",
          enum: ["known", "prepared"],
          description: "known = a fixed spells-known list; prepared = re-chosen on a long rest"
        },
        ritual: { type: "boolean" },
        focus: {
          type: ["string", "null"],
          description: "Spellcasting focus slug (arcane-focus, holy-symbol); null = none"
        },
        progression: {
          type: "string",
          enum: ["full", "half", "third", "pact"],
          description: "How this class's levels count toward the shared multiclass caster level"
        },
        spellListId: {
          type: ["string", "null"],
          description: "The spell list this class draws from - an open slug matched against each spell's `classes` tags"
        }
      }
    },
    { type: "null" }
  ]
} as const;
/** The printed 20-row class table as display data. Optional columns are null ("this class has no such column"), never 0. Structured feature riders stay server-side so the wizard can't become a second rules engine. */
const contentClassLevelTable = {
  type: "array",
  description:
    "The class's full 20-row printed progression: slot columns, cantrips/spells known, the prepared-spell formula, and the named resources that grow with level (Second Wind 2 to 4, Rage 3, Sneak Attack 3d6)",
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "level",
      "proficiencyBonus",
      "spellSlots",
      "pactSlots",
      "cantripsKnown",
      "spellsKnown",
      "preparedFormula",
      "preparedCount",
      "classResources"
    ],
    properties: {
      level: { type: "integer", minimum: 1, maximum: 20 },
      proficiencyBonus: { type: "integer", minimum: 2, maximum: 6 },
      spellSlots: {
        description: "Nine counts, index 0 = 1st-level slots; null for a non-caster row",
        oneOf: [
          { type: "array", minItems: 9, maxItems: 9, items: { type: "integer", minimum: 0, maximum: 4 } },
          { type: "null" }
        ]
      },
      pactSlots: {
        description: "Warlock Pact Magic: one uniform slot level with its own count",
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["level", "slots"],
            properties: {
              level: { type: "integer", minimum: 1, maximum: 9 },
              slots: { type: "integer", minimum: 0, maximum: 4 }
            }
          },
          { type: "null" }
        ]
      },
      cantripsKnown: { type: ["integer", "null"], minimum: 0, maximum: 10 },
      spellsKnown: { type: ["integer", "null"], minimum: 0, maximum: 40 },
      preparedFormula: {
        type: ["string", "null"],
        description:
          'The SRD prepared-spell rule as data ("<ability> modifier + <class> level") so homebrew can print its own wording'
      },
      preparedCount: { type: ["integer", "null"], minimum: 0, maximum: 60 },
      classResources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "amount"],
          properties: {
            id: contentSlug,
            name: { type: "string" },
            amount: {
              oneOf: [
                { type: "integer", minimum: 0, maximum: 999 },
                { type: "string", maxLength: 20 }
              ],
              description: 'A count, or a dice string ("3d6" for Sneak Attack)'
            }
          }
        }
      }
    }
  }
} as const;

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
// Reusable codex schema fragments.
const codexEntityType = {
  type: "string",
  enum: ["note", "character", "location", "faction", "item", "species", "religion", "event"]
} as const;
const codexMapKind = { type: "string", enum: ["battlemap", "regional", "world"] } as const;
const codexStringMap = { type: "object", additionalProperties: { type: "string" } } as const;
const codexUuid = { type: "string", format: "uuid" } as const;
const codexNullableUuid = { type: ["string", "null"], format: "uuid" } as const;
const codexInWorldDateOrNull = {
  oneOf: [{ $ref: "#/components/schemas/CodexInWorldDate" }, { type: "null" }]
} as const;
/** Dating shared by pages and journal entries: `inWorldDate` is the GM's raw input and source of truth;
 * `inWorldLabel` and `calendarInstant` are derived and recomputed whenever the world calendar changes. */
const codexPageDating = {
  inWorldLabel: {
    type: ["string", "null"],
    description: "Display form of the in-world date, derived from the calendar."
  },
  calendarInstant: { type: ["number", "null"], description: "Sortable absolute day index derived from the calendar." },
  inWorldDate: {
    ...codexInWorldDateOrNull,
    description: "The raw in-world date; the source of truth the other two are derived from."
  }
} as const;
const codexSessionStatus = { type: "string", enum: ["planned", "played"] } as const;
/** Quest objectives: 24 items and 120 characters of text, the repo's existing list and one-line bounds. */
const codexQuestStatus = {
  type: "string",
  enum: ["not-started", "active", "completed", "failed", "canceled"],
  description:
    "In LIFECYCLE order. `not-started` and `active` are the OPEN states - a quest the party can still do - and `completed`, `failed` and `canceled` are three different ways of being finished with one. `canceled` is not a synonym for `failed`: a lead the party never took up did not fail. A quest created without a status is `not-started`."
} as const;
const codexQuestObjectives = {
  type: "array",
  maxItems: 24,
  items: { $ref: "#/components/schemas/CodexQuestObjective" }
} as const;
const codexQuestEntityIds = { type: "array", maxItems: 24, items: codexUuid } as const;
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
    // A player session is authenticated and denied: 403, never 401.
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
      "Versioned, recipient-safe integration contract for a self-hosted VTT. Game writes accept an optional `commandId` (UUID) executed exactly once - supply your own and resend it to retry safely, and the server replays the stored outcome with `duplicate: true`; codex JSON-body writes accept one too - a replay carries `x-idempotent-replay: true` - while codex body-less POSTs, codex DELETEs and every homebrew write carry none and rely on `expectedRev` plus their own conflict rules instead. Stale-revision writes are rejected with 409 + `error.currentRevision` (`expectedRevision` targets the global game revision; `expectedRev` targets one record's revision). Role denials are 403, a missing credential is 401, and the existence of a secret record always reads as 404."
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
          "401": apiError
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
          "401": apiError
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
          "401": apiError
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "404": { $ref: "#/components/responses/ApiError" }
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
    [VIEWER_PATHS.access]: {
      get: {
        operationId: "listViewerAccess",
        security: [{ gmAuth: [] }],
        responses: {
          "200": {
            description: "Every paired viewer plus which are currently connected",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerAccessListResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
              "Current player-safe presentation state (map, camera, measurement, pings, initiative, encounter)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ViewerPresentationResponse" } } }
          },
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "401": { $ref: "#/components/responses/ApiError" }
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
          "What the content asks a character-builder draft to pick, worked out by the same survey `POST /game/characters` validates against, so a builder offers exactly what a create accepts. Each offer names its builder step, its options (named, with spell levels), its capacity after every feature that raises it, the level its rows are stamped with (one offer per grant level, so each Ability Score Improvement is its own), and the options this build cannot usefully take. The reply also carries the answers the build still accepts (an answer it no longer offers is dropped) and the ledger rows they make, which a create sends as `choices`. Send the answers by offer key, or a stored ledger as `choices` to read a character back for a rebuild. The GM always; a player session while the table's builder policy lets players build.",
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
          'One GM view of everything the party can currently see, across every reveal surface in the Codex - pages, maps, markers, journal (all six kinds), sessions, quests and standing. GM-only, and READ-ONLY: it is an AGGREGATION of the existing player projections, not a second opinion about visibility, so it lists exactly what the corresponding player-facing endpoints would return - a marker flagged revealed on a HIDDEN map is absent here, because the party cannot see it either. Every section is always present, empty ones included with `revealed: 0`, so "nothing is revealed here" cannot be mistaken for "this did not load". Each row carries the id its own kind\'s EXISTING reveal route takes, which is how un-revealing works from this surface: there is deliberately no unreveal route and no bulk operation. Table-side exposure (tokens, fog, the shared viewer) is deliberately out of scope - that system has its own visibility rules, and folding it in would make this the second place that decides what a player can see.'
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
          "Replaces the authored `record` and leaves `state`, `visibleToPlayers`, and `deletedAt` alone - genuinely correct PATCH semantics on the ROW, even though the `record` value it carries is complete. A partial merge into a polymorphic body under `additionalProperties: false` is unspecifiable, so the body is always the whole record."
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
          'Moves a record to `state: "published"`, which requires it to be valid. Publishing does NOT show it to players - that is `/visibility`, deliberately a separate endpoint. A publish REQUEST that is itself malformed is a 400; a well-formed request against a draft the stored state refuses is a 409.'
      })
    },
    [HOMEBREW_PATHS.contentUnpublish]: {
      post: homebrewOp("unpublishHomebrewContent", "HomebrewContentResponse", {
        body: "HomebrewStateChangeRequest",
        bodyRequired: false,
        params: [homebrewIdParam],
        notFound: true,
        description:
          'Returns a record to `state: "draft"`. It leaves the merged catalogs at once and may be invalid again while the GM reworks it.'
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
          "Which characters took this record, computed on demand from the character choice ledger (no persisted reverse index at this data volume). `safeToDelete` is always true and says so calmly: a built character carries a flattened, self-contained ActorDefinition, so deleting a homebrew record never breaks one."
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

      ImagePoint: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y"],
        properties: { x: { type: "number" }, y: { type: "number" } }
      },
      /** Calibration/scale/wizard-state internals stay flexible objects; the geometry lives in apps/server/src/grid-calibration*.ts. */
      MapAssetMetadata: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "kind",
          "originalName",
          "format",
          "mediaType",
          "width",
          "height",
          "byteLength",
          "importedAt",
          "calibration",
          "scale",
          "updatedAt"
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          kind: { type: "string", enum: ["battlemap", "regional", "world"] },
          originalName: { type: "string" },
          format: { type: "string" },
          mediaType: { type: "string" },
          width: { type: "integer", minimum: 1 },
          height: { type: "integer", minimum: 1 },
          byteLength: { type: "integer", minimum: 1 },
          importedAt: { type: "string", format: "date-time" },
          calibration: { type: ["object", "null"], additionalProperties: true },
          scale: { type: ["object", "null"], additionalProperties: true },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      MapCatalogEntry: {
        type: "object",
        additionalProperties: false,
        required: ["assetId", "name", "kind", "calibration", "scale", "createdAt", "updatedAt"],
        properties: {
          assetId: { type: "string", format: "uuid" },
          name: { type: "string" },
          kind: { type: "string", enum: ["battlemap", "regional", "world"] },
          calibration: { type: ["object", "null"], additionalProperties: true },
          scale: { type: ["object", "null"], additionalProperties: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
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
      ViewerAccess: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "createdAt", "expiresAt", "lastUsedAt", "revokedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: ["string", "null"], format: "date-time" },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      ViewerPairingResponse: envelopeSchema("#/components/schemas/ViewerPairingData"),
      ViewerPairingData: {
        type: "object",
        additionalProperties: false,
        required: ["pairing"],
        properties: {
          pairing: {
            type: "object",
            additionalProperties: false,
            required: ["code", "expiresAt"],
            properties: { code: { type: "string" }, expiresAt: { type: "string", format: "date-time" } }
          }
        }
      },
      ViewerSessionResponse: envelopeSchema("#/components/schemas/ViewerSessionData"),
      ViewerSessionData: {
        type: "object",
        additionalProperties: false,
        required: ["viewer"],
        properties: { viewer: { $ref: "#/components/schemas/ViewerAccess" } }
      },
      ViewerAccessListResponse: envelopeSchema("#/components/schemas/ViewerAccessListData"),
      ViewerAccessListData: {
        type: "object",
        additionalProperties: false,
        required: ["viewers", "connections"],
        properties: {
          viewers: { type: "array", items: { $ref: "#/components/schemas/ViewerAccess" } },
          connections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["connectionId", "viewerId", "name", "connectedAt"],
              properties: {
                connectionId: { type: "string" },
                viewerId: { type: "string", format: "uuid" },
                name: { type: "string" },
                connectedAt: { type: "string", format: "date-time" }
              }
            }
          }
        }
      },
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
      /** The deep game shapes are owned by @vtt/domain and evolve additively; the API contract pins the envelope, not every field. */
      ActorAvailableActionsData: {
        type: "object",
        additionalProperties: false,
        required: ["rulesMode", "actions", "derived"],
        properties: {
          rulesMode: { type: "string", enum: ["strict", "assisted", "freeform"] },
          derived: {
            type: "object",
            additionalProperties: false,
            required: ["proficiencyBonus", "armorClass", "initiative", "abilities", "skills", "defences"],
            description:
              "DISPLAY ONLY, and the sheet's single source for every number beside a roll button. Derived from the actor's LIVE loadout with the same functions the resolver uses, so a chip cannot disagree with the roll it starts - a circlet's granted expertise and an amulet's save bonus are already inside these numbers. Present on every response; a client should still tolerate its absence so it can talk to an older server. It rides this REQUEST rather than the broadcast game-state projection on purpose: this endpoint already authorizes its caller for one named actor, so the block is never even computed for an actor the caller may not see.",
            properties: {
              proficiencyBonus: { type: "integer" },
              armorClass: {
                type: "integer",
                description: "Live AC, already reconciled against worn armour and item riders"
              },
              initiative: { type: "integer", description: "Live initiative bonus including item riders" },
              abilities: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["ability", "check", "checkWithProficiency", "save", "saveProficient", "saveFromItems"],
                  properties: {
                    ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
                    check: { type: "integer", description: "Ability-check bonus INCLUDING item check-bonus riders" },
                    checkWithProficiency: {
                      type: "integer",
                      description: "The same check plus proficiency, for a GM-called check against no named skill"
                    },
                    save: {
                      type: "integer",
                      description: "The save the server will actually roll, minus only per-save cover"
                    },
                    saveProficient: { type: "boolean" },
                    saveFromItems: {
                      type: "integer",
                      description: "The equipment share of `save`, so a sheet can say where the bonus came from"
                    }
                  }
                }
              },
              skills: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "name", "ability", "tier", "bonus", "sources"],
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    ability: { type: ["string", "null"], enum: ["str", "dex", "con", "int", "wis", "cha", null] },
                    tier: {
                      type: "string",
                      enum: ["none", "proficient", "expertise"],
                      description: "The EFFECTIVE tier: the sheet's base tier raised by any item grant"
                    },
                    bonus: {
                      type: ["integer", "null"],
                      description: "Null only when the skill names no ability, the one case a sheet cannot roll it"
                    },
                    sources: {
                      type: "array",
                      items: { type: "string" },
                      description: 'Item names that raised the tier, e.g. ["Circlet of Shadows"]'
                    }
                  }
                }
              },
              defences: {
                type: "object",
                additionalProperties: false,
                required: ["resistances", "immunities", "vulnerabilities"],
                description:
                  "The damage defences in force outside any one hit, as the damage pipeline applies them: the stat block's, chosen features', items' and effects'. Petrified and underwater resistance are added per hit and are not listed.",
                properties: Object.fromEntries(
                  ["resistances", "immunities", "vulnerabilities"].map((key) => [
                    key,
                    {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["type", "source"],
                        properties: {
                          type: { type: "string", description: 'A damage type, e.g. "fire"' },
                          source: {
                            type: ["string", "null"],
                            description: "The feature, item or effect that grants it; null for the stat block itself"
                          }
                        }
                      }
                    }
                  ])
                )
              }
            }
          },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "activation",
                "available",
                "violations",
                "usesRemaining",
                "componentsRemaining",
                "description",
                "attackBonus",
                "reachFeet",
                "rangeFeet",
                "rangeNormalFeet",
                "attackCount",
                "saveAbility",
                "saveDc",
                "damage",
                "usesLimit",
                "usesPer",
                "usesPool",
                "requiresEffectTag",
                "multiattack",
                "reaction"
              ],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                activation: { type: "string", enum: ["action", "bonus-action", "reaction", "other"] },
                available: {
                  type: "boolean",
                  description: "Whether strict mode would allow resolving this action right now"
                },
                violations: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["rule", "message"],
                    properties: {
                      rule: {
                        type: "string",
                        description:
                          "Machine-readable rule id, e.g. economy.action-used, feature.requires-effect, condition.incapacitated"
                      },
                      message: { type: "string" }
                    }
                  }
                },
                usesRemaining: {
                  type: ["integer", "null"],
                  minimum: 0,
                  description: "Limited-use spending left; null when the action has no use limit"
                },
                componentsRemaining: {
                  type: ["integer", "null"],
                  minimum: 0,
                  description: "Rolls left in the open compound-action instance; null when no instance applies"
                },
                builtin: {
                  type: "boolean",
                  description:
                    "True for the SRD generic actions (Dodge, Dash, Help, Unarmed Strike, ...) every combatant can take"
                },
                description: {
                  type: "string",
                  description:
                    "DISPLAY ONLY. Every field from here down is read off the actor's EFFECTIVE action list, so it already carries the standing riders of what is equipped and attuned - which is what lets a client render an item-derived action (an amulet's cast, a +1 sword's swing) that is absent from the stat block entirely. None of it is what gets rolled: resolution takes `id` and recomputes through the same function, so a preview cannot disagree with the roll."
                },
                attackBonus: {
                  type: ["integer", "null"],
                  description: "To-hit including item riders; null when the action has no attack roll"
                },
                reachFeet: { type: ["integer", "null"] },
                rangeFeet: { type: ["integer", "null"] },
                rangeNormalFeet: {
                  type: ["integer", "null"],
                  description: "Normal range band; shots beyond it up to rangeFeet roll at disadvantage"
                },
                attackCount: { type: ["integer", "null"] },
                saveAbility: { type: ["string", "null"] },
                saveDc: { type: ["integer", "null"], description: "Save DC including item riders" },
                damage: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["formula", "type"],
                    properties: { formula: { type: "string" }, type: { type: "string" } }
                  }
                },
                usesLimit: {
                  type: ["integer", "null"],
                  description: "Total limited uses including any item that raised the pool; null when unlimited"
                },
                usesPer: {
                  type: ["string", "null"],
                  enum: ["turn", "encounter", "long-rest", "short-rest", "recharge", null]
                },
                usesPool: {
                  type: ["string", "null"],
                  description: "Shared pool key; actions naming one pool spend one counter"
                },
                requiresEffectTag: { type: ["string", "null"] },
                multiattack: {
                  oneOf: [
                    {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["actionId", "count"],
                        properties: { actionId: { type: "string" }, count: { type: "integer" } }
                      }
                    },
                    { type: "null" }
                  ]
                },
                reaction: {
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["trigger", "response"],
                      properties: {
                        trigger: { type: "string", enum: ["hit-by-attack"] },
                        response: { type: "string", enum: ["half-damage"] }
                      }
                    },
                    { type: "null" }
                  ]
                }
              }
            }
          }
        }
      },
      ActorAvailableActionsResponse: envelopeSchema("#/components/schemas/ActorAvailableActionsData"),
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
          }
        }
      },
      BuilderAbilityIncreases: {
        type: "array",
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ability", "amount"],
          properties: {
            ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
            amount: { type: "integer", minimum: 1, maximum: 2 }
          }
        }
      },
      BuilderChoiceRow: {
        type: "object",
        additionalProperties: false,
        required: ["level", "kind", "id"],
        properties: {
          level: { type: "integer", minimum: 1, maximum: 20 },
          classId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 },
          kind: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 },
          id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 },
          payload: { type: "object", additionalProperties: true }
        }
      },
      BuilderOffersData: {
        type: "object",
        additionalProperties: false,
        required: ["offers", "picks", "asiIncreases", "subclassId", "choices"],
        properties: {
          offers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "key",
                "step",
                "featureId",
                "kind",
                "label",
                "help",
                "capacity",
                "options",
                "maxSpellLevel",
                "level",
                "classId",
                "unresolvable",
                "unavailable"
              ],
              properties: {
                key: { type: "string", description: "Stable key the draft's answers are filed under" },
                step: { type: "string", enum: ["species", "background", "class", "features", "equipment"] },
                featureId: { type: ["string", "null"] },
                kind: { type: "string" },
                label: { type: "string" },
                help: { type: ["string", "null"] },
                capacity: { type: "integer", minimum: 0 },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "name"],
                    properties: { id: { type: "string" }, name: { type: "string" }, level: { type: "integer" } }
                  }
                },
                maxSpellLevel: { type: ["integer", "null"] },
                level: { type: "integer", minimum: 1, maximum: 20 },
                classId: { type: ["string", "null"] },
                unresolvable: {
                  type: ["string", "null"],
                  description: "Why nothing can be picked here yet; such an offer may be left open"
                },
                unavailable: {
                  type: ["object", "null"],
                  additionalProperties: { type: "string" },
                  description: "Option id -> why this build cannot usefully take it (already held, or no proficiency)"
                }
              }
            }
          },
          picks: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
            description: "The answers the build still accepts, by offer key"
          },
          asiIncreases: {
            type: "object",
            additionalProperties: { $ref: "#/components/schemas/BuilderAbilityIncreases" }
          },
          subclassId: { type: ["string", "null"], description: "The subclass offer's answer" },
          choices: {
            type: "array",
            items: { $ref: "#/components/schemas/BuilderChoiceRow" },
            description: "The ledger rows these answers make: a create's `choices`"
          }
        }
      },
      BuilderOffersResponse: envelopeSchema("#/components/schemas/BuilderOffersData"),
      ContentMonstersData: {
        type: "object",
        additionalProperties: false,
        required: ["monsters", "attribution"],
        properties: {
          monsters: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "challengeRating", "type", "size", "armorClass", "hitPoints"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                challengeRating: { type: "number" },
                type: { type: "string" },
                size: { type: "string" },
                armorClass: { type: "integer" },
                hitPoints: { type: "integer" }
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentMonstersResponse: envelopeSchema("#/components/schemas/ContentMonstersData"),
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
      ContentConditionsData: {
        type: "object",
        additionalProperties: false,
        required: ["conditions", "attribution"],
        properties: {
          conditions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "description"],
              properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" } }
            }
          },
          attribution: {
            type: "string",
            description:
              "The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content"
          }
        }
      },
      ContentConditionsResponse: envelopeSchema("#/components/schemas/ContentConditionsData"),
      ContentSkillsData: {
        type: "object",
        additionalProperties: false,
        required: ["skills", "attribution"],
        properties: {
          skills: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "description", "ability"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                ability: {
                  type: ["string", "null"],
                  enum: ["str", "dex", "con", "int", "wis", "cha", null],
                  description:
                    "The ability this skill's check uses; null only for a record that has not declared one yet"
                }
              }
            }
          },
          attribution: {
            type: "string",
            description:
              "The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content"
          }
        }
      },
      ContentSkillsResponse: envelopeSchema("#/components/schemas/ContentSkillsData"),
      ContentLanguagesData: {
        type: "object",
        additionalProperties: false,
        required: ["languages", "attribution"],
        properties: {
          languages: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "description", "table"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                table: {
                  type: "string",
                  description:
                    'Which SRD table the language is printed in - "standard" (widespread) or "rare" (secret or planar). An open slug: a homebrew table needs no schema change. The base "Common plus two languages" budget draws from `standard`; Druidic and Thieves\' Cant are `rare` and arrive from a class feature'
                }
              }
            }
          },
          attribution: {
            type: "string",
            description:
              "The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content"
          }
        }
      },
      ContentLanguagesResponse: envelopeSchema("#/components/schemas/ContentLanguagesData"),
      ContentSpellsData: {
        type: "object",
        additionalProperties: false,
        required: ["spells", "attribution"],
        properties: {
          spells: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "level",
                "school",
                "castingTime",
                "rangeText",
                "componentsText",
                "duration",
                "concentration",
                "ritual",
                "description",
                "higherLevel",
                "classes",
                "attackRoll",
                "rangeFeet",
                "damageRoll",
                "damageTypes",
                "castingOptions"
              ],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                level: { type: "integer", minimum: 0, maximum: 9, description: "0 is a cantrip" },
                school: { type: "string" },
                castingTime: { type: "string" },
                rangeText: { type: ["string", "null"] },
                attackRoll: {
                  type: "boolean",
                  description:
                    'Whether casting it rolls an attack. One of the three closed `fromPicks` predicates - "a cantrip that requires an attack roll" (Repelling Blast)'
                },
                rangeFeet: {
                  type: ["integer", "null"],
                  description:
                    'Range in FEET when the printed range IS a distance, else null (Self and Touch are not ranges of zero). Read by the `ranged` predicate - "a cantrip with a range of 10+ feet" (Eldritch Spear)'
                },
                componentsText: { type: "string", description: '"V, S, M (a pinch of soot)", or "None"' },
                duration: { type: "string" },
                concentration: { type: "boolean" },
                ritual: { type: "boolean" },
                description: { type: "string" },
                higherLevel: { type: ["string", "null"] },
                classes: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Spell-list ids this spell belongs to (\"wizard\", a homebrew list slug) - the builder filters a class's spell step on these, paired with the class record's spellcasting.spellListId"
                },
                damageRoll: {
                  type: ["string", "null"],
                  description: 'Base damage/healing roll ("8d6"), or null when the spell rolls nothing'
                },
                damageTypes: { type: "array", items: { type: "string" } },
                castingOptions: {
                  type: "array",
                  description:
                    "Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["level", "damageRoll", "targetCount"],
                    properties: {
                      level: { type: "integer", minimum: 1, maximum: 9 },
                      damageRoll: { type: ["string", "null"] },
                      targetCount: { type: ["integer", "null"] }
                    }
                  }
                }
              }
            }
          },
          attribution: {
            type: "string",
            description:
              "The bundle's canonical CC BY 4.0 statement - ADR-0015 requires it on any surface that displays this content"
          }
        }
      },
      ContentSpellsResponse: envelopeSchema("#/components/schemas/ContentSpellsData"),
      ContentEquipmentData: {
        type: "object",
        additionalProperties: false,
        required: ["equipment", "attribution"],
        properties: {
          equipment: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "category", "costGp", "weightLb", "description", "weapon", "armor", "appliesTo"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                category: {
                  type: "string",
                  description:
                    "Open slug: weapon, armor, shield, ammunition, adventuring-gear, tool, equipment-pack, consumable, focus, wondrous, or any homebrew kind. Not a closed set - derive groupings from the data."
                },
                costGp: { type: ["number", "null"] },
                weightLb: { type: ["number", "null"] },
                description: { type: ["string", "null"] },
                weapon: {
                  description: "Populated for weapons only",
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["category", "damageDice", "damageType", "rangeFeet", "longRangeFeet"],
                      properties: {
                        category: { type: "string", enum: ["simple", "martial"] },
                        damageDice: { type: "string" },
                        damageType: { type: "string" },
                        rangeFeet: { type: ["integer", "null"] },
                        longRangeFeet: { type: ["integer", "null"] },
                        mastery: {
                          type: "string",
                          enum: ["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"],
                          description:
                            "The SRD weapon-mastery property this weapon has. Browse-only: it is NOT copied onto an inventory row, and it does nothing until a character unlocks THIS weapon through Weapon Mastery. Absent on gear and on homebrew weapons that declare none."
                        },
                        properties: {
                          type: "array",
                          maxItems: 12,
                          items: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 40 },
                          description:
                            "The SRD weapon table's Properties column (finesse, light, thrown, versatile, reach, heavy, two-handed, loading, ammunition). Unlike `mastery` these ARE copied onto an inventory row and the engine reads them there - finesse decides whether the swing uses Dexterity, reach decides 10 feet versus 5. An empty array means the weapon genuinely has none."
                        }
                      }
                    },
                    { type: "null" }
                  ]
                },
                armor: {
                  description: "Populated for armor and shields only",
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "acBase",
                        "addDexModifier",
                        "dexModifierCap",
                        "stealthDisadvantage",
                        "strengthRequired"
                      ],
                      properties: {
                        acBase: { type: "integer" },
                        addDexModifier: { type: "boolean" },
                        dexModifierCap: { type: ["integer", "null"] },
                        stealthDisadvantage: { type: "boolean" },
                        strengthRequired: { type: ["integer", "null"] }
                      }
                    },
                    { type: "null" }
                  ]
                },
                appliesTo: {
                  description:
                    'C9: the eligibility column for a TEMPLATE magic item - the printed type-line qualifier ("Any Simple or Martial") plus the base ids it RESOLVED to at build/authoring time. Null everywhere except weapon/armor templates. A template row derives nothing until the player\'s pick binds it to one of `baseIds`, validated and copied server-side at set-inventory.',
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["label", "baseIds"],
                      properties: {
                        label: { type: "string" },
                        baseIds: {
                          type: "array",
                          minItems: 1,
                          maxItems: 40,
                          items: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }
                        }
                      }
                    },
                    { type: "null" }
                  ]
                }
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentEquipmentResponse: envelopeSchema("#/components/schemas/ContentEquipmentData"),
      // ---- Character-builder catalogs. Every feature is a declarative ContentFeature record, so homebrew and SRD
      // records are indistinguishable to the wizard.
      ContentFeature: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "level", "description", "tags", "choices", "grantedAtLevels", "extraPicks"],
        description:
          "The browse-and-pick projection of a bundle FeatureRecord. Prose is the display source of truth; a feature's structured riders (granted actions, effects, modifiers, limited uses) stay server-side - the server applies them when it builds the character, so the wizard never becomes a second rules engine.",
        properties: {
          id: contentSlug,
          name: { type: "string" },
          level: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 20,
            description:
              "The class/subclass level the feature lands at; null when it is not level-gated (species traits, feats)"
          },
          description: { type: "string" },
          tags: {
            type: "array",
            items: contentSlug,
            description: "Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)"
          },
          choices: {
            type: "array",
            items: { $ref: "#/components/schemas/ContentFeatureChoice" },
            description:
              "Every pick this feature asks for, in authored order; each writes a row in the character's choice-provenance ledger. One record may owe more than one, with different kinds and ceilings: Magic Initiate owes two cantrips and one level-1 spell. Empty when the feature grants without asking."
          },
          grantedAtLevels: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 20 },
            description:
              "Every level at which the owning class's table grants this feature - the authoritative repeat count. A feature granted at 4, 8, 12 and 16 asks its choice FOUR times and the server's capacity is choose x grants, so a client that ignores this offers too few picks and the build is rejected at creation. Empty when no class level table grants the feature (species traits, feats, subclass features)."
          },
          extraPicks: {
            type: "array",
            items: { $ref: "#/components/schemas/ContentExtraPick" },
            description:
              "Budgets this feature RAISES rather than picks it asks for. Travels although riders do not, because it is an input to picking: a wizard that ignores it caps the player at the printed level row and the extra pick the text promised is unselectable."
          }
        }
      },
      ContentFeatureChoice: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "choose", "from", "fromCatalog", "maxSpellLevel", "minSpellLevel", "fromPicks", "options"],
        description:
          "One pick a feature asks for. Options arrive either as plain ids in `from`, as an open catalog slug in `fromCatalog`, or as inline `options` carrying their own name and any second-order pick.",
        properties: {
          kind: contentSlug,
          choose: { type: "integer", minimum: 1, maximum: 10 },
          from: {
            type: "array",
            items: contentSlug,
            description: "Explicit option ids; empty when fromCatalog names an open list instead"
          },
          fromCatalog: {
            type: ["string", "null"],
            description: "An open catalog slug resolved at pick time (skills, feats, wizard-spells)"
          },
          maxSpellLevel: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 9,
            description:
              "Ceiling on a spell pick's level (Evocation Savant: 2; Magic Initiate: 0, i.e. cantrips only). null when the pick has no ceiling — a picker that ignores it offers spells the server then rejects"
          },
          minSpellLevel: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 9,
            description:
              'Floor on a spell pick\'s level (Mystic Arcanum: 6, so the level-6 arcanum is EXACTLY a level-6 spell rather than "6 or lower"). null when the pick has no floor'
          },
          fromPicks: {
            description:
              'The options are the character\'s OWN earlier answers rather than a catalog - "choose one of your known Warlock cantrips that deals damage". null for every ordinary pick.',
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["offer", "where"],
                properties: {
                  offer: {
                    type: "string",
                    description: 'The budget whose answers are the option list ("class-cantrips", "feature:<id>")'
                  },
                  where: {
                    type: ["string", "null"],
                    enum: ["deals-damage", "attack-roll", "ranged", null],
                    description: "Closed predicate narrowing those answers; null means all of them"
                  }
                }
              },
              { type: "null" }
            ]
          },
          options: {
            type: "array",
            items: { $ref: "#/components/schemas/ContentFeatureOption" },
            description:
              "Inline options with their authored names and any nested pick; empty when the options are plain ids or come from a catalog"
          }
        }
      },
      ContentFeatureOption: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "description", "requires", "choices", "extraPicks"],
        description:
          "One inline option of a feature's pick. Carries its authored name (an id alone would force the client to titleize) and any SECOND-ORDER pick it owes - Cleric Divine Order's Thaumaturge grants an extra cantrip, so choosing it opens another choice. Riders stay server-side.",
        properties: {
          id: contentSlug,
          name: { type: "string" },
          description: { type: "string" },
          requires: {
            description:
              'The earlier answer that makes this option legal, or null when it is always offerable. "The option you chose for Blessed Strikes grows more powerful": the later feature\'s options are gated on a pick already in the ledger. When gating leaves exactly as many legal options as the capacity, the answer is a CONSEQUENCE rather than a choice and neither side renders a pick for it.',
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["offer", "id"],
                properties: {
                  offer: {
                    type: "string",
                    description:
                      'The offer key holding the earlier answer ("feature:blessed-strikes", or a named budget)'
                  },
                  id: contentSlug
                }
              },
              { type: "null" }
            ]
          },
          choices: {
            type: "array",
            items: { $ref: "#/components/schemas/ContentFeatureChoice" },
            description:
              "Every nested pick this option owes, in authored order. Bounded at one level: a nested pick never carries its own options."
          },
          extraPicks: {
            type: "array",
            items: { $ref: "#/components/schemas/ContentExtraPick" },
            description:
              "Budgets this option RAISES once chosen - Divine Order's Thaumaturge adds one to the Cleric cantrip budget."
          }
        }
      },
      ContentExtraPick: {
        type: "object",
        additionalProperties: false,
        required: ["offer", "amount", "scaling"],
        description:
          "ONE pick budget a feature or a chosen option raises. `offer` is the offer key the wizard and the server share verbatim (class-cantrips, class-spells, class-skills, class-tools, background-skills, background-tools, background-languages, species-languages, or feature:<featureId>); the printed level row and every grant naming it are SUMMED, so two features each granting +1 yield +2.",
        properties: {
          offer: { type: "string", maxLength: 80, description: "The offer key whose capacity this raises" },
          amount: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 5,
            description: "How many extra picks, as a flat number; null when `scaling` states it instead"
          },
          scaling: {
            description:
              "The budget follows a printed class-table column instead of a constant - Eldritch Invocations 1 -> 10, Weapon Mastery 3 -> 6. Resolved against the same level table on both sides. Null for a flat grant.",
            oneOf: [{ $ref: "#/components/schemas/ExtraPickScaling" }, { type: "null" }]
          }
        }
      },
      ContentClassesData: {
        type: "object",
        additionalProperties: false,
        required: ["classes", "attribution"],
        properties: {
          classes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "source",
                "summary",
                "description",
                "hitDie",
                "statPriority",
                "primaryAbilities",
                "savingThrows",
                "skillChoiceCount",
                "skillChoices",
                "armorProficiencies",
                "weaponProficiencies",
                "toolProficiencies",
                "toolChoices",
                "multiclassProficiencies",
                "multiclassPrerequisites",
                "subclassLevel",
                "subclassLabel",
                "asiLevels",
                "spellcastingAbility",
                "spellcastingProgression",
                "spellcasting",
                "levelTable",
                "startingEquipmentOptions",
                "features"
              ],
              properties: {
                id: contentSlug,
                name: { type: "string" },
                source: contentSource,
                summary: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                hitDie: {
                  type: "string",
                  enum: ["d4", "d6", "d8", "d10", "d12"],
                  description: "The multiclass hit-dice pool keys on this"
                },
                statPriority: {
                  ...contentAbilities,
                  description:
                    "All six abilities, best first - the random generator's core input, as data rather than a hardcoded table"
                },
                primaryAbilities: contentAbilities,
                savingThrows: contentAbilities,
                skillChoiceCount: {
                  type: "integer",
                  minimum: 0,
                  maximum: 10,
                  description: "How many entries of skillChoices the character picks at level 1"
                },
                skillChoices: { type: "array", items: contentSlug },
                armorProficiencies: {
                  type: "array",
                  items: contentSlug,
                  description: "Granted armor training, as open slugs (light, medium, heavy, shields)"
                },
                weaponProficiencies: {
                  type: "array",
                  items: contentSlug,
                  description: "Granted weapon training - a group (simple, martial) or a single weapon id"
                },
                toolProficiencies: { type: "array", items: contentSlug },
                toolChoices: {
                  ...contentChoiceList,
                  description: '"Choose N tools" where the class offers one; null otherwise'
                },
                multiclassProficiencies: {
                  description:
                    "Proficiencies gained when this class is taken as a MULTICLASS (narrower than the level-1 set); null when the record declares none",
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["armor", "weapons", "tools", "skillChoices"],
                      properties: {
                        armor: { type: "array", items: contentSlug },
                        weapons: { type: "array", items: contentSlug },
                        tools: { type: "array", items: contentSlug },
                        skillChoices: contentChoiceList
                      }
                    },
                    { type: "null" }
                  ]
                },
                multiclassPrerequisites: {
                  description:
                    'Ability minimums for multiclassing INTO this class; mode "any" covers "STR 13 or DEX 13". null = always allowed. Display data - the server re-validates',
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["mode", "minimums"],
                      properties: {
                        mode: { type: "string", enum: ["all", "any"] },
                        minimums: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["ability", "minimum"],
                            properties: {
                              ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
                              minimum: { type: "integer", minimum: 1, maximum: 20 }
                            }
                          }
                        }
                      }
                    },
                    { type: "null" }
                  ]
                },
                subclassLevel: { type: "integer", minimum: 1, maximum: 20 },
                subclassLabel: {
                  type: ["string", "null"],
                  description: 'What this class calls its subclass ("Martial Archetype")'
                },
                asiLevels: {
                  type: "array",
                  items: { type: "integer", minimum: 1, maximum: 20 },
                  description: "Levels granting an Ability Score Improvement, or a feat instead"
                },
                spellcastingAbility: {
                  type: ["string", "null"],
                  description:
                    "Ability slug for this class's spellcasting; null for a non-caster. Per class, so Paladin CHA + Wizard INT is expressible"
                },
                spellcastingProgression: {
                  type: ["string", "null"],
                  enum: ["full", "half", "third", "pact", null],
                  description: "How this class's levels count toward the shared multiclass caster level"
                },
                spellcasting: {
                  ...contentSpellcastingSummary,
                  description:
                    "The full spellcasting header (ability, known/prepared, ritual, focus, progression, spell-list id); null for a non-caster. The flat spellcastingAbility/spellcastingProgression mirror it for existing readers"
                },
                levelTable: contentClassLevelTable,
                startingEquipmentOptions: contentStartingEquipmentOptions,
                features: contentFeatures
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentClassesResponse: envelopeSchema("#/components/schemas/ContentClassesData"),
      ContentSubclassesData: {
        type: "object",
        additionalProperties: false,
        required: ["subclasses", "attribution"],
        properties: {
          subclasses: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "source",
                "classId",
                "summary",
                "description",
                "subclassLevel",
                "spellcastingAbility",
                "spellcastingProgression",
                "spellcasting",
                "features"
              ],
              properties: {
                id: contentSlug,
                name: { type: "string" },
                source: contentSource,
                classId: contentSlug,
                summary: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                subclassLevel: {
                  type: ["integer", "null"],
                  minimum: 1,
                  maximum: 20,
                  description:
                    "The class level this subclass is taken at; null inherits the parent class's subclassLevel"
                },
                spellcastingAbility: {
                  type: ["string", "null"],
                  description: "Set by third-caster subclasses (Eldritch Knight, Arcane Trickster)"
                },
                spellcastingProgression: { type: ["string", "null"], enum: ["full", "half", "third", "pact", null] },
                spellcasting: {
                  ...contentSpellcastingSummary,
                  description:
                    "A third-caster subclass's full spellcasting header, same shape as a class's; null otherwise"
                },
                features: contentFeatures
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentSubclassesResponse: envelopeSchema("#/components/schemas/ContentSubclassesData"),
      ContentSpeciesData: {
        type: "object",
        additionalProperties: false,
        required: ["species", "attribution"],
        properties: {
          species: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "source",
                "summary",
                "description",
                "sizes",
                "speedFeet",
                "darkvisionFeet",
                "creatureType",
                "abilityBonuses",
                "abilityBonusChoice",
                "languages",
                "languageChoices",
                "lineages",
                "features"
              ],
              properties: {
                id: contentSlug,
                name: { type: "string" },
                source: contentSource,
                summary: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                sizes: {
                  type: "array",
                  items: { type: "string", enum: ["tiny", "small", "medium", "large", "huge", "gargantuan"] },
                  description: "A list because several 2024 species let the player pick Small or Medium"
                },
                speedFeet: { type: "integer", minimum: 0, maximum: 120 },
                darkvisionFeet: { type: ["integer", "null"] },
                creatureType: contentSlug,
                abilityBonuses: {
                  type: "array",
                  description:
                    "Fixed ability increases, as data. Empty for every SRD 5.2.1 species (increases live on the background); a 2014-style or homebrew record populates it and the builder applies whatever is declared",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ability", "amount"],
                    properties: {
                      ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
                      amount: { type: "integer", minimum: -2, maximum: 3 }
                    }
                  }
                },
                abilityBonusChoice: {
                  description:
                    '"Choose N abilities to raise by M" (the 2014 variant-human pattern); null when the species has none',
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["choose", "amount", "from"],
                      properties: {
                        choose: { type: "integer", minimum: 1, maximum: 6 },
                        amount: { type: "integer", minimum: 1, maximum: 3 },
                        from: contentAbilities
                      }
                    },
                    { type: "null" }
                  ]
                },
                languages: { type: "array", items: contentSlug },
                languageChoices: {
                  ...contentChoiceList,
                  description: '"Choose N languages" where the species offers one; null otherwise'
                },
                lineages: {
                  type: "array",
                  description: "Lineages/subraces; each one's traits are also folded into features",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "name", "description"],
                    properties: { id: contentSlug, name: { type: "string" }, description: { type: ["string", "null"] } }
                  }
                },
                features: {
                  ...contentFeatures,
                  description:
                    "Species traits plus every lineage's traits. NOTE: SRD 5.2.1 puts ability increases on the BACKGROUND, not the species"
                }
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentSpeciesResponse: envelopeSchema("#/components/schemas/ContentSpeciesData"),
      ContentBackgroundsData: {
        type: "object",
        additionalProperties: false,
        required: ["backgrounds", "attribution"],
        properties: {
          backgrounds: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "source",
                "summary",
                "description",
                "abilityOptions",
                "originFeatId",
                "skillProficiencies",
                "skillChoices",
                "toolProficiencies",
                "toolChoices",
                "languages",
                "languageChoices",
                "startingEquipmentOptions",
                "features"
              ],
              properties: {
                id: contentSlug,
                name: { type: "string" },
                source: contentSource,
                summary: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                abilityOptions: {
                  description:
                    "SRD 5.2.1 ability increases: which abilities, and the legal distributions (+2/+1 or +1/+1/+1) as data",
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["from", "spreads"],
                      properties: {
                        from: contentAbilities,
                        spreads: {
                          type: "array",
                          items: { type: "array", items: { type: "integer", minimum: 1, maximum: 3 } }
                        }
                      }
                    },
                    { type: "null" }
                  ]
                },
                originFeatId: {
                  type: ["string", "null"],
                  description: "The origin feat this background grants, keyed into the feat catalog"
                },
                skillProficiencies: { type: "array", items: contentSlug },
                skillChoices: {
                  ...contentChoiceList,
                  description:
                    '"Choose N skills" where the background offers one; null otherwise (fixed grants stay in skillProficiencies)'
                },
                toolProficiencies: { type: "array", items: contentSlug },
                toolChoices: {
                  ...contentChoiceList,
                  description: '"Choose N tools" where the background offers one; null otherwise'
                },
                languages: { type: "array", items: contentSlug },
                languageChoices: {
                  ...contentChoiceList,
                  description: '"Choose N languages" where the background offers one; null otherwise'
                },
                startingEquipmentOptions: contentStartingEquipmentOptions,
                features: contentFeatures
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentBackgroundsResponse: envelopeSchema("#/components/schemas/ContentBackgroundsData"),
      ContentFeatsData: {
        type: "object",
        additionalProperties: false,
        required: ["feats", "attribution"],
        properties: {
          feats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "name",
                "source",
                "summary",
                "description",
                "category",
                "repeatable",
                "prerequisiteLevel",
                "prerequisiteAbilities",
                "prerequisiteRequires",
                "prerequisiteText",
                "feature"
              ],
              properties: {
                id: contentSlug,
                name: { type: "string" },
                source: contentSource,
                summary: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                category: { ...contentSlug, description: "Open slug (origin / general / fighting-style / epic-boon)" },
                repeatable: { type: "boolean" },
                prerequisiteLevel: { type: ["integer", "null"], minimum: 1, maximum: 20 },
                prerequisiteAbilities: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ability", "minimum"],
                    properties: {
                      ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
                      minimum: { type: "integer", minimum: 1, maximum: 20 }
                    }
                  }
                },
                prerequisiteRequires: {
                  type: "array",
                  items: contentSlug,
                  description: "Proficiency or feature slugs the character must already have"
                },
                prerequisiteText: {
                  type: ["string", "null"],
                  description:
                    "Anything not modeled above, printed for the player. The SERVER decides whether a prerequisite is met - never the client"
                },
                feature: {
                  $ref: "#/components/schemas/ContentFeature",
                  description: "A feat IS a feature plus catalog metadata - hence one record, not a list"
                }
              }
            }
          },
          attribution: { type: "string" }
        }
      },
      ContentFeatsResponse: envelopeSchema("#/components/schemas/ContentFeatsData"),
      ContentNamesData: {
        type: "object",
        additionalProperties: false,
        required: ["names", "attribution"],
        properties: {
          names: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["speciesId", "source", "pools"],
              properties: {
                speciesId: contentSlug,
                source: contentSource,
                pools: {
                  type: "array",
                  description: "Ordered by the data, never by a hardcoded client list",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "label", "names"],
                    properties: {
                      id: contentSlug,
                      label: { type: "string", description: 'What this pool is ("Masculine", "Family", "Clan")' },
                      names: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            }
          },
          attribution: { type: "string" }
        }
      },
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
      // ===== Codex: worldbuilding data, request bodies, and response envelopes (codex-http.ts) =====
      CodexPageSummary: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "entityType",
          "fields",
          "folder",
          "tags",
          "revealedToPlayers",
          "bannerAssetId",
          "inWorldLabel",
          "calendarInstant",
          "inWorldDate",
          "rev",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          id: codexUuid,
          title: { type: "string" },
          entityType: codexEntityType,
          fields: { ...codexStringMap, description: "Player-facing typed entity fields (free-form key/value)." },
          folder: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          revealedToPlayers: { type: "boolean" },
          bannerAssetId: codexNullableUuid,
          ...codexPageDating,
          rev: { type: "integer", minimum: 0 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexPage: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "entityType",
          "fields",
          "gmFields",
          "folder",
          "tags",
          "revealedToPlayers",
          "bannerAssetId",
          "playerBody",
          "gmBody",
          "inWorldLabel",
          "calendarInstant",
          "inWorldDate",
          "rev",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          id: codexUuid,
          title: { type: "string" },
          entityType: codexEntityType,
          fields: codexStringMap,
          gmFields: { ...codexStringMap, description: "GM-only fields; never present in a player projection." },
          folder: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          revealedToPlayers: { type: "boolean" },
          bannerAssetId: codexNullableUuid,
          playerBody: { type: "string", description: "Player-facing markdown body." },
          gmBody: { type: "string", description: "GM-only markdown body; stripped from a player projection." },
          ...codexPageDating,
          rev: { type: "integer", minimum: 0 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexPageRevision: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "pageId",
          "rev",
          "title",
          "playerBody",
          "gmBody",
          "bannerAssetId",
          "tags",
          "authoredAt",
          "authorTag"
        ],
        properties: {
          id: { type: "integer", minimum: 1 },
          pageId: codexUuid,
          rev: { type: "integer", minimum: 0 },
          title: { type: "string" },
          playerBody: { type: "string" },
          gmBody: { type: "string" },
          bannerAssetId: codexNullableUuid,
          tags: { type: "array", items: { type: "string" } },
          authoredAt: { type: "string", format: "date-time" },
          authorTag: { type: "string" }
        }
      },
      CodexMap: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "assetId",
          "name",
          "kind",
          "parentMapId",
          "revealedToPlayers",
          "sortKey",
          "createdAt",
          "updatedAt",
          "tags"
        ],
        properties: {
          tags: { type: "array", items: { type: "string" } },
          id: codexUuid,
          assetId: codexUuid,
          name: { type: "string" },
          kind: codexMapKind,
          parentMapId: {
            ...codexNullableUuid,
            description: "Parent map in the atlas tree; for a player, nulled when the parent is not itself revealed."
          },
          revealedToPlayers: { type: "boolean" },
          sortKey: { type: "number" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexMarker: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "mapId",
          "x",
          "y",
          "iconId",
          "iconColor",
          "label",
          "revealedToPlayers",
          "pageIds",
          "subMapId",
          "sceneIds",
          "actorId",
          "isParty",
          "createdAt",
          "updatedAt",
          "tags"
        ],
        properties: {
          tags: { type: "array", items: { type: "string" } },
          id: codexUuid,
          mapId: codexUuid,
          x: { type: "number" },
          y: { type: "number" },
          iconId: { type: "string" },
          iconColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          label: { type: ["string", "null"] },
          revealedToPlayers: { type: "boolean" },
          pageIds: {
            type: "array",
            items: codexUuid,
            description: "Linked pages; for a player, filtered to the revealed subset."
          },
          subMapId: {
            ...codexNullableUuid,
            description: "Drill-down sub-map; nulled for a player when that map is not revealed."
          },
          sceneIds: {
            type: "array",
            items: codexUuid,
            description: "Linked prepared scenes; GM-only, stripped from a player projection."
          },
          actorId: codexNullableUuid,
          isParty: {
            type: "boolean",
            description:
              "Is this the party's pin? At most one marker in the whole atlas carries it. PLAYER-FACING - the party pin is for the players, and it is the ONE such key on the player marker projection - but it grants no visibility of its own: a hidden party pin, or one on a hidden map, is exactly as hidden as any other pin, because `isParty` is not part of any reveal predicate anywhere."
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexDowntimePayload: {
        type: "object",
        additionalProperties: false,
        description:
          "What a downtime record stores beyond its prose - who spent how many days doing what, and whether the GM has confirmed the clock move it proposes. The GM's shape. Deliberately NOT here: an `outcome`, which is prose, and this record already has two prose layers with the reveal split between them (`playerText`/`gmText`) - a third prose channel inside a JSON blob would sit outside that split.",
        required: ["who", "activity", "days", "applied", "characterPageId"],
        properties: {
          who: { type: "string", description: "Who spent the time. Free text - a character, the whole party, an NPC." },
          activity: { type: "string", description: "What they did with it." },
          days: {
            type: "integer",
            minimum: 0,
            description: "The time cost in in-world days - what the clock moves by when the GM confirms."
          },
          applied: {
            type: "boolean",
            description:
              "GM workflow state: has the clock move been confirmed? NEVER present in a player projection - it is a fact about the GM's prep, not about the party's week off."
          },
          characterPageId: {
            ...codexNullableUuid,
            description:
              "the character page this downtime belongs to, or null. Always present, including on records written before the field existed - the stored-payload reader supplies the null, so no consumer branches on key presence. A plain id with no foreign key: the record outlives the page, and deleting the page nulls this while `who` survives as the display fallback."
          }
        }
      },
      CodexQuestHistoryPayload: {
        type: "object",
        additionalProperties: false,
        description:
          "a quest CHANGED STATE. The quest record says where a quest stands; this says what happened - exactly as a `standing` record does beside the standing table. Written automatically, in the same transaction as the quest write, when a quest is CREATED (its initial status - a quest entering the log is an event, whether or not the party has begun it) and whenever a PATCH changes its status. Editing a quest's prose writes nothing. There is no cached title: readers resolve `questId` against the live quest, so a renamed quest reads correctly and a deleted one is a name they cannot show rather than an error - the history outlives the quest.",
        required: ["questId", "status"],
        properties: {
          questId: codexUuid,
          status: {
            ...codexQuestStatus,
            description:
              'The status REACHED, not a delta - the fact a GM states and the one a reader wants. A `failed` -> `active` transition records `active`; a reader words it as "reopened".'
          }
        }
      },
      CodexQuestHistoryPlayerPayload: {
        type: "object",
        additionalProperties: false,
        description:
          'A quest-history record as a PLAYER sees it. The whole ROW is hidden unless the quest itself is revealed - a quest record carries empty player text, so it cannot stand on its own prose, and a row reading "Quest - completed" for a quest the party has never heard of would announce both its existence and its ending. When it does travel, `status` is the record\'s only content and the reader can already read it on the quest itself.',
        required: ["questId", "status"],
        properties: {
          questId: {
            ...codexNullableUuid,
            description:
              "Nulled unless that quest is revealed - a second line of defence behind the whole-row gate, the same arrangement a standing payload's `factionPageId` uses."
          },
          status: codexQuestStatus
        }
      },
      CodexDowntimePlayerPayload: {
        type: "object",
        additionalProperties: false,
        description:
          "A revealed downtime record as a PLAYER sees it: the campaign facts, and `applied` allow-listed away.",
        required: ["who", "activity", "days", "characterPageId"],
        properties: {
          who: { type: "string" },
          activity: { type: "string" },
          days: { type: "integer", minimum: 0 },
          characterPageId: {
            ...codexNullableUuid,
            description:
              "carried ONLY when that character page is itself revealed, else null - the `factionPageId` rule on a standing payload verbatim. Unlike a standing record the ROW is not hidden when the link is nulled: a downtime row stands on its own player-visible content (`who`, `activity`, `days`, and usually prose), so a nulled link leaves a row that still means something."
          }
        }
      },
      CodexMilestonePayload: {
        type: "object",
        additionalProperties: false,
        description:
          "What a MILESTONE record carries beyond its prose - the level the party reached, and why. Identical for both audiences: a party knows its own level, and a revealed milestone with its two facts removed would be a dated row that says nothing. There is no GM-only half here at all; a milestone needing one writes it in the record's `gmText`, like every other journal row. No XP: progression is milestone-based by design and this record carries no arithmetic.",
        required: ["level", "reason"],
        properties: {
          level: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description:
              "The level REACHED, not a step. A delta would make the party's current level a sum over the whole timeline that a single deleted record silently changes."
          },
          reason: {
            type: "string",
            maxLength: 120,
            description:
              'Why, in one line ("cleared the crypt"). May be empty - the record\'s own prose carries it when this does not.'
          }
        }
      },
      CodexStandingPayload: {
        type: "object",
        additionalProperties: false,
        description:
          "What a STANDING record carries - which faction, how much it MOVED, and why. The GM's shape. `delta` and not the resulting value, deliberately: the `codex_standing` table says where things stand and this says what happened, so a deleted record cannot leave a history that no longer adds up to the table.",
        required: ["factionPageId", "delta", "reason"],
        properties: {
          factionPageId: {
            ...codexUuid,
            description:
              "The faction page this record is about. A plain id with no foreign key behind it: deleting a faction page removes its standing ROW but must leave its history standing, so a reader resolves this defensively - a missing page is a name it cannot show, not an error."
          },
          delta: { type: "integer", description: 'How far the standing moved, signed. `-15` reads "fell fifteen".' },
          reason: { type: "string", maxLength: 120, description: "Why, in one line. May be empty." }
        }
      },
      CodexStandingPlayerPayload: {
        type: "object",
        additionalProperties: false,
        description:
          "A revealed standing record as a PLAYER sees it. `delta` and `reason` travel WHOLE: the delta is the entire point of a record the GM chose to publish (\"the Harpers fell fifteen\"), and a published record with its number stripped would say that something changed with someone. `factionPageId` is the one field that is conditional - it is nulled unless that page is itself revealed, the same filter a quest's `entityIds` and a map's `parentMapId` pass, so a published record can never advertise a faction the party has never met. A record whose faction page is NOT revealed is not projected to a player at all - it is hidden whole, exactly as the standing TABLE row is: a standing record carries no prose of its own (the store writes an empty player text), so a row with the id stripped would still tell the party that an unnamed faction moved and why.",
        required: ["factionPageId", "delta", "reason"],
        properties: {
          factionPageId: {
            ...codexNullableUuid,
            description: "The faction page, or NULL when that page is not revealed to players."
          },
          delta: { type: "integer" },
          reason: { type: "string", maxLength: 120 }
        }
      },
      CodexStanding: {
        type: "object",
        additionalProperties: false,
        description:
          "Where the party stands with ONE faction, GM view. Four facts, and what is absent is the point: no HISTORY (every change writes a `kind='standing'` chronicle record instead, so the timeline is the one history in this codex rather than a second one), no `rev` (a standing is a number set in one action - there is no draft to go stale), and no cached faction TITLE (the live page is the one name, so a rename cannot leave a stale copy behind). A player projection of a revealed standing is exactly `factionPageId` and `value`, and only when the faction page is revealed too.",
        required: ["id", "factionPageId", "value", "revealedToPlayers", "createdAt", "updatedAt"],
        properties: {
          id: codexUuid,
          factionPageId: {
            ...codexUuid,
            description:
              "The faction page. UNIQUE across standings - one row per faction - which is why every standing route is addressed by this id rather than by `id`."
          },
          value: {
            type: "integer",
            minimum: -100,
            maximum: 100,
            description:
              "SIGNED: -100 hostile, 0 neutral, +100 allied. Signed because a faction can be actively against the party, which an unsigned favour scale cannot say. The WORD a reader shows beside the bar is a presentation of this number and is deliberately not stored."
          },
          revealedToPlayers: {
            type: "boolean",
            description:
              "GM-only field; absent from a player projection (a player only ever receives revealed standings)."
          },
          createdAt: { type: "string", format: "date-time", description: "GM-only; absent from a player projection." },
          updatedAt: {
            type: "string",
            format: "date-time",
            description:
              'GM-only; absent from a player projection. "When did this move" is a question the chronicle answers, with the reason attached.'
          }
        }
      },
      CodexJournalEntry: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "playerText",
          "gmText",
          "revealedToPlayers",
          "attachMarkerId",
          "attachPageId",
          "kind",
          "sourceEncounterId",
          "sessionId",
          "sessionNumber",
          "realDate",
          "inWorldLabel",
          "calendarInstant",
          "inWorldDate",
          "sortKey",
          "payload",
          "createdAt",
          "updatedAt",
          "tags"
        ],
        properties: {
          tags: { type: "array", items: { type: "string" } },
          id: codexUuid,
          playerText: { type: "string" },
          gmText: { type: ["string", "null"], description: "GM-only note; stripped from a player projection." },
          revealedToPlayers: { type: "boolean" },
          attachMarkerId: codexNullableUuid,
          attachPageId: codexNullableUuid,
          kind: {
            type: "string",
            enum: ["note", "combat", "deadline", "downtime", "milestone", "standing", "quest"],
            description:
              "What the row IS. `deadline`, `downtime`, `milestone` and `standing` are the structured kinds. Visibility NEVER depends on this: every kind is gated by `revealedToPlayers` alone."
          },
          sourceEncounterId: { type: ["integer", "null"] },
          sessionId: {
            ...codexNullableUuid,
            description:
              "the session this entry belongs to, BY IDENTITY. Null when it is filed under no session. This is what a WRITE sets; `sessionNumber` beside it is what a reader displays."
          },
          sessionNumber: {
            type: ["integer", "null"],
            description:
              "The linked session's number, resolved LIVE from that record - so renumbering a session updates every one of its entries with no journal write. Server-owned display data: a write body that carries it is a 400. It survives its session in exactly one case: deleting a REVEALED numbered session stamps its number back onto its entries as a bare label, because the players were already reading it."
          },
          realDate: { type: ["string", "null"] },
          inWorldLabel: { type: ["string", "null"] },
          calendarInstant: {
            type: ["number", "null"],
            description: "Sortable absolute day index derived from the calendar."
          },
          inWorldDate: codexInWorldDateOrNull,
          sortKey: { type: "number" },
          payload: {
            oneOf: [
              { $ref: "#/components/schemas/CodexDowntimePayload" },
              { $ref: "#/components/schemas/CodexMilestonePayload" },
              { $ref: "#/components/schemas/CodexStandingPayload" },
              { $ref: "#/components/schemas/CodexQuestHistoryPayload" },
              { type: "null" }
            ],
            description:
              'Kind-specific structured data, discriminated by `kind`: the downtime payload, the milestone payload, the standing payload, and null for the other three kinds. GM-only - the player journal projection carries no payload at all (a revealed record\'s facts are read on the chronicle). A DEADLINE deliberately has none: its text is the "what" and its `inWorldDate` is the "when".'
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexChronicleRecord: {
        type: "object",
        additionalProperties: false,
        description:
          "One row on the ONE chronicle as the **GM** receives it, in the single row shape every timeline record uses. `kind` says what it is and therefore what opening it means: `entry`/`combat`/`deadline`/`downtime` carry a journal-entry id, `event` carries a PAGE id. Every key is present on every kind (null where it does not apply), so no reader branches on key presence. The player's row is the separate `CodexChronicleRecordPlayer`; the two are joined by `CodexChronicleRecordProjected`.",
        // Every key required, GM-only ones included (nullable where unused), so the role `oneOf` stays unambiguous.
        required: [
          "kind",
          "id",
          "title",
          "text",
          "gmText",
          "revealedToPlayers",
          "sessionId",
          "sessionNumber",
          "realDate",
          "inWorldLabel",
          "calendarInstant",
          "inWorldDate",
          "tags",
          "attachPageId",
          "attachMarkerId",
          "sourceEncounterId",
          "fired",
          "payload",
          "proposedDate",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          kind: {
            type: "string",
            enum: ["entry", "combat", "event", "deadline", "downtime", "milestone", "standing", "quest"],
            description:
              "What the row IS, read by icon AND word - never by colour alone. A discriminator for DISPLAY only: it never decides visibility, which is `revealedToPlayers` and nothing else."
          },
          id: {
            ...codexUuid,
            description: "The record's own id - a journal entry's for `entry`/`combat`, a page's for `event`."
          },
          title: {
            type: ["string", "null"],
            description: "An event page's title; null for a journal entry, which has no name."
          },
          text: {
            type: "string",
            description:
              "The player-facing layer: a journal entry's full text, or a bounded excerpt of an event page's player body."
          },
          gmText: {
            type: ["string", "null"],
            description:
              "GM-only: an entry's GM note, or an excerpt of an event page's GM body. Not declared at all on `CodexChronicleRecordPlayer`."
          },
          revealedToPlayers: {
            type: "boolean",
            description:
              "GM-only field; not declared on `CodexChronicleRecordPlayer` (a player only ever receives revealed records)."
          },
          sessionId: {
            ...codexNullableUuid,
            description:
              "the session this row belongs to, by identity. Null for an `event` page and for an unfiled entry."
          },
          sessionNumber: {
            type: ["integer", "null"],
            description: "The linked session's number, resolved live from that record."
          },
          realDate: { type: ["string", "null"] },
          inWorldLabel: {
            type: ["string", "null"],
            description: "The in-world date as text - what the row is grouped under in the by-date lens."
          },
          calendarInstant: {
            type: ["number", "null"],
            description: "Sortable absolute day index derived from the calendar."
          },
          inWorldDate: {
            ...codexInWorldDateOrNull,
            description: "The raw in-world date the GM typed; the instant and the label are derived from it."
          },
          tags: { type: "array", items: { type: "string" } },
          attachPageId: { ...codexNullableUuid, description: "GM-only; not declared on `CodexChronicleRecordPlayer`." },
          attachMarkerId: {
            ...codexNullableUuid,
            description: "GM-only; not declared on `CodexChronicleRecordPlayer`."
          },
          sourceEncounterId: {
            type: ["integer", "null"],
            description: "GM-only replay linkage (K2); not declared on `CodexChronicleRecordPlayer`."
          },
          fired: {
            type: "boolean",
            description:
              "Has the campaign clock reached this deadline's own date? DERIVED on every read from `inWorldDate` against the clock, never stored - so rewinding the clock correctly un-fires a deadline. `false` for every kind that is not a dated deadline. Measured against WHOSE clock is a viewer-safety decision: the GM's row uses the GM's clock, a player's row uses the PUBLISHED date, so this boolean can never tell the party that a date they have not been shown has already gone by."
          },
          // The GM branch's payloads only; player payloads are listed separately so `oneOf` has one match.
          payload: {
            oneOf: [
              { $ref: "#/components/schemas/CodexDowntimePayload" },
              { $ref: "#/components/schemas/CodexMilestonePayload" },
              { $ref: "#/components/schemas/CodexStandingPayload" },
              { $ref: "#/components/schemas/CodexQuestHistoryPayload" },
              { type: "null" }
            ],
            description:
              "The kind's structured facts, discriminated by `kind`; null for the kinds that carry none. Allow-listed per kind, never a spread of the stored blob: the GM receives the full downtime payload including `applied`, a milestone's `{ level, reason }`, and a standing change's `delta`/`reason`."
          },
          proposedDate: {
            ...codexInWorldDateOrNull,
            description:
              "GM-only (not declared on `CodexChronicleRecordPlayer`): for an unapplied downtime, the date `apply-downtime` would move the clock to. Null once applied, and for every other kind. A clock move the GM has not confirmed - and may never confirm - is prep."
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "GM-only; not declared on `CodexChronicleRecordPlayer`."
          }
        }
      },
      CodexSession: {
        type: "object",
        additionalProperties: false,
        description:
          "One play session: the GM's prep for an evening at the table, and the recap of it afterwards. Two layers in one record, like a page's `playerBody`/`gmBody` - `recapBody` is the player-facing half and `prepBody` is the GM's. A player projection is deliberately narrow: a revealed session reduces to EXACTLY `id`, `sessionNumber`, `realDate`, and `recap` (the recap body, renamed the way a page's `playerBody` becomes `body` and a journal entry's `playerText` becomes `text`). Everything else here is GM-only. `sessionNumber` is the join to the journal: entries carry the same number, which is what the journal's by-session lens groups on - so it is unique across sessions, and a number already in use is refused rather than silently making a group ambiguous.",
        required: [
          "id",
          "sessionNumber",
          "realDate",
          "attendees",
          "prepBody",
          "recapBody",
          "revealedToPlayers",
          "status",
          "tags",
          "sceneIds",
          "rev",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          id: codexUuid,
          sessionNumber: {
            type: ["integer", "null"],
            description:
              '"Session 12" - the session\'s DISPLAY number. Unique across sessions; null until the GM assigns one. Journal entries link to the session by ID and resolve this live, so renumbering a session relabels every one of its entries with no journal write.'
          },
          realDate: {
            type: ["string", "null"],
            description:
              "The real-world date the group played, as the GM typed it. Free text, not a calendar instant - a session sits on the real calendar, never the world's, which is why sessions are their own route and not rows on `/codex/timeline`."
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Who was at the table. GM-only; absent from a player projection."
          },
          sceneIds: {
            type: "array",
            items: codexUuid,
            description:
              "the prepared scenes staged for this session, so the GM can put any of them live in one tap at the table. GM-ONLY, ALWAYS - stricter than the session's own reveal, because a revealed session publishes its RECAP and tonight's planned fights are spoilers even then."
          },
          prepBody: {
            type: "string",
            description:
              "GM-only prep notes for the session (markdown). NEVER present in a player projection, revealed or not - revealing a session publishes its recap, never its prep."
          },
          recapBody: {
            type: "string",
            description:
              "The player-facing recap (markdown). Reaches a revealed session's player projection as `recap`."
          },
          revealedToPlayers: {
            type: "boolean",
            description:
              "GM-only field; absent from a player projection (a player only ever receives revealed sessions)."
          },
          status: { ...codexSessionStatus, description: "GM-only; absent from a player projection." },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "the codex-wide tag vocabulary, so sessions filter and cross-link like every other record. Single-layer - there is no GM-only tag - and player-facing on a revealed session."
          },
          rev: {
            type: "integer",
            minimum: 0,
            description:
              "GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit."
          },
          createdAt: { type: "string", format: "date-time", description: "GM-only; absent from a player projection." },
          updatedAt: {
            type: "string",
            format: "date-time",
            description:
              "GM-only; absent from a player projection. Moves on an edit, but NOT on a reveal or an activate - neither is an edit."
          }
        }
      },
      CodexQuest: {
        type: "object",
        additionalProperties: false,
        description:
          "One quest: a thread the party is pulling on, and whether it is still open. Two layers in one record, like a page's `playerBody`/`gmBody` - `playerBody` is what the table may read and `gmBody` is the GM's own half (who is really behind it, what happens if they fail). A player projection of a REVEALED quest is exactly `id`, `title`, `status`, `body` (the player body, renamed the way a page's `playerBody` becomes `body`), `objectives`, and `entityIds`; everything else here is GM-only. `status` is the one field that is player-facing here but GM-only on a session: \"what is still open\" is the whole point of the feature, and a revealed quest whose state the player cannot see is useless. Objectives are the Codex's first ORDERED mutable list - the array is stored and returned exactly as given, never sorted, deduped, or keyed by position across a write.",
        required: [
          "id",
          "title",
          "status",
          "playerBody",
          "gmBody",
          "objectives",
          "entityIds",
          "revealedToPlayers",
          "tags",
          "rev",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          id: codexUuid,
          title: {
            type: "string",
            description: "The quest's name - the line that appears on the dashboard's open-quests card."
          },
          status: {
            ...codexQuestStatus,
            description:
              "Player-facing (unlike a session's `status`). Queryable server-side: the dashboard counts the OPEN ones - `not-started` and `active`."
          },
          playerBody: {
            type: "string",
            description:
              "The player-facing description (markdown). Reaches a revealed quest's player projection as `body`."
          },
          gmBody: {
            type: "string",
            description:
              "GM-only notes (markdown). NEVER present in a player projection, revealed or not - revealing a quest publishes its player body, never its GM body. It is also kept out of the player search index, because a HIT on a GM-only phrase leaks the phrase even when the body itself is never returned."
          },
          objectives: {
            ...codexQuestObjectives,
            description: "The ordered checklist. Player-facing in full - order is content, not incidental."
          },
          entityIds: {
            ...codexQuestEntityIds,
            description:
              "Codex pages this quest involves (the NPC who gave it, the location it points at). Player-facing, but filtered to the revealed subset - the same rule a marker's `pageIds` follows, so a quest can never name a page the player cannot open."
          },
          revealedToPlayers: {
            type: "boolean",
            description: "GM-only field; absent from a player projection (a player only ever receives revealed quests)."
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "the codex-wide tag vocabulary, so quests filter and cross-link like every other record. Single-layer, and player-facing on a revealed quest."
          },
          rev: {
            type: "integer",
            minimum: 0,
            description:
              "GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit."
          },
          createdAt: { type: "string", format: "date-time", description: "GM-only; absent from a player projection." },
          updatedAt: {
            type: "string",
            format: "date-time",
            description:
              "GM-only; absent from a player projection. Moves on an edit, but NOT on a reveal - a reveal is not an edit."
          }
        }
      },
      CodexCalendarMonth: {
        type: "object",
        additionalProperties: false,
        required: ["name", "days"],
        properties: { name: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 400 } }
      },
      CodexCalendarEra: {
        type: "object",
        additionalProperties: false,
        description:
          "A named era, running from `startYear` until the next era begins (`5f`). A date's era is DERIVED - the last era whose `startYear` the date's year has reached - and is never stored on the date, so adding one re-labels existing records without rewriting any of them. Sorted ascending by `startYear` on the way in.",
        required: ["name", "startYear"],
        properties: {
          name: { type: "string", maxLength: 40 },
          startYear: { type: "integer", minimum: -100_000, maximum: 100_000 }
        }
      },
      // Both date keys are required (nullable), matching what the GM projection emits and keeping the role `oneOf` unambiguous.
      CodexCalendar: {
        type: "object",
        additionalProperties: false,
        description:
          "The world's calendar as the **GM** receives it. The campaign has two clocks: the GM's, which they run ahead while prepping, and the PUBLISHED one the party sees. The player's calendar is the separate `CodexCalendarPlayer`, where `currentDate` is sourced from the published date and `publishedDate` is not declared at all; the two are joined by `CodexCalendarProjected`.",
        required: ["yearName", "eras", "months", "weekdays", "currentDate", "publishedDate"],
        properties: {
          yearName: { type: "string" },
          eras: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/CodexCalendarEra" },
            description:
              "The world's named eras, ascending by `startYear`. Empty on every calendar written before eras existed, which is exactly today's rendering: `yearName` stays the trailing suffix. Where an era applies it LEADS the year instead (\"Third Age 1492\")."
          },
          months: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: { $ref: "#/components/schemas/CodexCalendarMonth" }
          },
          weekdays: { type: "array", maxItems: 20, items: { type: "string" } },
          currentDate: {
            ...codexInWorldDateOrNull,
            description:
              "The GM's own clock - where the campaign is now. Null until a date is set. Never reaches a player by any path."
          },
          publishedDate: {
            ...codexInWorldDateOrNull,
            description:
              "What the party currently sees as 'now'. Equal to `currentDate` until the GM runs ahead while prepping, and moved only by `POST /codex/calendar/publish`. Not declared on `CodexCalendarPlayer`, where `currentDate` already IS this value."
          }
        }
      },
      // ---- Player projections of the role-projected read shapes.
      // Each mirrors `apps/server/src/codex-projections.ts` exactly (same keys, same order); that file is the source of
      // truth, and `apps/server/test/codex-http.test.ts` validates real responses against these. Widening one is a
      // viewer-safety change, not a documentation change.
      CodexPagePlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A page as a PLAYER receives it: the player body (renamed `body` - the layer prefix only means something when there are two layers), the player-facing `fields`, and no `gmBody`, `gmFields`, `rev`, `revealedToPlayers` or `createdAt`. An unrevealed page is never projected at all - it 404s.",
        required: ["id", "title", "entityType", "fields", "folder", "tags", "body", "bannerAssetId", "updatedAt"],
        properties: {
          id: codexUuid,
          title: { type: "string" },
          entityType: codexEntityType,
          fields: {
            ...codexStringMap,
            description: "The player-facing typed entity fields. `gmFields` has no player form."
          },
          folder: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          body: { type: "string", description: "The page's `playerBody`." },
          bannerAssetId: codexNullableUuid,
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexPageProjected: codexProjected("CodexPage"),
      CodexPageSummaryPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A page summary as a PLAYER receives it. A strict subset of the GM summary: no `fields`, no dating trio, no `rev`, no `revealedToPlayers`, no `createdAt`.",
        required: ["id", "title", "entityType", "folder", "tags", "bannerAssetId", "updatedAt"],
        properties: {
          id: codexUuid,
          title: { type: "string" },
          entityType: codexEntityType,
          folder: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          bannerAssetId: codexNullableUuid,
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      CodexPageSummaryProjected: codexProjected("CodexPageSummary"),
      CodexMapPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "An atlas map as a PLAYER receives it. `parentMapId` survives only when the parent is itself revealed - otherwise a revealed child would leak the id of a still-secret ancestor.",
        required: ["id", "assetId", "name", "kind", "parentMapId", "tags"],
        properties: {
          id: codexUuid,
          assetId: codexUuid,
          name: { type: "string" },
          kind: codexMapKind,
          parentMapId: { ...codexNullableUuid, description: "Nulled when the parent map is not itself revealed." },
          tags: { type: "array", items: { type: "string" } }
        }
      },
      CodexMapProjected: codexProjected("CodexMap"),
      CodexMarkerPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A pin as a PLAYER receives it: no `sceneIds`, no `actorId`, no `revealedToPlayers`, no timestamps, and page/sub-map links only when those targets are themselves revealed. `isParty` IS here - the party pin is for the players - but it grants no visibility: a hidden party pin, or one on a hidden map, is exactly as hidden as any other.",
        required: ["id", "mapId", "x", "y", "iconId", "iconColor", "label", "pageIds", "subMapId", "tags", "isParty"],
        properties: {
          id: codexUuid,
          mapId: codexUuid,
          x: { type: "number" },
          y: { type: "number" },
          iconId: { type: "string" },
          iconColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          label: { type: ["string", "null"] },
          pageIds: { type: "array", items: codexUuid, description: "Filtered to the revealed subset." },
          subMapId: { ...codexNullableUuid, description: "Nulled when that map is not revealed." },
          tags: { type: "array", items: { type: "string" } },
          isParty: { type: "boolean" }
        }
      },
      CodexMarkerProjected: codexProjected("CodexMarker"),
      CodexJournalEntryPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A journal entry as a PLAYER receives it - the mini-timeline row on a page or a pin. The player text (renamed `text`), and no `gmText`, `revealedToPlayers`, attachments, `sourceEncounterId`, `payload`, `sortKey`, dating internals or `updatedAt`. A downtime's facts and a deadline's fired state are read on the CHRONICLE, which carries them; a player-facing field the player Codex does not read is a field with no reason to travel.",
        required: ["id", "text", "kind", "sessionId", "sessionNumber", "realDate", "inWorldLabel", "tags", "createdAt"],
        properties: {
          id: codexUuid,
          text: { type: "string", description: "The entry's `playerText`." },
          kind: {
            type: "string",
            enum: ["note", "combat", "deadline", "downtime", "milestone", "standing", "quest"],
            description: "Visibility NEVER depends on this: every kind is gated by `revealedToPlayers` alone."
          },
          sessionId: {
            ...codexNullableUuid,
            description:
              "The session this entry belongs to, so a player can navigate from an entry to its recap. Present ONLY when that session is revealed - in which case the player can already list and open it, so this adds no information. Nulled TOGETHER with `sessionNumber` when the session is hidden: either half of the link would announce that a session they have not been shown exists."
          },
          sessionNumber: {
            type: ["integer", "null"],
            description:
              "Nulled together with `sessionId` when the linked session has not been revealed - a session's very existence is GM information. A bare label with no link survives only where the number was already player-visible."
          },
          realDate: { type: ["string", "null"] },
          inWorldLabel: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      CodexJournalEntryProjected: codexProjected("CodexJournalEntry"),
      CodexChronicleRecordPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "One chronicle row as a PLAYER receives it. Absent by construction: `gmText`, `revealedToPlayers`, `attachPageId`, `attachMarkerId`, `sourceEncounterId`, `proposedDate` and `updatedAt`. `fired` is measured against the PUBLISHED date, never the GM's clock, so it can never tell the party that a date they have not been shown has gone by.",
        required: [
          "kind",
          "id",
          "title",
          "text",
          "sessionId",
          "sessionNumber",
          "realDate",
          "inWorldLabel",
          "inWorldDate",
          "calendarInstant",
          "tags",
          "fired",
          "payload",
          "createdAt"
        ],
        properties: {
          kind: {
            type: "string",
            enum: ["entry", "combat", "event", "deadline", "downtime", "milestone", "standing", "quest"]
          },
          id: codexUuid,
          title: { type: ["string", "null"] },
          text: { type: "string" },
          sessionId: {
            ...codexNullableUuid,
            description:
              "Present only when the linked session is revealed; nulled together with `sessionNumber` otherwise."
          },
          sessionNumber: { type: ["integer", "null"] },
          realDate: { type: ["string", "null"] },
          inWorldLabel: { type: ["string", "null"] },
          inWorldDate: {
            ...codexInWorldDateOrNull,
            description:
              "the row's raw in-world date, so a calendar view can place it on a day without re-parsing prose. Information-equivalent to `inWorldLabel` beside it, which already spells out weekday, day, month and year - the structured parts add no bits and remove a client parse. Not the campaign's \"now\": the GM's clock is `CodexCalendarPlayer.currentDate`, which is the PUBLISHED date."
          },
          calendarInstant: {
            type: ["number", "null"],
            description:
              "the sortable day index for `inWorldDate` against the calendar the player already holds - a pure function of two things they have, computed once on the server. It is here so the client never re-derives it: the two derivations disagreed on a day that overflows its month, and one authority for one number is the fix. Null exactly when `inWorldDate` is."
          },
          tags: { type: "array", items: { type: "string" } },
          fired: { type: "boolean", description: "Derived against the PUBLISHED date." },
          payload: {
            oneOf: [
              { $ref: "#/components/schemas/CodexDowntimePlayerPayload" },
              { $ref: "#/components/schemas/CodexMilestonePayload" },
              { $ref: "#/components/schemas/CodexStandingPlayerPayload" },
              { $ref: "#/components/schemas/CodexQuestHistoryPlayerPayload" },
              { type: "null" }
            ],
            description:
              "The player half of the kind's structured facts: downtime without `applied`, a milestone's `{ level, reason }` unchanged, a standing change with `factionPageId` nulled unless that faction page is revealed."
          },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      CodexChronicleRecordProjected: codexProjected("CodexChronicleRecord"),
      CodexSessionPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A session as a PLAYER receives it - the tightest projection in the Codex, and every omission is a decision. `prepBody` is the GM's plan for the evening and has no player form; `attendees` is real-world personal data; `status` is the GM's own scheduling state; `rev` is the editor's conflict token. `recapBody` arrives renamed `recap`, because with only one layer left the prefix means nothing.",
        required: ["id", "sessionNumber", "realDate", "recap", "tags"],
        properties: {
          id: codexUuid,
          sessionNumber: { type: ["integer", "null"] },
          realDate: { type: ["string", "null"] },
          recap: { type: "string", description: "The session's `recapBody`." },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "tags are SINGLE-LAYER in this codex - there is no GM-only tag - and every other record kind already ships its tags to players. A revealed session's tags are its player-facing categorization, and they are already in the player search index by the same rule."
          }
        }
      },
      CodexSessionProjected: codexProjected("CodexSession"),
      CodexQuestPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          'A quest as a PLAYER receives it. `status` is KEPT - this is the one place a quest differs from a session, because "what is still open" is the entire point of the feature. `gmBody` and `rev` never travel, and `entityIds` is filtered to the revealed subset so a quest can never name a page the player cannot open.',
        required: ["id", "title", "status", "body", "objectives", "entityIds", "tags"],
        properties: {
          id: codexUuid,
          title: { type: "string" },
          status: codexQuestStatus,
          body: { type: "string", description: "The quest's `playerBody`." },
          objectives: codexQuestObjectives,
          entityIds: { ...codexQuestEntityIds, description: "Filtered to the revealed subset." },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "the `CodexSessionPlayer.tags` rule verbatim - tags are single-layer, and the quest's own reveal flag remains the whole predicate."
          }
        }
      },
      CodexQuestProjected: codexProjected("CodexQuest"),
      CodexStandingPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          'A standing as a PLAYER receives it: two keys. The row\'s own `id` is noise (a player never addresses a standing, and `factionPageId` is unique), and "when did this last move" is a question the chronicle answers with the reason attached. A standing reaches a player only when the standing AND its faction page are both revealed.',
        required: ["factionPageId", "value"],
        properties: {
          factionPageId: codexUuid,
          value: {
            type: "integer",
            minimum: -100,
            maximum: 100,
            description:
              "Signed -100..100. It travels unchanged: a revealed standing whose number the player cannot see would say nothing."
          }
        }
      },
      CodexStandingProjected: codexProjected("CodexStanding"),
      CodexCalendarPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          'The world calendar as a PLAYER receives it. `currentDate` keeps its name and its meaning ("where the campaign is now, as far as this reader is concerned") and only its SOURCE changes: it is read from the published date, and the GM\'s clock is not reachable from this payload at all. `publishedDate` is deliberately not echoed - for a player `currentDate` already IS it, so a second key could only duplicate it or lie.',
        required: ["yearName", "eras", "months", "weekdays", "currentDate"],
        properties: {
          yearName: { type: "string" },
          eras: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/CodexCalendarEra" },
            description:
              "Projected, never filtered: an era is STRUCTURE on the same footing as `months` and `weekdays`, which a player has always received. It carries no clock - `currentDate` is still the published date and the only one on this object."
          },
          months: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: { $ref: "#/components/schemas/CodexCalendarMonth" }
          },
          weekdays: { type: "array", maxItems: 20, items: { type: "string" } },
          currentDate: {
            ...codexInWorldDateOrNull,
            description: "The PUBLISHED date. Null until the GM publishes one."
          }
        }
      },
      CodexCalendarProjected: codexProjected("CodexCalendar"),
      CodexAsset: {
        type: "object",
        additionalProperties: false,
        required: ["id", "width", "height", "mediaType"],
        properties: {
          id: codexUuid,
          width: { type: "integer", minimum: 1 },
          height: { type: "integer", minimum: 1 },
          mediaType: { type: "string" }
        }
      },
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
      CodexSearchHit: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "id", "title", "tags", "entityType", "mapId"],
        description:
          "One row of the single suite-wide result list. Uniform across record types - every key is present on every kind, null where it does not apply, so a consumer never branches on key presence. Deliberately narrow: enough to render a row and open the record, and nothing more. A player's hit list is gated by exactly the reveal predicate that kind's LIST endpoint applies (a marker additionally requires ITS MAP to be revealed), and a journal `title` is excerpted from the player text alone.",
        properties: {
          kind: {
            type: "string",
            enum: ["page", "journal", "map", "marker", "quest", "session"],
            description: "Which record matched; decides where the client navigates."
          },
          id: codexUuid,
          title: {
            type: "string",
            description:
              "Page title, map name, marker label, or quest title; for a journal entry, a bounded one-line excerpt of its text; for a SESSION, `Session {n}`, else a recap excerpt, else `Untitled session` - never an empty string."
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Always present, so no consumer branches on key presence."
          },
          entityType: {
            oneOf: [codexEntityType, { type: "null" }],
            description: "The page's entity type; null for every other kind."
          },
          mapId: {
            ...codexNullableUuid,
            description:
              "The map a marker sits on; null for every other kind. Never names an unrevealed map, because a player only ever receives a marker hit when that map is revealed."
          }
        }
      },
      CodexSearchData: {
        type: "object",
        additionalProperties: false,
        required: ["hits", "truncated"],
        properties: {
          hits: { ...codexArrayRef("CodexSearchHit"), description: "The one ranked result list, all record kinds." },
          truncated: {
            type: "boolean",
            description:
              'The result list was CUT at the cap - narrow the query. The Codex is unpaginated by design at LAN scale, which is honest only while a caller can tell a complete list from a clipped one; this is that difference. Measured by asking the index for one row past the cap, so it can distinguish "exactly 50 matches" from "50 and more". For a player it reports whether the SEARCH was cut, before their own reveal gates removed anything - so it stays true rather than becoming a count of what they may see.'
          }
        }
      },
      CodexSearchResponse: envelopeSchema("#/components/schemas/CodexSearchData"),
      CodexConnection: {
        type: "object",
        additionalProperties: false,
        description:
          "One edge in the codex graph, GM view. ONE shape for both origins: a connection the GM declared and a connection derived from `[[wiki link]]` text differ by an `origin` attribute, not by being two systems with two panels and two edge kinds.",
        required: ["id", "fromKind", "fromId", "toPageId", "label", "origin", "layer", "createdAt"],
        properties: {
          id: {
            ...codexNullableUuid,
            description:
              "Null exactly when `origin` is `mention`: a derived edge has no row of its own, so it is deleted by editing the text that produced it."
          },
          fromKind: {
            type: "string",
            enum: ["page", "session", "quest", "journal"],
            description: "Which record the connection comes FROM. Session, quest and journal bodies join the graph."
          },
          fromId: codexUuid,
          toPageId: {
            ...codexUuid,
            description:
              "Connections v1 are edges INTO pages. `[[map:...]]`/`[[marker:...]]` targets still parse and persist but get no graph exposure."
          },
          label: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 40,
            description: 'The out-label ("ally of", "located in"). Null for an unlabelled connection.'
          },
          origin: { type: "string", enum: ["declared", "mention"] },
          layer: {
            type: "string",
            enum: ["player", "gm"],
            description:
              "Which layer the connection lives on. A `mention` inherits the body it was written in; a `declared` one is chosen at create (default `player`)."
          },
          createdAt: { type: ["string", "null"], format: "date-time", description: "Null for a mention row." }
        }
      },
      CodexConnectionPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A connection as a PLAYER receives it. No `id` (a player never addresses one), no `layer` (every connection they receive is on the player layer, so the key could only be a constant), no `createdAt`.",
        required: ["fromKind", "fromId", "toPageId", "label", "origin"],
        properties: {
          fromKind: { type: "string", enum: ["page", "session", "quest", "journal"] },
          fromId: codexUuid,
          toPageId: codexUuid,
          label: { type: ["string", "null"], minLength: 1, maxLength: 40 },
          origin: { type: "string", enum: ["declared", "mention"] }
        }
      },
      CodexConnectionProjected: codexProjected("CodexConnection"),
      CodexConnectionData: codexDataObject("connection", { $ref: "#/components/schemas/CodexConnection" }),
      CodexConnectionResponse: envelopeSchema("#/components/schemas/CodexConnectionData"),
      CodexConnectionListData: codexDataObject("connections", codexArrayRef("CodexConnectionProjected")),
      CodexConnectionListResponse: envelopeSchema("#/components/schemas/CodexConnectionListData"),
      CodexPageConnection: {
        type: "object",
        additionalProperties: false,
        description:
          "One row of a page's Connections panel: the OTHER endpoint resolved, plus which way the edge points. Folds in what used to be two separate views (backlinks and typed relationships).",
        required: [
          "id",
          "direction",
          "otherKind",
          "otherId",
          "otherTitle",
          "otherEntityType",
          "otherRevealed",
          "label",
          "origin",
          "layer",
          "section"
        ],
        properties: {
          id: codexNullableUuid,
          direction: { type: "string", enum: ["out", "in"] },
          otherKind: { type: "string", enum: ["page", "session", "quest", "journal"] },
          otherId: codexUuid,
          otherTitle: {
            type: "string",
            description:
              'A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry\'s player text - the reveal-audit naming rule.'
          },
          otherEntityType: {
            oneOf: [codexEntityType, { type: "null" }],
            description: "Pages only; null for every other kind."
          },
          otherRevealed: {
            type: "boolean",
            description:
              "GM-only; not declared on `CodexPageConnectionPlayer` (a player only ever receives connections to records they can see)."
          },
          label: { type: ["string", "null"] },
          origin: { type: "string", enum: ["declared", "mention"] },
          layer: { type: "string", enum: ["player", "gm"] },
          section: {
            type: ["string", "null"],
            description: "The heading the mention sits under; null for a declared connection."
          }
        }
      },
      CodexPageConnectionPlayer: {
        type: "object",
        additionalProperties: false,
        description:
          "A page's Connections panel as a PLAYER receives it: revealed others only, so `otherRevealed` would be a constant, and no `id` or `layer`.",
        required: ["direction", "otherKind", "otherId", "otherTitle", "otherEntityType", "label", "origin", "section"],
        properties: {
          direction: { type: "string", enum: ["out", "in"] },
          otherKind: { type: "string", enum: ["page", "session", "quest", "journal"] },
          otherId: codexUuid,
          otherTitle: { type: "string" },
          otherEntityType: { oneOf: [codexEntityType, { type: "null" }] },
          label: { type: ["string", "null"] },
          origin: { type: "string", enum: ["declared", "mention"] },
          section: { type: ["string", "null"] }
        }
      },
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
      // One uniform, narrow row for every record type, enough to name the record and hand its id to that kind's own
      // reveal route. `journalKind` is present-and-null on non-journal rows (as `CodexSearchHit` does with
      // `entityType`/`mapId`) so the GM can tell a revealed deadline from a note; the client badges it.
      CodexRevealAuditRow: {
        type: "object",
        additionalProperties: false,
        description: "One record the party can currently see.",
        required: ["kind", "id", "title", "journalKind"],
        properties: {
          kind: {
            type: "string",
            enum: ["page", "map", "marker", "journal", "session", "quest", "standing"],
            description:
              "Which reveal surface this row belongs to - and therefore which existing reveal route un-reveals it."
          },
          id: {
            ...codexUuid,
            description:
              "The record's OWN id, which is exactly the id that kind's existing reveal route takes. For a `standing` row this is the FACTION PAGE id, because `POST /codex/standing/{factionPageId}/reveal` is addressed that way."
          },
          title: {
            type: "string",
            description:
              "One line naming the record, taken from the record's own PLAYER projection - a page title, a map name, a marker label, a bounded excerpt of a journal entry's player text, \"Session 4\", a quest title, a faction name. Empty string when the record has no name (an unlabelled pin)."
          },
          journalKind: {
            oneOf: [
              { type: "string", enum: ["note", "combat", "deadline", "downtime", "milestone", "standing", "quest"] },
              { type: "null" }
            ],
            description:
              'WHICH kind of journal record this is - the same six-value vocabulary `CodexJournalEntry.kind` uses. Set on every `kind: "journal"` row and `null` on all six other kinds, present either way so no consumer branches on key presence. Render it as a badge beside `title`, never by parsing `title`: the title is the record\'s own prose whenever it has any, and only names the kind when the record is silent.'
          }
        }
      },
      CodexRevealAuditSection: {
        type: "object",
        additionalProperties: false,
        description:
          'One reveal surface\'s report. ALWAYS present, empty ones included with `revealed: 0` and `rows: []` - "nothing is revealed here" and "this did not load" must not look the same.',
        required: ["kind", "revealed", "total", "rows"],
        properties: {
          kind: { type: "string", enum: ["page", "map", "marker", "journal", "session", "quest", "standing"] },
          revealed: {
            type: "integer",
            minimum: 0,
            description:
              "How many records of this kind the party can CURRENTLY SEE - which is not always the same as how many carry a reveal flag. A marker flagged revealed on a hidden map is not counted, because the player-facing marker read does not return it either."
          },
          total: {
            type: "integer",
            minimum: 0,
            description: 'How many exist at all, so "3 of 40" reads as deliberate rather than as an empty screen.'
          },
          rows: codexArrayRef("CodexRevealAuditRow")
        }
      },
      CodexRevealAudit: {
        type: "object",
        additionalProperties: false,
        description:
          "Everything the party can currently see across every reveal surface in the Codex. A READ-ONLY AGGREGATION of the existing player projections - it restates no visibility rule and writes nothing, which is why it agrees with the player-facing endpoints exactly rather than approximately.",
        required: ["sections", "revealed", "total"],
        properties: {
          sections: {
            ...codexArrayRef("CodexRevealAuditSection"),
            description: "All seven surfaces, in a fixed order, always all present."
          },
          revealed: {
            type: "integer",
            minimum: 0,
            description: "Total records the party can see, across every surface."
          },
          total: { type: "integer", minimum: 0, description: "Total records that exist, across every surface." }
        }
      },
      CodexRevealAuditData: codexDataObject("audit", { $ref: "#/components/schemas/CodexRevealAudit" }),
      CodexRevealAuditResponse: envelopeSchema("#/components/schemas/CodexRevealAuditData"),
      CodexCalendarData: codexDataObject("calendar", { $ref: "#/components/schemas/CodexCalendar" }),
      CodexCalendarResponse: envelopeSchema("#/components/schemas/CodexCalendarData"),
      // The GET projects per role; calendar writes and the apply-downtime payload keep the GM shape.
      CodexCalendarProjectedData: codexDataObject("calendar", { $ref: "#/components/schemas/CodexCalendarProjected" }),
      CodexCalendarProjectedResponse: envelopeSchema("#/components/schemas/CodexCalendarProjectedData"),
      CodexRevisionHistorySettings: {
        type: "object",
        additionalProperties: false,
        description:
          "How much page version history the codex keeps, and what keeping it costs. The two knobs are exactly `CodexRevisionHistoryInput`'s; the two usage figures are server-computed and READ-ONLY, and they are a superset here rather than a second object because a settings screen wants the cost beside the control that changes it.",
        required: ["enabled", "windowMinutes", "versionCount", "versionBytes"],
        properties: {
          enabled: { type: "boolean", description: "Whether a page save may write a new revision at all." },
          windowMinutes: {
            type: "integer",
            minimum: 0,
            maximum: 10_080,
            description:
              "Coalescing window in minutes; `0` keeps every save. See `CodexRevisionHistoryInput.windowMinutes`."
          },
          versionCount: {
            type: "integer",
            minimum: 0,
            description:
              "How many revision rows exist, across the WHOLE codex rather than one page - the same set `DELETE /codex/page-revisions` operates on. Read-only: it is a fact about the table, so it is never accepted on a write."
          },
          versionBytes: {
            type: "integer",
            minimum: 0,
            description:
              "Roughly how much TEXT that history holds: the summed length of the content columns a revision duplicates from its page (both bodies, both field maps, the title and the tags). Deliberately APPROXIMATE and deliberately not disk usage or the export's serialized size - it exists to be compared against itself before and after a trim, and a figure precise enough to invite comparison against the sqlite file's size would be a figure that disagrees with it. Render it as \"about 8.0 MB of text\". Read-only, like `versionCount`."
          }
        }
      },
      CodexSettings: {
        type: "object",
        additionalProperties: false,
        description:
          "Every codex-WIDE setting as a READER sees it, nested by area, including the read-only usage figures. The nesting by area is what gives a later codex-wide setting a home without inventing fields for it today: `codex_meta` is the codex's singleton settings row, and this is that row as a caller sees it.",
        required: ["revisionHistory", "autosave"],
        properties: {
          revisionHistory: { $ref: "#/components/schemas/CodexRevisionHistorySettings" },
          autosave: { $ref: "#/components/schemas/CodexAutosaveSettings" }
        }
      },
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
      CodexImportCounts: {
        type: "object",
        additionalProperties: false,
        description:
          "What the database actually holds after the restore - its own row counts, not what the bundle claimed.",
        required: [
          "pages",
          "folders",
          "maps",
          "markers",
          "journal",
          "connections",
          "sessions",
          "quests",
          "standing",
          "revisions"
        ],
        properties: {
          pages: { type: "integer", minimum: 0 },
          folders: { type: "integer", minimum: 0 },
          maps: { type: "integer", minimum: 0 },
          markers: { type: "integer", minimum: 0 },
          journal: { type: "integer", minimum: 0 },
          connections: {
            type: "integer",
            minimum: 0,
            description:
              "DECLARED connections. Mention edges are derived from body text and are rebuilt by the restore, so counting them would double-count the rebuild's own output."
          },
          sessions: { type: "integer", minimum: 0 },
          quests: { type: "integer", minimum: 0 },
          standing: { type: "integer", minimum: 0 },
          revisions: { type: "integer", minimum: 0 }
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
