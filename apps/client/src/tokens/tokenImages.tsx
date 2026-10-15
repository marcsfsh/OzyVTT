import { useEffect, useState } from "react";
import { apiBlob } from "../lib/api";
import { TokenGlyph, type TokenGlyphProps } from "../scene/tokenGlyph";

/**
 * Token-asset blob URLs by asset id, fetched once and shared by every token using the asset. Never
 * revoked (a handful per session, gone with the tab); a failed fetch is dropped so a later mount can
 * retry. `resolved` holds settled URLs so a remount shows the image without an initials flash.
 */
const pendingCache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

function loadTokenBlob(assetId: string, token: string): Promise<string> {
  const existing = pendingCache.get(assetId);
  if (existing) return existing;
  const pending = apiBlob(`/api/v1/token-assets/${encodeURIComponent(assetId)}/content`, { token }).then((blob) => {
    const url = URL.createObjectURL(blob);
    resolved.set(assetId, url);
    return url;
  });
  pending.catch(() => pendingCache.delete(assetId));
  pendingCache.set(assetId, pending);
  return pending;
}

/**
 * Resolves a token asset to a bearer-authorized blob URL; null while loading or on error, so callers
 * fall back to initials. The shared-screen viewer uses the cookie-authorized `/content` URL instead.
 */
export function useTokenImageUrl(assetId: string | null | undefined, token: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (assetId ? (resolved.get(assetId) ?? null) : null));
  useEffect(() => {
    if (!assetId || !token) {
      setUrl(null);
      return;
    }
    const cached = resolved.get(assetId);
    setUrl(cached ?? null);
    if (cached) return;
    let active = true;
    loadTokenBlob(assetId, token)
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [assetId, token]);
  return url;
}

/** A `TokenGlyph` with an authorized image, one per token since the hook cannot run in a loop. */
export function AuthorizedTokenGlyph({
  assetId,
  token,
  ...glyph
}: Omit<TokenGlyphProps, "imageUrl"> &
  Readonly<{ assetId: string | null | undefined; token: string | null | undefined }>) {
  const imageUrl = useTokenImageUrl(assetId, token);
  return <TokenGlyph {...glyph} imageUrl={imageUrl} />;
}
