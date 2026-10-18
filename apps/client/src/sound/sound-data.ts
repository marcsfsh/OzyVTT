import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundBoard, SoundBoardView } from "@vtt/domain";
import { useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { command, read, type CommandEvent, type CommandPayload } from "../lib/command";
import { socket } from "../socket";

/** One sound in the GM's library, as the sound routes send it. */
export type SoundAsset = Readonly<{
  id: string;
  name: string;
  originalName: string;
  format: string;
  codec: string;
  mediaType: string;
  durationMs: number;
  byteLength: number;
  importedAt: string;
  updatedAt: string;
}>;

const LIBRARY = "/api/v1/sound-assets";
const failure = "The sound library could not be reached.";

/** Newer of two board views: by the board's revision, then by the server's clock (a screen's change keeps the
 *  revision). */
const newer = (current: SoundBoardView | null, next: SoundBoardView) =>
  current &&
  (current.revision > next.revision || (current.revision === next.revision && current.serverTime > next.serverTime))
    ? current
    : next;

/** The sound board, live: read when the socket (re)connects, then every `sound:changed` sent to the GM. */
export function useSoundBoard(): SoundBoardView | null {
  const [view, setView] = useState<SoundBoardView | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      void read("sound:board", {}).then((reply) => {
        if (active && reply.ok && reply.view) setView((current) => newer(current, reply.view!));
      });
    const onChanged = (next: SoundBoardView) => setView((current) => newer(current, next));
    socket.on("sound:changed", onChanged);
    socket.on("connect", load);
    load();
    return () => {
      active = false;
      socket.off("sound:changed", onChanged);
      socket.off("connect", load);
    };
  }, []);
  return view;
}

/** The GM's library of uploaded sounds, with the calls that change it. */
export function useSoundLibrary(token: string) {
  const [sounds, setSounds] = useState<readonly SoundAsset[] | null>(null);
  const refresh = useCallback(async () => {
    const data = await apiRequest<{ sounds: readonly SoundAsset[] }>(LIBRARY, { token, failure });
    setSounds(data.sounds);
  }, [token]);
  useEffect(() => {
    void refresh().catch(() => setSounds([]));
  }, [refresh]);
  const upload = useCallback(
    async (file: File) => {
      const query = new URLSearchParams({ filename: file.name, name: file.name.replace(/\.[^.]+$/, "") });
      const data = await apiRequest<{ sound: SoundAsset; duplicate: boolean }>(`${LIBRARY}?${query}`, {
        token,
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
        failure
      });
      await refresh();
      return data;
    },
    [token, refresh]
  );
  const rename = useCallback(
    async (id: string, name: string) => {
      await apiRequest(`${LIBRARY}/${id}`, { token, method: "PATCH", body: { name }, failure });
      await refresh();
    },
    [token, refresh]
  );
  const remove = useCallback(
    async (id: string) => {
      await apiRequest(`${LIBRARY}/${id}`, { token, method: "DELETE", failure });
      await refresh();
    },
    [token, refresh]
  );
  return { sounds, refresh, upload, rename, remove };
}

/** Sends a sound command; a refusal becomes a toast. Resolves true when the server took it. */
export function useSoundCommand() {
  const { toast } = useToast();
  return useCallback(
    async <E extends CommandEvent>(event: E, payload: CommandPayload<E>) => {
      const reply = await command(event, payload);
      if (!reply.ok) toast(reply.message ?? "The sound board didn't take that.", { tone: "error" });
      return reply.ok;
    },
    [toast]
  );
}

export type SendSound = ReturnType<typeof useSoundCommand>;

/** Whether anything sounds on the table screen now (or would, but for a pause). */
export function isSounding(board: SoundBoard) {
  return board.music.current !== null || board.ambient.some((layer) => layer.playing) || board.fired.length > 0;
}

/** Play the playlist, or pause and resume everything: the one action the table's sound needs most. */
export function playOrPause(board: SoundBoard, send: SendSound) {
  if (board.pausedAt !== null) return send("sound:pause", { paused: false });
  if (isSounding(board)) return send("sound:pause", { paused: true });
  return send("sound:play", { target: "music" });
}

/**
 * A level the GM drags: shown as it moves, sent to the table a few times a second while dragging (so the room
 * hears it change) and once more when let go. The dragged value stays on show until the board comes back with it.
 */
export function useLevel(saved: number, send: (level: number) => void) {
  const [local, setLocal] = useState<number | null>(null);
  const lastSentAt = useRef(0);
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    if (local === null) return;
    if (Math.abs(saved - local) < 0.005) return setLocal(null);
    // A refused or lost change gives way to the board's level after a moment.
    const timer = setTimeout(() => setLocal(null), 3_000);
    return () => clearTimeout(timer);
  }, [saved, local]);
  const change = (level: number) => {
    setLocal(level);
    const now = Date.now();
    if (now - lastSentAt.current > 300) {
      lastSentAt.current = now;
      lastSent.current = level;
      send(level);
    }
  };
  const commit = (level: number) => {
    if (level !== (lastSent.current ?? saved)) send(level);
    lastSent.current = null;
    lastSentAt.current = 0;
  };
  return { value: local ?? saved, change, commit };
}

/** "3:05" for a sound's length. */
export function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
