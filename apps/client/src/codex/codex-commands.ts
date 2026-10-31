import { useSyncExternalStore } from "react";

/** The GM Codex's creates, which the one search offers as rows while the Codex is mounted (it owns QuickCreate and
 *  the session and quest feeds the creates need). */
export type CodexCommands = Readonly<{
  createPage: (title: string) => void;
  createSession: () => void;
  createQuest: () => void;
}>;

let current: CodexCommands | null = null;
const listeners = new Set<() => void>();

/** Registers the mounted Codex's creates; returns the call that removes them again. */
export function provideCodexCommands(commands: CodexCommands): () => void {
  current = commands;
  listeners.forEach((listener) => listener());
  return () => {
    if (current !== commands) return;
    current = null;
    listeners.forEach((listener) => listener());
  };
}

export function useCodexCommands(): CodexCommands | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}
