import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  API_VERSION,
  CONTENT_PATHS,
  ENCOUNTER_ARCHIVE_PATHS,
  GAME_PATHS,
  GAME_COMMANDS,
  GameCommandEnvelopeSchema,
  SESSION_PATHS,
  type ApiErrorCode,
  type GameCommandType,
  type IntegrationScope
} from "@vtt/api-contract";

type GameCommandRoute = (typeof GAME_COMMANDS)[GameCommandType];
import type { EncounterArchiveSummary } from "./game-store.js";
import { describeFailure } from "./commands/failures.js";
import { isGmGrade, type GameCommandDescriptor, type GameOperations, type GamePrincipal } from "./game-operations.js";
import type { EncounterArchiveDocument } from "./encounter-archive.js";
import { projectPlayerReplay } from "./replay-projection.js";

/**
 * The public HTTP adapter over the shared game operations (ADR-0016): every write runs the same
 * operation as the Socket.IO handlers, so REST cannot fork from table behaviour.
 *
 * Principals (all `Authorization: Bearer`): GM session, player session, or a GM-minted integration
 * credential, checked against each route's scope and acting with GM authority. Players keep the table's
 * player limits. The public viewer never authenticates here.
 *
 * Errors: 400 validation_failed, 401 unauthenticated, 403 forbidden (bad/revoked/underscoped token or
 * role denial), 404 not_found, and 409 conflict for game refusals, stale `expectedRevision` (with
 * `error.currentRevision`) and timeline navigations awaiting confirmation (`error.details.needsConfirm`).
 */

export type GameApiRouterOptions = Readonly<{
  operations: GameOperations;
  registry: ReadonlyMap<string, GameCommandDescriptor>;
  gmSession: (token: string) => Readonly<{ sessionId: string }> | null;
  playerSession: (token: string) => Readonly<{ sessionId: string }> | null;
  verifyIntegration: (token: string, scope: IntegrationScope) => Readonly<{ id: string; name: string }> | null;
  archives: Readonly<{
    list: () => readonly EncounterArchiveSummary[];
    get: (id: number) => string | null;
    remove: (id: number) => void;
    /** Shares (or un-shares) one archived fight with players; false when no such archive exists. */
    setVisibility: (id: number, playerVisible: boolean) => boolean;
  }>;
  sessions: Readonly<{
    /** Issues a fresh player session (the socket's open LAN-trust join, over HTTP), or null before GM setup. */
    issuePlayer: () => Readonly<{ token: string; sessionId: string }> | null;
  }>;
  revision: () => number;
  newId?: () => string;
}>;

const expressPath = (openApiPath: string) => openApiPath.replace(/\{([a-zA-Z]+)\}/g, ":$1");

