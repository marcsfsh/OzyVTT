import { useMemo, useState, type ReactNode } from "react";
import type { ActorDefinition, ContentActionSummary, PlayerView } from "@vtt/domain";
import { PlayerActionRunner, summaryOfOwnAction } from "../encounter/PlayerActionRunner";
import { useSpellReference } from "../encounter/spells";
import { useTableCalibration } from "../scene/tableGeometry";
import { playerTargetCandidates, targetRows } from "../table/targetRows";
import { ActionList } from "./ActionList";
import { CastDetail } from "./CastDetail";
import { EconomyPips } from "./PlayTab";
import { characterLevel, heroicInspirationOf, isDown, type SheetActor, type SheetState } from "./sheet-model";
import { castOptions, preparedState, type CastOption } from "./spell-model";
import { SheetDetail, type DetailPlace } from "./SheetDetail";
import { NO_FACTS, turnOptions, type TurnFacts, type TurnOption } from "./turn-options";
import type { RowFacts } from "./useSheetDefinition";
import type { SheetController } from "./useSheetController";

/** The turn list's facts from the sheet's own read of the server's rows. */
export function turnFactsFrom(
  serverActions: readonly ContentActionSummary[],
  facts: ReadonlyMap<string, RowFacts>
): TurnFacts {
  const entries = [...facts.entries()];
  return {
    ...NO_FACTS,
    rows: new Map(serverActions.map((row) => [row.id, row])),
    ridesAHit: new Set(serverActions.filter((row) => row.ridesAHit).map((row) => row.id)),
    reasons: new Map(entries.flatMap(([id, row]) => (row.reason ? [[id, row.reason] as const] : []))),
    passive: new Set(entries.flatMap(([id, row]) => (row.passive ? [id] : []))),
    mastery: new Map(entries.flatMap(([id, row]) => (row.mastery ? [[id, row.mastery] as const] : [])))
  };
}

/**
 * The Play tab in a fight: the Death Saving Throws first at 0 Hit Points, then everything the character can do,
 * grouped by what it costs. A player acts through the same runner as the table's Turn tab; the GM's copy sends each
 * use to the server, which decides it.
 */
export function PlayFight({
  actor,
  role,
  state,
  definition,
  serverActions,
  facts,
  place,
  controller,
  showEconomy,
  card,
  death,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  state: SheetState | undefined;
  definition: ActorDefinition | null;
  serverActions: readonly ContentActionSummary[];
  facts: ReadonlyMap<string, RowFacts>;
  /** Where a spell's cast detail opens. */
  place: DetailPlace;
  controller: SheetController;
  /** The sheet's own page shows the turn's resources; the table keeps them in its bar. */
  showEconomy: boolean;
  /** A player's phone: the turn card with its favourite tiles. */
  card: boolean;
  death: ReactNode;
  onFeedback: (text: string) => void;
}>) {
  const derivedRows = useMemo(
    () => serverActions.filter((row) => !definition?.actions.some((own) => own.id === row.id)),
    [serverActions, definition]
  );
  // Who the fight's creatures are as the player knows them (who is down, how far each is), for the target list.
  const calibration = useTableCalibration(state?.combat?.mapAssetId ?? null);
  const playerRows = useMemo(() => {
    const view = state as PlayerView | undefined;
    if (role !== "player" || !view?.combat?.initiative) return undefined;
    const everyone = playerTargetCandidates(view);
    return new Map(
      targetRows(actor.id, everyone, view.combat.tokens ?? [], calibration, everyone).map((row) => [row.id, row])
    );
  }, [role, state, actor.id, calibration]);
  if (!definition) return <div className="cs-play">{death}</div>;
  // At 0 Hit Points the Death Saving Throws are the turn; the list would only say it can't be used.
  if (isDown(actor))
    return (
      <div className="cs-play">
        {death}
        <UnconsciousNote name={actor.name} />
      </div>
    );
  const combat = controller.liveCombat;
  const acting = state ? ((state as PlayerView).combat.initiative.find((entry) => entry.active)?.name ?? null) : null;
  const readied = actor.effects.some((effect) => effect.tags.includes("readied"));
  return (
    <div className="cs-play">
      {death}
      {role === "player" && combat ? (
        <PlayerActionRunner
          actorId={actor.id}
          definition={definition}
          extraActions={derivedRows}
          revision={combat.revision}
          inspired={heroicInspirationOf(actor) === true}
          playerDamageMode={combat.playerDamageMode}
          targets={combat.targets}
          {...(playerRows ? { targetRows: playerRows } : {})}
          effectTags={actor.effects.flatMap((effect) => effect.tags)}
          actor={actor}
          myTurn={combat.myTurn || readied}
          offTurn={readied && !combat.myTurn}
          castPlace={place}
          look={card ? "card" : "list"}
          round={state?.combat.round ?? null}
          acting={acting}
          {...(isDown(actor) ? { unavailable: "Unavailable while Unconscious" } : {})}
          header={
            showEconomy && state ? (
              <>
                {!card && !combat.myTurn && (
                  <p className="cs-sub">{acting ?? "Someone else"} is acting. Your Reaction stays ready.</p>
                )}
                <EconomyPips state={state} actorId={actor.id} />
              </>
            ) : null
          }
        />
      ) : (
        <GmPlayList
          actor={actor}
          definition={definition}
          derivedRows={derivedRows}
          serverActions={serverActions}
          facts={facts}
          place={place}
          controller={controller}
          onFeedback={onFeedback}
        />
      )}
    </div>
  );
}

