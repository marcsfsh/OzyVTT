import { useSyncExternalStore } from "react";

// Whether the floating preview of the table screen is open. The top bar's Table screen menu, the table screen
// controls and Settings all open the same panel, which the GM's shell draws.
let open = false;
const listeners = new Set<() => void>();

export function setViewerPreviewOpen(next: boolean) {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function useViewerPreviewOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open
  );
}
