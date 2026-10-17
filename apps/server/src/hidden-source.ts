// The one mask a hidden source's identity collapses to; shared so adjacent fields never disagree.
export const HIDDEN_SOURCE = "A hidden threat";

/** Scrubs a hidden source's name out of a free-form label ("Grappled by Vashkar") at the security
 *  boundary, since resolvers interpolate it and blanking would leave an empty chip. Word-boundary match;
 *  it can't catch other spellings, so resolvers must only interpolate the source's own `sourceName`. */
export function withoutSourceName(text: string, sourceName: string | null): string {
  const needle = sourceName?.trim() ?? "";
  if (needle.length === 0) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), HIDDEN_SOURCE);
}
