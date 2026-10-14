import type { ClientToServerEvents } from "@vtt/domain";
import { DAMAGE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";

export type ApplyDamagePayload = Parameters<ClientToServerEvents["actor:apply-damage"]>[0];

/**
 * The `actor:apply-damage` manual-entry payload for all three hand-entry doors. A plain `.ts` so
 * `damage-type.mirror.test.ts` can assert on the bytes the app sends.
 */
export function manualDamagePayload(input: Readonly<{
  commandId: string;
  actorId: string;
  amount: number;
  /** The canonical slug from `manualDamageType`, or `undefined` for the untyped fast path. */
  damageType?: string;
  /** SRD knock-out: a drop to 0 leaves the target Unconscious and stable instead of dying. */
  nonlethal?: boolean;
  expectedRevision?: number;
}>): ApplyDamagePayload {
  return {
    commandId: input.commandId,
    actorId: input.actorId,
    amount: input.amount,
    ...(input.damageType !== undefined ? { damageType: input.damageType } : {}),
    ...(input.nonlethal ? { nonlethal: true } : {}),
    ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {})
  };
}

/**
 * The damage-type control's value as a slug, or `undefined` for untyped (absent, empty or "untyped").
 * Homebrew words pass through: the vocabulary is open and the server warns the GM about unknown ones.
 */
export function manualDamageType(chosen: string | null): string | undefined {
  if (chosen === null) return undefined;
  const slug = chosen.trim().toLowerCase().replace(/\s+/g, "-");
  return slug === "" || slug === "untyped" ? undefined : slug;
}

/** The thirteen SRD types as chooser rows, from `DAMAGE_TYPE_IDS`. */
export const DAMAGE_TYPE_OPTIONS: ReadonlyArray<{ id: string; label: string }> = DAMAGE_TYPE_IDS.map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1)
}));
