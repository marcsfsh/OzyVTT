import { useSyncExternalStore } from "react";

/**
 * Which prepared scene the GM is privately staging, if any. Local to the GM: it never touches the
 * server or players; it only decides which scene the GM's own map renders. A module store so the
 * scene panel and the table view stay in sync.
 */
let previewSceneId: string | null = null;
const listeners = new Set<() => void>();

export function setPreviewScene(sceneId: string | null) {
  if (previewSceneId === sceneId) return;
  previewSceneId = sceneId;
  for (const listener of listeners) listener();
}

export function usePreviewScene(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => previewSceneId,
    () => previewSceneId
  );
}