/** What an Unconscious character can do: nothing on a turn, while every other tab stays open for reading. */
export function UnconsciousNote({ name }: Readonly<{ name: string }>) {
  return (
    <section className="cs-group" aria-label="While Unconscious">
      <span className="cs-eyebrow">While Unconscious</span>
      <p className="cs-note">
        While Unconscious, {name} can't take any action or Reaction. The other tabs stay open for reading.
      </p>
    </section>
  );
}

/** The GM's copy of the list: a tap sends the use to the server, a spell first picks its slot. */
function GmPlayList({
  actor,
  definition,
  derivedRows,
  serverActions,
  facts,
  place,
  controller
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  derivedRows: readonly ContentActionSummary[];
  serverActions: readonly ContentActionSummary[];
  facts: ReadonlyMap<string, RowFacts>;
  place: DetailPlace;
  controller: SheetController;
  onFeedback: (text: string) => void;
}>) {
  const spellReference = useSpellReference();
  const spellIndex = useMemo(() => new Map(spellReference.map((entry) => [entry.id, entry])), [spellReference]);
  const options = useMemo(
    () =>
      turnOptions({
        definition,
        actor,
        ownSummaries: new Map(definition.actions.map((action) => [action.id, summaryOfOwnAction(action)])),
        extraActions: derivedRows,
        facts: turnFactsFrom(serverActions, facts),
        spellReference: spellIndex,
        characterLevel: characterLevel(definition) ?? 1
      }),
    [definition, actor, derivedRows, serverActions, facts, spellIndex]
  );
  const [casting, setCasting] = useState<TurnOption | null>(null);
  const choicesOf = (option: TurnOption): CastOption[] =>
    option.spell
      ? castOptions({
          spell: option.spell,
          definition,
          actor,
          content: spellIndex.get(option.spell.id),
          policeSlots: false,
          prepared: preparedState(option.spell, actor, definition) !== "unprepared"
        })
      : [];
  const cast = (option: TurnOption, choice: CastOption) => {
    const spell = option.spell!;
    if (choice.kind === "free" && spell.freeActionId) controller.castSpellAction(spell.freeActionId);
    else if (choice.kind === "ritual" && spell.ritualActionId) controller.castSpellAction(spell.ritualActionId);
    else controller.castSpellAction(option.id, choice.kind === "slot" ? choice.level : undefined);
  };
  const detail = casting?.spell ? (
    <CastDetail
      spell={casting.spell}
      action={casting.summary}
      content={spellIndex.get(casting.spell.id)}
      options={choicesOf(casting)}
      aimed={false}
      busy={false}
      onBack={() => setCasting(null)}
      onCast={(choice) => {
        setCasting(null);
        cast(casting, choice);
      }}
    />
  ) : null;
  if (detail && place.kind === "inline") return detail;
  return (
    <>
      <ActionList
        options={options}
        myTurn
        busy={false}
        onUse={(option) => {
          const choices = choicesOf(option);
          if (option.spell && choices.length > 1) setCasting(option);
          else if (option.spell && choices.length === 1) cast(option, choices[0]!);
          else controller.sendThroughServer(option.id);
        }}
      />
      {detail && casting && (
        <SheetDetail place={place} title={`Cast ${casting.name}`} onClose={() => setCasting(null)}>
          {detail}
        </SheetDetail>
      )}
    </>
  );
}
