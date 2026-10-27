import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { rosterActors, type GmView, type MutationResult } from "@vtt/domain";
import type { MapSelection } from "../maps/map-catalog";
import { Button, IconChevronLeft } from "@vtt/ui";
import { command } from "../lib/command";
import { CharacterSheet } from "../sheet/CharacterSheet";
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
import { LogComposer } from "../table/LogComposer";
import { TablePanel, useRememberedTab, type PanelTab } from "../table/TablePanel";
import { revealInRegion } from "../lib/reveal";
import { InStripEnd } from "../table/stripSlot";
import { turnTiles } from "../table/TurnTiles";
import { useSelectedToken } from "../scene/selectedToken";
import { NotesTab } from "../table/NotesTab";
import { rollsLine, StartFight } from "./StartFight";

/** A monster defeated in the last fight on this scene stays out of the next one unless the GM adds it back. */
function stillStanding(actors: GmView["actors"], actorId: string) {
  const actor = actors.find((candidate) => candidate.id === actorId);
  return actor !== undefined && !isDefeatedMonster(actor);
}

/** "Lyra", "Lyra and Borin", "Lyra, Borin and Kael". */
function listOf(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The fight's XP award: its player characters, and the monsters in it at 0 Hit Points. Null when either is empty. */
export function fightExperienceOf(state: GmView) {
  const inFight = state.combat.initiative
    .map((entry) => state.actors.find((actor) => actor.id === entry.actorId))
    .filter((actor) => actor !== undefined);
  const recipients = inFight.filter((actor) => actor.kind === "player-character");
  const defeated = inFight.filter((actor) => actor.kind === "monster" && actor.hp.current <= 0);
  return recipients.length > 0 && defeated.length > 0 ? { recipients, defeated } : null;
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
  /** The party's rest, on the Party tab. */
  rest?: ReactNode;
  /** The active session's live board. */
  tonight?: ReactNode;
  /** The Codex at the table: search and a compact page with Reveal on its blocks. */
  codex?: ReactNode;
}>;

export function GmEncounterPanel({
  state,
  selectedMap,
  mapLibrary,
  onSelectMap,
  phone = false,
  slots,
  token = null
}: Readonly<{
  state: GmView;
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  onSelectMap?: (map: MapSelection | null) => void;
  /** Below 980px: the fight splits into Act and Order tabs, and Needs you becomes a tab. */
  phone?: boolean;
  slots?: GmPanelSlots;
  /** The GM's bearer, for the portraits' token art. */
  token?: string | null;
}>) {
  const selectedTokenId = useSelectedToken();
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
  // Encounter-setup opt-in: claimed players roll their own initiative (per encounter, never persisted).
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
    revealInRegion(activeRowRef.current, "nearest", "smooth");
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
      // An empty tray stays empty: "nothing staged" is a decision, and the roster doesn't fill it.
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
  const nextLabel = reviewing ? (reviewing.resumeNext ? "Resume live play" : "Next turn") : "End turn";
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
  // SRD Experience Points: the characters in the fight share the XP of the monsters they brought to 0 Hit Points.
  const fightExperience = fightExperienceOf(state);
  const awardFightExperience = async (inLair: boolean) => {
    if (!fightExperience) return;
    const names = fightExperience.recipients.map((actor) => actor.name);
    if (
      !(await askConfirm({
        title: "Award the fight's XP?",
        body: `${listOf(names)} share the XP of ${listOf(fightExperience.defeated.map((actor) => actor.name))}${inLair ? ", at the lair XP for a legendary creature" : ""}.`,
        confirmLabel: "Award XP"
      }))
    )
      return;
    // The log says how much each gained.
    await run(
      () =>
        command("actor:award-experience", {
          actorIds: fightExperience.recipients.map((actor) => actor.id),
          defeatedIds: fightExperience.defeated.map((actor) => actor.id),
          // A creature with no lair XP gives its usual XP.
          ...(inLair ? { inLairIds: fightExperience.defeated.map((actor) => actor.id) } : {})
        }),
      `${listOf(names)} share the fight's XP.`
    );
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
    ? (nameOf(state.combat.mapAssetId) ?? "the live scene's map")
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

  // In this fight offers everyone staged on the map or in the tray, and anyone ticked, so an untick keeps its row.
  const onMapOrTray = new Set(state.combat.tokens.map((entry) => entry.actorId));
  const candidates = rosterActors(state.actors)
    .filter((actor) => !actor.archived && (selectedActors.has(actor.id) || onMapOrTray.has(actor.id)))
    .sort((left, right) => Number(right.kind === "player-character") - Number(left.kind === "player-character"));
  const stagedActors = candidates.filter((actor) => selectedActors.has(actor.id));
  const tick = (actorId: string, ticked: boolean) =>
    setSelectedActors((current) => {
      const next = new Set(current);
      if (ticked) next.add(actorId);
      else next.delete(actorId);
      return next;
    });
  const prep = (
    <ScenePrepPanel
      actors={state.actors}
      staged={stagedIds}
      placedIds={new Set(state.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId))}
      onAdd={(actorId) => tick(actorId, true)}
      onRemove={(actorId) => tick(actorId, false)}
      mapName={panelMapName}
      mapNote={sceneLive ? "A scene is live. Choosing another map makes a new scene live on it." : undefined}
      selectedMapId={quickStartMapId}
      onSelectMap={chooseQuickStartMap}
      mapFallback={mapLibrary}
      stagingRevealed={stagingVisibility !== "gm-only"}
      combatActive={false}
      busy={busy}
      emptyNote="No one staged yet. The party lands here automatically; add monsters below."
    />
  );
  // A live scene owns its map, so its staging folds away under the list; a quick start needs the map choice open.
  const staging = sceneLive ? (
    <details className="start-fight-staging">
      <summary>Add characters or monsters</summary>
      {prep}
    </details>
  ) : (
    prep
  );
  const setupBody = (
    <StartFight
      state={state}
      token={token}
      candidates={candidates}
      ticked={selectedActors}
      onTick={tick}
      surprised={surprised}
      onSurprised={(actorId) =>
        setSurprised((current) => {
          const next = new Set(current);
          if (!next.delete(actorId)) next.add(actorId);
          return next;
        })
      }
      playersRoll={playersRollInitiative}
      onPlayersRoll={setPlayersRollInitiative}
      groupMonsters={groupMonsters}
      onGroupMonsters={setGroupMonsters}
      busy={busy}
      // Spell areas outlast a fight and can be cast outside one (Glyph of Warding, Alarm), so they are listed here too.
      spellAreas={<SpellAreas state={state} busy={busy} run={run} onFeedback={setMessage} />}
      staging={staging}
      blocked={
        readyToStart
          ? null
          : stagedIds.length === 0
            ? "Stage at least one character or monster."
            : "Pick a battle map first."
      }
      phone={phone}
    />
  );

  const orderBody = (
    <section
      className="encounter-panel combat-active encounter-order"
      aria-label={`Turn order · round ${state.combat.round}`}
    >
      {/* The round is in the header's status line. */}
      {placed < total && (
        <p className="encounter-place-nudge">
          {placed} of {total} tokens are on the map. Drag the rest from the tray.
        </p>
      )}
      {reviewing && (
        <div className={`turn-review${dirty ? " dirty" : ""}`} role="status">
          <strong>Reviewing {reviewing.label ?? "an earlier turn"}</strong>
          <span>
            {dirty
              ? "You changed this turn. Next turn rewrites history from here and undoes everything after it. Previous discards the change."
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
      <div className="encounter-region scroll-y">
        {/* The spell areas the server runs on the map; one a player cast waits here to be placed. They scroll with
            the order, so a few of them never crowd the order out of its section. */}
        <SpellAreas state={state} busy={busy} run={run} onFeedback={setMessage} />
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

  // The acting creature's card, lamps and actions.
  const actBody = actingActor ? (
    <div className="encounter-acting">
      <ActingConsole
        state={state}
        actorsById={actorsById}
        busy={busy}
        run={run}
        onFeedback={setMessage}
        token={token}
      />
    </div>
  ) : (
    <p className="table-panel-empty">Nobody is acting yet.</p>
  );

  const feedback = message ? (
    <p className="encounter-feedback" role="status">
      {message}
    </p>
  ) : null;

  // Who acts after this turn, as the strip's NEXT marks it.
  const nextUp = turnTiles({ role: "gm", state }).find((tile) => tile.next);
  const turnControls = (
    <div className="table-panel-foot-turn">
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
        {/* One primary at a time: while a roll waits, or history is under review, End turn steps down. */}
        <Button
          variant={rollPending || reviewing ? "secondary" : "primary"}
          className="table-panel-primary turn-next"
          disabled={busy}
          onClick={next}
        >
          {nextLabel}
        </Button>
      </div>
      {nextUp && !reviewing && <p className="start-fight-count">Next: {nextUp.name}</p>}
      {/* Adding to the fight, its settings and ending it are in the Fight menu at the strip's end. */}
      <InStripEnd>
        <FightMenu
          state={state}
          busy={busy}
          run={run}
          onFeedback={setMessage}
          onAddMonsters={() => setBrowsing(true)}
          onEnd={() => void end()}
          labelled
          {...(fightExperience ? { onAwardExperience: (inLair: boolean) => void awardFightExperience(inLair) } : {})}
        />
      </InStripEnd>
    </div>
  );
  const startControls = (
    <div className="table-panel-foot-start">
      <Button variant="primary" className="table-panel-primary" disabled={busy || !readyToStart} onClick={start}>
        Start the fight
      </Button>
      <p className="start-fight-count">{rollsLine(stagedActors, playersRollInitiative)}</p>
    </div>
  );

  const fighting = state.combat.active;
  const needsCount = slots?.needsCount ?? 0;
  // What waits on the GM leads the Fight tab, and the tab's count follows the GM to the other tabs.
  const fightLabel = (
    <>
      Fight
      {needsCount > 0 && (
        <span className="table-tab-count">
          <span aria-hidden="true">{needsCount}</span>
          <span className="nh-sr-only">, {needsCount} waiting on you</span>
        </span>
      )}
    </>
  );
  const fightBody = fighting ? (
    <>
      {slots?.needs}
      {actBody}
      {/* The order with each row's tools (score, HP, conditions, the sheet); a phone has an Order tab for it. */}
      {!phone && (
        <details className="encounter-order-tools">
          <summary>Turn order and tools</summary>
          {orderBody}
        </details>
      )}
    </>
  ) : (
    <>
      {slots?.needs}
      {setupBody}
    </>
  );
  const logBody = (
    <div className="table-log-tab">
      {slots?.log}
      <LogComposer options={slots?.dice} />
    </div>
  );
  const partyBody = (
    <>
      {slots?.rest && <div className="table-party-rest">{slots.rest}</div>}
      {slots?.party}
    </>
  );
  const tabs: PanelTab[] = [
    { id: "fight", label: fightLabel, content: fightBody },
    // A phone has no room beside the acting card, so the order is its own tab there.
    ...(phone && fighting ? [{ id: "order", label: "Order", content: orderBody, scrolls: false }] : []),
    { id: "log", label: "Log", content: logBody, scrolls: false },
    { id: "party", label: "Party", content: partyBody },
    ...(slots?.tonight || slots?.codex
      ? [
          {
            id: "notes",
            label: "Notes",
            content: <NotesTab tonight={slots?.tonight} codex={slots?.codex} />,
            scrolls: false
          }
        ]
      : []),
    // The token last pressed on the map, with the same controls as its menu there.
    ...(selectedTokenId && slots?.token ? [{ id: "token", label: "Token", content: slots.token }] : [])
  ];
  const fallback = "fight";
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
        tabs={tabs}
        active={tab}
        onActive={setTab}
        phone={phone}
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
