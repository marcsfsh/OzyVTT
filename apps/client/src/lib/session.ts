import type { SessionJoinResult } from "@vtt/domain";
import { socket } from "../socket";
import { read } from "./command";

/** The player's session token, shared by the app and the standalone sheet tab (same origin). */
const PLAYER_TOKEN_KEY = "vtt.player-token";

/** The stored player token. Storage can throw in private mode, which reads as "none yet". */
export function storedPlayerToken(): string | undefined {
  try {
    return localStorage.getItem(PLAYER_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Connects the socket with a session token and joins the table. The token rides in `socket.auth` too,
 * so a reconnect resumes without another join. A player token the server issues or renews is stored.
 */
export async function joinTable(token: string | undefined): Promise<SessionJoinResult> {
  socket.auth = { token };
  socket.connect();
  const result = await read("session:join", { token });
  if (result.ok && result.role === "player" && result.token) {
    try {
      localStorage.setItem(PLAYER_TOKEN_KEY, result.token);
    } catch {
      /* private mode: the session still works for this tab */
    }
  }
  return result;
}
