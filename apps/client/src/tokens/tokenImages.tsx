import { useEffect, useState } from "react";
import { TokenGlyph, type TokenGlyphProps } from "../scene/mapImage";

/**
 * Session-scoped cache of token-asset blob URLs keyed by asset id. Many tokens can share one image
 * (a room full of goblins), so we fetch each asset once and hand every token the same blob URL. The
 * cache is intentionally never revoked — a LAN table holds a handful of token images per session and
 * the blobs die with the tab; a failed fetch is dropped so a later mount can retry. `resolved` mirrors
 * the settled URLs so an already-loaded image shows immediately (no initials flash on remount).
 */
const pendingCache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

function loadTokenBlob(assetId: string, token: string): Promise<string> {
  const existing = pendingCache.get(assetId);
  if (existing) return existing;
  const pending = fetch(`/api/v1/token-assets/${encodeURIComponent(assetId)}/content`, { headers: { authorization: `Bearer ${token}` } })
    .then(async (response) => {
      if (!response.ok) throw new Error("The token image could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      resolved.set(assetId, url);
      return url;
    });
  pending.catch(() => pendingCache.delete(assetId));
  pendingCache.set(assetId, pending);
  return pending;
}

/**
 * Resolves a token asset to a bearer-authorized blob URL (shared across tokens using the same asset).
 * Returns null while loading or on error so callers fall back to initials. The shared-screen viewer
 * does not use this — it embeds the cookie-authorized `/content` URL directly in the `<image>`.
 */
export function useTokenImageUrl(assetId: string | null | undefined, token: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (assetId ? resolved.get(assetId) ?? null : null));
  useEffect(() => {
    if (!assetId || !token) { setUrl(null); return; }
    const cached = resolved.get(assetId);
    setUrl(cached ?? null);
    if (cached) return;
    let active = true;
    loadTokenBlob(assetId, token).then((next) => { if (active) setUrl(next); }).catch(() => { if (active) setUrl(null); });
    return () => { active = false; };
  }, [assetId, token]);
  return url;
}

/**
 * A `TokenGlyph` that resolves `assetId` to an authorized image URL for the interactive client. Used
 * per-token so the image hook runs once per token (hooks can't loop). The viewer passes `imageUrl`
 * to `TokenGlyph` directly instead, since its `/content` URL is cookie-authorized.
 */
export function AuthorizedTokenGlyph({ assetId, token, ...glyph }: Omit<TokenGlyphProps, "imageUrl"> & Readonly<{ assetId: string | null | undefined; token: string | null | undefined }>) {
  const imageUrl = useTokenImageUrl(assetId, token);
  return <TokenGlyph {...glyph} imageUrl={imageUrl} />;
}
