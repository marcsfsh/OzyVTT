import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Input, Modal, RevealSwitch, Select, useToast } from "@vtt/ui";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { useTokenImageUrl } from "./tokenImages";
import "./tokens.css";

/**
 * **The token picker (A11 / D18 / ruling R1).** One component, two roles.
 *
 * A player sets the token for their OWN claimed character: browse the shelf the GM offers, or upload an
 * image. There is **no approval step** — the GM curates the shelf, they do not vet the choice. A GM sets
 * anyone's, keeps the folder filter and the per-definition memory, and carries the reveal control on
 * every tile: that switch is R1's curation, deciding whether players are OFFERED that image, and it is
 * the only thing on this surface that is GM-only.
 *
 * Two guards are the server's, and this component leans on them rather than re-deciding:
 *  - the LISTING is filtered server-side (`token-catalog.ts` `list("player")`), so a hidden entry never
 *    reaches a player's browser to be filtered out here;
 *  - `actor.set-token-image` runs the same `canInitiateForActor` check every player-initiated command
 *    does, so "own claimed character only" has one definition and it is not in this file.
 */

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
  /** GM-only curation flag (R1). A player's listing never carries a hidden entry at all. */
  hidden?: boolean;
}>;

async function api(path: string, bearer: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${bearer}`, ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "That token request was refused.");
  return body.data;
}

function TokenThumb({ asset, bearer, remembered, selected, onPick, reveal }: Readonly<{
  asset: TokenAsset;
  bearer: string;
  remembered: boolean;
  selected: boolean;
  onPick: () => void;
  /** GM only: R1 curation for this one entry. Absent for a player. */
  reveal?: (shown: boolean) => void;
}>) {
  const url = useTokenImageUrl(asset.id, bearer);
  return <div className={`token-tile${selected ? " selected" : ""}`}>
    <button type="button" className="token-thumb lift" onClick={onPick} aria-pressed={selected} title={asset.name}>
      <span className="token-thumb-image">{url ? <img src={url} alt="" /> : <span className="token-thumb-placeholder" aria-hidden="true" />}</span>
      <span className="token-thumb-name">{asset.name}</span>
      {remembered && <Badge className="token-thumb-badge" tone="primary" solid>Recent</Badge>}
    </button>
    {reveal && <RevealSwitch revealed={asset.hidden !== true} ariaLabel={`Show ${asset.name} to players`} onChange={reveal} className="token-tile-reveal" />}
  </div>;
}

export function TokenLibrary({ actorId, actorName, definitionId, currentAssetId, token, gmToken, role = "gm", onClose }: Readonly<{
  actorId: string;
  actorName: string;
  definitionId?: string | null;
  currentAssetId?: string | null;
  /** The caller's bearer: the GM session token, or the player's own session token. */
  token?: string;
  /** @deprecated The picker is no longer GM-only; pass `token` + `role`. Kept so the token menu's
      existing call site keeps working untouched — it is a GM surface either way. */
  gmToken?: string;
  role?: "gm" | "player";
  onClose: () => void;
}>) {
  const bearer = token ?? gmToken ?? "";
  const { toast } = useToast();
  const [assets, setAssets] = useState<readonly TokenAsset[]>([]);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [uploadFolder, setUploadFolder] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const query = definitionId && role === "gm" ? `?definitionId=${encodeURIComponent(definitionId)}` : "";
    const data = await api(`/api/v1/token-assets${query}`, bearer);
    setAssets(data.tokens);
    setRemembered(data.rememberedAssetId ?? null);
  };
  useEffect(() => { void refresh().catch((error: Error) => setMessage(error.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bearer, definitionId]);

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
      if (result.ok) { toast(tokenAssetId ? `${actorName}'s token is set.` : `${actorName}'s token image is cleared.`, { tone: "success" }); onClose(); }
      else setMessage(result.message ?? "That token image could not be assigned.");
    });
  };

  /** Upload lands, is assigned, and closes — one gesture, D18's "no approval step" taken literally. */
  const upload = async (file: File) => {
    setBusy(true); setMessage("");
    try {
      const params = new URLSearchParams({ filename: file.name, name: file.name.replace(/\.[^.]+$/, "") });
      // A player never chooses a folder: the server files their upload on one shelf the GM can curate.
      if (role === "gm" && uploadFolder.trim()) params.set("folder", uploadFolder.trim());
      const data = await api(`/api/v1/token-assets?${params}`, bearer, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      await refresh();
      assign(data.token.id);
    } catch (error) { setBusy(false); setMessage((error as Error).message); }
  };

  /** R1: curate one entry. GM only — the route refuses anyone else, and this control is not rendered. */
  const setHidden = async (asset: TokenAsset, shown: boolean) => {
    setAssets((current) => current.map((entry) => entry.id === asset.id ? { ...entry, hidden: !shown } : entry));
    try { await api(`/api/v1/token-assets/${asset.id}`, bearer, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: !shown }) }); }
    catch (error) { setMessage((error as Error).message); await refresh().catch(() => {}); }
  };

  return <Modal
    open
    onClose={onClose}
    size="lg"
    className="token-library"
    title={`Token image — ${actorName}`}
    ariaLabel={`Token image for ${actorName}`}
    footer={<>
      {currentAssetId && <Button variant="ghost" disabled={busy} onClick={() => assign(null)}>Remove image</Button>}
      <Button variant="secondary" disabled={busy} onClick={onClose}>Done</Button>
    </>}
  >
    <div className="token-library-filters" role="group" aria-label="Find a token">
      <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tokens" aria-label="Search tokens" />
      {folders.length > 0 && <Select value={folder} onChange={(event) => setFolder(event.target.value)} aria-label="Folder">
        <option value="all">All folders</option>
        <option value="__unfiled">Unfiled</option>
        {folders.map((name) => <option key={name} value={name}>{name}</option>)}
      </Select>}
      {role === "gm" && <Input value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} maxLength={60} placeholder="Upload into folder (optional)" aria-label="Upload into folder" list="token-folder-list" />}
      <datalist id="token-folder-list">{folders.map((name) => <option key={name} value={name} />)}</datalist>
    </div>

    {message && <p className="token-library-feedback" role="status">{message}</p>}

    {rememberedAsset && role === "gm" && <section className="token-library-section" aria-label="Previously used for this character or monster">
      <h3>Previously used</h3>
      <div className="token-grid"><TokenThumb asset={rememberedAsset} bearer={bearer} remembered selected={currentAssetId === rememberedAsset.id} onPick={() => assign(rememberedAsset.id)} /></div>
    </section>}

    <section className="token-library-section">
      <h3>Library</h3>
      <div className="token-grid">
        {/* Upload is the FIRST tile, not a form above the grid: picking a picture and making a picture
            are the same decision, so they sit in the same row of choices (D5's shape, D18's surface). */}
        <button type="button" className="token-thumb token-thumb-upload lift" disabled={busy} onClick={() => fileRef.current?.click()}>
          <span className="token-thumb-image"><span className="token-upload-mark" aria-hidden="true" /></span>
          <span className="token-thumb-name">Upload an image</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          className="token-upload-input"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }}
        />
        {visible.map((asset) => <TokenThumb
          key={asset.id}
          asset={asset}
          bearer={bearer}
          remembered={asset.id === remembered}
          selected={currentAssetId === asset.id}
          onPick={() => assign(asset.id)}
          {...(role === "gm" ? { reveal: (shown: boolean) => void setHidden(asset, shown) } : {})}
        />)}
      </div>
      {assets.length > 0 && visible.length === 0 && <p className="token-library-empty">No tokens match this filter.</p>}
      {assets.length === 0 && <p className="token-library-empty">{role === "gm" ? "No token images yet — upload one to give this creature a token." : "Your GM hasn't shared any token images yet. Upload your own instead."}</p>}
    </section>
  </Modal>;
}
