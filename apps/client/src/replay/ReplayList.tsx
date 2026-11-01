import { useState } from "react";
import { Button, IconChevronLeft, IconEye, IconEyeOff, RevealSwitch, EmptyState } from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { durationOf, replayMeta, replayTitle, useReplays } from "./replays";
import { useReplayActions } from "./ReplayActions";
import "./replay.css";

export function ReplayList({
  role,
  token,
  onOpen,
  onBack
}: Readonly<{
  role: "gm" | "player";
  token: string;
  onOpen: (archiveId: number) => void;
  /** A player reaches this list at its own address, so its way back to the table is a frame row. */
  onBack?: () => void;
}>) {
  const { archives, error, refresh } = useReplays(token);
  const { busy, setShared, more, dialogs } = useReplayActions(token, refresh);
  const phone = useMediaQuery("(max-width: 760px)");
  const [chosenId, setChosenId] = useState<number | null>(null);
  const chosen = archives?.find((archive) => archive.id === chosenId) ?? archives?.[0] ?? null;

  /* Heading (and the player's way back) stay fixed; the rows are the one scroll region. Rows are
     plain `<li>`s with rules drawn in `replay.css`, and no cards. */
  return (
    <section className="replay-panel replay-list-page pane-frame pane-scene frame-col anim-view">
      {/* The GM's list sits under Prep's bar, which names it, so it has no title row (theme spec 2.2). A player's page
          is below the table, so it keeps Back and its own name (rule 12). */}
      {role === "player" ? (
        <header className="replay-list-head">
          {onBack && (
            <Button variant="ghost" className="replay-list-back" onClick={onBack}>
              <IconChevronLeft /> Back to the table
            </Button>
          )}
          <h2>Replays</h2>
          {/* Why their list may be short. */}
          <p>The encounters your GM has shared with the party.</p>
          {error && <p className="replay-error">{error}</p>}
        </header>
      ) : (
        error && <p className="replay-error">{error}</p>
      )}
      <div className="replay-list-body scroll-y frame-fill">
        {archives === null && <p>Loading replays…</p>}
        {/* No door: the list fills itself when a fight ends. */}
        {archives !== null && archives.length === 0 && !error && (
          <EmptyState>
            {role === "gm"
              ? "No replays yet. Every encounter that ends is kept here."
              : "Your GM hasn't shared an encounter yet."}
          </EmptyState>
        )}
        {archives !== null && archives.length > 0 && (
          <div className="replay-split">
            {/* The list as a table (E3 replays spec 2.1), newest first; the chosen row is lit and its replay sits
                beside it on a laptop. A phone's row opens the replay's page. */}
            <table className="replay-table">
              <thead>
                <tr>
                  <th scope="col">Replay</th>
                  <th scope="col">Fought</th>
                  <th scope="col">Turns</th>
                  <th scope="col">Length</th>
                  {role === "gm" && (
                    <th scope="col">
                      <span className="nh-sr-only">Players see it</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {archives.map((archive) => (
                  <tr key={archive.id} className={chosen?.id === archive.id ? "is-on" : undefined}>
                    <td>
                      <button
                        type="button"
                        className="replay-table-open interactive"
                        aria-pressed={chosen?.id === archive.id}
                        onClick={() => (phone ? onOpen(archive.id) : setChosenId(archive.id))}
                      >
                        <b>{replayTitle(archive)}</b>
                        {archive.name && archive.encounterName && <small>{archive.encounterName}</small>}
                      </button>
                    </td>
                    <td className="tabular">{new Date(archive.endedAt).toLocaleDateString()}</td>
                    <td className="tabular">{archive.turnCount}</td>
                    <td className="tabular">{durationOf(archive.startedAt, archive.endedAt) ?? "Unknown"}</td>
                    {role === "gm" && (
                      <td>
                        {archive.playerVisible ? (
                          <>
                            <IconEye />
                            <span className="nh-sr-only">Players see it</span>
                          </>
                        ) : (
                          <>
                            <IconEyeOff />
                            <span className="nh-sr-only">Hidden from players</span>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!phone && chosen && (
              <aside className="replay-beside" aria-label={replayTitle(chosen)}>
                <div className="replay-beside-head">
                  <h3>{replayTitle(chosen)}</h3>
                  {role === "gm" && more(chosen)}
                </div>
                <p className="replay-beside-line tabular">{replayMeta(chosen)}</p>
                {role === "gm" && (
                  <span className="replay-beside-reveal">
                    <RevealSwitch
                      revealed={chosen.playerVisible}
                      ariaLabel="Show this replay to players"
                      disabled={busy === chosen.id}
                      onChange={(shared) => void setShared(chosen, shared)}
                    />
                    <span aria-hidden="true">{chosen.playerVisible ? "Players see it" : "Hidden from players"}</span>
                  </span>
                )}
                <Button variant="primary" onClick={() => onOpen(chosen.id)}>
                  Watch
                </Button>
              </aside>
            )}
          </div>
        )}
      </div>
      {dialogs}
    </section>
  );
}
