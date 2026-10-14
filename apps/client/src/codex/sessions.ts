/** Shared session reading rules, typed so both the GM row and the player projection satisfy them. */

export type SessionRef = Readonly<{ id: string; sessionNumber: number | null }>;

/** Session numbers are nullable, and "Session null" is not a name. */
export function sessionTitle(session: SessionRef): string {
  return session.sessionNumber === null ? "Unnumbered session" : `Session ${session.sessionNumber}`;
}

/** The session record for a number, or null. Older numbered journal groups may have no record behind them. */
export function sessionByNumber<T extends SessionRef>(sessions: readonly T[], sessionNumber: number): T | null {
  return sessions.find((session) => session.sessionNumber === sessionNumber) ?? null;
}

/**
 * Which session the "Next session" card shows. The GM's active pointer wins when it names a listed
 * session; players never receive it, so fall back to the highest-numbered session. Unnumbered sessions
 * are a last resort; among them the last (most recently created, given server order) wins.
 */
export function pickNextSession<T extends SessionRef>(
  sessions: readonly T[],
  activeSessionId: string | null = null
): T | null {
  if (activeSessionId) {
    const active = sessions.find((session) => session.id === activeSessionId);
    if (active) return active;
  }
  const numbered = sessions.filter((session) => session.sessionNumber !== null);
  if (numbered.length > 0)
    return numbered.reduce((best, session) => (session.sessionNumber! > best.sessionNumber! ? session : best));
  return sessions.at(-1) ?? null;
}
