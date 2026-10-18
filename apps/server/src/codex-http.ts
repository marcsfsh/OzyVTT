import { createHash } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { CODEX_ASSET_PATHS, CODEX_PATHS } from "@vtt/api-contract";
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
import { findGm, gmHome } from "./codex/find.js";
import { liveBoard, liveClue, sessionHappened } from "./codex/live.js";
import { PlayerCodexReads, readerOf } from "./codex/player-reads.js";
import { prepItems } from "./codex/prep.js";
import { CodexNotFoundError, CodexRevisionConflictError, CodexValidationError } from "./codex/validate.js";
import { revealAuditRecords } from "./codex/visibility.js";
import type { CodexStore } from "./codex-store.js";
import { callerOf, refuse, sendUnauthenticated, type CredentialVerifiers } from "./request-auth.js";
import {
  AudienceSetSchema,
  BlockAddSchema,
  BlockEditSchema,
  BlockMoveSchema,
  CalendarSchema,
  CodexImportSchema,
  CodexSettingsSchema,
  ConnectionCreateSchema,
  ConnectionUpdateSchema,
  DeadlineCreateSchema,
  DowntimeCreateSchema,
  FieldAudienceSchema,
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
  PartyPlaceSchema,
  PrepTemplateCreateSchema,
  PrepTemplateDuplicateSchema,
  PrepTemplateUpdateSchema,
  PreviewSessionSchema,
  QuestCreateSchema,
  QuestUpdateSchema,
  RevealSchema,
  RevisionsDeleteSchema,
  SessionApplyTemplateSchema,
  SessionCreateSchema,
  SessionCurrentSceneSchema,
  SessionLogSchema,
  SessionTickSchema,
  SessionUpdateSchema,
  StandingSetSchema,
  parseHomeSince,
  parseSearchQuery
} from "./codex-requests.js";
import {
  EVERYONE,
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
  projectGmSession,
  projectGmStanding,
  projectRevealAudit,
  type CodexReader
} from "./codex-projections.js";

