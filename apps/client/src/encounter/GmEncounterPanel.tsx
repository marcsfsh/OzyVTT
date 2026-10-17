import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { rosterActors, type GmView, type MutationResult } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { Button, Chip, Switch, IconArrow, IconChevronLeft, IconPlus, Eyebrow } from "@vtt/ui";
import { command } from "../lib/command";
import { CharacterSheet } from "./CharacterSheet";
import { MonsterBrowser } from "./MonsterBrowser";
import { ScenePrepPanel } from "../scenes/ScenePrepPanel";
import type { PickerMap } from "../maps/MapPicker";
import { useConfirm } from "../components/feedback";
import { ConfirmRow } from "./ConfirmRow";
import { FightMenu } from "./FightMenu";
import { ActingConsole } from "./ActingConsole";
import { GmInitiativeRow } from "./GmInitiativeRow";
import { SpellAreas } from "./SpellAreas";
import { useTargeting, useTargetingResult } from "./targeting";
import { holdsTheTurn } from "../table/NeedsYou";
import { isDefeatedMonster } from "../table/needs";
import { TablePanel, useRememberedTab, type PanelTab } from "../table/TablePanel";

/** A monster defeated in the last fight on this scene stays out of the next one unless the GM adds it back. */
function stillStanding(actors: GmView["actors"], actorId: string) {
  const actor = actors.find((candidate) => candidate.id === actorId);
  return actor !== undefined && !isDefeatedMonster(actor);
}

/** How long a turn button ignores taps after a turn command settles: longer than a double tap. */
const TURN_SETTLE_MS = 500;

/** What the table puts in the GM's panel besides the fight: Needs you, the dice, the log, the token, the party. */
export type GmPanelSlots = Readonly<{
  needs?: ReactNode;
  needsCount?: number;
  dice?: ReactNode;
  log?: ReactNode;
  token?: ReactNode;
  party?: ReactNode;
  /** The rest button, beside Start the fight. */
  rest?: ReactNode;
}>;

