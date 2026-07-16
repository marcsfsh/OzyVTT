/**
 * A v4 UUID generator that works in insecure browsing contexts.
 *
 * The app is served over plain HTTP on a LAN IP (e.g. http://192.168.x.x:3001), which is NOT a
 * secure context, and browsers gate `crypto.randomUUID` (and all of SubtleCrypto) to secure
 * contexts only. Calling `crypto.randomUUID()` there throws `TypeError: crypto.randomUUID is not
 * a function`, which previously broke every command emit (stuck "Claiming…", dead dice/moves).
 *
 * `crypto.getRandomValues`, unlike `randomUUID`, IS available in insecure contexts, so we build a
 * spec-compliant RFC 4122 v4 UUID from it. Command IDs are validated server-side as UUIDs
 * (`z.string().uuid()`), so the output shape must stay a real v4 UUID.
 */
export function newId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xxxxxx

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}