/**
 * The Codex REST surface (`/api/v1/codex/*`), outside the GameState broadcast. Writes bump the store revision and
 * ping `notifyChanged`; reads branch on role. A player's read comes from `codex/player-reads.ts`, which asks
 * `codex/visibility.ts` what a player may see and projects through `codex-projections.ts`.
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
  /** Say, with no content, that the Codex changed. The server decides which clients hear it. */
  notifyChanged: () => void;
  /**
   * A real player token for the GM's preview, reading as these characters (none: as everyone). The GM's own token
   * would still get GM projections.
   */
  issuePreviewSession: (characterIds: readonly string[]) => string;
  /** The player characters a session has claimed: what a player reads beyond what everyone reads. Absent: none. */
  playerCharacters?: (sessionId: string) => readonly string[];
  /** The party's player characters, the only ids an audience may name. Absent: none, so no audience names one. */
  partyCharacters?: () => ReadonlySet<string>;
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
  /**
   * Who a player's read is for: the characters the session claims, or the ones a preview names. Read from the
   * signed token and the game's claims, never from the request.
   */
  const readerFor = (request: Request, response: Response): CodexReader => {
    const caller = callerOf(request, response, options.verifiers, { scope: "codex:read" });
    if (caller.kind !== "player") return EVERYONE;
    if (caller.preview) return readerOf(caller.preview.characterIds);
    return readerOf(options.playerCharacters?.(caller.sessionId) ?? []);
  };
  /** Every player read is built by `PlayerCodexReads`, which the players' ping fingerprints too. */
  const playerReads = (request: Request, response: Response) =>
    new PlayerCodexReads(store, readerFor(request, response));
  /** An audience may name only the party's player characters. */
  const partyOnly = (characterIds: readonly string[] | undefined) => {
    const party = options.partyCharacters?.() ?? new Set<string>();
    if ((characterIds ?? []).some((characterId) => !party.has(characterId)))
      throw new CodexValidationError("That character is not in the party.");
  };
  /** A page and its Connections panel, both unfiltered, or null when there is no such page. */
  const gmPageRead = (pageId: string) => {
    const page = store.getPage(pageId);
    return (
      page && { page: projectGmPage(page), connections: projectGmPageConnections(store.connectionsForPage(page.id)) }
    );
  };

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

  /** Every write. A player session gets 403 (a missing sign-in gets 401): players are signed in, and they are refused. */
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
   * Weak `ETag` of a version, the grade and the resource, with a 304 on match. A GM's version is the store
   * revision, which every write bumps. A player's is a hash of the body they receive: the revision moves on
   * GM-only writes too, and a tag that moved with it would tell the table the GM had saved something. Called only
   * after every auth and existence gate, so a 304 never confirms that a hidden record exists.
   */
  const readEnvelope = (request: Request, response: Response, grade: CodexGrade, data: unknown) => {
    const version =
      grade === "gm"
        ? `r${store.revision}`
        : `c${createHash("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 16)}`;
    const etag = `W/"codex-${version}-${grade}-${resourceKey(request)}"`;
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
    const tag = request.query.tag === undefined ? undefined : String(request.query.tag);
    // Folders are the GM's private filing. A player's folder filter is ignored, since an answer that changed
    // with it would show which pages the GM filed where.
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).pages(tag));
    const folder =
      request.query.folder === undefined
        ? undefined
        : request.query.folder === ""
          ? null
          : String(request.query.folder);
    const pages = store.listPages({ folder, tag }).map(projectGmPageSummary);
    return readEnvelope(request, response, role, { pages });
  });

  /** One result list (`hits`) across all record kinds, filtered and sorted (`codex/find.ts`). */
  router.get(expressPath(CODEX_PATHS.search), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    let query;
    try {
      query = parseSearchQuery(request.query);
    } catch (error) {
      return malformed(response, error);
    }
    // A player's search reads only what that player reads, and has no visibility filter.
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).search(query));
    return readEnvelope(request, response, role, findGm(store, query));
  });

  // Home: the GM's counts, latest changes and reveal check; a player's new since their last visit.
  router.get(expressPath(CODEX_PATHS.home), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    if (role === "gm") return readEnvelope(request, response, role, { home: gmHome(store) });
    let since;
    try {
      since = parseHomeSince(request.query);
    } catch (error) {
      return malformed(response, error);
    }
    return readEnvelope(request, response, role, playerReads(request, response).home(since));
  });

  router.get(expressPath(CODEX_PATHS.pageById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const data =
      role === "gm"
        ? gmPageRead(pathParam(request, "id"))
        : playerReads(request, response).page(pathParam(request, "id"));
    if (!data) return sendFailure(response, 404, "not_found", "That page was not found.");
    return readEnvelope(request, response, role, data);
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

  // Hidden blocks: content and place are edits (`rev` moves, `expectedRev` guards); who sees one is not.
  write(
    "post",
    CODEX_PATHS.pageBlocks,
    (request) => {
      const { expectedRev, ...input } = withoutCommandId(BlockAddSchema.parse(request.body));
      const { page, blockId } = store.addPageBlock(pathParam(request, "id"), input, expectedRev);
      return { page: projectGmPage(page), block: page.blocks.find((block) => block.id === blockId) };
    },
    { status: 201, currentRevision: (request) => store.getPage(pathParam(request, "id"))?.rev }
  );
  write(
    "patch",
    CODEX_PATHS.pageBlockById,
    (request) => {
      const { expectedRev, ...input } = withoutCommandId(BlockEditSchema.parse(request.body));
      return {
        page: projectGmPage(
          store.editPageBlock(pathParam(request, "id"), pathParam(request, "blockId"), input, expectedRev)
        )
      };
    },
    { currentRevision: (request) => store.getPage(pathParam(request, "id"))?.rev }
  );
  write(
    "post",
    CODEX_PATHS.pageBlockMove,
    (request) => {
      const { expectedRev, ...place } = withoutCommandId(BlockMoveSchema.parse(request.body));
      return {
        page: projectGmPage(
          store.movePageBlock(pathParam(request, "id"), pathParam(request, "blockId"), place, expectedRev)
        )
      };
    },
    { currentRevision: (request) => store.getPage(pathParam(request, "id"))?.rev }
  );
  // Idempotent: a block already gone answers the page as it is.
  write("delete", CODEX_PATHS.pageBlockById, (request) => ({
    page: projectGmPage(store.deletePageBlock(pathParam(request, "id"), pathParam(request, "blockId")))
  }));
  write("put", CODEX_PATHS.pageBlockAudience, (request) => {
    const { audience, characterIds } = AudienceSetSchema.parse(request.body);
    partyOnly(characterIds);
    return {
      page: projectGmPage(
        store.setPageBlockAudience(pathParam(request, "id"), pathParam(request, "blockId"), audience, characterIds)
      )
    };
  });
  write("put", CODEX_PATHS.pageFieldAudience, (request) => ({
    page: projectGmPage(
      store.setPageFieldAudience(
        pathParam(request, "id"),
        pathParam(request, "key"),
        FieldAudienceSchema.parse(request.body).audience
      )
    )
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

  // GM preview: mints a real, short-lived player principal, never a role flag on the GM's token. It reads as
  // everyone, or as one party character, and only reads.
  router.post(expressPath(CODEX_PATHS.previewSession), requireGmSession, (request, response) => {
    try {
      const { characterId } = PreviewSessionSchema.parse(request.body ?? {});
      const characterIds = characterId ? [characterId] : [];
      partyOnly(characterIds);
      return sendData(response, 201, { token: options.issuePreviewSession(characterIds) });
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
      connection: store.connectionEdge(
        store.createConnection(pathParam(request, "id"), withoutCommandId(ConnectionCreateSchema.parse(request.body)))
      )
    }),
    CREATED
  );
  // Declared connections only; a mention is edited through its source text.
  write("patch", CODEX_PATHS.connectionById, (request) => ({
    connection: store.connectionEdge(
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
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).connections());
    return readEnvelope(request, response, role, { connections: projectGmConnections(store.listAllConnections()) });
  });

  // The atlas: maps and their pins

  router.get(expressPath(CODEX_PATHS.maps), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).maps());
    return readEnvelope(request, response, role, { maps: store.listMaps().map(projectGmMap) });
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
    const data =
      role === "gm"
        ? store.getMap(mapId) && { markers: store.listMarkers(mapId).map(projectGmMarker) }
        : playerReads(request, response).mapMarkers(mapId);
    if (!data) return sendFailure(response, 404, "not_found", "That map was not found.");
    return readEnvelope(request, response, role, data);
  });

  // Pins pointing at a page. A player is refused a hidden page first, so ids cannot be probed.
  router.get(expressPath(CODEX_PATHS.pageMarkers), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const pageId = pathParam(request, "id");
    const data =
      role === "gm"
        ? store.getPage(pageId) && { markers: store.markersForPage(pageId).map(projectGmMarker) }
        : playerReads(request, response).pageMarkers(pageId);
    if (!data) return sendFailure(response, 404, "not_found", "That page was not found.");
    return readEnvelope(request, response, role, data);
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
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).party());
    const marker = store.partyMarker();
    const map = marker ? store.getMap(marker.mapId) : null;
    return readEnvelope(request, response, role, {
      party: marker && map ? { marker: projectGmMarker(marker), mapName: map.name } : null
    });
  });

  // Puts the party at a point on any map: the party pin moves there, or one is made, in one write.
  write("post", CODEX_PATHS.party, (request) => {
    const { mapId, x, y, revealedToPlayers } = PartyPlaceSchema.parse(request.body);
    const placed = store.placeParty({ mapId, x, y, revealedToPlayers });
    return { marker: projectGmMarker(placed.marker), created: placed.created };
  });

  // One pin by id. Any player gate failure is the same 404 as a bogus id.
  router.get(expressPath(CODEX_PATHS.markerById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const markerId = pathParam(request, "id");
    const marker = role === "gm" ? store.getMarker(markerId) : null;
    const data =
      role === "gm" ? marker && { marker: projectGmMarker(marker) } : playerReads(request, response).marker(markerId);
    if (!data) return sendFailure(response, 404, "not_found", "That pin was not found.");
    return readEnvelope(request, response, role, data);
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
  // `isParty: false` clears only this pin, whichever pin holds the flag.
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
    if (role === "player") {
      // A player reads a pin's or page's mini-timeline only when that pin or page is visible, so hidden ids
      // cannot be probed. Each entry's own gate still applies.
      const data = playerReads(request, response).journal({ markerId, pageId });
      if (!data) return sendFailure(response, 404, "not_found", "That was not found.");
      return readEnvelope(request, response, role, data);
    }
    const rows = markerId || pageId ? store.listEntriesFor({ markerId, pageId }) : store.listTimeline();
    return readEnvelope(request, response, role, { entries: rows.map(projectGmJournalEntry) });
  });

  // The chronicle: entries and dated event pages in one order. `listChronicle` is ungated;
  // `projectPlayerChronicleRecord` is the only player gate.
  router.get(expressPath(CODEX_PATHS.timeline), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).chronicle());
    // The GM's own clock, kept to this branch so it cannot reach a player.
    const campaignInstant = store.campaignInstant();
    const records = store.listChronicle().map((row) =>
      projectGmChronicleRecord(row, {
        campaignInstant,
        // Only an unapplied downtime has a proposed date, and only the GM sees it.
        proposedDate: row.kind === "entry" ? store.proposedDateFor(row.entry) : null
      })
    );
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
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).sessions());
    return readEnvelope(request, response, role, {
      sessions: store.listSessions().map(projectGmSession),
      activeSessionId: store.activeSessionId
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
    const sessionId = pathParam(request, "id");
    const session = role === "gm" ? store.getSession(sessionId) : null;
    const data =
      role === "gm"
        ? session && { session: projectGmSession(session) }
        : playerReads(request, response).session(sessionId);
    if (!data) return sendFailure(response, 404, "not_found", "That session was not found.");
    return readEnvelope(request, response, role, data);
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
  // Re-applies a template to the prep and keeps what was written.
  write(
    "post",
    CODEX_PATHS.sessionApplyTemplate,
    (request) => {
      const { templateId, expectedRev } = SessionApplyTemplateSchema.parse(request.body);
      return { session: projectGmSession(store.applyPrepTemplate(pathParam(request, "id"), templateId, expectedRev)) };
    },
    { currentRevision: (request) => store.getSession(pathParam(request, "id"))?.rev }
  );

  // The live board and the recap step. GM-only: the prep never reaches a player.
  router.get(expressPath(CODEX_PATHS.board), requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", { board: liveBoard(store) })
  );
  router.get(expressPath(CODEX_PATHS.sessionHappened), requireGmRead, (request, response) => {
    const session = store.getSession(pathParam(request, "id"));
    if (!session) return sendFailure(response, 404, "not_found", "That session was not found.");
    return readEnvelope(request, response, "gm", { happened: sessionHappened(store, session) });
  });
  write(
    "post",
    CODEX_PATHS.sessionLog,
    (request) => {
      const { text, revealedToPlayers } = SessionLogSchema.parse(request.body);
      return {
        entry: projectGmJournalEntry(store.logSessionLine(pathParam(request, "id"), { text, revealedToPlayers }))
      };
    },
    CREATED
  );
  // Answers with the clue as the board shows it, so the client can offer to reveal a block it links.
  write("post", CODEX_PATHS.sessionTick, (request) => {
    const { itemId, done } = SessionTickSchema.parse(request.body);
    const session = store.tickPrepItem(pathParam(request, "id"), itemId, done);
    const ticked = prepItems(session.prep).find(({ item }) => item.id === itemId)!;
    return { session: projectGmSession(session), clue: liveClue(store, ticked.item) };
  });
  write("post", CODEX_PATHS.sessionCurrentScene, (request) => ({
    session: projectGmSession(
      store.setCurrentScene(pathParam(request, "id"), SessionCurrentSceneSchema.parse(request.body).sceneId)
    )
  }));

  // Prep templates: the GM's library. The built-in starting template is read-only.

  router.get(expressPath(CODEX_PATHS.prepTemplates), requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", store.listPrepTemplates())
  );
  write(
    "post",
    CODEX_PATHS.prepTemplates,
    (request) => ({
      template: store.createPrepTemplate(withoutCommandId(PrepTemplateCreateSchema.parse(request.body)))
    }),
    CREATED
  );
  write(
    "patch",
    CODEX_PATHS.prepTemplateById,
    (request) => {
      const { expectedRev, ...fields } = withoutCommandId(PrepTemplateUpdateSchema.parse(request.body));
      return { template: store.updatePrepTemplate(pathParam(request, "id"), fields, expectedRev) };
    },
    { currentRevision: (request) => store.getPrepTemplate(pathParam(request, "id"))?.rev }
  );
  write("delete", CODEX_PATHS.prepTemplateById, (request) => {
    store.deletePrepTemplate(pathParam(request, "id"));
    return { deleted: true };
  });
  write(
    "post",
    CODEX_PATHS.prepTemplateDuplicate,
    (request) => ({
      template: store.duplicatePrepTemplate(
        pathParam(request, "id"),
        PrepTemplateDuplicateSchema.parse(request.body ?? {}).name
      )
    }),
    CREATED
  );
  write("post", CODEX_PATHS.prepTemplateDefault, (request) => ({
    defaultTemplateId: store.setDefaultPrepTemplate(pathParam(request, "id"))
  }));

  // Quests. A hidden quest is a 404 for a player, and its page links are filtered to revealed pages.

  router.get(expressPath(CODEX_PATHS.quests), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).quests());
    return readEnvelope(request, response, role, { quests: store.listQuests().map(projectGmQuest) });
  });
  write(
    "post",
    CODEX_PATHS.quests,
    (request) => {
      const input = withoutCommandId(QuestCreateSchema.parse(request.body));
      partyOnly(input.objectives?.flatMap((objective) => objective.characterIds ?? []));
      return { quest: projectGmQuest(store.createQuest(input)) };
    },
    CREATED
  );
  router.get(expressPath(CODEX_PATHS.questById), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const questId = pathParam(request, "id");
    const quest = role === "gm" ? store.getQuest(questId) : null;
    const data =
      role === "gm" ? quest && { quest: projectGmQuest(quest) } : playerReads(request, response).quest(questId);
    if (!data) return sendFailure(response, 404, "not_found", "That quest was not found.");
    return readEnvelope(request, response, role, data);
  });
  write(
    "patch",
    CODEX_PATHS.questById,
    (request) => {
      const { expectedRev, ...fields } = withoutCommandId(QuestUpdateSchema.parse(request.body));
      partyOnly(fields.objectives?.flatMap((objective) => objective.characterIds ?? []));
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
  write(
    "post",
    CODEX_PATHS.questBlocks,
    (request) => {
      const { expectedRev, ...input } = withoutCommandId(BlockAddSchema.parse(request.body));
      const { quest, blockId } = store.addQuestBlock(pathParam(request, "id"), input, expectedRev);
      return { quest: projectGmQuest(quest), block: quest.blocks.find((block) => block.id === blockId) };
    },
    { status: 201, currentRevision: (request) => store.getQuest(pathParam(request, "id"))?.rev }
  );
  write(
    "patch",
    CODEX_PATHS.questBlockById,
    (request) => {
      const { expectedRev, ...input } = withoutCommandId(BlockEditSchema.parse(request.body));
      return {
        quest: projectGmQuest(
          store.editQuestBlock(pathParam(request, "id"), pathParam(request, "blockId"), input, expectedRev)
        )
      };
    },
    { currentRevision: (request) => store.getQuest(pathParam(request, "id"))?.rev }
  );
  write(
    "post",
    CODEX_PATHS.questBlockMove,
    (request) => {
      const { expectedRev, ...place } = withoutCommandId(BlockMoveSchema.parse(request.body));
      return {
        quest: projectGmQuest(
          store.moveQuestBlock(pathParam(request, "id"), pathParam(request, "blockId"), place, expectedRev)
        )
      };
    },
    { currentRevision: (request) => store.getQuest(pathParam(request, "id"))?.rev }
  );
  write("delete", CODEX_PATHS.questBlockById, (request) => ({
    quest: projectGmQuest(store.deleteQuestBlock(pathParam(request, "id"), pathParam(request, "blockId")))
  }));
  write("put", CODEX_PATHS.questBlockAudience, (request) => {
    const { audience, characterIds } = AudienceSetSchema.parse(request.body);
    partyOnly(characterIds);
    return {
      quest: projectGmQuest(
        store.setQuestBlockAudience(pathParam(request, "id"), pathParam(request, "blockId"), audience, characterIds)
      )
    };
  });
  write("put", CODEX_PATHS.questObjectiveAudience, (request) => {
    const { audience, characterIds } = AudienceSetSchema.parse(request.body);
    partyOnly(characterIds);
    return {
      quest: projectGmQuest(
        store.setObjectiveAudience(pathParam(request, "id"), pathParam(request, "objectiveId"), audience, characterIds)
      )
    };
  });

  // Standing, addressed by faction page id. A player needs both the standing and its faction revealed.

  router.get(expressPath(CODEX_PATHS.standing), (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).standing());
    return readEnvelope(request, response, role, { standing: store.listStanding().map(projectGmStanding) });
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
    if (role === "player") return readEnvelope(request, response, role, playerReads(request, response).calendar());
    return readEnvelope(request, response, role, {
      calendar: projectGmCalendar(store.getCalendar(), store.getPublishedDate())
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
  // still bumps the revision for the GM's ETags.
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
      (principal.kind === "player" && store.isMediaVisibleToPlayers(id, readerFor(request, response)));
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
