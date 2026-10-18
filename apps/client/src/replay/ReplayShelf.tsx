import { replayMeta, replayTitle, useReplays } from "./replays";
import "./replay.css";

/**
 * The player's shelf: the shared replays as a quiet section under their sheet. Renders nothing when
 * the GM has shared none.
 */
export function ReplayShelf({ token, onOpen }: Readonly<{ token: string; onOpen: (archiveId: number) => void }>) {
  const { archives } = useReplays(token);
  if (!archives || archives.length === 0) return null;
  return (
    <section className="replay-shelf">
      <h3>Replays</h3>
      <ul>
        {archives.map((archive) => (
          <li key={archive.id}>
            <button type="button" className="replay-shelf-row" onClick={() => onOpen(archive.id)}>
              <span>{replayTitle(archive)}</span>
              <span className="replay-shelf-meta tabular">{replayMeta(archive)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
