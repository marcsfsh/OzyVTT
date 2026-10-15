import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rosterActors, type GmActor, type GmView, type MutationResult } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { Button, Select, Switch } from "@vtt/ui";
import { command } from "../lib/command";
import { ActionRunner } from "./ActionRunner";
import { PendingAsksForGm } from "./RuleAsk";
import { useRollPreference } from "../dice/roll-preference";
import { manualDamagePayload, manualDamageType } from "./manual-damage";
import { DamageTypeField } from "./DamageTypeField";
import { CharacterSheet } from "./CharacterSheet";
import { ConditionDots, ConditionEditor } from "./conditions";
import { initialsOf } from "../scene/mapImage";
import { MonsterBrowser } from "./MonsterBrowser";
import { ScenePrepPanel } from "../scenes/ScenePrepPanel";
import type { PickerMap } from "../maps/MapPicker";
import { useConfirm } from "../components/feedback";
import { DockPicker, type DockControl } from "./DockPicker";
import { SavePrompt } from "./SavePrompt";
import { ReactionPrompt } from "./ReactionPrompt";
import { EffectChips } from "./EffectChips";
import { DyingTracker } from "./DyingTracker";
import { PendingDamagePrompt } from "./PendingDamagePrompt";
import { menuWidthFor, placeFightMenu, type FightMenuPlacement } from "./FightMenu";

const validInitiativeScore = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== "" &&
  Number.isInteger(Number(value)) &&
  Number(value) >= -1000 &&
  Number(value) <= 1000;

/** How many monsters the ⋯ menu's `Recent` disclosure offers; matches scene prep
    (`ScenePrepPanel.tsx`). */
