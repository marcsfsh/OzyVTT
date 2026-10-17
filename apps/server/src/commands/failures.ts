import type { ApiErrorCode } from "@vtt/api-contract";
import type { MutationResult, RefusalCode } from "@vtt/domain";
import { GameAccessDeniedError } from "../authorization.js";
import {
  CommandRejectedError,
  RevisionConflictError,
  RulesBlockedError,
  TimelineConfirmationRequired
} from "../game-store.js";

/** A request that failed schema validation. */
export class GameInputError extends Error {
  constructor(
    message: string,
    public readonly issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>
  ) {
    super(message);
  }
}

/** A read whose subject does not exist for this principal. Over HTTP a resource miss is a 404. */
export class GameNotFoundError extends CommandRejectedError {
  constructor(message: string) {
    super(message, "not_found");
  }
}

/** How a failed command or read answers, on either transport. */
export type GameFailure = Readonly<{
  status: 400 | 403 | 404 | 409 | 500;
  /** The HTTP envelope's coarse code. */
  code: ApiErrorCode;
  message: string;
  details: Readonly<{
    /** The stable refusal code: the socket reply's `code`, and over HTTP `error.details.reason`. */
    reason: RefusalCode | (string & {});
    issues?: GameInputError["issues"];
    needsConfirm?: TimelineConfirmationRequired["confirm"];
    blocked?: Readonly<{ rule: string; message: string; overridable: boolean }>;
  }>;
  /** A stale `expectedRevision`: the caller should reload before retrying. */
  stale?: true;
}>;

const UNEXPECTED = "The command could not be processed.";

/** The one mapping from a thrown error to a reply. Expected refusals keep their message and carry a code;
 *  anything else is a bug, logged here and answered generically so internals never reach a client. */
export function describeFailure(error: unknown): GameFailure {
  if (error instanceof GameInputError)
    return {
      status: 400,
      code: "validation_failed",
      message: error.message,
      details: { reason: "validation_failed", ...(error.issues ? { issues: error.issues } : {}) }
    };
  if (error instanceof GameAccessDeniedError)
    return { status: 403, code: "forbidden", message: error.message, details: { reason: "forbidden" } };
  if (error instanceof TimelineConfirmationRequired)
    return {
      status: 409,
      code: "conflict",
      message: error.message,
      details: { reason: "needs_confirm", needsConfirm: error.confirm }
    };
  if (error instanceof RevisionConflictError)
    return {
      status: 409,
      code: "conflict",
      message: error.message,
      details: { reason: "stale_revision" },
      stale: true
    };
  // Rules-mode refusals carry what an override needs (ADR-0020); their code is the rule id.
  if (error instanceof RulesBlockedError)
    return {
      status: 409,
      code: "conflict",
      message: error.message,
      details: {
        reason: error.code,
        blocked: { rule: error.rule, message: error.message, overridable: error.overridable }
      }
    };
  if (error instanceof GameNotFoundError)
    return { status: 404, code: "not_found", message: error.message, details: { reason: error.code } };
  if (error instanceof CommandRejectedError)
    return { status: 409, code: "conflict", message: error.message, details: { reason: error.code } };
  console.error("Unexpected failure in a game command:", error);
  return { status: 500, code: "internal_error", message: UNEXPECTED, details: { reason: "internal_error" } };
}

/** A socket call made before `session:join`. */
export const NOT_JOINED_REPLY: MutationResult = { ok: false, code: "not_joined", message: "Join a session first." };
/** A socket whose session was revoked or ran out; the client signs in again (ADR-0027). */
export const SESSION_ENDED_REPLY: MutationResult = {
  ok: false,
  code: "unauthenticated",
  message: "Your session ended. Sign in again."
};

/** The socket acknowledgement for a failed command or read. A timeline confirmation is not a refusal there:
 *  the client re-sends with the confirm flag. */
export function failureReply(error: unknown): MutationResult {
  const { message, details } = describeFailure(error);
  if (details.needsConfirm) return { ok: true, needsConfirm: details.needsConfirm, message };
  return { ok: false, code: details.reason, message, ...(details.blocked ? { blocked: details.blocked } : {}) };
}
