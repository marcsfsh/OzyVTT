import type { ApiErrorCode } from "@vtt/api-contract";
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
export class GameNotFoundError extends CommandRejectedError {}

/** How a failed command or read answers, on either transport. */
export type GameFailure = Readonly<{
  status: 400 | 403 | 404 | 409 | 500;
  code: ApiErrorCode;
  message: string;
  details?: Readonly<{
    issues?: GameInputError["issues"];
    needsConfirm?: TimelineConfirmationRequired["confirm"];
    blocked?: Readonly<{ rule: string; message: string; overridable: boolean }>;
  }>;
  /** A stale `expectedRevision`: the caller should reload before retrying. */
  stale?: true;
}>;

const UNEXPECTED = "The command could not be processed.";

/** The one mapping from a thrown error to a reply. Expected refusals keep their message; anything else is a
 *  bug, logged here and answered generically so internals never reach a client. */
export function describeFailure(error: unknown): GameFailure {
  if (error instanceof GameInputError)
    return {
      status: 400,
      code: "validation_failed",
      message: error.message,
      ...(error.issues ? { details: { issues: error.issues } } : {})
    };
  if (error instanceof GameAccessDeniedError) return { status: 403, code: "forbidden", message: error.message };
  if (error instanceof TimelineConfirmationRequired)
    return { status: 409, code: "conflict", message: error.message, details: { needsConfirm: error.confirm } };
  if (error instanceof RevisionConflictError)
    return { status: 409, code: "conflict", message: error.message, stale: true };
  // Rules-mode refusals carry what an override needs (ADR-0020).
  if (error instanceof RulesBlockedError)
    return {
      status: 409,
      code: "conflict",
      message: error.message,
      details: { blocked: { rule: error.rule, message: error.message, overridable: error.overridable } }
    };
  if (error instanceof GameNotFoundError) return { status: 404, code: "not_found", message: error.message };
  if (error instanceof CommandRejectedError) return { status: 409, code: "conflict", message: error.message };
  console.error("Unexpected failure in a game command:", error);
  return { status: 500, code: "internal_error", message: UNEXPECTED };
}
