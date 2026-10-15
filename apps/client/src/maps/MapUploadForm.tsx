import { useRef, useState } from "react";
import { Button, IconPlus, Input, Select, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import type { MapAsset, MapKind } from "./map-catalog";

/**
 * The library's upload row: one "Add map…" file button; name, type and folder fields appear once a
 * file is chosen.
 */
export function MapUploadForm({
  gmToken,
  folderNames,
  onUploaded
}: Readonly<{
  gmToken: string;
  folderNames: readonly string[];
  /** The new (or already uploaded) map, for the library to select. */
  onUploaded: (mapId: string) => Promise<void>;
}>) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MapKind>("battlemap");
  const [uploadFolder, setUploadFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return toast("Choose an image first.", { tone: "error" });
    setBusy(true);
    try {
      const query = new URLSearchParams({ filename: file.name, name: name || file.name.replace(/\.[^.]+$/, ""), kind });
      if (uploadFolder.trim()) query.set("folder", uploadFolder.trim());
      const data = await apiRequest<{ asset: MapAsset; duplicate: boolean }>(`/api/v1/map-assets?${query}`, {
        token: gmToken,
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
        failure: "Map request failed."
      });
      setFile(null);
      setName("");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      await onUploaded(data.asset.id);
      toast(
        data.duplicate
          ? "That image was already uploaded; the existing map is selected."
          : "Map uploaded — set its grid below.",
        { tone: "success" }
      );
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* The upload row: one "Add map…" file button; name/type/folder fields appear once a file is
            chosen. The class says a file is chosen and the CSS decides how that lays out. */}
      <form className={`map-upload${file ? " has-file" : ""}`} onSubmit={upload}>
        <Button
          variant={file ? "secondary" : "primary"}
          className="map-upload-file"
          onClick={() => uploadInputRef.current?.click()}
        >
          <IconPlus /> {file ? file.name : "Add map…"}
        </Button>
        <input
          ref={uploadInputRef}
          className="map-upload-input"
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            if (next && !name) setName(next.name.replace(/\.[^.]+$/, ""));
          }}
        />
        <div className="map-upload-details">
          <label>
            Map name <span className="map-upload-optional">(optional)</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="Ruined Keep"
            />
          </label>
          <label>
            Map type
            <Select value={kind} onChange={(event) => setKind(event.target.value as MapKind)}>
              <option value="battlemap">Battle map</option>
              <option value="regional">Regional map</option>
              <option value="world">World map</option>
            </Select>
          </label>
          <label>
            Folder
            <Input
              value={uploadFolder}
              onChange={(event) => setUploadFolder(event.target.value)}
              maxLength={60}
              placeholder="Optional"
              list="map-folder-list"
            />
          </label>
          <datalist id="map-folder-list">
            {folderNames.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          <Button variant="primary" type="submit" disabled={busy || !file}>
            Upload map
          </Button>
        </div>
      </form>
    </>
  );
}
