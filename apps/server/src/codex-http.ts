import { createHash } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { CODEX_ASSET_PATHS, CODEX_PATHS } from "@vtt/api-contract";
import type { CodexConnection } from "@vtt/domain";
import {
  apiErrorHandler,
  expressPath,
  issuesOf,
  pathParam,
  sendData,
  sendFailure,
  sendInternalError
} from "./http-kit.js";
import { InvalidRequestError } from "./invalid-request.js";
import type { MapAssetStore } from "./map-assets.js";
import { CODEX_BUNDLE_VERSION } from "./codex/bundle.js";
import type { CodexRelationshipRow } from "./codex/connections.js";
import { CodexNotFoundError, CodexRevisionConflictError, CodexValidationError } from "./codex/validate.js";
import {
  chronicleContext,
  connectionContext,
  isMapVisible,
  isMarkerVisible,
  isPageVisible,
  journalContext,
  mapContext,
  markerRecord,
  questContext,
  revealAuditRecords,
  searchRecord,
  standingContext
} from "./codex/visibility.js";
import type { CodexStore } from "./codex-store.js";
import { callerOf, refuse, sendUnauthenticated, type CredentialVerifiers } from "./request-auth.js";
import {
  CalendarSchema,
  CodexImportSchema,
  CodexSettingsSchema,
  ConnectionCreateSchema,
  ConnectionUpdateSchema,
  DeadlineCreateSchema,
  DowntimeCreateSchema,
  FolderMoveSchema,
  FolderPathSchema,
  JournalUpdateSchema,
  JournalWriteSchema,
  MapCreateSchema,
  MapParentSchema,
  MapUpdateSchema,
  MarkerCreateSchema,
  MarkerMoveSchema,
  MarkerPartySchema,
  MarkerUpdateSchema,
  MilestoneCreateSchema,
  PageCreateSchema,
  PageUpdateSchema,
  QuestCreateSchema,
  QuestUpdateSchema,
  RevealSchema,
  RevisionsDeleteSchema,
  SessionCreateSchema,
  SessionUpdateSchema,
  StandingSetSchema
} from "./codex-requests.js";
import {
  projectGmCalendar,
  projectGmChronicleRecord,
  projectGmConnections,
  projectGmJournalEntry,
  projectGmMap,
  projectGmMarker,
  projectGmPage,
  projectGmPageConnections,
  projectGmPageSummary,
  projectGmQuest,
  projectGmSearchHit,
  projectGmSession,
  projectGmStanding,
  projectPlayerCalendar,
  projectPlayerChronicleRecord,
  projectPlayerConnections,
  projectPlayerJournalEntry,
  projectPlayerMap,
  projectPlayerPage,
  projectPlayerPageConnections,
  projectPlayerPageMarker,
  projectPlayerPageSummary,
  projectPlayerQuest,
  projectPlayerSearchHit,
  projectPlayerSession,
  projectPlayerStanding,
  projectRevealAudit
} from "./codex-projections.js";

/**
 * The Codex REST surface (`/api/v1/codex/*`), outside the GameState broadcast. Writes bump the store revision and
 * ping `notifyChanged`; reads branch on role, ask `codex/visibility.ts` what a player may see, and project
 * through `codex-projections.ts`.
 */

/** `gm` and `integration` both read at GM grade. `none` and `invalid` have no live credential (401); `denied` is a
 *  valid credential that does not reach the Codex, such as an integration credential without the scope (403). */
type CodexPrincipal = Readonly<{ kind: "gm" | "player" | "integration" | "none" | "invalid" | "denied" }>;
type CodexGrade = "gm" | "player";

type CodexRouterOptions = Readonly<{
  store: CodexStore;
  /** Content-addressed store for page media (banners + inline images), separate from map/token assets. */
  assets: MapAssetStore;
  /** The server's credential checks. Required to carry `integration` so no mount site silently disables
   *  credentials. */
  verifiers: CredentialVerifiers & Required<Pick<CredentialVerifiers, "integration">>;
  /** Emit a content-free `codex:changed` ping so every client refetches its projected view. */
  notifyChanged: () => void;
  /** A real player token for the GM's preview: the GM's own token would still get GM projections. */
  issuePreviewSession: () => string;
}>;

