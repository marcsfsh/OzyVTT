import { useToast } from "@vtt/ui";
import { usePrompt } from "../components/feedback";
import { apiRequest } from "../lib/api";
import type { MapAsset, MapKind } from "./map-catalog";

/**
 * What can be done to a map from its row or its page: rename it, change its type, and file it in a folder. Each is one
 * write to the library, read back after. Render `dialog` once.
 */
export function useMapActions(token: string, reload: () => Promise<unknown>) {
  const { prompt, dialog } = usePrompt();
  const { toast } = useToast();
  const patch = async (
    map: MapAsset,
    details: Readonly<{ name?: string; kind?: MapKind; folder?: string | null }>,
    done: string
  ) => {
    try {
      await apiRequest(`/api/v1/map-assets/${map.id}`, {
        token,
        method: "PATCH",
        body: details,
        failure: "The map could not be changed."
      });
      await reload();
      toast(done, { tone: "success" });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    }
  };
  const rename = async (map: MapAsset) => {
    const next = await prompt({ title: "Rename map", defaultValue: map.name, confirmLabel: "Rename" });
    if (next && next.trim() && next.trim() !== map.name) await patch(map, { name: next.trim() }, "Map renamed.");
  };
  const setFolder = (map: MapAsset, folder: string | null) =>
    patch(map, { folder }, folder ? `Moved to ${folder}.` : "Taken out of its folder.");
  const newFolder = async (map: MapAsset) => {
    const folder = await prompt({
      title: "New folder",
      body: "Move this map to a new folder.",
      placeholder: "Folder name",
      confirmLabel: "Move"
    });
    if (folder?.trim()) await setFolder(map, folder.trim());
  };
  const setKind = (map: MapAsset, kind: MapKind) => patch(map, { kind }, "Map type changed.");
  /** Choose's Move to (E2 spec 2.3): one write for each chosen map in turn, then one read of the library. */
  const moveMany = async (chosen: readonly MapAsset[], folder: string | null) => {
    try {
      for (const map of chosen)
        await apiRequest(`/api/v1/map-assets/${map.id}`, {
          token,
          method: "PATCH",
          body: { folder },
          failure: "The map could not be changed."
        });
      await reload();
      const count = `${chosen.length} ${chosen.length === 1 ? "map" : "maps"}`;
      toast(folder ? `Moved ${count} to ${folder}.` : `Took ${count} out of their folder.`, { tone: "success" });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    }
  };
  /** Asks a new folder's name for Choose's Move to. */
  const askFolder = () =>
    prompt({
      title: "New folder",
      body: "Move the chosen maps to a new folder.",
      placeholder: "Folder name",
      confirmLabel: "Move"
    });
  return { rename, setFolder, newFolder, setKind, moveMany, askFolder, dialog };
}

/** The folders in use, in order, for pickers and filters. */
export function folderNamesOf(maps: readonly MapAsset[]): string[] {
  return [...new Set(maps.map((map) => map.folder).filter((folder): folder is string => folder !== null))].sort(
    (a, b) => a.localeCompare(b)
  );
}
