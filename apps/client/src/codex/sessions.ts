/**
 * M9's shared session reading rules — what a session is CALLED and which one is "next".
 *
 * Pure functions, no JSX, for the same reason `chronicle.ts` is: five surfaces read a session (the
 * Campaign card, the console drawer, the journal's by-session lens, the sessions destination and the
 * player's dashboard) and they are deliberately separate implementations. What must not drift is the
 * *meaning* — how a session names itself, and which one the table is pointed at.
 *
 * Everything here is structurally typed on the narrowest shape that answers the question, so the GM
 * record (`CodexSession`) and the PLAYER projection (`PlayerCodexSession`, four keys) both satisfy it.
 * That is not a convenience: a helper that demanded a GM-only field would be one that could not be used
 * on the player's dashboard, and the fix for that is always to widen the projection.
 */

/** The minimum needed to name a session and to resolve one. Satisfied by BOTH projections. */
export type SessionRef = Readonly<{ id: string; sessionNumber: number | null }>;

/**
 * How a session says which one it is. An unnumbered session is legitimate (the store's number column is
 * nullable), so it needs a name rather than an empty heading — and "Session null" is not a name.
 */
export function sessionTitle(session: SessionRef): string {
  return session.sessionNumber === null ? "Unnumbered session" : `Session ${session.sessionNumber}`;
}

/**
 * Resolve a session NUMBER to its record, or null when no session exists for it.
 *
 * M9 ships with **no backfill**, so most numbered journal entries have no session record behind them.
 * That is the whole reason this returns null rather than inventing one: a legacy "Session 4" heading on
 * the chronicle must keep rendering exactly as it does today until a GM actually creates session 4.
 */
export function sessionByNumber<T extends SessionRef>(sessions: readonly T[], sessionNumber: number): T | null {
  return sessions.find((session) => session.sessionNumber === sessionNumber) ?? null;
}

/**
 * Which session the dashboard's "Next session" card is about.
 *
 * The GM has an explicit answer — `activeSessionId`, the pointer they set themselves — so it wins
 * outright whenever it names a session still in the list. A player is never sent that pointer (the
 * server answers them `null`; it names a record that may well be unrevealed), so for them the rule
 * falls through to the highest-numbered session they can see, which is the nearest one to now.
 *
 * Unnumbered sessions are the last resort, not the first: a GM who has numbered their campaign should
 * never have the card taken over by a stray unnumbered scratch record. Among those, the list's own
 * order decides — the server sends numbered-first in number order, then unnumbered oldest-first, so the
 * last element is the most recently created one.
 */
export function pickNextSession<T extends SessionRef>(sessions: readonly T[], activeSessionId: string | null = null): T | null {
  if (activeSessionId) {
    const active = sessions.find((session) => session.id === activeSessionId);
    if (active) return active;
  }
  const numbered = sessions.filter((session) => session.sessionNumber !== null);
  if (numbered.length > 0) return numbered.reduce((best, session) => (session.sessionNumber! > best.sessionNumber! ? session : best));
  return sessions.at(-1) ?? null;
}
