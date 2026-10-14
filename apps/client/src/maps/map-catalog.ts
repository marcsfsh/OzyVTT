import { useCallback, useEffect, useState } from "react";
import type { MapSelection } from "./MapManager";
import { socket } from "../socket";

/**
 * The map catalog shared by every prep surface: id, name, kind, folder, geometry, and whether its
 * grid is set (i.e. whether tokens will snap).
 */

export type PickerMap = MapSelection & Readonly<{ folder: string | null }>;

/**
 * The session's bearer token for the map endpoints. The GM's token lives in shell state and is also
 * handed to the socket on sign-in, so a component not passed a token reads the credential its live
 * connection already uses. An explicit token argument always wins.
 */
export function sessionToken(): string | null {
  const auth = socket.auth as { token?: string } | undefined;
  return typeof auth?.token === "string" && auth.token.length > 0 ? auth.token : null;
}

async function readBody(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? body?.message ?? "The map library could not be reached.");
  return body.data;
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
      const data = await readBody(
        await fetch("/api/v1/map-assets", { headers: { authorization: `Bearer ${bearer}` } })
      );
      const rows: readonly PickerMap[] = (data.assets as readonly (PickerMap & { folder?: string | null })[]).map(
        (asset) => ({
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          folder: asset.folder ?? null,
          width: asset.width,
          height: asset.height,
          calibration: asset.calibration,
          scale: asset.scale
        })
      );
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
  const data = await readBody(
    await fetch(`/api/v1/map-assets?${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": file.type || "application/octet-stream" },
      body: file
    })
  );
  const asset = data.asset as PickerMap & { folder?: string | null };
  return {
    asset: {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      folder: asset.folder ?? null,
      width: asset.width,
      height: asset.height,
      calibration: asset.calibration,
      scale: asset.scale
    },
    duplicate: data.duplicate === true
  };
}
