import { useEffect, useState } from "react";
import "./encounter-map.css";

export function EncounterMap({ assetId, token, altText = "Active encounter battlemap" }: Readonly<{ assetId: string; token: string | null; altText?: string }>) {
  const [source, setSource] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading active battlemap…");

  useEffect(() => {
    setSource(null);
    if (!token) { setMessage("A table session is required to load the active battlemap."); return; }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMessage("Loading active battlemap…");
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/content`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? "The active battlemap is not available to this session." : "The active battlemap could not be loaded.");
      objectUrl = URL.createObjectURL(await response.blob());
      setSource(objectUrl); setMessage("");
    }).catch((error) => { if (error.name !== "AbortError") setMessage(error.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, token]);

  return <div className="encounter-map-stage" aria-busy={!source}>
    {source ? <img src={source} alt={altText} draggable={false} /> : <p role="status">{message}</p>}
  </div>;
}