const RECENT_COUNT = 10;

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
  const [scores, setScores] = useState<Record<string, string>>({});
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
  const [editingActorId, setEditingActorId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");
  const [browsing, setBrowsing] = useState(false);
  // The map picked in this panel when no scene is live. Kept separately from `selectedMap`, which the
  // shell also sets on its own; only an explicit pick should move the fight.
  const [pickedMap, setPickedMap] = useState<PickerMap | null>(null);
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  // Rows are one line by default; at most one row's tools are open at a time.
  const [expandedActorId, setExpandedActorId] = useState<string | null>(null);
  const [hpAmount, setHpAmount] = useState("");
  /** The damage type for the number beside it. Unlike `hpAmount` it is not cleared; see `adjustHp`. */
  const [hpDamageType, setHpDamageType] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the ⋯ popover on Escape (outside clicks hit the backdrop). Rich content keeps it a bespoke
  // popover rather than a Menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // Anchor the ⋯ menu to its button (see `placeFightMenu`), portaled out to clear the dock stacking.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /* The scroller is the body, not the menu: every scroll offset read and write goes here. */
  const menuBodyRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<FightMenuPlacement | null>(null);
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const button = menuButtonRef.current,
        menu = menuRef.current;
      if (!button || !menu) return;
      // Measure the natural height with the cap off, so a menu that gained room gets it back; the width
      // is applied too, since wrapping depends on it. Uncapping zeroes the body's `scrollTop`, so it is
      // restored, or every scroll would snap back to the top.
      const cappedHeight = menu.style.maxHeight,
        cappedWidth = menu.style.width,
        scrolled = menuBodyRef.current?.scrollTop ?? 0;
      menu.style.maxHeight = "none";
      menu.style.width = `${menuWidthFor(window.innerWidth)}px`;
      const natural = menu.offsetHeight;
      menu.style.maxHeight = cappedHeight;
      menu.style.width = cappedWidth;
      if (menuBodyRef.current) menuBodyRef.current.scrollTop = scrolled;
      setMenuPos(
        placeFightMenu(button.getBoundingClientRect(), natural, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      );
    };
    // Capture phase: the scroll that moves the trigger belongs to an ancestor scroller. The menu's own
    // scrolls never move the trigger, so they are ignored.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);
  // A legendary creature acting off-turn (SRD Legendary Actions) takes over the acting console until
  // the real turn advances.
  const [legendaryActingId, setLegendaryActingId] = useState<string | null>(null);
  useEffect(() => {
    setLegendaryActingId(null);
  }, [state.combat.turnActorId]);
  const cancelEditRef = useRef(false);
  const knownActorIdsRef = useRef<ReadonlySet<string>>(new Set(state.actors.map((actor) => actor.id)));
  const actorsById = useMemo(() => new Map(state.actors.map((actor) => [actor.id, actor])), [state.actors]);
  // Scroll the newly active combatant's row into view on each real turn change.
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.combat.turnActorId]);

  useEffect(() => {
    if (state.combat.active)
      setScores(Object.fromEntries(state.combat.initiative.map((entry) => [entry.actorId, String(entry.score)])));
  }, [state.combat.active, state.combat.initiative]);
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
      const entries = rosterActors(state.actors)
        .filter((actor) => selectedActors.has(actor.id))
        .map((actor) => {
          const value = scores[actor.id]?.trim();
          return { actorId: actor.id, ...(value ? { score: Number(value) } : {}) };
        });
      if (entries.length === 0) throw new Error("Stage at least one character or monster.");
      return command("encounter:start", {
        mapAssetId: startMapId,
        entries,
        playersRollInitiative,
        expectedRevision: state.revision
      });
    }, "The fight has started. Blank Initiative scores were rolled, and every token is ready in the tray above.");
  // Inline-edit an initiative score: Enter or blur commits, Escape (via cancelEditRef) discards.
  const commitEdit = (actorId: string, previous: number) => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditingActorId(null);
      return;
    }
    setEditingActorId(null);
    const trimmed = editScore.trim();
    if (!validInitiativeScore(trimmed) || Number(trimmed) === previous) return;
    void run(
      () =>
        command("initiative:set", {
          actorId,
          score: Number(trimmed),
          expectedRevision: state.revision
        }),
      "Initiative updated."
    );
  };
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
  const adjustHp = (
    event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp",
    actorId: string,
    name: string,
    options?: { nonlethal?: boolean }
  ) => {
    const value = Number(hpAmount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) {
      setMessage(`Enter a whole number (${minimum}-1000).`);
      return;
    }
    // The type rides only on damage; a leftover "fire" must not travel with Heal, Temp or Set.
    const damageType = event === "actor:apply-damage" ? manualDamageType(hpDamageType) : undefined;
    const typed = damageType ? ` ${damageType}` : "";
    const verbs = {
      "actor:apply-damage": options?.nonlethal
        ? `${name} took ${value} nonlethal${typed} damage.`
        : `${name} took ${value}${typed} damage.`,
      "actor:heal": `${name} healed ${value}.`,
      "actor:set-temp-hp": `${name} has ${value} temporary HP.`,
      "actor:set-hp": `${name} set to ${value} HP.`
    } as const;
    setHpAmount("");
    void run(
      () =>
        event === "actor:set-hp"
          ? command(event, { actorId, current: value, expectedRevision: state.revision })
          : event === "actor:apply-damage"
            ? command(
                event,
                manualDamagePayload({
                  actorId,
                  amount: value,
                  damageType,
                  nonlethal: options?.nonlethal,
                  expectedRevision: state.revision
                })
              )
            : command(event, { actorId, amount: value, expectedRevision: state.revision }),
      verbs[event]
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
  // The acting creature's console under the active row. A normal turn needs no name header (the row
  // names it); an off-turn legendary actor keeps its name.
  const renderActingConsole = () => {
    const turnActor = state.combat.turnActorId ? actorsById.get(state.combat.turnActorId) : undefined;
    const legendaryActor =
      legendaryActingId && legendaryActingId !== state.combat.turnActorId
        ? actorsById.get(legendaryActingId)
        : undefined;
    const actor = legendaryActor ?? turnActor;
    // Legendary creatures act on other creatures' turns (SRD Legendary Actions): offer a console
    // switch for each off-turn legendary combatant with actions left.
    const legendaryOffers = state.combat.initiative
      .flatMap((entry) => {
        const candidate = actorsById.get(entry.actorId);
        return candidate?.legendary?.actionsPerRound &&
          candidate.id !== state.combat.turnActorId &&
          candidate.id !== legendaryActingId
          ? [candidate]
          : [];
      })
      .map((candidate) => ({
        candidate,
        remaining: Math.max(
          0,
          (candidate.legendary!.actionsPerRound ?? 0) - (state.combat.legendaryUsed[candidate.id] ?? 0)
        )
      }));
    if (!actor) return null;
    // At 0 HP a creature is down: its death saves (PCs) show above a dimmed console, and the server
    // rejects its actions (condition.down) unless the GM forces one through the audited override.
    const down = actor.hp.current <= 0;
    const legendaryPool = legendaryActor?.legendary?.actionsPerRound;
    const legendarySpent = legendaryActor ? (state.combat.legendaryUsed[legendaryActor.id] ?? 0) : 0;
    return (
      <>
        {legendaryOffers.length > 0 && (
          <div className="legendary-strip" role="group" aria-label="Legendary actions available">
            {legendaryOffers.map(({ candidate, remaining }) => (
              <button
                key={candidate.id}
                type="button"
                className="legendary-offer"
                disabled={busy || remaining === 0}
                title={
                  remaining === 0
                    ? `${candidate.name} has no legendary actions left this round (they refill when its turn starts).`
                    : `Take a legendary action with ${candidate.name} (used on other creatures' turns).`
                }
                onClick={() => setLegendaryActingId(candidate.id)}
              >
                ⭐ {candidate.name} {remaining}/{candidate.legendary!.actionsPerRound}
              </button>
            ))}
          </div>
        )}
        {down &&
          (actor.deathSaves ? (
            <DyingTracker
              actorId={actor.id}
              name={actor.name}
              deathSaves={actor.deathSaves}
              canRoll
              onFeedback={setMessage}
              rollMode={rollMode}
              isActingTurn={state.combat.turnActorId === actor.id}
            />
          ) : (
            <p className="acting-down-note" role="status">
              <strong>{actor.name} is down (0 HP).</strong> Actions are disabled — click one to force it through a rules
              override.
            </p>
          ))}
        <section
          className={`acting-console${legendaryActor ? " legendary-acting" : ""}${down ? " down" : ""}`}
          aria-label={legendaryActor ? `Legendary action: ${actor.name}` : `Acting now: ${actor.name}`}
        >
          <header className="acting-console-head">
            {/* Only when there is something to show: the legendary actor's name and pool, or the turn
              actor's movement. */}
            {(legendaryActor || actor.speedFeet !== undefined) && (
              <div className="acting-console-title">
                {legendaryActor && <strong className="acting-console-name">{actor.name}</strong>}
                {legendaryActor ? (
                  <span
                    className="economy-slot legendary-pill"
                    title="Legendary actions remaining this round; the pool refills on its own turn."
                  >
                    ⭐ {Math.max(0, (legendaryPool ?? 0) - legendarySpent)}/{legendaryPool}
                  </span>
                ) : (
                  actor.speedFeet !== undefined && (
                    <span
                      className="economy-movement"
                      title="Movement spent this turn / base walking speed (Dash and conditions adjust the real budget server-side)"
                    >
                      {Math.round(state.combat.turn.movementUsedFeet)}/{actor.speedFeet} ft
                    </span>
                  )
                )}
              </div>
            )}
            {legendaryActor ? (
              // Off-turn legendary console: the turn economy belongs to the turn actor, so offer a GM correction
              // (+1) and a way back instead of Action/Bonus/Reaction.
              <div className="acting-console-economy-row">
                <button
                  type="button"
                  className="economy-slot"
                  disabled={busy || legendarySpent === 0}
                  title="Restore one legendary action (GM correction)"
                  onClick={() =>
                    void run(
                      () =>
                        command("turn:use-legendary", {
                          actorId: actor.id,
                          spent: Math.max(0, legendarySpent - 1),
                          expectedRevision: state.revision
                        }),
                      "Legendary action restored."
                    )
                  }
                >
                  +1
                </button>
                <button type="button" className="secondary legendary-done" onClick={() => setLegendaryActingId(null)}>
                  Back to {turnActor?.name ?? "the turn"}
                </button>
              </div>
            ) : (
              <div className="acting-console-economy-row">
                <button
                  type="button"
                  className="economy-slot"
                  aria-pressed={state.combat.turn.actionUsed}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        command("turn:use", {
                          slot: "action",
                          used: !state.combat.turn.actionUsed,
                          expectedRevision: state.revision
                        }),
                      state.combat.turn.actionUsed ? "Action restored." : "Action spent."
                    )
                  }
                >
                  Action
                </button>
                <button
                  type="button"
                  className="economy-slot"
                  aria-pressed={state.combat.turn.bonusActionUsed}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        command("turn:use", {
                          slot: "bonus-action",
                          used: !state.combat.turn.bonusActionUsed,
                          expectedRevision: state.revision
                        }),
                      state.combat.turn.bonusActionUsed ? "Bonus action restored." : "Bonus action spent."
                    )
                  }
                >
                  Bonus
                </button>
                <button
                  type="button"
                  className="economy-slot"
                  aria-pressed={state.combat.reactionsUsed.includes(actor.id)}
                  disabled={busy}
                  title="Reactions refresh on its own turn"
                  onClick={() =>
                    void run(
                      () =>
                        command("turn:use-reaction", {
                          actorId: actor.id,
                          used: !state.combat.reactionsUsed.includes(actor.id),
                          expectedRevision: state.revision
                        }),
                      state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent."
                    )
                  }
                >
                  Reaction
                </button>
              </div>
            )}
          </header>
          <ActionRunner state={state} actor={actor} onFeedback={setMessage} />
        </section>
      </>
    );
  };

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
            <span className="eyebrow">FIGHT</span>
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
                  →
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
            {/* An explicit label, since a screen reader would otherwise read `⋯`. */}
            <button
              type="button"
              ref={menuButtonRef}
              className="encounter-menu-toggle"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Fight options"
              title="Fight options - rules assistant, environment, roster, end"
              onClick={() => setMenuOpen((current) => !current)}
            >
              ⋯
            </button>
            {menuOpen &&
              createPortal(
                <>
                  <div className="encounter-menu-backdrop" onPointerDown={() => setMenuOpen(false)} />
                  <div
                    ref={menuRef}
                    className="encounter-menu anim-dialog"
                    role="menu"
                    aria-label="Fight options"
                    style={
                      menuPos
                        ? {
                            top: menuPos.top,
                            bottom: menuPos.bottom,
                            left: menuPos.left,
                            width: menuPos.width,
                            maxHeight: menuPos.maxHeight
                          }
                        : { visibility: "hidden" }
                    }
                  >
                    {/* The frame does not scroll; this body does. `.encounter-menu::before` (plate, rim, chamfer)
              is `inset: -1px`, so if the menu itself scrolled the plate would scroll away with the
              content. `role="none"` keeps the wrapper out of the menu's accessibility tree. */}
                    <div ref={menuBodyRef} className="encounter-menu-body scroll-y" role="none">
                      <label className="rules-mode-control">
                        Rules assistant
                        <Select
                          value={state.combat.rulesMode}
                          disabled={busy}
                          onChange={(event) => {
                            const mode = event.target.value as "strict" | "assisted" | "freeform";
                            void command("encounter:set-rules-mode", { mode }).then((result) =>
                              setMessage(
                                result.ok
                                  ? `Rules assistant: ${mode === "strict" ? "Enforce" : mode === "assisted" ? "Advise" : "Off"}.`
                                  : (result.message ?? "The rules assistant could not be changed.")
                              )
                            );
                          }}
                        >
                          <option value="strict">Enforce - blocks illegal moves; you can allow them</option>
                          <option value="assisted">Advise - allows everything, leaves notes</option>
                          <option value="freeform">Off - no checks, no prompts</option>
                        </Select>
                      </label>
                      <label className="rules-mode-control">
                        Players' hits
                        <Select
                          value={state.combat.playerDamageMode}
                          disabled={busy}
                          onChange={(event) => {
                            const mode = event.target.value as "proposal" | "direct";
                            void command("encounter:set-player-damage-mode", { mode }).then((result) =>
                              setMessage(
                                result.ok
                                  ? `Players' hits ${mode === "direct" ? "apply directly." : "wait for your OK."}`
                                  : (result.message ?? "The player damage mode could not be changed.")
                              )
                            );
                          }}
                        >
                          <option value="proposal">GM confirms - apply on your tap</option>
                          <option value="direct">Direct - players apply damage</option>
                        </Select>
                      </label>
                      <label className="rules-mode-control">
                        Player initiative
                        <Select
                          value={state.combat.playerInitiativeMode}
                          disabled={busy}
                          onChange={(event) => {
                            const mode = event.target.value as "immediate" | "wait";
                            void command("encounter:set-player-initiative-mode", { mode }).then((result) =>
                              setMessage(
                                result.ok
                                  ? `Player initiative ${mode === "wait" ? "waits for everyone." : "begins immediately."}`
                                  : (result.message ?? "The player initiative mode could not be changed.")
                              )
                            );
                          }}
                        >
                          <option value="immediate">Start now - players roll in</option>
                          <option value="wait">Wait for all players</option>
                        </Select>
                      </label>
                      <label className="rules-mode-control">
                        Health
                        <Select
                          value={state.combat.healthDisplay.style}
                          disabled={busy}
                          onChange={(event) => {
                            const style = event.target.value as "band" | "bar" | "ring" | "aura";
                            void command("encounter:set-health-display", {
                              style,
                              audience: state.combat.healthDisplay.audience
                            }).then((result) =>
                              setMessage(
                                result.ok
                                  ? `Health shows as ${style === "band" ? "a status badge" : style === "bar" ? "an HP bar" : style === "ring" ? "a health ring" : "a health aura"}.`
                                  : (result.message ?? "The health display could not be changed.")
                              )
                            );
                          }}
                        >
                          <option value="band">Status badge</option>
                          <option value="bar">HP bar</option>
                          <option value="ring">Health ring</option>
                          <option value="aura">Health aura</option>
                        </Select>
                      </label>
                      <label className="rules-mode-control">
                        Health is
                        <Select
                          value={state.combat.healthDisplay.audience}
                          disabled={busy || state.combat.healthDisplay.style === "band"}
                          onChange={(event) => {
                            const audience = event.target.value as "gm" | "all";
                            void command("encounter:set-health-display", {
                              style: state.combat.healthDisplay.style,
                              audience
                            }).then((result) =>
                              setMessage(
                                result.ok
                                  ? `Health is ${audience === "all" ? "shown to players" : "GM only"}.`
                                  : (result.message ?? "The health display could not be changed.")
                              )
                            );
                          }}
                        >
                          <option value="gm">GM only</option>
                          <option value="all">Shown to players</option>
                        </Select>
                      </label>
                      <Switch
                        className="environment-control"
                        label="Underwater fight"
                        checked={state.combat.underwater}
                        disabled={busy}
                        onChange={(underwater) =>
                          void command("encounter:set-environment", { underwater }).then((result) =>
                            setMessage(
                              result.ok
                                ? underwater
                                  ? "The fight is now underwater."
                                  : "The fight is no longer underwater."
                                : (result.message ?? "The environment could not be changed.")
                            )
                          )
                        }
                      />
                      <div className="menu-section" role="group" aria-label="Add to the fight">
                        <p className="menu-section-title">Add to the fight</p>
                        {(() => {
                          // Archived characters are out of play and the server refuses them; `rosterActors` also drops a
                          // launched replay's clones.
                          const available = rosterActors(state.actors).filter(
                            (actor) =>
                              !actor.archived && !state.combat.initiative.some((entry) => entry.actorId === actor.id)
                          );
                          /* Same shape as scene prep (ScenePrepPanel.tsx): characters and NPCs listed in full; monsters
                   behind a collapsed `Recent`, ten deep, sorted by the server-stamped `lastUsedAt`. A new monster
                   comes from `+ Add monsters`. */
                          const addable = available.filter((actor) => actor.kind !== "monster");
                          const recent = available
                            .filter((actor) => actor.kind !== "player-character" && actor.lastUsedAt !== undefined)
                            .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
                            .slice(0, RECENT_COUNT);
                          const row = (actor: GmActor) => (
                            <div key={actor.id} className="menu-add-row">
                              <span>
                                {actor.name}
                                {actor.visibility === "gm-only" ? " · GM only" : ""}
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () =>
                                      command("encounter:add-combatant", {
                                        actorId: actor.id,
                                        expectedRevision: state.revision
                                      }),
                                    `${actor.name} joined the fight - their token is in the staging tray.`
                                  )
                                }
                              >
                                Add
                              </button>
                            </div>
                          );
                          return (
                            <>
                              {addable.length > 0 && <div className="menu-add-list">{addable.map(row)}</div>}
                              {/* Only when the roster is truly exhausted; `Recent` may still offer monsters. */}
                              {available.length === 0 && (
                                <p className="menu-empty-note">Everyone on the roster is already in this fight.</p>
                              )}
                              {/* No `.scroll-y` here: `RECENT_COUNT` bounds the list, and a nested scroller inside the
                      body's scroll region is hard to use. */}
                              <details className="menu-add-recent">
                                <summary>Recent{recent.length > 0 ? ` (${recent.length})` : ""}</summary>
                                {recent.length === 0 ? (
                                  <p className="menu-empty-note">Monsters you have used before show up here.</p>
                                ) : (
                                  <div className="menu-add-list">{recent.map(row)}</div>
                                )}
                              </details>
                            </>
                          );
                        })()}
                        <button
                          type="button"
                          className="encounter-add-monsters"
                          disabled={busy}
                          onClick={() => {
                            setBrowsing(true);
                            setMenuOpen(false);
                          }}
                        >
                          + Add monsters
                        </button>
                      </div>
                      <button
                        type="button"
                        className="encounter-end"
                        disabled={busy}
                        onClick={() => {
                          setMenuOpen(false);
                          end();
                        }}
                      >
                        End the fight
                      </button>
                    </div>
                  </div>
                </>,
                document.fullscreenElement ?? document.body
              )}
          </div>
          {confirm && (
            <div className="turn-confirm" role="alertdialog" aria-label="Confirm history change">
              <span>{confirm.message}</span>
              <div className="turn-confirm-actions">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <button
                  type="button"
                  className="encounter-primary"
                  disabled={busy}
                  onClick={() => {
                    const pending = confirm;
                    setConfirm(null);
                    void runTurn(pending.run, pending.success);
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
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
                const actor = actorsById.get(entry.actorId);
                const active = state.combat.turnActorId === entry.actorId;
                const editing = editingActorId === entry.actorId;
                const down = actor !== undefined && actor.hp.current <= 0;
                const expanded = expandedActorId === entry.actorId;
                return (
                  <li
                    key={entry.actorId}
                    ref={active ? activeRowRef : undefined}
                    className={`${active ? "active" : ""}${down ? " down" : ""}${expanded ? " expanded" : ""}`.trim()}
                    aria-current={active ? "step" : undefined}
                  >
                    <div className="initiative-row-main">
                      {/* Row: [avatar | name + HP bar | initiative]. The row opens a floating tools card over the
                list, so rows never shift while you work. */}
                      <button
                        type="button"
                        className="initiative-expand"
                        aria-expanded={expanded}
                        title={
                          expanded
                            ? "Close"
                            : `Manage ${actor?.name ?? "this token"} - HP, conditions, effects, reaction, sheet`
                        }
                        onClick={() => {
                          setExpandedActorId((current) => (current === entry.actorId ? null : entry.actorId));
                          setHpAmount("");
                        }}
                      >
                        <span
                          className={`initiative-avatar ${actor?.kind ?? "npc"}${actor?.visibility === "gm-only" ? " gm-hidden" : ""}`}
                          aria-hidden="true"
                        >
                          {initialsOf(actor?.name ?? "?")}
                        </span>
                        <span className="initiative-main-col">
                          <span className="initiative-name-line">
                            {active && (
                              <span className="initiative-caret" aria-hidden="true">
                                ▶
                              </span>
                            )}
                            <strong className="initiative-name-text">{actor?.name ?? "(removed)"}</strong>
                            {actor && <ConditionDots conditions={actor.conditions} />}
                            {actor && state.combat.reactionsUsed.includes(actor.id) && (
                              <span className="reaction-spent-dot" title="Reaction spent (restore in the row tools)">
                                R
                              </span>
                            )}
                            {actor && (
                              <span
                                className={`initiative-hp-text hp-${actor.hp.current <= 0 ? "down" : actor.hp.current * 2 <= actor.hp.maximum ? "bloodied" : "healthy"}`}
                              >
                                {actor.hp.current}/{actor.hp.maximum}
                                {actor.hp.temporary > 0 ? <small>+{actor.hp.temporary}</small> : null}
                              </span>
                            )}
                          </span>
                          {actor && (
                            <span className="initiative-hpbar" aria-hidden="true">
                              <span
                                className={`initiative-hpbar-fill hp-${actor.hp.current <= 0 ? "down" : actor.hp.current * 2 <= actor.hp.maximum ? "bloodied" : "healthy"}`}
                                style={{
                                  width: `${Math.max(0, Math.min(100, (actor.hp.current / Math.max(1, actor.hp.maximum)) * 100))}%`
                                }}
                              />
                            </span>
                          )}
                        </span>
                      </button>
                      {editing ? (
                        <input
                          className="initiative-score-edit"
                          type="number"
                          min="-1000"
                          max="1000"
                          autoFocus
                          value={editScore}
                          onChange={(event) => setEditScore(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            else if (event.key === "Escape") {
                              cancelEditRef.current = true;
                              event.currentTarget.blur();
                            }
                          }}
                          onBlur={() => commitEdit(entry.actorId, entry.score)}
                        />
                      ) : (
                        /* A quiet inline number; its paint stays small and `.tap-target`'s `::after` provides the 44px
                 hit area, which fits in the row gaps without overlapping `.initiative-expand`. */
                        <button
                          type="button"
                          className="initiative-score-value tap-target"
                          disabled={busy}
                          title="Initiative - click to edit"
                          onClick={() => {
                            setEditScore(String(entry.score));
                            setEditingActorId(entry.actorId);
                          }}
                        >
                          {entry.score}
                        </button>
                      )}
                    </div>
                    {expanded && actor && (
                      <>
                        <div
                          className="encounter-overlay-backdrop"
                          onPointerDown={() => {
                            setExpandedActorId(null);
                          }}
                        />
                        <div className="row-tools-popover" role="dialog" aria-label={`Tools for ${actor.name}`}>
                          <div className="hp-editor" role="group" aria-label={`Adjust hit points for ${actor.name}`}>
                            <input
                              type="number"
                              min="0"
                              max="1000"
                              placeholder="0"
                              autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
                              aria-label="Amount"
                              value={hpAmount}
                              onChange={(event) => setHpAmount(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") adjustHp("actor:apply-damage", entry.actorId, actor.name);
                                else if (event.key === "Escape") {
                                  setExpandedActorId(null);
                                }
                              }}
                            />
                            <button
                              type="button"
                              disabled={busy}
                              title="Apply as damage (or press Enter)"
                              onClick={() => adjustHp("actor:apply-damage", entry.actorId, actor.name)}
                            >
                              Dmg
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="Nonlethal damage - a drop to 0 knocks out (Unconscious and stable) instead of dying"
                              onClick={() =>
                                adjustHp("actor:apply-damage", entry.actorId, actor.name, { nonlethal: true })
                              }
                            >
                              KO
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => adjustHp("actor:heal", entry.actorId, actor.name)}
                            >
                              Heal
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => adjustHp("actor:set-temp-hp", entry.actorId, actor.name)}
                            >
                              Temp
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => adjustHp("actor:set-hp", entry.actorId, actor.name)}
                            >
                              Set
                            </button>
                            {/* Below the buttons, which already fill this row at 375px. Panel state like `hpAmount`, so it
                    survives applying and opening the next row (a fireball is one type across several tokens);
                    it is shown as a chip and named in the confirmation. */}
                            <DamageTypeField value={hpDamageType} disabled={busy} onChange={setHpDamageType} />
                          </div>
                          <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setMessage} />
                          <EffectChips actorId={actor.id} effects={actor.effects} canEnd onFeedback={setMessage} />
                          <div className="initiative-row-tools">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    command("turn:use-reaction", {
                                      actorId: actor.id,
                                      used: !state.combat.reactionsUsed.includes(actor.id),
                                      expectedRevision: state.revision
                                    }),
                                  state.combat.reactionsUsed.includes(actor.id)
                                    ? "Reaction restored."
                                    : "Reaction spent."
                                )
                              }
                            >
                              {state.combat.reactionsUsed.includes(actor.id) ? "Restore reaction" : "Spend reaction"}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setSheetActorId(actor.id);
                                setExpandedActorId(null);
                              }}
                            >
                              Open sheet
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setExpandedActorId(null);
                              }}
                            >
                              Close
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                    {/* The acting console sits under the row, and under the HP/tools popover when open. */}
                    {active && renderActingConsole()}
                    {/* Required decisions and the dying state stay visible whether or not the row is expanded. */}
                    {actor && actor.deathSaves && actor.hp.current <= 0 && state.combat.turnActorId !== actor.id && (
                      <DyingTracker
                        actorId={actor.id}
                        name={actor.name}
                        deathSaves={actor.deathSaves}
                        canRoll
                        onFeedback={setMessage}
                        rollMode={rollMode}
                        isActingTurn={state.combat.turnActorId === actor.id}
                      />
                    )}
                    {actor &&
                      state.combat.pendingSaves
                        .filter((save) => save.targetActorId === actor.id)
                        .map((save) => (
                          <SavePrompt
                            key={save.id}
                            save={save}
                            targetName={actor.name}
                            canDismiss
                            onFeedback={setMessage}
                            rollMode={rollMode}
                            legendaryResistanceLeft={
                              actor.legendary?.resistancesPerDay !== undefined
                                ? Math.max(
                                    0,
                                    actor.legendary.resistancesPerDay - (actor.actionUses["legendary-resistance"] ?? 0)
                                  )
                                : undefined
                            }
                          />
                        ))}
                    {actor &&
                      state.combat.pendingReactions
                        .filter((reaction) => reaction.actorId === actor.id)
                        .map((reaction) => (
                          <ReactionPrompt
                            key={reaction.id}
                            reaction={reaction}
                            actorName={actor.name}
                            canDismiss
                            onFeedback={setMessage}
                            rollMode={rollMode}
                          />
                        ))}
                    {actor &&
                      (state.combat.pendingDamage ?? [])
                        .filter((proposal) => proposal.targetActorId === actor.id)
                        .map((proposal) => (
                          <PendingDamagePrompt key={proposal.id} proposal={proposal} onFeedback={setMessage} />
                        ))}
                  </li>
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
