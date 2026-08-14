import type { ClientToServerEvents } from "@vtt/domain";
import { DAMAGE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";

export type ApplyDamagePayload = Parameters<ClientToServerEvents["actor:apply-damage"]>[0];

/**
 * THE `actor:apply-damage` MANUAL-ENTRY PAYLOAD, built in one place.
 *
 * Register D7's client half. The server has accepted an optional `damageType` on the manual path
 * since `4a` shipped, and no client control sent one: the GM's three hand-entry doors - the
 * turn-order row's tools popover, the map token's context menu and the sheet's HP box - each
 * hand-rolled `{commandId, actorId, amount}` and got the defence-free fast path. A GM could watch a
 * fire-resistant target lose all ten of a fire bolt with nothing in the feed to explain why, because
 * nothing had halved it.
 *
 * All three doors now build their payload here, which is also what makes the far-end proof possible:
 * `damage-type.mirror.test.ts` runs in the node project and cannot load a `.tsx` that imports CSS, so
 * a shared `.ts` is the only way for a test to assert on the bytes the app REALLY sends rather than on
 * a payload retyped beside it - and a retyped payload is the kind that passes while the app is broken.
 *
 * The shape is the domain contract's, not a copy: `ApplyDamagePayload` is read off
 * `ClientToServerEvents`, so a field this builder misspells is a typecheck failure.
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
 * What the damage-type control holds, as the SLUG the engine matches on - or `undefined` when the
 * entry is untyped and today's fast path must be preserved byte for byte.
 *
 * Three "untyped" cases, and the third is the one that matters: `"untyped"` is the resolver's own
 * live fourteenth value (`hit-points.ts`), so a GM who types the word gets the fast path rather than a
 * typed part of a type nothing can ever resist. Absent and empty are the same answer by the same rule
 * the amount field already uses - an untouched control sends nothing, so the wire is unchanged for
 * every GM who never opens this.
 *
 * A HOMEBREW TYPE TRAVELS. The vocabulary is open on purpose and the server says so twice
 * (`ApplyDamageSchema`: "the SRD thirteen are a suggestion list, never a gate"), so "ooze" reaches the
 * maths and matches an "ooze" defence. What the client must NOT do is silently correct or reject it:
 * the server already answers a hand-typed word the SRD does not know with a GM-only line naming the
 * risk, and swallowing the word here would replace that with nothing at all.
 */
export function manualDamageType(chosen: string | null): string | undefined {
  if (chosen === null) return undefined;
  const slug = chosen.trim().toLowerCase().replace(/\s+/g, "-");
  return slug === "" || slug === "untyped" ? undefined : slug;
}

/**
 * The thirteen SRD types as chooser rows. `DAMAGE_TYPE_IDS` is the ONE list (`enums.ts` centralised it
 * precisely so a second copy cannot drift), and the label is derived from the slug rather than mapped,
 * for the same reason.
 */
export const DAMAGE_TYPE_OPTIONS: ReadonlyArray<{ id: string; label: string }> = DAMAGE_TYPE_IDS.map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1)
}));