/** Strip the idempotency key before a parsed body reaches the store, which knows nothing of retries. */
function withoutCommandId<T extends { commandId?: string }>(input: T): Omit<T, "commandId"> {
  const { commandId: _commandId, ...rest } = input;
  return rest;
}
/** `ETag` resource fingerprint: path plus sorted query. A collision only costs a 200, never a wrong 304. */
function resourceKey(request: Request): string {
  const [path, rawQuery = ""] = request.originalUrl.split("?");
  const query = [...new URLSearchParams(rawQuery)]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${path}?${query}`).digest("hex").slice(0, 12);
}
const FAULT = "The codex request failed.";
/** Only `ZodError` and `CodexValidationError` are the caller's fault; anything else is a sanitized 500. */
function malformed(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return sendFailure(response, 400, "validation_failed", error.issues[0]?.message ?? "The request is malformed.", {
      issues: issuesOf(error)
    });
  }
  if (error instanceof CodexValidationError) return sendFailure(response, 400, "validation_failed", error.message);
  return sendInternalError(response, error, FAULT);
}
/** `currentRevision` is supplied only where a 409 can be a stale `expectedRev`, so its presence means "rebase and retry". */
function codexError(response: Response, error: unknown, currentRevision?: () => number | undefined) {
  if (error instanceof CodexRevisionConflictError)
    return sendFailure(response, 409, "conflict", error.message, undefined, currentRevision?.());
  if (error instanceof CodexNotFoundError) return sendFailure(response, 404, "not_found", error.message);
  return malformed(response, error);
}

/** A declared connection in the graph's edge shape, as the connection writes answer. */
function declaredConnection(relationship: CodexRelationshipRow): CodexConnection {
  return {
    id: relationship.id,
    fromKind: "page" as const,
    fromId: relationship.fromPageId,
    toPageId: relationship.toPageId,
    label: relationship.label,
    origin: "declared" as const,
    layer: relationship.layer,
    createdAt: relationship.createdAt
  };
}

const NO_SCOPE = "This credential does not carry the Codex scope this route needs.";

/** Just the credential checks, so the import guard is built from the same ones the router gets. */
export type CodexAuthOptions = Pick<CodexRouterOptions, "verifiers">;

/**
 * Who is calling, read by the shared `callerOf` (ADR-0027): role comes only from the signed session token or a
 * verified credential. `callerOf` memoizes per request, because checking a credential writes its audit rows.
 */
function principalFor(
  request: Request,
  response: Response,
  options: CodexAuthOptions,
  scope: "codex:read" | "codex:write"
): CodexPrincipal {
  const caller = callerOf(request, response, options.verifiers, { scope });
  if (caller.kind === "none" || caller.kind === "invalid" || caller.kind === "gm" || caller.kind === "player")
    return { kind: caller.kind };
  if (caller.kind === "integration" && caller.inScope) return { kind: "integration" };
  return { kind: "denied" };
}

/** Answers a caller the route does not serve: 401 without a live credential, else 403 with `forbidden`. */
function refusePrincipal(response: Response, principal: CodexPrincipal, forbidden: string) {
  if (principal.kind === "none" || principal.kind === "invalid") return sendUnauthenticated(response, principal.kind);
  return sendFailure(response, 403, "forbidden", principal.kind === "denied" ? NO_SCOPE : forbidden);
}

/** The one refusal a Codex write can get, shared by the router and the import guard. */
function refuseWrite(response: Response, principal: CodexPrincipal) {
  return refusePrincipal(response, principal, "Codex writes are the GM's.");
}

/**
 * Authorization for `POST /codex/import`, mounted ahead of its 64 MB body parser so an unauthenticated caller
 * cannot block the game's event loop with huge parses. Same `principalFor`/`refuseWrite` policy as the router.
 */
export function createCodexImportGuard(options: CodexAuthOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:write");
    if (principal.kind === "gm" || principal.kind === "integration") return next();
    return refuseWrite(response, principal);
  };
}

export function createCodexRouter(options: CodexRouterOptions) {
  const router = Router();
  const { store } = options;

  /** The projection grade for a read, or null once a 401/403 has been sent. Credentials read at GM grade. */
  const readGrade = (request: Request, response: Response): CodexGrade | null => {
    const principal = principalFor(request, response, options, "codex:read");
    if (principal.kind === "gm" || principal.kind === "integration") return "gm";
    if (principal.kind === "player") return "player";
    refusePrincipal(response, principal, NO_SCOPE);
    return null;
  };

  /** GM-grade reads: folders, revision history, settings, the reveal audit, export. No player branch. */
  const requireGmRead = (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:read");
    if (principal.kind === "gm" || principal.kind === "integration") return next();
    return refusePrincipal(response, principal, "The codex's GM surfaces are the GM's.");
  };

  /**
   * `commandId` idempotency: a resent id replays the stored 2xx status and body (`x-idempotent-replay`). Runs
   * after authorization, records only after a successful response, and refuses an id reused for another
   * method/path. Returns true when it has already answered.
   */
  const idempotency = (request: Request, response: Response): boolean => {
    const supplied = (request.body as { commandId?: unknown } | undefined)?.commandId;
    if (typeof supplied !== "string" || request.method === "DELETE") return false;
    const fingerprint = `${request.method} ${request.baseUrl}${request.path}`;
    const replay = store.recallCommand(supplied);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        sendFailure(
          response,
          400,
          "validation_failed",
          "That commandId was already used for a different request. An idempotency key identifies one request, so retries must resend the same one and a new request needs a new key."
        );
        return true;
      }
      response.setHeader("x-idempotent-replay", "true");
      response.status(replay.status).json(replay.body);
      return true;
    }
    const send = response.json.bind(response);
    response.json = (payload: unknown) => {
      if (response.statusCode >= 200 && response.statusCode < 300)
        store.recordCommand(supplied, response.statusCode, payload, fingerprint);
      return send(payload);
    };
    return false;
  };

  /** Every write. A player session gets 403, not 401: they are authenticated, and they are refused. */
  const requireWrite = (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:write");
    // Idempotency runs inside the guard, so it is always after authorization.
    if (principal.kind === "gm" || principal.kind === "integration")
      return idempotency(request, response) ? undefined : next();
    return refuseWrite(response, principal);
  };

  /** Minting a player session token is GM-session only; a credential must not hand out player sessions. */
  const requireGmSession = (request: Request, response: Response, next: NextFunction) => {
    const caller = callerOf(request, response, options.verifiers, { scope: "codex:write" });
    if (caller.kind === "gm") return next();
    return refuse(response, caller, "Only a GM session may mint a player preview.");
  };

  /**
   * Weak `ETag` of store revision (every write bumps it), grade and resource, with a 304 on match. Called only
   * after every auth and existence gate, so a 304 never confirms that a hidden record exists.
   */
  const readEnvelope = (request: Request, response: Response, grade: CodexGrade, data: unknown) => {
    const etag = `W/"codex-r${store.revision}-${grade}-${resourceKey(request)}"`;
    response.setHeader("etag", etag);
    if (request.header("if-none-match") === etag) return response.status(304).end();
    return sendData(response, 200, data);
  };

  /**
   * One GM write: `run` parses the body, calls the store and returns the response data; then every client is
   * pinged and the data is sent. A store error becomes its status. `currentRevision` re-reads the row only on a
   * 409, so the caller learns which revision it lost the race to. `quiet` skips the ping for GM-only state.
   */
  const write = (
    method: "post" | "patch" | "put" | "delete",
    path: string,
    run: (request: Request) => unknown,
    how: Readonly<{
      status?: number;
      quiet?: boolean;
      currentRevision?: (request: Request) => number | undefined;
    }> = {}
  ) =>
    router[method](expressPath(path), requireWrite, (request: Request, response: Response) => {
      try {
        const data = run(request);
        if (!how.quiet) options.notifyChanged();
        return sendData(response, how.status ?? 200, data);
      } catch (error) {
        const { currentRevision } = how;
        return codexError(response, error, currentRevision && (() => currentRevision(request)));
      }
    });
  const CREATED = { status: 201 } as const;

  // Pages

  router.get(expressPath(CODEX_PATHS.pages), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const filter = {
      folder:
        request.query.folder === undefined
          ? undefined
          : request.query.folder === ""
            ? null
            : String(request.query.folder),
      tag: request.query.tag === undefined ? undefined : String(request.query.tag)
    };
    const rows = store.listPages(filter);
    const pages =
      role === "gm"
        ? rows.map(projectGmPageSummary)
        : rows.map(projectPlayerPageSummary).filter((page) => page !== null);
    return readEnvelope(request, response, role, { pages });
  });

  /** One result list (`hits`) across all record kinds, discriminated by `kind`. */
  router.get(expressPath(CODEX_PATHS.search), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const query = typeof request.query.q === "string" ? request.query.q : "";
    // Resolved for both roles: cheap, and a conditional here would make forgetting it a leak.
    const playerContext = journalContext(store);
    const found = store.searchAll(role, query);
    const hits = found.hits
      .map((ref) => searchRecord(store, ref))
      .filter((record) => record !== null)
      .map((record) => (role === "gm" ? projectGmSearchHit(record) : projectPlayerSearchHit(record, playerContext)))
      .filter((hit) => hit !== null);
    // `truncated` is measured before projection, so it means the search itself was cut off.
    return readEnvelope(request, response, role, { hits, truncated: found.truncated });
  });

  router.get(expressPath(CODEX_PATHS.pageById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return sendFailure(response, 404, "not_found", "That page was not found.");
    if (role === "gm")
      return readEnvelope(request, response, role, {
        page: projectGmPage(page),
        connections: projectGmPageConnections(store.connectionsForPage(page.id))
      });
    const projected = projectPlayerPage(page);
    if (!projected) return sendFailure(response, 404, "not_found", "That page was not found.");
    // The same context as the graph feed, so the panel and the graph are gated by one rule.
    return readEnvelope(request, response, role, {
      page: projected,
      connections: projectPlayerPageConnections(store.connectionsForPage(page.id), connectionContext(store))
    });
  });

  write(
    "post",
    CODEX_PATHS.pages,
    (request) => ({ page: projectGmPage(store.createPage(withoutCommandId(PageCreateSchema.parse(request.body)))) }),
    CREATED
  );
  write(
    "patch",
    CODEX_PATHS.pageById,
    (request) => {
      const { expectedRev, ...fields } = withoutCommandId(PageUpdateSchema.parse(request.body));
      return { page: projectGmPage(store.updatePage(pathParam(request, "id"), fields, expectedRev, "gm")) };
    },
    { currentRevision: (request) => store.getPage(pathParam(request, "id"))?.rev }
  );
  write("post", CODEX_PATHS.pageReveal, (request) => ({
    page: projectGmPage(store.setPageRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed))
  }));
  write("delete", CODEX_PATHS.pageById, (request) => {
    store.deletePage(pathParam(request, "id"));
    return { deleted: true };
  });

  // Folder records make empty folders persist; otherwise a folder is only implied by its pages.
  write("post", CODEX_PATHS.foldersMove, (request) => {
    const { from, to } = FolderMoveSchema.parse(request.body);
    return { moved: store.moveFolder(from, to) };
  });
  router.get(expressPath(CODEX_PATHS.folders), requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", { folders: store.listFolders() })
  );
  write(
    "post",
    CODEX_PATHS.folders,
    (request) => ({ path: store.createFolder(FolderPathSchema.parse(request.body).path) }),
    CREATED
  );
  write("post", CODEX_PATHS.foldersDelete, (request) => {
    store.deleteFolder(FolderPathSchema.parse(request.body).path);
    return { deleted: true };
  });

  // GM preview: mints a real, short-lived player principal, never a role flag on the GM's token.
  router.post(expressPath(CODEX_PATHS.previewSession), requireGmSession, (_request, response) => {
    try {
      return sendData(response, 201, { token: options.issuePreviewSession() });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.get(expressPath(CODEX_PATHS.pageRevisions), requireGmRead, (request, response) => {
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return sendFailure(response, 404, "not_found", "That page was not found.");
    return readEnvelope(request, response, "gm", { revisions: store.listRevisions(page.id) });
  });
  write("post", CODEX_PATHS.pageRevisionRestore, (request) => {
    const revisionId = Number(request.params.revisionId);
    if (!Number.isInteger(revisionId)) throw new CodexValidationError("The revision id is malformed.");
    return { page: projectGmPage(store.restoreRevision(pathParam(request, "id"), revisionId, "gm")) };
  });

  // Connections: declared edges and mentions are one concept, one panel, one graph.

  // Idempotent on `(from, to, label)`. Touches both pages' recency but not their `rev`.
  write(
    "post",
    CODEX_PATHS.pageConnections,
    (request) => ({
      connection: declaredConnection(
        store.createConnection(pathParam(request, "id"), withoutCommandId(ConnectionCreateSchema.parse(request.body)))
      )
    }),
    CREATED
  );
  // Declared connections only; a mention is edited through its source text.
  write("patch", CODEX_PATHS.connectionById, (request) => ({
    connection: declaredConnection(
      store.updateConnection(pathParam(request, "id"), withoutCommandId(ConnectionUpdateSchema.parse(request.body)))
    )
  }));
  write("delete", CODEX_PATHS.connectionById, (request) => {
    store.deleteConnection(pathParam(request, "id"));
    return { deleted: true };
  });
  router.get(expressPath(CODEX_PATHS.connections), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const all = store.listAllConnections();
    if (role === "gm") return readEnvelope(request, response, role, { connections: projectGmConnections(all) });
    return readEnvelope(request, response, role, {
      connections: projectPlayerConnections(all, connectionContext(store))
    });
  });

  // The atlas: maps and their pins

  router.get(expressPath(CODEX_PATHS.maps), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const rows = store.listMaps();
    const maps =
      role === "gm"
        ? rows.map(projectGmMap)
        : rows.map((row) => projectPlayerMap(row, mapContext(store, row))).filter((map) => map !== null);
    return readEnvelope(request, response, role, { maps });
  });
  write(
    "post",
    CODEX_PATHS.maps,
    (request) => ({ map: projectGmMap(store.createMap(withoutCommandId(MapCreateSchema.parse(request.body)))) }),
    CREATED
  );
  write("patch", CODEX_PATHS.mapById, (request) => ({
    map: projectGmMap(store.updateMap(pathParam(request, "id"), withoutCommandId(MapUpdateSchema.parse(request.body))))
  }));
  write("post", CODEX_PATHS.mapParent, (request) => ({
    map: projectGmMap(store.setMapParent(pathParam(request, "id"), MapParentSchema.parse(request.body).parentMapId))
  }));
  write("post", CODEX_PATHS.mapReveal, (request) => ({
    map: projectGmMap(store.setMapRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed))
  }));
  write("delete", CODEX_PATHS.mapById, (request) => {
    store.deleteMap(pathParam(request, "id"));
    return { deleted: true };
  });

  router.get(expressPath(CODEX_PATHS.mapMarkers), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const mapId = pathParam(request, "id");
    if (!store.getMap(mapId)) return sendFailure(response, 404, "not_found", "That map was not found.");
    const rows = store.listMarkers(mapId);
    if (role === "gm") return readEnvelope(request, response, role, { markers: rows.map(projectGmMarker) });
    if (!isMapVisible(store, mapId)) return sendFailure(response, 404, "not_found", "That map was not found.");
    const markers = rows
      .map((row) => projectPlayerPageMarker(markerRecord(store, row)))
      .filter((marker) => marker !== null);
    return readEnvelope(request, response, role, { markers });
  });

  // Pins pointing at a page. A player is refused a hidden page first, so ids cannot be probed.
  router.get(expressPath(CODEX_PATHS.pageMarkers), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return sendFailure(response, 404, "not_found", "That page was not found.");
    if (role !== "gm" && !isPageVisible(store, page.id))
      return sendFailure(response, 404, "not_found", "That page was not found.");
    const rows = store.markersForPage(page.id);
    if (role === "gm") return readEnvelope(request, response, role, { markers: rows.map(projectGmMarker) });
    const markers = rows
      .map((row) => projectPlayerPageMarker(markerRecord(store, row)))
      .filter((marker) => marker !== null);
    return readEnvelope(request, response, role, { markers });
  });

  write(
    "post",
    CODEX_PATHS.mapMarkers,
    (request) => ({
      marker: projectGmMarker(
        store.createMarker(pathParam(request, "id"), withoutCommandId(MarkerCreateSchema.parse(request.body)))
      )
    }),
    CREATED
  );

  // Where the party is. A player gets null (not 404) for a hidden pin, so a hidden party pin and none look
  // the same; `mapName` is sent only with a visible pin.
  router.get(expressPath(CODEX_PATHS.party), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const marker = store.partyMarker();
    const map = marker ? store.getMap(marker.mapId) : null;
    if (!marker || !map) return readEnvelope(request, response, role, { party: null });
    if (role === "gm")
      return readEnvelope(request, response, role, { party: { marker: projectGmMarker(marker), mapName: map.name } });
    const projected = projectPlayerPageMarker(markerRecord(store, marker));
    return readEnvelope(request, response, role, {
      party: projected === null ? null : { marker: projected, mapName: map.name }
    });
  });

  // One pin by id. Any player gate failure is the same 404 as a bogus id.
  router.get(expressPath(CODEX_PATHS.markerById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const marker = store.getMarker(pathParam(request, "id"));
    if (!marker) return sendFailure(response, 404, "not_found", "That pin was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { marker: projectGmMarker(marker) });
    const projected = projectPlayerPageMarker(markerRecord(store, marker));
    if (!projected) return sendFailure(response, 404, "not_found", "That pin was not found.");
    return readEnvelope(request, response, role, { marker: projected });
  });

  write("patch", CODEX_PATHS.markerById, (request) => ({
    marker: projectGmMarker(
      store.updateMarker(pathParam(request, "id"), withoutCommandId(MarkerUpdateSchema.parse(request.body)))
    )
  }));
  write("post", CODEX_PATHS.markerMove, (request) => {
    const { x, y } = MarkerMoveSchema.parse(request.body);
    return { marker: projectGmMarker(store.moveMarker(pathParam(request, "id"), x, y)) };
  });
  write("post", CODEX_PATHS.markerReveal, (request) => ({
    marker: projectGmMarker(
      store.setMarkerRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed)
    )
  }));
  // `isParty: false` clears only this pin, not whichever pin holds the flag.
  write("put", CODEX_PATHS.markerParty, (request) => {
    const markerId = pathParam(request, "id");
    const { isParty } = MarkerPartySchema.parse(request.body);
    if (isParty) store.setPartyMarker(markerId);
    else if (store.partyMarker()?.id === markerId) store.setPartyMarker(null);
    // `setPartyMarker` refuses an unknown id; clearing one that does not hold the flag is caught here.
    const marker = store.getMarker(markerId);
    if (!marker) throw new CodexNotFoundError("That marker was not found.");
    return { marker: projectGmMarker(marker) };
  });
  write("delete", CODEX_PATHS.markerById, (request) => {
    store.deleteMarker(pathParam(request, "id"));
    return { deleted: true };
  });

  // The journal

  router.get(expressPath(CODEX_PATHS.journal), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const markerId = typeof request.query.markerId === "string" ? request.query.markerId : undefined;
    const pageId = typeof request.query.pageId === "string" ? request.query.pageId : undefined;
    // A player reads a pin's or page's mini-timeline only when that pin or page is visible, so hidden ids
    // cannot be probed. Each entry's own gate still applies below.
    if (role !== "gm") {
      if (markerId && !isMarkerVisible(store, markerId))
        return sendFailure(response, 404, "not_found", "That was not found.");
      if (pageId && !isPageVisible(store, pageId))
        return sendFailure(response, 404, "not_found", "That was not found.");
    }
    const rows = markerId || pageId ? store.listEntriesFor({ markerId, pageId }) : store.listTimeline();
    if (role === "gm") return readEnvelope(request, response, role, { entries: rows.map(projectGmJournalEntry) });
    const context = journalContext(store);
    const entries = rows.map((row) => projectPlayerJournalEntry(row, context)).filter((entry) => entry !== null);
    return readEnvelope(request, response, role, { entries });
  });

  // The chronicle: entries and dated event pages in one order. `listChronicle` is ungated;
  // `projectPlayerChronicleRecord` is the only player gate.
  router.get(expressPath(CODEX_PATHS.timeline), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const rows = store.listChronicle();
    if (role === "gm") {
      // The GM's own clock, kept to this branch so it cannot reach a player.
      const campaignInstant = store.campaignInstant();
      const records = rows.map((row) =>
        projectGmChronicleRecord(row, {
          campaignInstant,
          // Only an unapplied downtime has a proposed date, and only the GM sees it.
          proposedDate: row.kind === "entry" ? store.proposedDateFor(row.entry) : null
        })
      );
      return readEnvelope(request, response, role, { records });
    }
    const context = chronicleContext(store);
    const records = rows.map((row) => projectPlayerChronicleRecord(row, context)).filter((record) => record !== null);
    return readEnvelope(request, response, role, { records });
  });

  write(
    "post",
    CODEX_PATHS.journal,
    (request) => ({
      entry: projectGmJournalEntry(store.createEntry(withoutCommandId(JournalWriteSchema.parse(request.body))))
    }),
    CREATED
  );
  // Deadline, downtime and milestone have their own create routes, each needing a date or a payload, and are
  // registered before the `{id}` family. Reveal goes through the ordinary journal route.
  write(
    "post",
    CODEX_PATHS.journalDeadline,
    (request) => ({
      entry: projectGmJournalEntry(store.createDeadline(withoutCommandId(DeadlineCreateSchema.parse(request.body))))
    }),
    CREATED
  );
  // Never moves the clock; answers with the date `apply-downtime` would move it to.
  write(
    "post",
    CODEX_PATHS.journalDowntime,
    (request) => {
      const entry = store.createDowntime(withoutCommandId(DowntimeCreateSchema.parse(request.body)));
      return { entry: projectGmJournalEntry(entry), proposedDate: store.proposedDateFor(entry) };
    },
    CREATED
  );
  write(
    "post",
    CODEX_PATHS.journalMilestone,
    (request) => ({
      entry: projectGmJournalEntry(store.createMilestone(withoutCommandId(MilestoneCreateSchema.parse(request.body))))
    }),
    CREATED
  );
  // Moves the GM's clock by the downtime's days. A second apply is refused.
  write("post", CODEX_PATHS.journalApplyDowntime, (request) => {
    const { entry, calendar } = store.applyDowntime(pathParam(request, "id"));
    return { entry: projectGmJournalEntry(entry), calendar: projectGmCalendar(calendar, store.getPublishedDate()) };
  });
  write("patch", CODEX_PATHS.journalById, (request) => ({
    entry: projectGmJournalEntry(
      store.updateEntry(pathParam(request, "id"), withoutCommandId(JournalUpdateSchema.parse(request.body)))
    )
  }));
  write("post", CODEX_PATHS.journalReveal, (request) => ({
    entry: projectGmJournalEntry(
      store.setEntryRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed)
    )
  }));
  write("delete", CODEX_PATHS.journalById, (request) => {
    store.deleteEntry(pathParam(request, "id"));
    return { deleted: true };
  });

  // Sessions. A hidden session is a 404 for a player: secret must look like absent.

  router.get(expressPath(CODEX_PATHS.sessions), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const rows = store.listSessions();
    if (role === "gm")
      return readEnvelope(request, response, role, {
        sessions: rows.map(projectGmSession),
        activeSessionId: store.activeSessionId
      });
    // A player always gets `activeSessionId: null` (it may name a hidden session); the key keeps one shape.
    return readEnvelope(request, response, role, {
      sessions: rows.map(projectPlayerSession).filter((session) => session !== null),
      activeSessionId: null
    });
  });
  write(
    "post",
    CODEX_PATHS.sessions,
    (request) => ({
      session: projectGmSession(store.createSession(withoutCommandId(SessionCreateSchema.parse(request.body))))
    }),
    CREATED
  );
  router.get(expressPath(CODEX_PATHS.sessionById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const session = store.getSession(pathParam(request, "id"));
    if (!session) return sendFailure(response, 404, "not_found", "That session was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { session: projectGmSession(session) });
    const projected = projectPlayerSession(session);
    if (!projected) return sendFailure(response, 404, "not_found", "That session was not found.");
    return readEnvelope(request, response, role, { session: projected });
  });
  write(
    "patch",
    CODEX_PATHS.sessionById,
    (request) => {
      const { expectedRev, ...fields } = withoutCommandId(SessionUpdateSchema.parse(request.body));
      return { session: projectGmSession(store.updateSession(pathParam(request, "id"), fields, expectedRev)) };
    },
    { currentRevision: (request) => store.getSession(pathParam(request, "id"))?.rev }
  );
  write("delete", CODEX_PATHS.sessionById, (request) => {
    store.deleteSession(pathParam(request, "id"));
    return { deleted: true };
  });
  write("post", CODEX_PATHS.sessionReveal, (request) => ({
    session: projectGmSession(
      store.setSessionRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed)
    )
  }));
  // Answers with the pointer alone: activating a session does not edit it.
  write("post", CODEX_PATHS.sessionActivate, (request) => ({
    activeSessionId: store.setActiveSession(pathParam(request, "id"))
  }));

  // Quests. A hidden quest is a 404 for a player, and its page links are filtered to revealed pages.

  router.get(expressPath(CODEX_PATHS.quests), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const rows = store.listQuests();
    if (role === "gm") return readEnvelope(request, response, role, { quests: rows.map(projectGmQuest) });
    const quests = rows
      .map((row) => projectPlayerQuest(row, questContext(store, row)))
      .filter((quest) => quest !== null);
    return readEnvelope(request, response, role, { quests });
  });
  write(
    "post",
    CODEX_PATHS.quests,
    (request) => ({
      quest: projectGmQuest(store.createQuest(withoutCommandId(QuestCreateSchema.parse(request.body))))
    }),
    CREATED
  );
  router.get(expressPath(CODEX_PATHS.questById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const quest = store.getQuest(pathParam(request, "id"));
    if (!quest) return sendFailure(response, 404, "not_found", "That quest was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { quest: projectGmQuest(quest) });
    const projected = projectPlayerQuest(quest, questContext(store, quest));
    if (!projected) return sendFailure(response, 404, "not_found", "That quest was not found.");
    return readEnvelope(request, response, role, { quest: projected });
  });
  write(
    "patch",
    CODEX_PATHS.questById,
    (request) => {
      const { expectedRev, ...fields } = withoutCommandId(QuestUpdateSchema.parse(request.body));
      return { quest: projectGmQuest(store.updateQuest(pathParam(request, "id"), fields, expectedRev)) };
    },
    { currentRevision: (request) => store.getQuest(pathParam(request, "id"))?.rev }
  );
  write("delete", CODEX_PATHS.questById, (request) => {
    store.deleteQuest(pathParam(request, "id"));
    return { deleted: true };
  });
  write("post", CODEX_PATHS.questReveal, (request) => ({
    quest: projectGmQuest(store.setQuestRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed))
  }));

  // Standing, addressed by faction page id. A player needs both the standing and its faction revealed.

  router.get(expressPath(CODEX_PATHS.standing), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const rows = store.listStanding();
    if (role === "gm") return readEnvelope(request, response, role, { standing: rows.map(projectGmStanding) });
    const standing = rows
      .map((row) => projectPlayerStanding(row, standingContext(store, row)))
      .filter((row) => row !== null);
    return readEnvelope(request, response, role, { standing });
  });
  // The value and its history record are one write, hence `reason` here.
  write("put", CODEX_PATHS.standingByFaction, (request) => {
    const { value, reason } = StandingSetSchema.parse(request.body);
    return { standing: projectGmStanding(store.setStanding(pathParam(request, "factionPageId"), value, reason)) };
  });
  write("post", CODEX_PATHS.standingReveal, (request) => ({
    standing: projectGmStanding(
      store.setStandingRevealed(pathParam(request, "factionPageId"), RevealSchema.parse(request.body).revealed)
    )
  }));

  // What the party can currently see, for the GM. `projectRevealAudit` decides every row.
  router.get(expressPath(CODEX_PATHS.revealAudit), requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", { audit: projectRevealAudit(revealAuditRecords(store)) })
  );

  // The calendar: the GM gets their own clock plus the published one; a player gets only the published one.

  router.get(expressPath(CODEX_PATHS.calendar), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const calendar = store.getCalendar();
    const publishedDate = store.getPublishedDate();
    return readEnvelope(request, response, role, {
      calendar:
        role === "gm" ? projectGmCalendar(calendar, publishedDate) : projectPlayerCalendar(calendar, publishedDate)
    });
  });
  // Replacing the calendar moves only the GM's clock; it never publishes.
  write("put", CODEX_PATHS.calendar, (request) => ({
    calendar: projectGmCalendar(
      store.setCalendar(withoutCommandId(CalendarSchema.parse(request.body))),
      store.getPublishedDate()
    )
  }));
  // Before a calendar save: which revealed dated records it would move. Reads only, so no commandId and no ping.
  router.post(expressPath(CODEX_PATHS.calendarCheck), requireGmRead, (request, response) => {
    try {
      return sendData(response, 200, {
        moves: store.calendarMoves(withoutCommandId(CalendarSchema.parse(request.body)))
      });
    } catch (error) {
      return malformed(response, error);
    }
  });
  // The only thing that moves the players' clock forward; unpublishing takes it away.
  write("post", CODEX_PATHS.calendarPublish, () => ({
    calendar: projectGmCalendar(store.publishCampaignDate(), store.getPublishedDate())
  }));
  write("post", CODEX_PATHS.calendarUnpublish, () => ({
    calendar: projectGmCalendar(store.unpublishCampaignDate(), store.getPublishedDate())
  }));

  // Restore a backup: replace-only and all-or-nothing. The body must be an unedited export file.
  write("post", CODEX_PATHS.import, (request) => ({
    replaced: true,
    counts: store.importBundle(CodexImportSchema.parse(request.body).codex)
  }));

  // Settings are GM-only, reads included. Their writes ping nobody (no client shows them), though the store
  // still bumps the revision for ETags.
  router.get(expressPath(CODEX_PATHS.settings), requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", { settings: store.getSettings() })
  );
  // Answers with the stored read shape; `.strict()` rejects the read-only usage fields.
  write(
    "put",
    CODEX_PATHS.settings,
    (request) => ({ settings: store.setSettings(withoutCommandId(CodexSettingsSchema.parse(request.body))) }),
    { quiet: true }
  );
  // Prunes history Codex-wide. Works with history switched off and never touches a page.
  write(
    "delete",
    CODEX_PATHS.pageRevisionsCollection,
    (request) => ({ deleted: store.deleteRevisionsOlderThan(RevisionsDeleteSchema.parse(request.body).olderThanDays) }),
    { quiet: true }
  );

  router.get(expressPath(CODEX_PATHS.export), requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", {
      codex: store.exportBundle(),
      exportedAt: new Date().toISOString(),
      bundleVersion: CODEX_BUNDLE_VERSION
    })
  );

  // Media: page banners and inline images

  router.post(
    expressPath(CODEX_ASSET_PATHS.collection),
    requireWrite,
    express.raw({ type: () => true, limit: "11mb" }),
    async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0)
          return sendFailure(response, 400, "validation_failed", "Upload the image as the request body.");
        const filename = typeof request.query.filename === "string" ? request.query.filename : "image";
        const imported = await options.assets.import(request.body, filename);
        return sendData(response, imported.duplicate ? 200 : 201, {
          asset: {
            id: imported.metadata.id,
            width: imported.metadata.width,
            height: imported.metadata.height,
            mediaType: imported.metadata.mediaType
          }
        });
      } catch (error) {
        if (error instanceof InvalidRequestError) return sendFailure(response, 400, "validation_failed", error.message);
        return sendInternalError(response, error, FAULT);
      }
    }
  );

  router.get(expressPath(CODEX_ASSET_PATHS.content), async (request, response) => {
    const id = pathParam(request, "id");
    // A GM or credential always; a player only when revealed player-facing content uses the image. Everyone else is
    // refused before any lookup, so the answer never depends on whether the image exists.
    const principal = principalFor(request, response, options, "codex:read");
    const allowed =
      principal.kind === "gm" ||
      principal.kind === "integration" ||
      (principal.kind === "player" && store.isMediaVisibleToPlayers(id));
    if (!allowed) return refusePrincipal(response, principal, "That image is not available to this session.");
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return sendFailure(response, 404, "not_found", "That image was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    response.setHeader("content-length", content.length);
    return response.send(content);
  });

  // A fixed message out, the real error to the log. This router's own `express.raw` 413s land here too.
  router.use(apiErrorHandler(FAULT));
  return router;
}