function bearerToken(req: Request) {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

export function createGameApiRouter(options: GameApiRouterOptions) {
  const router = Router();
  const newId = options.newId ?? randomUUID;

  // Self-sufficient when mounted standalone; a no-op under api-v1.ts, which already stamped these.
  router.use((req, res, next) => {
    if (!res.locals.requestId) {
      const candidate = req.header("x-request-id");
      res.locals.requestId =
        candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
          ? candidate
          : newId();
      res.setHeader("x-request-id", res.locals.requestId);
      res.setHeader("cache-control", "no-store");
    }
    next();
  });

  function sendError(
    res: Response,
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    currentRevision?: number
  ) {
    return res.status(status).json({
      ok: false,
      apiVersion: API_VERSION,
      error: {
        code,
        message,
        requestId: res.locals.requestId,
        ...(details ? { details } : {}),
        ...(currentRevision !== undefined ? { currentRevision } : {})
      }
    });
  }

  function sendOperationError(res: Response, error: unknown) {
    const failure = describeFailure(error);
    return sendError(
      res,
      failure.status,
      failure.code,
      failure.message,
      failure.details,
      failure.stale ? options.revision() : undefined
    );
  }

  function sendData(res: Response, data: unknown) {
    return res.json({ ok: true, apiVersion: API_VERSION, data });
  }

  function resolvePrincipal(req: Request, res: Response, scope: IntegrationScope): GamePrincipal | null {
    const token = bearerToken(req);
    if (!token) {
      sendError(res, 401, "unauthenticated", "A GM session, player session, or integration bearer token is required.");
      return null;
    }
    const gm = options.gmSession(token);
    if (gm) return { kind: "gm", sessionId: gm.sessionId };
    const player = options.playerSession(token);
    if (player) return { kind: "player", sessionId: player.sessionId };
    const credential = options.verifyIntegration(token, scope);
    if (credential) return { kind: "integration", credentialId: credential.id, name: credential.name };
    sendError(res, 403, "forbidden", "The token is invalid, revoked, or missing the required scope.");
    return null;
  }

  const authorize = (scope: IntegrationScope) => (req: Request, res: Response, next: NextFunction) => {
    const principal = resolvePrincipal(req, res, scope);
    if (!principal) return;
    res.locals.principal = principal;
    next();
  };

  /** Builds a command payload from the JSON body plus path fields. A missing commandId is minted (and
   *  echoed) so plain curl calls work; clients wanting safe retries supply their own. Path params win. */
  function commandPayload(req: Request, extras: Record<string, unknown> = {}) {
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<
      string,
      unknown
    >;
    return { commandId: newId(), ...body, ...extras };
  }

  /** A typed route for one cataloged command; scope and handler come from the same registry as the tunnel. */
  const command = (type: string, extras?: (req: Request) => Record<string, unknown>) => {
    const descriptor = options.registry.get(type);
    if (!descriptor) throw new Error(`game-http route references an uncataloged command type: ${type}`);
    return [
      authorize(descriptor.scope),
      async (req: Request, res: Response) => {
        const payload = commandPayload(req, extras?.(req));
        try {
          const data = await descriptor.run(res.locals.principal as GamePrincipal, payload);
          sendData(res, { commandId: payload.commandId, ...data });
        } catch (error) {
          sendOperationError(res, error);
        }
      }
    ] as const;
  };

  const ops = options.operations;

  // ---------- Game state reads ----------

  router.get(expressPath(GAME_PATHS.snapshot), authorize("game:read"), (req, res) => {
    try {
      const requested =
        req.query.view === "player"
          ? ("player" as const)
          : req.query.view === "gm" || req.query.view === undefined
            ? undefined
            : null;
      if (requested === null) return sendError(res, 400, "validation_failed", 'view must be "gm" or "player".');
      const projected = ops.view(res.locals.principal as GamePrincipal, requested);
      const revision = (projected.game as { revision: number }).revision;
      // Weak because presence and timed-annotation expiry can change content without a revision bump.
      const etag = `W/"game-r${revision}-${projected.view}"`;
      res.setHeader("etag", etag);
      if (req.header("if-none-match") === etag) return res.status(304).end();
      return sendData(res, { view: projected.view, revision, game: projected.game });
    } catch (error) {
      return sendOperationError(res, error);
    }
  });

  // Action availability: the same evaluation strict-mode resolution runs, as a read.
  router.get(expressPath(GAME_PATHS.actorAvailableActions), authorize("combat:read"), (req, res) => {
    try {
      return sendData(
        res,
        ops.actorAvailableActions(res.locals.principal as GamePrincipal, { actorId: req.params.actorId })
      );
    } catch (error) {
      return sendOperationError(res, error);
    }
  });

  router.get(expressPath(GAME_PATHS.log), authorize("combat:read"), (req, res) => {
    const rawLimit = req.query.limit;
    let limit: number | undefined;
    if (rawLimit !== undefined) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
        return sendError(res, 400, "validation_failed", "limit must be an integer between 1 and 1000.");
    }
    return sendData(res, { entries: ops.logEntries(res.locals.principal as GamePrincipal, limit) });
  });

  // ---------- Generic command tunnel + catalog ----------

  router.get(expressPath(GAME_PATHS.commands), authorize("system:read"), (_req, res) => {
    const commands = [...options.registry.values()]
      .map(({ type, scope, summary }) => ({ type, scope, summary }))
      .sort((a, b) => a.type.localeCompare(b.type));
    return sendData(res, { commands });
  });

  router.post(expressPath(GAME_PATHS.commands), async (req, res) => {
    const envelope = GameCommandEnvelopeSchema.safeParse(req.body);
    if (!envelope.success)
      return sendError(res, 400, "validation_failed", "The command envelope is malformed.", {
        issues: envelope.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      });
    const descriptor = options.registry.get(envelope.data.type);
    if (!descriptor)
      return sendError(res, 404, "not_found", "That command type is not available over the integration API.", {
        availableTypes: [...options.registry.keys()].sort()
      });
    const principal = resolvePrincipal(req, res, descriptor.scope);
    if (!principal) return;
    const payload: Record<string, unknown> = {
      commandId: envelope.data.commandId ?? newId(),
      ...envelope.data.payload,
      ...(envelope.data.expectedRevision !== undefined ? { expectedRevision: envelope.data.expectedRevision } : {})
    };
    try {
      const data = await descriptor.run(principal, payload);
      return sendData(res, { commandId: payload.commandId, type: descriptor.type, ...data });
    } catch (error) {
      return sendOperationError(res, error);
    }
  });

  // ---------- Typed command routes (same operations the socket handlers call) ----------

  // Each command's route comes from GAME_COMMANDS; its path parameters join the payload under their own
  // names, except the archive launch, whose `{id}` is the archive's number.
  for (const [type, route] of Object.entries(GAME_COMMANDS) as Array<[GameCommandType, GameCommandRoute]>) {
    const extras =
      type === "replay.launch"
        ? (req: Request) => ({ archiveId: Number(req.params.id) })
        : (req: Request) => ({ ...req.params });
    router[route.method](expressPath(route.path), ...command(type, extras));
  }

  // ---------- Player sessions (headless / alternate player clients) ----------

  router.post(expressPath(SESSION_PATHS.player), (_req, res) => {
    const issued = options.sessions.issuePlayer();
    if (!issued) return sendError(res, 409, "conflict", "The host must complete GM setup before players join.");
    return res.status(201).json({ ok: true, apiVersion: API_VERSION, data: issued });
  });

  // ---------- Bundled content reads ----------

  function sendContent(res: Response, read: () => unknown) {
    try {
      return sendData(res, read());
    } catch (error) {
      return sendOperationError(res, error);
    }
  }

  router.get(expressPath(CONTENT_PATHS.monsters), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentMonsters(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.monsterById), authorize("game:read"), (req, res) =>
    sendContent(res, () =>
      ops.contentMonsterSheet(res.locals.principal as GamePrincipal, { definitionId: req.params.definitionId })
    )
  );
  router.get(expressPath(CONTENT_PATHS.monsterActions), authorize("game:read"), (req, res) =>
    sendContent(res, () =>
      ops.contentMonsterActions(res.locals.principal as GamePrincipal, { definitionId: req.params.definitionId })
    )
  );
  router.get(expressPath(CONTENT_PATHS.conditions), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentConditions(res.locals.principal as GamePrincipal))
  );
  // Rules catalogs are public SRD reference, so player sessions may read them (the operations enforce
  // that). The bestiary is the GM-only exception.
  router.get(expressPath(CONTENT_PATHS.skills), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentSkills(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.languages), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentLanguages(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.spells), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentSpells(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.equipment), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentEquipment(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.classes), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentClasses(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.subclasses), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentSubclasses(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.species), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentSpecies(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.backgrounds), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentBackgrounds(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.feats), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentFeats(res.locals.principal as GamePrincipal))
  );
  router.get(expressPath(CONTENT_PATHS.names), authorize("game:read"), (_req, res) =>
    sendContent(res, () => ops.contentNames(res.locals.principal as GamePrincipal))
  );

  // ---------- Encounter archives ----------

  /** Archive management (visibility, delete) stays GM-grade; the two reads below are role-aware. */
  function requireGmGradePrincipal(res: Response): GamePrincipal | null {
    const principal = res.locals.principal as GamePrincipal;
    if (!isGmGrade(principal)) {
      sendError(res, 403, "forbidden", "Only the GM may access encounter archives.");
      return null;
    }
    return principal;
  }

  function archiveIdParam(req: Request, res: Response): number | null {
    const raw = req.params.id;
    const id = typeof raw === "string" && /^[0-9]{1,12}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id < 1) {
      sendError(res, 400, "validation_failed", "The archive id must be a positive integer.");
      return null;
    }
    return id;
  }

  /** Role-aware: the GM gets the stored document, a player gets the computed player replay, and an
   *  unshared archive is a 404 for a player. Never 403, which would confirm the recording exists. */
  router.get(expressPath(ENCOUNTER_ARCHIVE_PATHS.collection), authorize("combat:read"), (_req, res) => {
    const principal = res.locals.principal as GamePrincipal;
    if (!isGmGrade(principal))
      return sendData(res, { encounters: options.archives.list().filter((entry) => entry.playerVisible) });
    return sendData(res, { encounters: options.archives.list() });
  });

  router.get(expressPath(ENCOUNTER_ARCHIVE_PATHS.byId), authorize("combat:read"), (req, res) => {
    const principal = res.locals.principal as GamePrincipal;
    const id = archiveIdParam(req, res);
    if (id === null) return;
    if (!isGmGrade(principal)) {
      const shared = options.archives.list().some((entry) => entry.id === id && entry.playerVisible);
      const stored = shared ? options.archives.get(id) : null;
      // Missing and unshared are indistinguishable on purpose.
      if (stored === null) return sendError(res, 404, "not_found", "No such encounter archive.");
      let document: EncounterArchiveDocument;
      try {
        document = JSON.parse(stored) as EncounterArchiveDocument;
      } catch {
        return sendError(res, 404, "not_found", "No such encounter archive.");
      }
      return sendData(res, { id, document: projectPlayerReplay(id, document) });
    }
    const document = options.archives.get(id);
    if (document === null) return sendError(res, 404, "not_found", "No such encounter archive.");
    // The stored JSON is spliced in verbatim, avoiding a parse/re-serialize of a potentially large document.
    return res
      .type("application/json")
      .send(`{"ok":true,"apiVersion":"${API_VERSION}","data":{"id":${id},"document":${document}}}`);
  });

  /** Per-replay sharing: GM-grade only, storing the GM's decision. */
  router.post(expressPath(ENCOUNTER_ARCHIVE_PATHS.visibility), authorize("combat:write"), (req, res) => {
    if (!requireGmGradePrincipal(res)) return;
    const id = archiveIdParam(req, res);
    if (id === null) return;
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<
      string,
      unknown
    >;
    if (typeof body.playerVisible !== "boolean")
      return sendError(res, 400, "validation_failed", "playerVisible must be true or false.");
    if (!options.archives.setVisibility(id, body.playerVisible))
      return sendError(res, 404, "not_found", "No such encounter archive.");
    return sendData(res, { id, playerVisible: body.playerVisible });
  });

  router.delete(expressPath(ENCOUNTER_ARCHIVE_PATHS.byId), authorize("admin"), (req, res) => {
    if (!requireGmGradePrincipal(res)) return;
    const id = archiveIdParam(req, res);
    if (id === null) return;
    if (options.archives.get(id) === null) return sendError(res, 404, "not_found", "No such encounter archive.");
    options.archives.remove(id);
    return sendData(res, { id, deleted: true });
  });

  return router;
}
