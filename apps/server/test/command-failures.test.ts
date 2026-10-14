import { afterEach, describe, expect, it, vi } from "vitest";
import { GameAccessDeniedError } from "../src/authorization.js";
import { describeFailure, GameInputError, GameNotFoundError } from "../src/commands/failures.js";
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
      details: { issues: [] }
    });
    expect(describeFailure(new GameAccessDeniedError("Only the GM can end an encounter."))).toEqual({
      status: 403,
      code: "forbidden",
      message: "Only the GM can end an encounter."
    });
    expect(describeFailure(new GameNotFoundError("That stat block is not in the bundled content."))).toMatchObject({
      status: 404,
      code: "not_found"
    });
    expect(describeFailure(new CommandRejectedError("That character is already claimed."))).toEqual({
      status: 409,
      code: "conflict",
      message: "That character is already claimed."
    });
    expect(describeFailure(new RevisionConflictError("Your view is outdated."))).toMatchObject({
      status: 409,
      stale: true
    });
  });

  it("carries what an override or a confirmation needs", () => {
    expect(describeFailure(new RulesBlockedError("movement.exceeds-speed", "Out of movement."))).toMatchObject({
      status: 409,
      details: { blocked: { rule: "movement.exceeds-speed", message: "Out of movement.", overridable: true } }
    });
    expect(describeFailure(new TimelineConfirmationRequired("rewrite-history", "Confirm first."))).toMatchObject({
      status: 409,
      details: { needsConfirm: "rewrite-history" }
    });
  });

  it("answers anything unexpected generically and logs it, so internals never reach a client", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = describeFailure(new TypeError("Cannot read properties of undefined (reading 'hp')"));
    expect(failure).toEqual({ status: 500, code: "internal_error", message: "The command could not be processed." });
    expect(log).toHaveBeenCalledOnce();
    expect(describeFailure("not even an error").message).toBe("The command could not be processed.");
  });
});
