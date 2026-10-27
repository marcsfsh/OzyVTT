import { afterEach, describe, expect, it, vi } from "vitest";
import { GameAccessDeniedError } from "../src/authorization.js";
import { describeFailure, failureReply, GameInputError, GameNotFoundError } from "../src/commands/failures.js";
import {
  CommandRejectedError,
  RevisionConflictError,
  RulesBlockedError,
  TimelineConfirmationRequired
} from "../src/game-store.js";

// Both transports answer a failed command through `describeFailure`, so its cases are the error contract
// for the socket ack and the HTTP envelope alike.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeFailure", () => {
  it("keeps the message of every expected refusal, with the status its kind implies", () => {
    expect(describeFailure(new GameInputError("The roll request is malformed.", []))).toMatchObject({
      status: 400,
      code: "validation_failed",
      message: "The roll request is malformed.",
      details: { reason: "validation_failed", issues: [] }
    });
    expect(describeFailure(new GameAccessDeniedError("Only the GM can end an encounter."))).toEqual({
      status: 403,
      code: "forbidden",
      message: "Only the GM can end an encounter.",
      details: { reason: "forbidden" }
    });
    expect(describeFailure(new GameNotFoundError("That stat block is not in the bundled content."))).toMatchObject({
      status: 404,
      code: "not_found",
      details: { reason: "not_found" }
    });
    expect(describeFailure(new CommandRejectedError("That character is already claimed."))).toEqual({
      status: 409,
      code: "conflict",
      message: "That character is already claimed.",
      details: { reason: "refused" }
    });
    expect(describeFailure(new RevisionConflictError("Your view is outdated."))).toMatchObject({
      status: 409,
      details: { reason: "stale_revision" },
      stale: true
    });
  });

  it("carries a refusal's own code, so a client never has to match its wording", () => {
    expect(
      describeFailure(new CommandRejectedError("Finish reviewing the combat history first.", "history_review"))
    ).toMatchObject({ status: 409, code: "conflict", details: { reason: "history_review" } });
    expect(failureReply(new CommandRejectedError("No room for another encounter.", "encounter_room_full"))).toEqual({
      ok: false,
      code: "encounter_room_full",
      message: "No room for another encounter."
    });
    // A rules block's code is the rule that blocked it, beside what an override needs.
    expect(failureReply(new RulesBlockedError("cover.total", "The target has Total Cover."))).toEqual({
      ok: false,
      code: "cover.total",
      message: "The target has Total Cover.",
      blocked: { rule: "cover.total", message: "The target has Total Cover.", overridable: true }
    });
    // A confirmation is not a refusal on the socket: the client re-sends with the confirm flag.
    expect(failureReply(new TimelineConfirmationRequired("discard-changes", "Confirm first."))).toEqual({
      ok: true,
      needsConfirm: "discard-changes",
      message: "Confirm first."
    });
  });

  it("carries what an override or a confirmation needs", () => {
    expect(describeFailure(new RulesBlockedError("movement.exceeds-speed", "Out of movement."))).toMatchObject({
      status: 409,
      details: {
        reason: "movement.exceeds-speed",
        blocked: { rule: "movement.exceeds-speed", message: "Out of movement.", overridable: true }
      }
    });
    expect(describeFailure(new TimelineConfirmationRequired("rewrite-history", "Confirm first."))).toMatchObject({
      status: 409,
      details: { reason: "needs_confirm", needsConfirm: "rewrite-history" }
    });
  });

  it("answers anything unexpected generically and logs it, so internals never reach a client", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = describeFailure(new TypeError("Cannot read properties of undefined (reading 'hp')"));
    expect(failure).toEqual({
      status: 500,
      code: "internal_error",
      message: "The command could not be processed.",
      details: { reason: "internal_error" }
    });
    expect(failureReply(new TypeError("boom"))).toEqual({
      ok: false,
      code: "internal_error",
      message: "The command could not be processed."
    });
    expect(log).toHaveBeenCalledTimes(2);
    expect(describeFailure("not even an error").message).toBe("The command could not be processed.");
  });
});
