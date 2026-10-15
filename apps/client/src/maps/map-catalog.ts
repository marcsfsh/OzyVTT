import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import type { MapSelection } from "./MapManager";
import { socket } from "../socket";

/**
 * The map catalog shared by every prep surface: id, name, kind, folder, geometry, and whether its
 * grid is set (i.e. whether tokens will snap).
 */

export type PickerMap = MapSelection & Readonly<{ folder: string | null }>;

export type Point = Readonly<{ x: number; y: number }>;
export type MapKind = "battlemap" | "regional" | "world";
/** One library row as the server sends it. */
export type MapAsset = Readonly<{
  id: string;
  name: string;
  kind: MapKind;
  folder: string | null;
  originalName: string;
  format: string;
  mediaType: string;
  width: number;
  height: number;
  byteLength: number;
  importedAt: string;
  calibration: Readonly<{
    calibration: Readonly<{ origin: Point; cellSizePx: number; rotationRadians: number; distancePerCell: number }>;
    verificationErrorPx: number;
  }> | null;
  scale: Readonly<{ kind: "image-scale"; distancePerPixel: number; unit: string }> | null;
}>;

/**
 * The session's bearer token for the map endpoints. The GM's token lives in shell state and is also
 * handed to the socket on sign-in, so a component not passed a token reads the credential its live
 * connection already uses. An explicit token argument always wins.
 */
export function sessionToken(): string | null {
  const auth = socket.auth as { token?: string } | undefined;
  return typeof auth?.token === "string" && auth.token.length > 0 ? auth.token : null;
}

const failure = "The map library could not be reached.";
type AssetRow = PickerMap & Readonly<{ folder?: string | null }>;

/** The picker's fields of one asset row; the server's row carries more (file details, timestamps). */
const pickerMapOf = (asset: AssetRow): PickerMap => ({
  id: asset.id,
  name: asset.name,
  kind: asset.kind,
  folder: asset.folder ?? null,
  width: asset.width,
  height: asset.height,
  calibration: asset.calibration,
  scale: asset.scale
});

/** Every map in the library. */
export async function listMaps(bearer: string): Promise<readonly PickerMap[]> {
  const data = await apiRequest<{ assets: readonly AssetRow[] }>("/api/v1/map-assets", { token: bearer, failure });
  return data.assets.map(pickerMapOf);
}

export type MapCatalog = Readonly<{
  /** `null` until the first fetch settles ("not known yet", distinct from "no maps"). */
  maps: readonly PickerMap[] | null;
  /** Refetch; resolves with the asset named by `preferId` once it is in the new list. */
  reload: (preferId?: string) => Promise<PickerMap | undefined>;
  /** The token actually in use (explicit argument, else the session's). */
  token: string | null;
  error: string | null;
}>;

export function useMapCatalog(token?: string | null): MapCatalog {
  const bearer = token ?? sessionToken();
  const [maps, setMaps] = useState<readonly PickerMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    async (preferId?: string) => {
      if (!bearer) return undefined;
      const rows = await listMaps(bearer);
      setMaps(rows);
      return preferId ? rows.find((row) => row.id === preferId) : undefined;
    },
    [bearer]
  );
  useEffect(() => {
    void reload().catch((failure: Error) => setError(failure.message));
  }, [reload]);
  return { maps, reload, token: bearer, error };
}

/** POST an image to the library. Returns the created (or deduplicated) asset row. */
export async function uploadMap(
  bearer: string,
  file: File,
  kind: MapSelection["kind"]
): Promise<{ asset: PickerMap; duplicate: boolean }> {
  const query = new URLSearchParams({ filename: file.name, name: file.name.replace(/\.[^.]+$/, ""), kind });
  const data = await apiRequest<{ asset: AssetRow; duplicate?: boolean }>(`/api/v1/map-assets?${query}`, {
    token: bearer,
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
    failure
  });
  return { asset: pickerMapOf(data.asset), duplicate: data.duplicate === true };
}
