import { Skeleton } from "@vtt/ui";
import { useEffect, useState } from "react";

/**
 * A codex media image. Bearer tokens can't ride an <img src>, so - like the map renderer - we fetch the
 * asset with the caller's token, turn it into an object URL, and render that. Used for page banners and
 * inline images; the same component serves GM and player (the server gates player access to media used
 * by revealed pages).
 */
export function CodexImage({ assetId, token, alt, className }: Readonly<{ assetId: string; token: string; alt?: string; className?: string }>) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!assetId || !token) return;
    setFailed(false);
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetch(`/api/v1/codex-assets/${encodeURIComponent(assetId)}/content`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("unavailable"); objectUrl = URL.createObjectURL(await response.blob()); setUrl(objectUrl); })
      .catch((error) => { if (error.name !== "AbortError") setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, token]);

  if (failed) return <span className="codex-img-failed">{alt || "image unavailable"}</span>;
  if (!url) return <Skeleton variant="block" className={className} />;
  return <img className={className} src={url} alt={alt ?? ""} loading="lazy" />;
}
