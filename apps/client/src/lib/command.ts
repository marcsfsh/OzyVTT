import type { ClientToServerEvents } from "@vtt/domain";
import { socket } from "../socket";
import { newId } from "./ids";

type EventName = keyof ClientToServerEvents;
type Payload<E extends EventName> = Parameters<ClientToServerEvents[E]>[0];
export type Reply<E extends EventName> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

/** Events whose payload carries a `commandId`: they change state and are deduplicated by it. */
export type CommandEvent = {
  [E in EventName]: Payload<E> extends { commandId: string } ? E : never;
}[EventName];
export type ReadEvent = Exclude<EventName, CommandEvent>;
/** What a caller passes to `command`: the payload without the `commandId` it adds. */
export type CommandPayload<E extends CommandEvent> = Omit<Payload<E>, "commandId">;

/** Long enough for a slow LAN, short enough that a dropped reply doesn't leave a button busy forever. */
export const COMMAND_TIMEOUT_MS = 10_000;

export const TIMEOUT_MESSAGE = "The server didn't answer. Check the connection and try again.";

function emit<E extends EventName>(event: E, payload: Payload<E>): Promise<Reply<E>> {
  return new Promise((resolve) => {
    // The typed emit can't follow a generic event name, so this one call is untyped.
    const timed = socket.timeout(COMMAND_TIMEOUT_MS) as unknown as {
      emit(event: string, payload: unknown, ack: (error: Error | null, reply: Reply<E>) => void): void;
    };
    timed.emit(event, payload, (error, reply) => {
      // Every reply type has `ok` and `message`, so a timeout answers in the same shape.
      resolve(error ? ({ ok: false, code: "timeout", message: TIMEOUT_MESSAGE } as Reply<E>) : reply);
    });
  });
}

/**
 * Sends a command and resolves with the server's reply, or a refusal on timeout. A caller resending the
 * same intent passes its earlier `commandId`, so the server answers the retry without acting twice.
 */
export function command<E extends CommandEvent>(
  event: E,
  payload: CommandPayload<E>,
  commandId: string = newId()
): Promise<Reply<E>> {
  return emit(event, { ...payload, commandId } as Payload<E>);
}

/** Asks the server for something without changing state. */
export function read<E extends ReadEvent>(event: E, payload: Payload<E>): Promise<Reply<E>> {
  return emit(event, payload);
}
