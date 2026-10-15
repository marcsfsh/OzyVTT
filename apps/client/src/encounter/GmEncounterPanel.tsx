import { useEffect, useMemo, useRef, useState } from "react";
import { rosterActors, type GmView, type MutationResult } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { Button, Switch, IconArrow, Eyebrow } from "@vtt/ui";
import { command } from "../lib/command";
import { PendingAsksForGm } from "./RuleAsk";
import { useRollPreference } from "../dice/roll-preference";
import { CharacterSheet } from "./CharacterSheet";
import { MonsterBrowser } from "./MonsterBrowser";
import { ScenePrepPanel } from "../scenes/ScenePrepPanel";
import type { PickerMap } from "../maps/MapPicker";
import { useConfirm } from "../components/feedback";
import { DockPicker, type DockControl } from "./DockPicker";
import { ConfirmRow } from "./ConfirmRow";
import { FightMenu } from "./FightMenu";
import { ActingConsole } from "./ActingConsole";
import { GmInitiativeRow } from "./GmInitiativeRow";

export function GmEncounterPanel({
  state,
  selectedMap,
  mapLibrary,
  onSelectMap,
  dock
}: Readonly<{
  state: GmView;
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  onSelectMap?: (map: MapSelection | null) => void;
  dock?: DockControl;
}>) {
  const [selectedActors, setSelectedActors] = useState<ReadonlySet<string>>(() =>
    state.combat.initiative.length > 0
      ? new Set(state.combat.initiative.map((entry) => entry.actorId))
      : new Set(
          rosterActors(state.actors)
            .filter((actor) => actor.kind === "player-character" && !actor.archived)
            .map((actor) => actor.id)
        )
  );
  const liveMapRef = useRef(state.combat.mapAssetId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // The GM's rolls follow the shared per-browser dice-input preference.
  const { rollMode } = useRollPreference();
  // Encounter-setup opt-in: claimed players roll their own initiative (per encounter, not persisted).
  const [playersRollInitiative, setPlayersRollInitiative] = useState(false);
  // A pending history rewrite/discard the GM must confirm (see the Previous/Next flow).
  const [confirm, setConfirm] = useState<{
    message: string;
    run: () => Promise<MutationResult>;
    success: string;
  } | null>(null);
  const { confirm: askConfirm, dialog: confirmDialog } = useConfirm();
  const [browsing, setBrowsing] = useState(false);
  // The map picked in this panel when no scene is live. Kept separately from `selectedMap`, which the
  // shell also sets on its own; only an explicit pick should move the fight.
  const [pickedMap, setPickedMap] = useState<PickerMap | null>(null);
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  // Rows are one line by default; at most one row's tools are open at a time.
  const [expandedActorId, setExpandedActorId] = useState<string | null>(null);
  /** The damage type for the row tools' number; not cleared between rows (one fireball, several tokens). */
  const [hpDamageType, setHpDamageType] = useState<string | null>(null);
  const knownActorIdsRef = useRef<ReadonlySet<string>>(new Set(state.actors.map((actor) => actor.id)));
  const actorsById = useMemo(() => new Map(state.actors.map((actor) => [actor.id, actor])), [state.actors]);
  // Scroll the newly active combatant's row into view on each real turn change.
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.combat.turnActorId]);

  useEffect(() => {
    // When a prepared scene goes live, pre-select its staged combatants.
    if (state.combat.mapAssetId !== liveMapRef.current) {
      liveMapRef.current = state.combat.mapAssetId;
      if (!state.combat.active && state.combat.initiative.length > 0)
        setSelectedActors(new Set(state.combat.initiative.map((entry) => entry.actorId)));
    }
  }, [state.combat.mapAssetId, state.combat.active, state.combat.initiative]);
  useEffect(() => {
    if (state.combat.active) return;
    setSelectedActors((current) => {
      // Prune removed actors, and auto-check actors added during setup (a monster added from the
      // browser is meant to fight).
      const known = knownActorIdsRef.current;
      const valid = new Set([...current].filter((id) => actorsById.has(id)));
      // Roster only: a replay launch adds a burst of actors the server deletes when the replay ends.
      for (const actor of rosterActors(state.actors)) if (!known.has(actor.id) && !actor.archived) valid.add(actor.id);
      knownActorIdsRef.current = new Set(state.actors.map((actor) => actor.id));
      // An empty tray stays empty: "nothing staged" is a decision, not a gap to fill with the roster.
      return valid;
    });
  }, [actorsById, state.actors, state.combat.active]);

  const run = async (operation: () => Promise<MutationResult>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.message ?? "The command was rejected.");
      setMessage(success);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    void run(async () => {
      // A live scene's map is the encounter's map (the server requires it). Otherwise the map picked in
      // the panel wins, so the quick-start door can run a fight somewhere else.
      const startMapId = sceneLive ? (state.combat.mapAssetId ?? undefined) : quickStartMapId;
      if (!startMapId)
        throw new Error(
          selectedMap && selectedMap.kind !== "battlemap"
            ? "Pick a battle map before starting the fight. Regional and world maps stay available outside fights."
            : "Pick a battle map first, or make a scene live from the Scenes tab."
        );
      // No scores: the server rolls every staged combatant, so a previous fight's order never carries over.
      const entries = rosterActors(state.actors)
        .filter((actor) => selectedActors.has(actor.id))
        .map((actor) => ({ actorId: actor.id }));
      if (entries.length === 0) throw new Error("Stage at least one character or monster.");
      return command("encounter:start", {
        mapAssetId: startMapId,
        entries,
        playersRollInitiative,
        expectedRevision: state.revision
      });
    }, "The fight has started. Initiative was rolled, and every token is ready in the tray above.");
  const changeScore = (actorId: string, score: number) =>
    void run(
      () => command("initiative:set", { actorId, score, expectedRevision: state.revision }),
      "Initiative updated."
    );
  // Turn time travel: Previous rewinds the table to the end of the prior turn; Next steps forward or,
  // at the return point, resumes live play. If the GM changed things while rewound, the server asks
  // to confirm (Next rewrites history, Previous discards the change), and the command is re-sent with
  // the matching confirm flag.
  const cursor = state.combat.historyCursor;
  const dirty = state.combat.historyDirty;
  const reviewing =
    cursor === null
      ? null
      : {
          label: (state.turnHistory ?? []).find((entry) => entry.index === cursor)?.label,
          resumeNext: (state.turnHistory ?? []).find((entry) => entry.index > cursor)?.kind === "return"
        };
  const nextLabel = reviewing?.resumeNext ? "Resume live play" : "Next turn";
  const runTurn = async (
    operation: () => Promise<MutationResult>,
    success: string,
    onConfirm?: () => Promise<MutationResult>
  ) => {
    setBusy(true);
    setMessage("");
    setConfirm(null);
    try {
      const result = await operation();
      if (result.needsConfirm && onConfirm) {
        setConfirm({ message: result.message ?? "Confirm this change?", run: onConfirm, success });
        return;
      }
      if (!result.ok) throw new Error(result.message ?? "The turn command was rejected.");
      setMessage(success);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const next = () =>
    void runTurn(
      () => command("initiative:next", { expectedRevision: state.revision }),
      reviewing?.resumeNext ? "Resumed live play." : "Advanced to the next turn.",
      () => command("initiative:next", { confirmRewrite: true, expectedRevision: state.revision })
    );
  const previous = () =>
    void runTurn(
      () => command("initiative:previous", { expectedRevision: state.revision }),
      "Moved to the previous turn.",
      () =>
        command("initiative:previous", {
          confirmDiscard: true,
          expectedRevision: state.revision
        })
    );
  const end = async () => {
    if (
      !(await askConfirm({
        title: "End the fight?",
        body: "Turn order stays saved for reference, but the shared screen will hide it.",
        confirmLabel: "End the fight",
        danger: true
      }))
    )
      return;
    void run(() => command("encounter:end", { expectedRevision: state.revision }), "Fight ended.");
  };
  // The quick-start door: everyone active is pre-listed in the staging tray, archived characters
  // nowhere. The map, tray, Add buttons and Recent are the same parts scene prep uses.
  const stagedIds = rosterActors(state.actors)
    .filter((actor) => selectedActors.has(actor.id) && !actor.archived)
    .map((actor) => actor.id);
  // Only a live scene owns its map. `combat.mapAssetId` stays set after a fight ends and must not
  // lock the GM to it.
  const sceneLive = state.combat.activeSceneId !== null;
  // The just-picked map first: the shell's library is refetched only on a tab change, so a map
  // uploaded from this panel is not in it yet.
  const nameOf = (id: string | null) =>
    id
      ? pickedMap?.id === id
        ? pickedMap.name
        : ((mapLibrary ?? []).find((map) => map.id === id)?.name ?? null)
      : null;
  const quickStartMapId =
    pickedMap?.id ?? state.combat.mapAssetId ?? (selectedMap?.kind === "battlemap" ? selectedMap.id : null);
  const panelMapName = sceneLive
    ? (nameOf(state.combat.mapAssetId) ?? "the live scene’s map")
    : (pickedMap?.name ?? nameOf(quickStartMapId) ?? (selectedMap?.kind === "battlemap" ? selectedMap.name : null));
  const readyToStart =
    stagedIds.length > 0 && (sceneLive ? state.combat.mapAssetId !== null : quickStartMapId !== null);
  /**
   * Picking a map from the quick-start door. With no scene live it is just a choice. With a scene
   * live the server requires the fight to use that scene's map, so one `scene.create {activate}`
   * parks the current scene and goes live on a new one named after the map. Only offered before a
   * fight starts.
   */
  const chooseQuickStartMap = (map: PickerMap) => {
    setPickedMap(map);
    onSelectMap?.(map);
    if (!sceneLive || map.id === state.combat.mapAssetId) return;
    void run(
      () =>
        command("scene:create", {
          name: map.name.slice(0, 120),
          mapAssetId: map.id,
          combatantIds: stagedIds,
          activate: true,
          expectedRevision: state.revision
        }),
      `${map.name} is live.`
    );
  };
  // Guarded because the first frame after a GM signs in can still be the player projection, which
  // has no GM-only fields; without it the panel throws into the error boundary.
  const stagingVisibility = state.stagingDefaults?.visibility ?? "public";

  // Rotate the turn order so the acting combatant leads; its console renders under that top row.
  const activeIndex = state.combat.initiative.findIndex((entry) => state.combat.turnActorId === entry.actorId);
  const orderedInitiative =
    activeIndex > 0
      ? [...state.combat.initiative.slice(activeIndex), ...state.combat.initiative.slice(0, activeIndex)]
      : state.combat.initiative;

  return (
    <section
      className={`encounter-panel${state.combat.active ? " combat-active" : " setup"}`}
      {...(state.combat.active
        ? { "aria-label": `Turn order - round ${state.combat.round}` }
        : { "aria-labelledby": "gm-encounter-title" })}
    >
      {/* During combat the panel has no heading block; the round pill rides the control bar. */}
      {/* One title, naming the action. The prep panel below has no heading of its own here. */}
      {!state.combat.active && (
        <div className="encounter-heading">
          <div>
            <Eyebrow>FIGHT</Eyebrow>
            <h2 id="gm-encounter-title">Start a fight</h2>
          </div>
        </div>
      )}
      {/* Docking the tracker to the map is available before and during combat. */}
      <DockPicker dock={dock} />
      {!state.combat.active ? (
        <>
          <ScenePrepPanel
            actors={state.actors}
            staged={stagedIds}
            placedIds={
              new Set(state.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId))
            }
            onAdd={(actorId) => setSelectedActors((current) => new Set(current).add(actorId))}
            onRemove={(actorId) =>
              setSelectedActors((current) => {
                const next = new Set(current);
                next.delete(actorId);
                return next;
              })
            }
            mapName={panelMapName}
            mapNote={sceneLive ? "A scene is live. Choosing another map makes a new scene live on it." : undefined}
            selectedMapId={quickStartMapId}
            onSelectMap={chooseQuickStartMap}
            mapFallback={mapLibrary}
            stagingRevealed={stagingVisibility !== "gm-only"}
            combatActive={false}
            busy={busy}
            emptyNote="No one staged yet. The party lands here automatically; add monsters below."
            footer={
              <>
                <Switch
                  label="Players roll their own initiative"
                  checked={playersRollInitiative}
                  disabled={busy}
                  onChange={setPlayersRollInitiative}
                />
                {!readyToStart && (
                  <p className="encounter-start-blocked" role="status">
                    {stagedIds.length === 0 ? "Stage at least one character or monster." : "Pick a battle map first."}
                  </p>
                )}
                <Button variant="primary" arrow block disabled={busy || !readyToStart} onClick={start}>
                  Start the fight
                </Button>
              </>
            }
          />
        </>
      ) : (
        <>
          {(() => {
            const placed = state.combat.tokens.filter((token) => token.position !== null).length;
            const total = state.combat.initiative.length;
            return placed < total ? (
              <p className="encounter-place-nudge">
                {placed} of {total} tokens placed - drag the rest from the tray above.
              </p>
            ) : null;
          })()}
          {reviewing && (
            <div className={`turn-review${dirty ? " dirty" : ""}`} role="status">
              <strong>Reviewing {reviewing.label ?? "an earlier turn"}</strong>
              <span>
                {dirty
                  ? "You changed this turn. Next turn rewrites history from here (undoing everything after it); Previous discards the change."
                  : "The whole table is paused here. Step forward to resume live play - nothing is undone until you change something."}
              </span>
            </div>
          )}
          {/* One compact control bar: turn navigation gets the space; occasional controls live behind ⋯. */}
          <div className="encounter-topbar">
            <strong className="encounter-round">Round {state.combat.round}</strong>
            <div className="turn-controls">
              <button
                className="encounter-primary turn-prev"
                disabled={busy}
                onClick={previous}
                title="Previous turn"
                aria-label="Previous turn"
              >
                ‹
              </button>
              <button
                className={`encounter-primary${reviewing?.resumeNext ? " resume" : ""}`}
                disabled={busy}
                onClick={next}
              >
                {nextLabel}
                <span className="nav-arrow" aria-hidden="true">
                  <IconArrow />
                </span>
              </button>
            </div>
            {/* Mid-fight reinforcements are a combat action, so one visible tap. */}
            <button
              type="button"
              className="encounter-menu-toggle"
              disabled={busy}
              title="Add monsters to this fight (SRD)"
              aria-label="Add monsters to this fight"
              onClick={() => setBrowsing(true)}
            >
              +
            </button>
            <FightMenu
              state={state}
              busy={busy}
              run={run}
              onFeedback={setMessage}
              onAddMonsters={() => setBrowsing(true)}
              onEnd={() => void end()}
            />
          </div>
          {confirm && (
            <ConfirmRow
              ariaLabel="Confirm history change"
              confirmLabel="Confirm"
              busy={busy}
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                const pending = confirm;
                setConfirm(null);
                void runTurn(pending.run, pending.success);
              }}
            >
              {confirm.message}
            </ConfirmRow>
          )}
          {/* Players' questions, pinned above the turn order. Allow replays the parked command with GM
          authority; it can fail against current state, in which case the question stays and says so. */}
          <PendingAsksForGm state={state} onFeedback={setMessage} />
          {(state.combat.pendingInitiative ?? []).length > 0 && (
            <div className="initiative-gathering" role="status">
              <span>
                Waiting on {state.combat.pendingInitiative.length} player
                {state.combat.pendingInitiative.length === 1 ? "" : "s"} to roll initiative
                {state.combat.playerInitiativeMode === "wait" ? " - turns begin once everyone has" : ""}.
              </span>
              <button
                type="button"
                className="encounter-primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void command("initiative:roll-remaining", {}).then((result) => {
                    setBusy(false);
                    setMessage(
                      result.ok
                        ? "Rolled initiative for the rest of the table."
                        : (result.message ?? "Initiative could not be rolled.")
                    );
                  });
                }}
              >
                Roll for the rest
              </button>
            </div>
          )}
          {/* The GM's tracker scroll region; the topbar, start/stop controls and gathering notice stay
          pinned above it. */}
          <div className="encounter-region scroll-y">
            <ol className="initiative-list gm">
              {orderedInitiative.map((entry) => {
                const active = state.combat.turnActorId === entry.actorId;
                return (
                  <GmInitiativeRow
                    key={entry.actorId}
                    entry={entry}
                    actor={actorsById.get(entry.actorId)}
                    state={state}
                    active={active}
                    expanded={expandedActorId === entry.actorId}
                    rowRef={active ? activeRowRef : undefined}
                    onToggleExpanded={() =>
                      setExpandedActorId((current) => (current === entry.actorId ? null : entry.actorId))
                    }
                    onCloseTools={() => setExpandedActorId(null)}
                    onScoreChange={(score) => changeScore(entry.actorId, score)}
                    actingConsole={
                      <ActingConsole
                        state={state}
                        actorsById={actorsById}
                        busy={busy}
                        run={run}
                        rollMode={rollMode}
                        onFeedback={setMessage}
                      />
                    }
                    busy={busy}
                    run={run}
                    rollMode={rollMode}
                    hpDamageType={hpDamageType}
                    onHpDamageTypeChange={setHpDamageType}
                    onOpenSheet={setSheetActorId}
                    onFeedback={setMessage}
                  />
                );
              })}
            </ol>
          </div>
        </>
      )}
      {message && (
        <p className="encounter-feedback" role="status">
          {message}
        </p>
      )}
      {/* Mid-fight reinforcements: one command adds the monster to the roster and the turn order,
        its token waiting in the staging tray at the table's "new tokens" visibility. */}
      {browsing && <MonsterBrowser visibility={stagingVisibility} joinEncounter onClose={() => setBrowsing(false)} />}
      {(() => {
        const sheetActor = sheetActorId ? actorsById.get(sheetActorId) : undefined;
        return sheetActor ? (
          <CharacterSheet actor={sheetActor} role="gm" state={state} onClose={() => setSheetActorId(null)} />
        ) : null;
      })()}
      {confirmDialog}
    </section>
  );
}
