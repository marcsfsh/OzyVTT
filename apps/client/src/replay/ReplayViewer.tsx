import { useMemo, useState } from "react";
import type { PlayerHp } from "@vtt/domain";
import { Alert, Button, GmOnlyTag, IconChevronLeft, useToast } from "@vtt/ui";
import { navigate } from "../router";
import { conditionBadgeLabel, healthBandFor } from "../encounter/conditions";
import { useConfirm } from "../components/feedback";
import { command } from "../lib/command";
import { useReplayActions } from "./ReplayActions";
import {
  durationOf,
  replayTitle,
  stepsOf,
  useReplays,
  type ArchiveDocument,
  type PlayerReplayDocument
} from "./replays";
import {
  ReplayFrame,
  ReplayNotice,
  ReplaySide,
  Stage,
  Transport,
  useArchiveDocument,
  usePlayback,
  when
} from "./ReplayStage";
import { countOf } from "@vtt/domain";

/** The launch refusals the panel can route somewhere; any other refusal is a toast. */
const ROUTED_REFUSALS = ["encounter_room_full", "history_review"] as const;
type RoutedRefusal = (typeof ROUTED_REFUSALS)[number];

/** The replay's name from the list this viewer may read, the same name the list shows; "Replay" until it loads. */
function useReplayName(archiveId: number, token: string): string {
  const { archives } = useReplays(token);
  const summary = archives?.find((archive) => archive.id === archiveId);
  return summary ? replayTitle(summary) : "Replay";
}

// The GM viewer

