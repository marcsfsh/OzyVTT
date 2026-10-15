import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Input, Modal, RevealSwitch, Select, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { command } from "../lib/command";
import { useTokenImageUrl } from "./tokenImages";
import "./tokens.css";

/**
 * The token picker, for both roles. A player sets the token for their own claimed character (shelf
 * image or upload, no approval step); a GM sets anyone's and also controls which images are offered
 * to players. The server filters the listing by role and checks actor ownership on
 * `actor.set-token-image`; this component does not re-decide either.
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
  /** GM-only curation flag; a player's listing never carries a hidden entry. */
  hidden?: boolean;
}>;

const failure = "That token request was refused.";

function TokenThumb({
  asset,
  bearer,
  remembered,
  selected,
  onPick,
  reveal
}: Readonly<{
  asset: TokenAsset;
  bearer: string;
  remembered: boolean;
  selected: boolean;
  onPick: () => void;
  /** GM only: show or hide this entry for players. Absent for a player. */
  reveal?: (shown: boolean) => void;
}>) {
  const url = useTokenImageUrl(asset.id, bearer);
  return (
    <div className={`token-tile${selected ? " selected" : ""}`}>
      <button type="button" className="token-thumb lift" onClick={onPick} aria-pressed={selected} title={asset.name}>
        <span className="token-thumb-image">
          {url ? <img src={url} alt="" /> : <span className="token-thumb-placeholder" aria-hidden="true" />}
        </span>
        <span className="token-thumb-name">{asset.name}</span>
        {remembered && (
          <Badge className="token-thumb-badge" tone="primary" solid>
            Recent
          </Badge>
        )}
      </button>
      {reveal && (
        <RevealSwitch
          revealed={asset.hidden !== true}
          ariaLabel={`Show ${asset.name} to players`}
          onChange={reveal}
          className="token-tile-reveal"
        />
      )}
    </div>
  );
}

export function TokenLibrary({
  actorId,
  actorName,
  definitionId,
  currentAssetId,
  token,
  gmToken,
  role = "gm",
  onClose
}: Readonly<{
  actorId: string;
  actorName: string;
  definitionId?: string | null;
  currentAssetId?: string | null;
  /** The caller's bearer: the GM session token, or the player's own session token. */
  token?: string;
  /** @deprecated Pass `token` + `role`. Kept for the token menu's existing GM call site. */
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
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const query = definitionId && role === "gm" ? `?definitionId=${encodeURIComponent(definitionId)}` : "";
    const data = await apiRequest<{ tokens: readonly TokenAsset[]; rememberedAssetId?: string | null }>(
      `/api/v1/token-assets${query}`,
      { token: bearer, failure }
    );
    setAssets(data.tokens);
    setRemembered(data.rememberedAssetId ?? null);
  }, [bearer, definitionId, role]);
  useEffect(() => {
    void refresh().catch((error: Error) => toast(error.message, { tone: "error" }));
  }, [refresh, toast]);

  const folders = useMemo(
    () =>
      Array.from(new Set(assets.map((asset) => asset.folder).filter((value): value is string => value !== null))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [assets]
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assets.filter(
      (asset) =>
        (folder === "all" || (folder === "__unfiled" ? asset.folder === null : asset.folder === folder)) &&
        (needle === "" || asset.name.toLowerCase().includes(needle))
    );
  }, [assets, search, folder]);
  const rememberedAsset = remembered ? (assets.find((asset) => asset.id === remembered) ?? null) : null;

  const assign = async (tokenAssetId: string | null) => {
    setBusy(true);
    const result = await command("actor:set-token-image", { actorId, tokenAssetId });
    setBusy(false);
    if (result.ok) {
      toast(tokenAssetId ? `${actorName}'s token is set.` : `${actorName}'s token image is cleared.`, {
        tone: "success"
      });
      onClose();
    } else toast(result.message ?? "That token image could not be assigned.", { tone: "error" });
  };

  /** Upload, assign and close in one gesture. */
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ filename: file.name, name: file.name.replace(/\.[^.]+$/, "") });
      // A player never chooses a folder: the server files their upload on one shelf the GM can curate.
      if (role === "gm" && uploadFolder.trim()) params.set("folder", uploadFolder.trim());
      const data = await apiRequest<{ token: TokenAsset }>(`/api/v1/token-assets?${params}`, {
        token: bearer,
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
        failure
      });
      await refresh();
      await assign(data.token.id);
    } catch (error) {
      setBusy(false);
      toast((error as Error).message, { tone: "error" });
    }
  };

  /** GM only: the route refuses anyone else, and the control is not rendered for players. */
  const setHidden = async (asset: TokenAsset, shown: boolean) => {
    setAssets((current) => current.map((entry) => (entry.id === asset.id ? { ...entry, hidden: !shown } : entry)));
    try {
      await apiRequest(`/api/v1/token-assets/${asset.id}`, {
        token: bearer,
        method: "PATCH",
        body: { hidden: !shown },
        failure
      });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
      await refresh().catch(() => {});
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="token-library"
      title={`Token image — ${actorName}`}
      ariaLabel={`Token image for ${actorName}`}
      footer={
        <>
          {currentAssetId && (
            <Button variant="ghost" disabled={busy} onClick={() => assign(null)}>
              Remove image
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="token-library-filters" role="group" aria-label="Find a token">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tokens"
          aria-label="Search tokens"
        />
        {folders.length > 0 && (
          <Select value={folder} onChange={(event) => setFolder(event.target.value)} aria-label="Folder">
            <option value="all">All folders</option>
            <option value="__unfiled">Unfiled</option>
            {folders.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        )}
        {role === "gm" && (
          <Input
            value={uploadFolder}
            onChange={(event) => setUploadFolder(event.target.value)}
            maxLength={60}
            placeholder="Upload into folder (optional)"
            aria-label="Upload into folder"
            list="token-folder-list"
          />
        )}
        <datalist id="token-folder-list">
          {folders.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      {rememberedAsset && role === "gm" && (
        <section className="token-library-section" aria-label="Previously used for this character or monster">
          <h3>Previously used</h3>
          <div className="token-grid">
            <TokenThumb
              asset={rememberedAsset}
              bearer={bearer}
              remembered
              selected={currentAssetId === rememberedAsset.id}
              onPick={() => assign(rememberedAsset.id)}
            />
          </div>
        </section>
      )}

      <section className="token-library-section">
        <h3>Library</h3>
        <div className="token-grid">
          {/* Upload is the first tile, in the same row as the choices. */}
          <button
            type="button"
            className="token-thumb token-thumb-upload lift"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <span className="token-thumb-image">
              <span className="token-upload-mark" aria-hidden="true" />
            </span>
            <span className="token-thumb-name">Upload an image</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            className="token-upload-input"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          {visible.map((asset) => (
            <TokenThumb
              key={asset.id}
              asset={asset}
              bearer={bearer}
              remembered={asset.id === remembered}
              selected={currentAssetId === asset.id}
              onPick={() => assign(asset.id)}
              {...(role === "gm" ? { reveal: (shown: boolean) => void setHidden(asset, shown) } : {})}
            />
          ))}
        </div>
        {assets.length > 0 && visible.length === 0 && (
          <p className="token-library-empty">No tokens match this filter.</p>
        )}
        {assets.length === 0 && (
          <p className="token-library-empty">
            {role === "gm"
              ? "No token images yet — upload one to give this creature a token."
              : "Your GM hasn't shared any token images yet. Upload your own instead."}
          </p>
        )}
      </section>
    </Modal>
  );
}
