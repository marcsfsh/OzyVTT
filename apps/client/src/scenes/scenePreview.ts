import { useSyncExternalStore } from "react";

/**
 * Which prepared scene the GM is privately previewing/staging, if any. This is a purely local GM
 * concern — it never touches the server or the players' view; it only decides which scene the GM's own
 * battle map renders for arranging tokens. Cleared when the GM closes the preview or a scene goes live.
 * A module store (like the targeting store) so the ScenePanel and the main table view stay in sync.
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
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => previewSceneId,
    () => previewSceneId
  );
}