export function GmEncounterPanel({
  state,
  selectedMap,
  mapLibrary,
  onSelectMap,
  phone = false,
  slots
}: Readonly<{
  state: GmView;
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  onSelectMap?: (map: MapSelection | null) => void;
  /** Below 980px: the fight splits into Act and Order tabs, and Needs you becomes a tab. */
  phone?: boolean;
  slots?: GmPanelSlots;
}>) {
  const [selectedActors, setSelectedActors] = useState<ReadonlySet<string>>(() =>
    state.combat.initiative.length > 0
      ? new Set(state.combat.initiative.map((entry) => entry.actorId).filter((id) => stillStanding(state.actors, id)))
      : new Set(
          rosterActors(state.actors)
            .filter((actor) => actor.kind === "player-character" && !actor.archived)
            .map((actor) => actor.id)
        )
  );
  const liveMapRef = useRef(state.combat.mapAssetId);
  const [busy, setBusy] = useState(false);
  // On a LAN the turn changes before a double tap's second tap lands, so a turn button ignores taps
  // until shortly after the last turn command settled; otherwise one double tap skips a combatant.
  const turnSettlesAt = useRef(0);
  const [message, setMessage] = useState("");
  // Encounter-setup opt-in: claimed players roll their own initiative (per encounter, not persisted).
  const [playersRollInitiative, setPlayersRollInitiative] = useState(false);
  // SRD Surprise and group rolls, per fight: who rolls initiative at Disadvantage, and one roll per stat block.
  const [surprised, setSurprised] = useState<ReadonlySet<string>>(() => new Set());
  const [groupMonsters, setGroupMonsters] = useState(true);
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
        setSelectedActors(
          new Set(state.combat.initiative.map((entry) => entry.actorId).filter((id) => stillStanding(state.actors, id)))
        );
    }
  }, [state.combat.mapAssetId, state.combat.active, state.combat.initiative, state.actors]);
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
        .map((actor) => (surprised.has(actor.id) ? { actorId: actor.id, surprised: true } : { actorId: actor.id }));
      if (entries.length === 0) throw new Error("Stage at least one character or monster.");
      return command("encounter:start", {
        mapAssetId: startMapId,
        entries,
        playersRollInitiative,
        groupMonsters,
        expectedRevision: state.revision
      });
    }, "The fight has started, and initiative was rolled.");
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
  // One primary at a time: while a roll waits to be made or answered, Next turn steps down.
  const targeting = useTargeting();
  const targetingResult = useTargetingResult();
  const rollPending = targeting !== null || targetingResult?.preview === true || holdsTheTurn(state);
  const runTurn = async (
    operation: () => Promise<MutationResult>,
    success: string,
    onConfirm?: () => Promise<MutationResult>
  ) => {
    if (performance.now() < turnSettlesAt.current) return;
    turnSettlesAt.current = Number.POSITIVE_INFINITY;
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
      turnSettlesAt.current = performance.now() + TURN_SETTLE_MS;
      setMessage(success);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      if (turnSettlesAt.current === Number.POSITIVE_INFINITY) turnSettlesAt.current = 0;
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

  const actingActor = state.combat.turnActorId ? actorsById.get(state.combat.turnActorId) : undefined;
  const placed = state.combat.tokens.filter((token) => token.position !== null).length;
  const total = state.combat.initiative.length;

  const setupBody = (
    <div className="encounter-panel setup" aria-labelledby="gm-encounter-title">
      <div className="encounter-heading">
        <div>
          <Eyebrow>FIGHT</Eyebrow>
          <h2 id="gm-encounter-title">Start a fight</h2>
        </div>
      </div>
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
            <Switch
              label="One roll for each group of identical monsters"
              checked={groupMonsters}
              disabled={busy}
              onChange={setGroupMonsters}
            />
            {stagedIds.length > 0 && (
              <fieldset className="encounter-surprise">
                <legend>Surprised? They roll initiative at Disadvantage.</legend>
                <div className="encounter-surprise-chips">
                  {stagedIds.map((actorId) => (
                    <Chip
                      key={actorId}
                      pressed={surprised.has(actorId)}
                      disabled={busy}
                      onClick={() =>
                        setSurprised((current) => {
                          const next = new Set(current);
                          if (!next.delete(actorId)) next.add(actorId);
                          return next;
                        })
                      }
                    >
                      {state.actors.find((actor) => actor.id === actorId)?.name ?? "Unknown"}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            )}
            {!readyToStart && (
              <p className="encounter-start-blocked" role="status">
                {stagedIds.length === 0 ? "Stage at least one character or monster." : "Pick a battle map first."}
              </p>
            )}
          </>
        }
      />
    </div>
  );

  const orderBody = (
    <section
      className="encounter-panel combat-active encounter-order"
      aria-label={`Turn order · round ${state.combat.round}`}
    >
      <div className="encounter-order-head">
        <strong className="encounter-round">Round {state.combat.round}</strong>
        {placed < total && (
          <span className="encounter-place-nudge">
            {placed} of {total} tokens are on the map. Drag the rest from the tray.
          </span>
        )}
      </div>
      {reviewing && (
        <div className={`turn-review${dirty ? " dirty" : ""}`} role="status">
          <strong>Reviewing {reviewing.label ?? "an earlier turn"}</strong>
          <span>
            {dirty
              ? "You changed this turn. Next turn rewrites history from here, undoing everything after it. Previous discards the change."
              : "The whole table is paused here. Step forward to resume live play. Nothing is undone until you change something."}
          </span>
        </div>
      )}
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
      {/* The spell areas the server runs on the map; one a player cast waits here to be placed. */}
      <SpellAreas state={state} busy={busy} run={run} onFeedback={setMessage} />
      <div className="encounter-region scroll-y">
        <ol className="initiative-list gm">
          {state.combat.initiative.map((entry) => {
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
                actingConsole={null}
                busy={busy}
                run={run}
                hpDamageType={hpDamageType}
                onHpDamageTypeChange={setHpDamageType}
                onOpenSheet={setSheetActorId}
                onFeedback={setMessage}
              />
            );
          })}
        </ol>
      </div>
    </section>
  );

  // The acting creature's console: its economy and actions, with its name, HP and AC at the top.
  const actBody = actingActor ? (
    <section className="encounter-acting scroll-y" aria-label={`Now acting · ${actingActor.name}`}>
      <p className="encounter-acting-head">
        <span>Now acting · {actingActor.name}</span>
        <span className="encounter-acting-numbers">
          {actingActor.hp.current}/{actingActor.hp.maximum}
          {actingActor.armorClass !== undefined ? ` · AC ${actingActor.armorClass}` : ""}
        </span>
      </p>
      <ActingConsole state={state} actorsById={actorsById} busy={busy} run={run} onFeedback={setMessage} />
    </section>
  ) : (
    <p className="table-panel-empty">Nobody is acting yet.</p>
  );

  const feedback = message ? (
    <p className="encounter-feedback" role="status">
      {message}
    </p>
  ) : null;

  const turnControls = (
    <div className="table-panel-foot-row turn-controls">
      <button
        type="button"
        className="encounter-primary turn-prev"
        disabled={busy}
        onClick={previous}
        title="Previous turn"
        aria-label="Previous turn"
      >
        <IconChevronLeft />
      </button>
      <button
        type="button"
        className={`encounter-primary turn-next${reviewing?.resumeNext ? " resume" : ""}${rollPending ? " is-quiet" : ""}`}
        disabled={busy}
        onClick={next}
      >
        {nextLabel}
        <span className="nav-arrow" aria-hidden="true">
          <IconArrow />
        </span>
      </button>
      {/* Ending the fight sits beside the turn, where the GM looks for it. */}
      <Button variant="secondary" size="sm" className="encounter-end" disabled={busy} onClick={() => void end()}>
        End fight
      </Button>
      {/* Mid-fight reinforcements are a combat action, so one visible tap. */}
      <button
        type="button"
        className="encounter-menu-toggle"
        disabled={busy}
        title="Add monsters to this fight (SRD)"
        aria-label="Add monsters to this fight"
        onClick={() => setBrowsing(true)}
      >
        <IconPlus />
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
  );
  const startControls = (
    <div className="table-panel-foot-row">
      {slots?.rest}
      <Button variant="primary" arrow className="table-panel-primary" disabled={busy || !readyToStart} onClick={start}>
        Start the fight
      </Button>
    </div>
  );

  const fighting = state.combat.active;
  const needsCount = slots?.needsCount ?? 0;
  const tabs: PanelTab[] = phone
    ? fighting
      ? [
          { id: "act", label: "Act", content: actBody },
          { id: "order", label: "Order", content: orderBody, scrolls: false },
          {
            id: "needs",
            label: needsCount > 0 ? `Needs ${needsCount}` : "Needs",
            content: slots?.needs ?? <p className="table-panel-empty">Nothing waits on you.</p>
          },
          { id: "dice", label: "Dice", content: slots?.dice },
          { id: "log", label: "Log", content: slots?.log, scrolls: false }
        ]
      : [
          {
            id: "scene",
            label: "Scene",
            content: (
              <>
                {slots?.needs}
                {setupBody}
              </>
            )
          },
          { id: "party", label: "Party", content: slots?.party },
          { id: "dice", label: "Dice", content: slots?.dice },
          { id: "log", label: "Log", content: slots?.log, scrolls: false }
        ]
    : [
        {
          id: "fight",
          label: "Fight",
          content: fighting ? (
            <div className="encounter-fight">
              {orderBody}
              {actBody}
            </div>
          ) : (
            setupBody
          ),
          scrolls: !fighting
        },
        { id: "dice", label: "Dice", content: slots?.dice },
        { id: "log", label: "Log", content: slots?.log, scrolls: false },
        { id: "token", label: "Token", content: slots?.token }
      ];
  const fallback = phone ? (fighting ? "act" : "scene") : "fight";
  const [tab, setTab] = useRememberedTab(
    `vtt.table-tab.gm.${phone ? "phone" : "laptop"}`,
    tabs.map((entry) => entry.id),
    fallback,
    `${fighting}|${phone}`
  );

  return (
    <>
      <TablePanel
        label={fighting ? `The fight · round ${state.combat.round}` : "The table"}
        {...(!phone && slots?.needs ? { top: slots.needs } : {})}
        tabs={tabs}
        active={tab}
        onActive={setTab}
        footer={
          <>
            {feedback}
            {fighting ? turnControls : startControls}
          </>
        }
      />
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
    </>
  );
}
