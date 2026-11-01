import { Button } from "@vtt/ui";
import { countOf } from "@vtt/domain";
import { replayTitle, useReplays } from "./replays";
import "./replay.css";

/** The shelf shows four cards; past that, All replays opens the whole list. */
const SHELF_SIZE = 4;

/**
 * The player's shelf (E3 replays spec 2.5): REPLAYS · {N} under the sheet, then the shared replays as cards two to a
 * row, each with its name, its turns and Watch. Renders nothing when the GM has shared none. A player's list never
 * carries the encounter's own name, so a card reads the GM's name or "Encounter" with the day.
 */
export function ReplayShelf({
  token,
  onOpen,
  onAll
}: Readonly<{ token: string; onOpen: (archiveId: number) => void; onAll: () => void }>) {
  const { archives } = useReplays(token);
  if (!archives || archives.length === 0) return null;
  const shown = archives.slice(0, SHELF_SIZE);
  return (
    <section className="replay-shelf" aria-labelledby="replay-shelf-head">
      <h3 id="replay-shelf-head" className="replay-shelf-head">
        Replays · <span className="tabular">{archives.length}</span>
      </h3>
      <ul className="replay-shelf-cards">
        {shown.map((archive) => (
          <li key={archive.id} className="replay-shelf-card">
            <b className="replay-shelf-name">{replayTitle(archive)}</b>
            <span className="replay-shelf-turns tabular">{countOf(archive.turnCount, "turn")}</span>
            <Button
              size="sm"
              variant="primary"
              aria-label={`Watch ${replayTitle(archive)}`}
              onClick={() => onOpen(archive.id)}
            >
              Watch
            </Button>
          </li>
        ))}
      </ul>
      {archives.length > SHELF_SIZE && (
        <Button variant="ghost" className="replay-shelf-all" onClick={onAll}>
          All replays · {archives.length}
        </Button>
      )}
    </section>
  );
}
