import { CHAT_MAX_LENGTH } from "@vtt/domain/commands";

/**
 * A chat line as the server keeps it (ADR-0038): NFC, control characters gone, line breaks and tabs folded to spaces,
 * runs of spaces to one, trimmed. Null when nothing is left. Clients render it as text, so nothing here escapes.
 */
export function cleanChatText(raw: string): string | null {
  const text = raw
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return text.length === 0 ? null : text;
}

/** How long a cleaned line is, in code points, as the 500 cap counts it. */
export const chatLength = (text: string) => [...text].length;

export { CHAT_MAX_LENGTH };

/** Per session, 5 lines in 10 seconds and 30 in a minute; the GM gets twice that. Kept in memory for the run. */
export class ChatLimiter {
  private readonly sent = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}

  allow(sessionId: string, gm: boolean): boolean {
    const now = this.now();
    const times = (this.sent.get(sessionId) ?? []).filter((at) => now - at < 60_000);
    const scale = gm ? 2 : 1;
    const recent = times.filter((at) => now - at < 10_000).length;
    if (recent >= 5 * scale || times.length >= 30 * scale) {
      this.sent.set(sessionId, times);
      return false;
    }
    this.sent.set(sessionId, [...times, now]);
    return true;
  }
}
