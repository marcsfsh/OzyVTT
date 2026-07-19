import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  API_VERSION,
  CONTENT_PATHS,
  ENCOUNTER_ARCHIVE_PATHS,
  GAME_PATHS,
  GameCommandEnvelopeSchema,
  SESSION_PATHS,
  type ApiErrorCode,
  type IntegrationScope
} from "@vtt/api-contract";
import { CommandRejectedError, RevisionConflictError, RulesBlockedError, TimelineConfirmationRequired, type EncounterArchiveSummary } from "./game-store.js";
import { GameAccessDeniedError, GameInputError, isGmGrade, type GameCommandDescriptor, type GameOperations, type GamePrincipal } from "./game-operations.js";

/**
 * The public HTTP adapter over the shared game operations (ADR-0016). Every write here runs the
 * exact operation the Socket.IO handlers run — same validation, same role checks, same store
 * dispatch, same side effects — so the REST surface can never fork from the table's behavior.
 *
 * Principals: a GM session token, a player session token, or a GM-minted integration credential,
 * all as `Authorization: Bearer`. Integration credentials are checked against each route's scope
 * and act with GM authority (they are the GM's own trusted automation); player sessions keep
 * exactly the player limits the table enforces. The public viewer never authenticates here.
 *
 * Error contract: 400 validation_failed (malformed request), 401 unauthenticated (no token),
 * 403 forbidden (bad/revoked/underscoped token, or a role denial), 404 not_found, and
 * 409 conflict for everything the game itself refuses — domain rejections, stale
 * `expectedRevision` (with `error.currentRevision`), and timeline navigations awaiting GM
 * confirmation (with `error.details.needsConfirm`).
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
      res.locals.requestId = candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : newId();
      res.setHeader("x-request-id", res.locals.requestId);
      res.setHeader("cache-control", "no-store");
    }
    next();
  });

  function sendError(res: Response, status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>, currentRevision?: number) {
    return res.status(status).json({
      ok: false,
      apiVersion: API_VERSION,
      error: { code, message, requestId: res.locals.requestId, ...(details ? { details } : {}), ...(currentRevision !== undefined ? { currentRevision } : {}) }
    });
  }

  /** One mapping for every operation failure, so REST semantics stay uniform across the whole surface. */
  function sendOperationError(res: Response, error: unknown) {
    if (error instanceof GameInputError) return sendError(res, 400, "validation_failed", error.message, error.issues ? { issues: error.issues } : undefined);
    if (error instanceof GameAccessDeniedError) return sendError(res, 403, "forbidden", error.message);
    if (error instanceof TimelineConfirmationRequired) return sendError(res, 409, "conflict", error.message, { needsConfirm: error.confirm });
    if (error instanceof RevisionConflictError) return sendError(res, 409, "conflict", error.message, undefined, options.revision());
    // Rules-mode rejections (ADR-0020) stay 409 conflict but carry machine-readable blocked details
    // so integrations can resend with `override: {reason}` without parsing prose.
    if (error instanceof RulesBlockedError) return sendError(res, 409, "conflict", error.message, { blocked: { rule: error.rule, message: error.message, overridable: error.overridable } });
    if (error instanceof CommandRejectedError) return sendError(res, 409, "conflict", error.message);
    return sendError(res, 500, "internal_error", "The command could not be processed.");
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

  /**
   * Assemble a command payload from the JSON body plus path-derived fields. A missing commandId is
   * minted here (and echoed in the response) so plain curl calls work; clients wanting safe retries
   * supply their own. Path parameters win over any same-named body field.
   */
  function commandPayload(req: Request, extras: Record<string, unknown> = {}) {
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    return { commandId: newId(), ...body, ...extras };
  }

  /**
   * A typed route for one cataloged command: scope AND handler come from the registry (the same
   * one the generic tunnel dispatches through), so a typed route can never drift from the tunnel.
   */
  const command = (type: string, extras?: (req: Request) => Record<string, unknown>) => {
    const descriptor = options.registry.get(type);
    if (!descriptor) throw new Error(`game-http route references an uncataloged command type: ${type}`);
    return [authorize(descriptor.scope), async (req: Request, res: Response) => {
      const payload = commandPayload(req, extras?.(req));
      try {
        const data = await descriptor.run(res.locals.principal as GamePrincipal, payload);
        sendData(res, { commandId: payload.commandId, ...data });
      } catch (error) {
        sendOperationError(res, error);
      }
    }] as const;
  };

  const ops = options.operations;

  // ---------- Game state reads ----------

  router.get(expressPath(GAME_PATHS.snapshot), authorize("game:read"), (req, res) => {
    try {
      const requested = req.query.view === "player" ? ("player" as const) : req.query.view === "gm" || req.query.view === undefined ? undefined : null;
      if (requested === null) return sendError(res, 400, "validation_failed", "view must be \"gm\" or \"player\".");
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

  // Server-computed action availability: the same evaluation strict-mode resolution runs, as a read.
  router.get(expressPath(GAME_PATHS.actorAvailableActions), authorize("combat:read"), (req, res) => {
    try {
      return sendData(res, ops.actorAvailableActions(res.locals.principal as GamePrincipal, { actorId: req.params.actorId }));
    } catch (error) {
      if (error instanceof CommandRejectedError) return sendError(res, 404, "not_found", error.message);
      return sendOperationError(res, error);
    }
  });

  router.get(expressPath(GAME_PATHS.log), authorize("combat:read"), (req, res) => {
    const rawLimit = req.query.limit;
    let limit: number | undefined;
    if (rawLimit !== undefined) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return sendError(res, 400, "validation_failed", "limit must be an integer between 1 and 1000.");
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
    if (!envelope.success) return sendError(res, 400, "validation_failed", "The command envelope is malformed.", { issues: envelope.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    const descriptor = options.registry.get(envelope.data.type);
    if (!descriptor) return sendError(res, 404, "not_found", "That command type is not available over the integration API.", { availableTypes: [...options.registry.keys()].sort() });
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

  const actorIdParam = (req: Request) => ({ actorId: req.params.actorId });
  const saveIdParam = (req: Request) => ({ saveId: req.params.saveId });
  const idParam = (req: Request) => ({ id: req.params.id });
  router.post(expressPath(GAME_PATHS.encounterStart), ...command("encounter.start"));
  router.post(expressPath(GAME_PATHS.encounterEnd), ...command("encounter.end"));
  router.post(expressPath(GAME_PATHS.encounterCombatants), ...command("encounter.add-combatant"));
  router.post(expressPath(GAME_PATHS.initiativeSet), ...command("initiative.set"));
  router.post(expressPath(GAME_PATHS.initiativeNext), ...command("initiative.next"));
  router.post(expressPath(GAME_PATHS.initiativePrevious), ...command("initiative.previous"));
  router.post(expressPath(GAME_PATHS.turnEnd), ...command("turn.end"));
  router.post(expressPath(GAME_PATHS.turnUse), ...command("turn.use"));
  router.post(expressPath(GAME_PATHS.turnReaction), ...command("turn.use-reaction"));
  router.post(expressPath(GAME_PATHS.turnLegendary), ...command("turn.use-legendary"));
  router.post(expressPath(GAME_PATHS.tokenMove), ...command("token.move", actorIdParam));
  router.post(expressPath(GAME_PATHS.actors), ...command("actor.add-from-definition"));
  router.delete(expressPath(GAME_PATHS.actorById), ...command("actor.remove", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorDamage), ...command("actor.apply-damage", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorHeal), ...command("actor.heal", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorTempHp), ...command("actor.set-temp-hp", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorHp), ...command("actor.set-hp", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorConditions), ...command("actor.set-condition", actorIdParam));
  router.post(expressPath(GAME_PATHS.definitionsImport), ...command("actor.import-definition"));
  router.post(expressPath(GAME_PATHS.rolls), ...command("dice.roll"));
  router.post(expressPath(GAME_PATHS.actionResolve), ...command("action.resolve"));
  router.post(expressPath(GAME_PATHS.saveAnswer), ...command("save.answer", saveIdParam));
  router.post(expressPath(GAME_PATHS.saveDismiss), ...command("save.dismiss", saveIdParam));
  router.post(expressPath(GAME_PATHS.reactionAnswer), ...command("reaction.answer", (req: Request) => ({ reactionId: req.params.reactionId })));
  router.post(expressPath(GAME_PATHS.reactionDismiss), ...command("reaction.dismiss", (req: Request) => ({ reactionId: req.params.reactionId })));
  router.post(expressPath(GAME_PATHS.effects), ...command("effect.add", actorIdParam));
  router.post(expressPath(GAME_PATHS.effectEnd), ...command("effect.end", (req: Request) => ({ actorId: req.params.actorId, effectId: req.params.effectId })));
  router.post(expressPath(GAME_PATHS.deathSaveRoll), ...command("death-save.roll", actorIdParam));
  router.post(expressPath(GAME_PATHS.rulesMode), ...command("encounter.set-rules-mode"));
  router.post(expressPath(GAME_PATHS.environment), ...command("encounter.set-environment"));
  router.post(expressPath(GAME_PATHS.actorRest), ...command("actor.rest", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorSpendHitDice), ...command("actor.spend-hit-dice", actorIdParam));
  // Literal segments (ping/clear) are registered before the {id} routes, though methods keep them unambiguous anyway.
  router.post(expressPath(GAME_PATHS.annotationsPing), ...command("annotation.ping"));
  router.post(expressPath(GAME_PATHS.annotationsClear), ...command("annotation.clear"));
  router.post(expressPath(GAME_PATHS.annotations), ...command("annotation.add"));
  router.delete(expressPath(GAME_PATHS.annotationById), ...command("annotation.remove", idParam));
  router.post(expressPath(GAME_PATHS.annotationMove), ...command("annotation.move", idParam));
  router.post(expressPath(GAME_PATHS.annotationColor), ...command("annotation.set-color", idParam));
  router.post(expressPath(GAME_PATHS.annotationVisibility), ...command("annotation.set-visibility", idParam));
  router.post(expressPath(GAME_PATHS.annotationMovable), ...command("annotation.set-movable", idParam));
  router.post(expressPath(GAME_PATHS.claims), ...command("character.claim"));
  router.post(expressPath(GAME_PATHS.claimsRelease), ...command("character.release"));
  router.post(expressPath(GAME_PATHS.claimForceRelease), ...command("character.force-release", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorTokenImage), ...command("actor.set-token-image", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorSize), ...command("actor.set-size", actorIdParam));
  router.post(expressPath(GAME_PATHS.actorSpeed), ...command("actor.set-speed", actorIdParam));
  router.post(expressPath(GAME_PATHS.scenes), ...command("scene.create"));
  router.delete(expressPath(GAME_PATHS.sceneById), ...command("scene.remove", (req) => ({ sceneId: req.params.sceneId })));
  router.post(expressPath(GAME_PATHS.sceneRename), ...command("scene.rename", (req) => ({ sceneId: req.params.sceneId })));
  router.post(expressPath(GAME_PATHS.sceneActivate), ...command("scene.activate", (req) => ({ sceneId: req.params.sceneId })));
  router.post(expressPath(GAME_PATHS.sceneCombatants), ...command("scene.set-combatants", (req) => ({ sceneId: req.params.sceneId })));
  router.post(expressPath(GAME_PATHS.fogEnabled), ...command("fog.set-enabled"));
  router.post(expressPath(GAME_PATHS.fogPaint), ...command("fog.paint"));
  router.post(expressPath(GAME_PATHS.fogReset), ...command("fog.reset"));

  // ---------- Player sessions (headless / alternate player clients) ----------

  router.post(expressPath(SESSION_PATHS.player), (_req, res) => {
    const issued = options.sessions.issuePlayer();
    if (!issued) return sendError(res, 409, "conflict", "The host must complete GM setup before players join.");
    return res.status(201).json({ ok: true, apiVersion: API_VERSION, data: issued });
  });

  // ---------- Bundled content reads ----------

  /** Content misses are 404s here (resource semantics), while the same operation's message text stays intact. */
  function sendContent(res: Response, read: () => unknown) {
    try {
      return sendData(res, read());
    } catch (error) {
      if (error instanceof CommandRejectedError) return sendError(res, 404, "not_found", error.message);
      return sendOperationError(res, error);
    }
  }

  router.get(expressPath(CONTENT_PATHS.monsters), authorize("game:read"), (_req, res) => sendContent(res, () => ops.contentMonsters(res.locals.principal as GamePrincipal)));
  router.get(expressPath(CONTENT_PATHS.monsterById), authorize("game:read"), (req, res) => sendContent(res, () => ops.contentMonsterSheet(res.locals.principal as GamePrincipal, { definitionId: req.params.definitionId })));
  router.get(expressPath(CONTENT_PATHS.monsterActions), authorize("game:read"), (req, res) => sendContent(res, () => ops.contentMonsterActions(res.locals.principal as GamePrincipal, { definitionId: req.params.definitionId })));
  router.get(expressPath(CONTENT_PATHS.conditions), authorize("game:read"), (_req, res) => sendContent(res, () => ops.contentConditions(res.locals.principal as GamePrincipal)));

  // ---------- Encounter archives (Time Machine v2) ----------

  /** Archives hold full state + GM-only narration: GM sessions and integrations yes, player sessions never. */
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

  router.get(expressPath(ENCOUNTER_ARCHIVE_PATHS.collection), authorize("combat:read"), (_req, res) => {
    if (!requireGmGradePrincipal(res)) return;
    return sendData(res, { encounters: options.archives.list() });
  });

  router.get(expressPath(ENCOUNTER_ARCHIVE_PATHS.byId), authorize("combat:read"), (req, res) => {
    if (!requireGmGradePrincipal(res)) return;
    const id = archiveIdParam(req, res);
    if (id === null) return;
    const document = options.archives.get(id);
    if (document === null) return sendError(res, 404, "not_found", "No such encounter archive.");
    // The stored JSON is spliced in verbatim — no parse/re-serialize round trip on a potentially large document.
    return res.type("application/json").send(`{"ok":true,"apiVersion":"${API_VERSION}","data":{"id":${id},"document":${document}}}`);
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
