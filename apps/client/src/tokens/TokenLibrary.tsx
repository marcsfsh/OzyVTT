import { useEffect, useMemo, useState } from "react";
import { Modal } from "@vtt/ui";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { useTokenImageUrl } from "./tokenImages";
import "./tokens.css";

type TokenAsset = Readonly<{
  id: string;
  name: string;
  folder: string | null;
  mediaType: string;
  width: number;
  height: number;
  byteLength: number;
  importedAt: string;
  lastUsedAt: string | null;
}>;

async function api(path: string, gmToken: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${gmToken}`, ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Token request failed.");
  return body.data;
}

function TokenThumb({ asset, gmToken, remembered, selected, onPick }: Readonly<{ asset: TokenAsset; gmToken: string; remembered: boolean; selected: boolean; onPick: () => void }>) {
  const url = useTokenImageUrl(asset.id, gmToken);
  return <button type="button" className={`token-thumb lift${selected ? " selected" : ""}`} onClick={onPick} aria-pressed={selected} title={asset.name}>
    <span className="token-thumb-image">{url ? <img src={url} alt="" /> : <span className="token-thumb-placeholder" aria-hidden="true">🎴</span>}</span>
    <span className="token-thumb-name">{asset.name}</span>
    {remembered && <span className="token-thumb-badge">Recent</span>}
  </button>;
}

/**
 * GM token-image picker for one actor. Lists uploaded token images (searchable, one level of folders),
 * surfaces the image last used for this creature's definition, uploads new images, and assigns the
 * chosen image to the actor via the authoritative `actor:set-token-image` command. Portaled to <body>
 * so it clears the docked panel and enlarged-map stacking contexts.
 */
export function TokenLibrary({ actorId, actorName, definitionId, currentAssetId, gmToken, onClose }: Readonly<{
  actorId: string;
  actorName: string;
  definitionId?: string | null;
  currentAssetId?: string | null;
  gmToken: string;
  onClose: () => void;
}>) {
  const [assets, setAssets] = useState<readonly TokenAsset[]>([]);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [file, setFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadFolder, setUploadFolder] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const query = definitionId ? `?definitionId=${encodeURIComponent(definitionId)}` : "";
    const data = await api(`/api/v1/token-assets${query}`, gmToken);
    setAssets(data.tokens);
    setRemembered(data.rememberedAssetId ?? null);
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gmToken, definitionId]);

  const folders = useMemo(() => Array.from(new Set(assets.map((asset) => asset.folder).filter((value): value is string => value !== null))).sort((a, b) => a.localeCompare(b)), [assets]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assets.filter((asset) =>
      (folder === "all" || (folder === "__unfiled" ? asset.folder === null : asset.folder === folder)) &&
      (needle === "" || asset.name.toLowerCase().includes(needle))
    );
  }, [assets, search, folder]);
  const rememberedAsset = remembered ? assets.find((asset) => asset.id === remembered) ?? null : null;

  const assign = (tokenAssetId: string | null) => {
    setBusy(true); setMessage("");
    socket.emit("actor:set-token-image", { commandId: newId(), actorId, tokenAssetId }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (result.ok) onClose(); else setMessage(result.message ?? "That token image could not be assigned.");
    });
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) { setMessage("Choose an image to upload."); return; }
    setBusy(true); setMessage("");
    try {
      const params = new URLSearchParams({ filename: file.name, name: uploadName || file.name.replace(/\.[^.]+$/, "") });
      if (uploadFolder.trim()) params.set("folder", uploadFolder.trim());
      const data = await api(`/api/v1/token-assets?${params}`, gmToken, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      setFile(null); setUploadName("");
      await refresh();
      setMessage(data.duplicate ? "That image was already in the library." : "Token image uploaded.");
      assign(data.token.id);
    } catch (error) { setBusy(false); setMessage((error as Error).message); }
  };

  return <Modal
    open
    onClose={onClose}
    size="lg"
    className="token-library"
    title={actorName}
    ariaLabel={`Token image for ${actorName}`}
    footer={<>
      {currentAssetId && <button type="button" className="token-library-remove" disabled={busy} onClick={() => assign(null)}>Remove image</button>}
      <button type="button" disabled={busy} onClick={onClose}>Done</button>
    </>}
  >
        <span className="eyebrow">TOKEN IMAGE</span>
        <form className="token-upload" onSubmit={upload}>
          <label>Image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !uploadName) setUploadName(next.name.replace(/\.[^.]+$/, "")); }} /></label>
          <label>Name<input value={uploadName} onChange={(event) => setUploadName(event.target.value)} maxLength={80} placeholder="Goblin" /></label>
          <label>Folder<input value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} maxLength={60} placeholder="Optional" list="token-folder-list" /></label>
          <datalist id="token-folder-list">{folders.map((name) => <option key={name} value={name} />)}</datalist>
          <button disabled={busy || !file}>Upload &amp; use</button>
        </form>

        <div className="token-library-filters" role="group" aria-label="Filter tokens">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tokens" aria-label="Search tokens" />
          <select value={folder} onChange={(event) => setFolder(event.target.value)} aria-label="Folder">
            <option value="all">All folders</option>
            <option value="__unfiled">Unfiled</option>
            {folders.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        {message && <p className="token-library-feedback" role="status">{message}</p>}

        {rememberedAsset && <section className="token-library-section" aria-label="Previously used for this creature">
          <h3>Previously used</h3>
          <div className="token-grid"><TokenThumb asset={rememberedAsset} gmToken={gmToken} remembered selected={currentAssetId === rememberedAsset.id} onPick={() => assign(rememberedAsset.id)} /></div>
        </section>}

        <section className="token-library-section">
          <h3>Library</h3>
          {visible.length === 0
            ? <p className="token-library-empty">{assets.length === 0 ? "No token images yet. Upload one above." : "No tokens match this filter."}</p>
            : <div className="token-grid">{visible.map((asset) => <TokenThumb key={asset.id} asset={asset} gmToken={gmToken} remembered={asset.id === remembered} selected={currentAssetId === asset.id} onPick={() => assign(asset.id)} />)}</div>}
        </section>

  </Modal>;
}
