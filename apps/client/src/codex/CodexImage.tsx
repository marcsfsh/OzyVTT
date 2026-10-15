import { Skeleton } from "@vtt/ui";
import { useEffect, useState } from "react";
import { codexAssetContent } from "./api";

/**
 * A codex media image, fetched with the caller's token and rendered from an object URL. The server gates
 * player access to media on revealed pages.
 */
export function CodexImage({
  assetId,
  token,
  alt,
  className
}: Readonly<{ assetId: string; token: string; alt?: string; className?: string }>) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!assetId || !token) return;
    setFailed(false);
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void codexAssetContent(token, assetId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, token]);

  if (failed) return <span className="codex-img-failed">{alt || "image unavailable"}</span>;
  if (!url) return <Skeleton variant="block" className={className} />;
  return <img className={className} src={url} alt={alt ?? ""} loading="lazy" />;
}
