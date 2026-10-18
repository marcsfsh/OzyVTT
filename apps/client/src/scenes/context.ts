import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CodexSceneLink, GmView } from "@vtt/domain";
import { CODEX_PATHS } from "@vtt/api-contract";
import { apiRequest } from "../lib/api";
import type { MapAsset } from "../maps/map-catalog";

/** What every view of the Scenes tab reads: the GM's view, the map library, and the Codex links to each scene. */
export type ScenesContextValue = Readonly<{
  state: GmView;
  token: string;
  /** The library with every detail the server sends; null until the first read lands. */
  maps: readonly MapAsset[] | null;
  /** Reads the library again, and tells the rest of the GM's app it changed. */
  reloadMaps: () => Promise<readonly MapAsset[]>;
  /** The Codex sessions and pins that name each scene, by scene id. Empty until read, or when the read fails. */
  links: ReadonlyMap<string, CodexSceneLink>;
  reloadLinks: () => void;
  /** Below 761px: the bottom tab bar, and lists become rows with two facts. */
  phone: boolean;
  /** Below 980px: the workbench stacks and an editor's map becomes a bar that opens full screen. */
  narrow: boolean;
  go: (path: string) => void;
  /** The map the GM opened, for the shared screen's map choice. */
  onOpenMap: (map: MapAsset) => void;
}>;

export const ScenesContext = createContext<ScenesContextValue | null>(null);

export function useScenes(): ScenesContextValue {
  const value = useContext(ScenesContext);
  if (!value) throw new Error("useScenes is used outside the Scenes tab.");
  return value;
}

/** The Codex's links to table scenes. A failed read leaves them empty: the scene pages work without them. */
export function useSceneLinks(token: string) {
  const [links, setLinks] = useState<ReadonlyMap<string, CodexSceneLink>>(new Map());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    apiRequest<{ links: readonly CodexSceneLink[] }>(CODEX_PATHS.sceneLinks, { token })
      .then((data) => {
        if (active) setLinks(new Map(data.links.map((link) => [link.sceneId, link])));
      })
      .catch(() => {
        if (active) setLinks(new Map());
      });
    return () => {
      active = false;
    };
  }, [token, version]);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return { links, reload };
}