function GmViewer({
  gmToken,
  archiveId,
  onBack,
  onLaunched
}: Readonly<{ gmToken: string; archiveId: number; onBack: () => void; onLaunched: () => void }>) {
  const { document, error } = useArchiveDocument<ArchiveDocument>(archiveId, gmToken);
  const { archives, refresh } = useReplays(gmToken);
  const summary = archives?.find((archive) => archive.id === archiveId) ?? null;
  const name = summary ? replayTitle(summary) : "Replay";
  const { more, dialogs } = useReplayActions(gmToken, refresh, onBack);
  const [launching, setLaunching] = useState(false);
  /** A refusal with somewhere to go stays on screen (an Alert, since a toast fades): it is a state with a next step. */
  const [refused, setRefused] = useState<{ code: RoutedRefusal; message: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();

  const steps = useMemo(() => (document ? stepsOf(document) : []), [document]);
  const line = useMemo(
    () =>
      steps.map((entry) => ({
        round: entry.state.combat.round,
        health: new Map(entry.state.actors.map((actor) => [actor.id, { current: actor.hp.current }] as const))
      })),
    [steps]
  );
  const playback = usePlayback(steps.length);
  const { index } = playback;
  const step = steps[index];

  if (error)
    return (
      <ReplayNotice>
        <p className="replay-error">{error}</p>
        <Button variant="secondary" onClick={onBack}>
          Back to replays
        </Button>
      </ReplayNotice>
    );
  if (!document || !step)
    return (
      <ReplayNotice>
        <p>Loading the replay…</p>
      </ReplayNotice>
    );

  const turnLog = document.log.filter((entry) => entry.revision > step.from && entry.revision <= step.to);

  /**
   * Launch from here. The confirm says the live scene is parked, as when switching scenes; there is
   * only ever one table.
   */
  const launch = async () => {
    const ok = await confirm({
      title: "Launch from this moment?",
      body: `The table becomes this replay at turn ${index + 1}, and your live encounter waits in Encounters to resume anytime.`,
      confirmLabel: "Launch"
    });
    if (!ok) return;
    setLaunching(true);
    setRefused(null);
    const result = await command("replay:launch", { archiveId, turnIndex: index });
    setLaunching(false);
    if (!result.ok) {
      const message = result.message ?? "That moment could not be launched.";
      // A refusal with somewhere to go stays on screen with its door; anything else is a toast.
      const routed = ROUTED_REFUSALS.find((code) => code === result.code);
      if (routed) setRefused({ code: routed, message });
      else toast(message, { tone: "error" });
      return;
    }
    toast("The table is live on that moment. Your previous encounter is parked in Encounters.", { tone: "success" });
    onLaunched();
  };

  return (
    <ReplayFrame loaded={document} onMove={playback.move}>
      {/* The head row: the name with when it was fought to its right, More at the end (E3 replays spec 2.2). */}
      <div className="replay-header">
        <Button onClick={onBack}>
          <IconChevronLeft /> Replays
        </Button>
        <div className="replay-header-text">
          <h2>{name}</h2>
          <p className="replay-meta">
            {[
              when(document.startedAt ?? document.endedAt),
              countOf(document.turns.length, "turn"),
              durationOf(document.startedAt, document.endedAt)
            ]
              .filter(Boolean)
              .map((part, at) => (
                <span key={at}>
                  {at > 0 && " · "}
                  {part}
                </span>
              ))}
          </p>
        </div>
        {summary && <div className="replay-header-actions">{more(summary, { share: true })}</div>}
      </div>
      {/* The refusal and its way out. A full scene list links to the scene gallery, the only place a
        prepared scene can be removed; a history review says where to go (the rewind banner on the
        table) and offers no route. */}
      {refused && (
        <Alert tone="warning" className="replay-refusal" title="That moment could not be launched">
          <p>{refused.message}</p>
          <div className="replay-refusal-actions">
            {refused.code === "encounter_room_full" && (
              <Button variant="primary" size="sm" onClick={() => void navigate("/encounters")}>
                Manage encounters
              </Button>
            )}
            {refused.code === "history_review" && (
              <span>
                Step back to the live turn on the table first. The encounter's history banner has the way out.
              </span>
            )}
            <Button size="sm" onClick={() => setRefused(null)}>
              Dismiss
            </Button>
          </div>
        </Alert>
      )}
      <Transport
        index={index}
        count={steps.length}
        playing={playback.playing}
        line={line}
        onMove={playback.move}
        onPlay={playback.toggle}
        onSeek={playback.seek}
        end={
          <Button variant="primary" onClick={launch} disabled={launching}>
            {launching ? "Launching…" : `Launch from turn ${index + 1}`}
          </Button>
        }
      />
      <p className="replay-step-label">
        <strong>{step.label}</strong> · {when(step.at)}
      </p>
      <div className="replay-layout frame-fill">
        <Stage
          mapAssetId={step.state.combat.mapAssetId}
          bearer={gmToken}
          tokens={step.state.combat.tokens}
          label="Replayed battle map"
          actorFor={(actorId) => {
            const actor = step.state.actors.find((candidate) => candidate.id === actorId);
            if (!actor) return null;
            return {
              name: actor.name,
              tokenAssetId: actor.tokenAssetId ?? null,
              hidden: actor.visibility === "gm-only",
              band: healthBandFor(actor.hp),
              conditions: actor.conditions.map(conditionBadgeLabel),
              active: step.state.combat.turnActorId === actor.id
            };
          }}
        />
        <ReplaySide
          turns={steps.map((entry) => ({ label: entry.label, at: when(entry.at) }))}
          current={index}
          onSeek={playback.seek}
          order={
            <ol className="replay-initiative">
              {step.state.combat.initiative.map((entry) => {
                const actor = step.state.actors.find((candidate) => candidate.id === entry.actorId);
                if (!actor) return null;
                const active = step.state.combat.turnActorId === actor.id;
                return (
                  <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
                    <span className="replay-init-name">
                      {actor.name}
                      {actor.visibility === "gm-only" && <GmOnlyTag />}
                    </span>
                    <span className="replay-init-hp tabular">
                      {actor.hp.current}/{actor.hp.maximum}
                      {actor.hp.temporary > 0 ? ` +${actor.hp.temporary}` : ""} hp
                    </span>
                    {actor.conditions.length > 0 && (
                      <span className="replay-init-conditions">
                        {actor.conditions.map(conditionBadgeLabel).join(" · ")}
                      </span>
                    )}
                    <strong className="tabular">{entry.score}</strong>
                  </li>
                );
              })}
            </ol>
          }
          log={
            turnLog.length === 0 ? (
              <p className="replay-log-empty">Nothing was logged during this turn.</p>
            ) : (
              <ol className="replay-log">
                {turnLog.map((entry) => (
                  <li key={entry.id} className={`log-${entry.kind}${entry.gmOnly ? " replay-log-gm" : ""}`}>
                    <span>{entry.text}</span>
                    {entry.gmOnly && <GmOnlyTag />}
                  </li>
                ))}
              </ol>
            )
          }
        />
      </div>
      {dialog}
      {dialogs}
    </ReplayFrame>
  );
}

// The player viewer

function PlayerViewer({
  token,
  archiveId,
  onBack
}: Readonly<{ token: string; archiveId: number; onBack: () => void }>) {
  const { document, error } = useArchiveDocument<PlayerReplayDocument>(archiveId, token);
  const name = useReplayName(archiveId, token);
  const turns = useMemo(() => document?.turns ?? [], [document]);
  const line = useMemo(
    () =>
      turns.map((entry) => ({
        round: entry.combat.round,
        health: new Map(
          entry.actors.map(
            (actor) =>
              [actor.id, actor.hp.kind === "band" ? { band: actor.hp.band } : { current: actor.hp.current }] as const
          )
        )
      })),
    [turns]
  );
  const playback = usePlayback(turns.length);
  const turn = turns[playback.index];

  if (error)
    return (
      <ReplayNotice>
        <p className="replay-error">{error}</p>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </ReplayNotice>
    );
  if (!document || !turn)
    return (
      <ReplayNotice>
        <p>Loading the replay…</p>
      </ReplayNotice>
    );

  const bandOf = (hp: PlayerHp) =>
    hp.kind === "band"
      ? hp.band
      : hp.current <= 0
        ? ("down" as const)
        : hp.current * 2 <= hp.maximum
          ? ("bloodied" as const)
          : ("healthy" as const);
  const hpText = (hp: PlayerHp) =>
    hp.kind === "exact"
      ? `${hp.current}/${hp.maximum} hp`
      : hp.band === "down"
        ? "down"
        : hp.band === "bloodied"
          ? "bloodied"
          : "healthy";

  return (
    <ReplayFrame loaded={document} onMove={playback.move}>
      <div className="replay-header">
        <Button variant="ghost" onClick={onBack}>
          <IconChevronLeft /> Back
        </Button>
        <div className="replay-header-text">
          <h2>{name}</h2>
          <p className="replay-meta">You're watching this encounter as the party saw it.</p>
        </div>
      </div>
      <Transport
        index={playback.index}
        count={turns.length}
        playing={playback.playing}
        line={line}
        onMove={playback.move}
        onPlay={playback.toggle}
        onSeek={playback.seek}
      />
      <p className="replay-step-label">
        <strong>{turn.label}</strong> · {when(turn.at)}
      </p>
      <div className="replay-layout frame-fill">
        <Stage
          mapAssetId={turn.combat.mapAssetId}
          bearer={token}
          tokens={turn.combat.tokens}
          label="Replayed battle map"
          actorFor={(actorId) => {
            const actor = turn.actors.find((candidate) => candidate.id === actorId);
            if (!actor) return null;
            return {
              name: actor.name,
              tokenAssetId: null,
              hidden: false,
              band: bandOf(actor.hp),
              conditions: actor.conditions,
              active: turn.combat.turnActorId === actor.id
            };
          }}
        />
        <ReplaySide
          turns={turns.map((entry) => ({ label: entry.label, at: when(entry.at) }))}
          current={playback.index}
          onSeek={playback.seek}
          order={
            <ol className="replay-initiative">
              {turn.combat.initiative.map((entry) => {
                const actor = turn.actors.find((candidate) => candidate.id === entry.actorId);
                const active = turn.combat.turnActorId === entry.actorId;
                return (
                  <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
                    <span className="replay-init-name">{entry.name}</span>
                    {actor && <span className="replay-init-hp">{hpText(actor.hp)}</span>}
                    {actor && actor.conditions.length > 0 && (
                      <span className="replay-init-conditions">{actor.conditions.join(" · ")}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          }
          log={
            turn.log.length === 0 ? (
              <p className="replay-log-empty">Nothing was logged during this turn.</p>
            ) : (
              <ol className="replay-log">
                {turn.log.map((entry) => (
                  <li key={entry.id} className={`log-${entry.kind}`}>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ol>
            )
          }
        />
      </div>
    </ReplayFrame>
  );
}

/** One URL, two documents: the role picks the reader; the server decides what it may read. */
export function ReplayViewer({
  role,
  token,
  archiveId,
  onBack,
  onLaunched
}: Readonly<{
  role: "gm" | "player";
  token: string;
  archiveId: number;
  onBack: () => void;
  onLaunched?: () => void;
}>) {
  // Keyed by archive, so moving to another replay starts it at its first turn.
  return role === "gm" ? (
    <GmViewer key={archiveId} gmToken={token} archiveId={archiveId} onBack={onBack} onLaunched={onLaunched ?? onBack} />
  ) : (
    <PlayerViewer key={archiveId} token={token} archiveId={archiveId} onBack={onBack} />
  );
}
