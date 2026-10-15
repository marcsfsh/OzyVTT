import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  API_VERSION,
  ENCOUNTER_ARCHIVE_PATHS,
  GAME_PATHS,
  GAME_COMMANDS,
  GameCommandEnvelopeSchema,
  SESSION_PATHS,
  type IntegrationScope
} from "@vtt/api-contract";
import type { EncounterArchiveSummary } from "./game-store.js";
import {
  describeFailure,
  isGmGrade,
  type AnyCommand,
  type GameCommands,
  type GamePrincipal,
  type GameReply
} from "./commands/index.js";
import type { EncounterArchiveDocument } from "./encounter-archive.js";
import { bearerToken, expressPath, issuesOf, pathParam, sendData, sendFailure } from "./http-kit.js";
import { projectPlayerReplay } from "./replay-projection.js";

/**
 * The public HTTP adapter over the game commands (ADR-0016): every write and read runs the same
 * table entry as the Socket.IO handlers, so REST cannot fork from table behaviour.
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
  game: GameCommands;
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

export function createGameApiRouter(options: GameApiRouterOptions) {
  const router = Router();
  const newId = options.newId ?? randomUUID;

  function sendOperationError(res: Response, error: unknown) {
    const failure = describeFailure(error);
    return sendFailure(
      res,
      failure.status,
      failure.code,
      failure.message,
      failure.details,
      failure.stale ? options.revision() : undefined
    );
  }

  function resolvePrincipal(req: Request, res: Response, scope: IntegrationScope): GamePrincipal | null {
    const token = bearerToken(req);
    if (!token) {
      sendFailure(
        res,
        401,
        "unauthenticated",
        "A GM session, player session, or integration bearer token is required."
      );
      return null;
    }
    const gm = options.gmSession(token);
    if (gm) return { kind: "gm", sessionId: gm.sessionId };
    const player = options.playerSession(token);
    if (player) return { kind: "player", sessionId: player.sessionId };
    const credential = options.verifyIntegration(token, scope);
    if (credential) return { kind: "integration", credentialId: credential.id, name: credential.name };
    sendFailure(res, 403, "forbidden", "The token is invalid, revoked, or missing the required scope.");
    return null;
  }

  const authorize = (scope: IntegrationScope) => (req: Request, res: Response, next: NextFunction) => {
    const principal = resolvePrincipal(req, res, scope);
    if (!principal) return;
    res.locals.principal = principal;
    next();
  };

  /** Runs a command for the request's principal and answers with the reply, or the failure mapping. */
  async function sendCommand(
    res: Response,
    principal: GamePrincipal,
    command: AnyCommand,
    payload: { commandId: unknown },
    echo: GameReply = {}
  ) {
    try {
      const data = await options.game.dispatch(command.type, principal, payload);
      return sendData(res, 200, { commandId: payload.commandId, ...echo, ...data });
    } catch (error) {
      return sendOperationError(res, error);
    }
  }

  const { game } = options;
  const commandsByType = new Map(game.commands.map((command) => [command.type as string, command]));

  // ---------- Game state reads ----------

  router.get(expressPath(GAME_PATHS.snapshot), authorize("game:read"), (req, res) => {
    try {
      const requested =
        req.query.view === "player"
          ? ("player" as const)
          : req.query.view === "gm" || req.query.view === undefined
            ? undefined
            : null;
      if (requested === null) return sendFailure(res, 400, "validation_failed", 'view must be "gm" or "player".');
      const projected = game.view(res.locals.principal as GamePrincipal, requested);
      const revision = (projected.game as { revision: number }).revision;
      // Weak because presence and timed-annotation expiry can change content without a revision bump.
      const etag = `W/"game-r${revision}-${projected.view}"`;
      res.setHeader("etag", etag);
      if (req.header("if-none-match") === etag) return res.status(304).end();
      return sendData(res, 200, { view: projected.view, revision, game: projected.game });
    } catch (error) {
      return sendOperationError(res, error);
    }
  });

  // The reads the socket serves too (content catalogs, action availability, the combat log), from one table.
  for (const read of game.reads)
    router.get(expressPath(read.path), authorize(read.scope), (req, res) => {
      try {
        const params = req.params as Record<string, string>;
        const input = read.httpInput ? read.httpInput({ params, query: req.query }) : params;
        return sendData(res, 200, game.read(read, res.locals.principal as GamePrincipal, input));
      } catch (error) {
        return sendOperationError(res, error);
      }
    });

  // ---------- Generic command tunnel + catalog ----------

  router.get(expressPath(GAME_PATHS.commands), authorize("system:read"), (_req, res) => {
    const commands = game.commands
      .map(({ type, summary }) => ({ type, scope: GAME_COMMANDS[type].scope, summary }))
      .sort((a, b) => a.type.localeCompare(b.type));
    return sendData(res, 200, { commands });
  });

  router.post(expressPath(GAME_PATHS.commands), async (req, res) => {
    const envelope = GameCommandEnvelopeSchema.safeParse(req.body);
    if (!envelope.success)
      return sendFailure(res, 400, "validation_failed", "The command envelope is malformed.", {
        issues: issuesOf(envelope.error)
      });
    const command = commandsByType.get(envelope.data.type);
    if (!command)
      return sendFailure(res, 404, "not_found", "That command type is not available over the integration API.", {
        availableTypes: [...commandsByType.keys()].sort()
      });
    const principal = resolvePrincipal(req, res, GAME_COMMANDS[command.type].scope);
    if (!principal) return;
    const payload = {
      commandId: envelope.data.commandId ?? newId(),
      ...envelope.data.payload,
      ...(envelope.data.expectedRevision !== undefined ? { expectedRevision: envelope.data.expectedRevision } : {})
    };
    return sendCommand(res, principal, command, payload, { type: command.type });
  });

  // ---------- Typed command routes ----------

  // Each command's route comes from GAME_COMMANDS. The JSON body plus path parameters is the payload; a
  // missing commandId is minted (and echoed) so plain curl calls work, and path parameters win.
  for (const command of game.commands) {
    const route = GAME_COMMANDS[command.type];
    router[route.method](expressPath(route.path), authorize(route.scope), (req, res) => {
      const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<
        string,
        unknown
      >;
      const params = req.params as Record<string, string>;
      const payload = { commandId: newId(), ...body, ...(command.pathParams ? command.pathParams(params) : params) };
      return sendCommand(res, res.locals.principal as GamePrincipal, command, payload);
    });
  }

  // ---------- Player sessions (headless / alternate player clients) ----------

  router.post(expressPath(SESSION_PATHS.player), (_req, res) => {
    const issued = options.sessions.issuePlayer();
    if (!issued) return sendFailure(res, 409, "conflict", "The host must complete GM setup before players join.");
    return sendData(res, 201, issued);
  });

  // ---------- Encounter archives ----------

  /** Archive management (visibility, delete) stays GM-grade; the two reads below are role-aware. */
  function requireGmGradePrincipal(res: Response): GamePrincipal | null {
    const principal = res.locals.principal as GamePrincipal;
    if (!isGmGrade(principal)) {
      sendFailure(res, 403, "forbidden", "Only the GM may access encounter archives.");
      return null;
    }
    return principal;
  }

  function archiveIdParam(req: Request, res: Response): number | null {
    const raw = pathParam(req, "id");
    const id = /^[0-9]{1,12}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id < 1) {
      sendFailure(res, 400, "validation_failed", "The archive id must be a positive integer.");
      return null;
    }
    return id;
  }

  /** Role-aware: the GM gets the stored document, a player gets the computed player replay, and an
   *  unshared archive is a 404 for a player. Never 403, which would confirm the recording exists. */
  router.get(expressPath(ENCOUNTER_ARCHIVE_PATHS.collection), authorize("combat:read"), (_req, res) => {
    const principal = res.locals.principal as GamePrincipal;
    if (!isGmGrade(principal))
      return sendData(res, 200, { encounters: options.archives.list().filter((entry) => entry.playerVisible) });
    return sendData(res, 200, { encounters: options.archives.list() });
  });

  router.get(expressPath(ENCOUNTER_ARCHIVE_PATHS.byId), authorize("combat:read"), (req, res) => {
    const principal = res.locals.principal as GamePrincipal;
    const id = archiveIdParam(req, res);
    if (id === null) return;
    if (!isGmGrade(principal)) {
      const shared = options.archives.list().some((entry) => entry.id === id && entry.playerVisible);
      const stored = shared ? options.archives.get(id) : null;
      // Missing and unshared are indistinguishable on purpose.
      if (stored === null) return sendFailure(res, 404, "not_found", "No such encounter archive.");
      let document: EncounterArchiveDocument;
      try {
        document = JSON.parse(stored) as EncounterArchiveDocument;
      } catch {
        return sendFailure(res, 404, "not_found", "No such encounter archive.");
      }
      return sendData(res, 200, { id, document: projectPlayerReplay(id, document) });
    }
    const document = options.archives.get(id);
    if (document === null) return sendFailure(res, 404, "not_found", "No such encounter archive.");
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
      return sendFailure(res, 400, "validation_failed", "playerVisible must be true or false.");
    if (!options.archives.setVisibility(id, body.playerVisible))
      return sendFailure(res, 404, "not_found", "No such encounter archive.");
    return sendData(res, 200, { id, playerVisible: body.playerVisible });
  });

  router.delete(expressPath(ENCOUNTER_ARCHIVE_PATHS.byId), authorize("admin"), (req, res) => {
    if (!requireGmGradePrincipal(res)) return;
    const id = archiveIdParam(req, res);
    if (id === null) return;
    if (options.archives.get(id) === null) return sendFailure(res, 404, "not_found", "No such encounter archive.");
    options.archives.remove(id);
    return sendData(res, 200, { id, deleted: true });
  });

  return router;
}
