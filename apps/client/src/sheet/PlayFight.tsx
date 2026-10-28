import { useMemo, useState, type ReactNode } from "react";
import type { ActorDefinition, ContentActionSummary, PlayerView } from "@vtt/domain";
import type { CastShaping } from "@vtt/schemas";
import { PlayerActionRunner, summaryOfOwnAction } from "../encounter/PlayerActionRunner";
import { useSpellReference } from "../encounter/spells";
import { useTableCalibration } from "../scene/tableGeometry";
import { playerTargetCandidates, targetRows } from "../table/targetRows";
import { ActionList } from "./ActionList";
import { CastDetail } from "./CastDetail";
import { SpellPickChooser } from "../encounter/SpellPickChooser";
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
  filter
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
  /** The Actions subtab's choice of rows. */
  filter?: ActionFilter;
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
          {...(filter ? { filter } : {})}
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
        <SheetActionList
          actor={actor}
          definition={definition}
          serverActions={serverActions}
          facts={facts}
          place={place}
          controller={controller}
          {...(filter ? { filter } : {})}
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

/** Which rows an Actions subtab lists, and whether the generic actions (Dash, Dodge) show with them. */
export type ActionFilter = Readonly<{ option: (option: TurnOption) => boolean; common: boolean }>;

/**
 * The list a tap sends straight to the server: the GM's copy in an encounter, and everyone's outside one, where the
 * server rolls the use as the sheet always has (an attack with its damage). A spell first picks its slot.
 */
export function SheetActionList({
  actor,
  definition,
  serverActions,
  facts,
  place,
  controller,
  filter,
  empty
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  serverActions: readonly ContentActionSummary[];
  facts: ReadonlyMap<string, RowFacts>;
  place: DetailPlace;
  controller: SheetController;
  filter?: ActionFilter;
  /** What the list says when it has no rows. */
  empty?: string;
}>) {
  const derivedRows = useMemo(
    () => serverActions.filter((row) => !definition.actions.some((own) => own.id === row.id)),
    [serverActions, definition]
  );
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
  /** A feature whose spell is being picked (Divine Intervention). */
  const [choosing, setChoosing] = useState<TurnOption | null>(null);
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
  const cast = (option: TurnOption, choice: CastOption, shaping: readonly CastShaping[] = []) => {
    const spell = option.spell!;
    if (choice.kind === "free" && spell.freeActionId)
      controller.castSpellAction(spell.freeActionId, undefined, shaping);
    else if (choice.kind === "ritual" && spell.ritualActionId)
      controller.castSpellAction(spell.ritualActionId, undefined, shaping);
    else controller.castSpellAction(option.id, choice.kind === "slot" ? choice.level : undefined, shaping);
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
      onCast={(choice, shaping) => {
        setCasting(null);
        cast(casting, choice, shaping);
      }}
    />
  ) : null;
  if (detail && place.kind === "inline") return detail;
  return (
    <>
      <ActionList
        options={filter ? options.filter(filter.option) : options}
        myTurn
        busy={false}
        {...(empty ? { empty } : {})}
        onUse={(option) => {
          if (option.picks && option.picks.length > 0) {
            setChoosing(option);
            return;
          }
          const choices = choicesOf(option);
          const shapeable = (option.summary.shaping?.options.length ?? 0) > 0;
          if (option.spell && (choices.length > 1 || shapeable)) setCasting(option);
          else if (option.spell && choices.length === 1) cast(option, choices[0]!);
          // Outside an encounter an attack rolls its damage with it, as the Gear tab's does.
          else
            controller.sendThroughServer(
              option.id,
              !controller.inFight && option.summary.damage.length > 0 ? { includeDamage: true } : {}
            );
        }}
      />
      {detail && casting && (
        <SheetDetail place={place} title={`Cast ${casting.name}`} onClose={() => setCasting(null)}>
          {detail}
        </SheetDetail>
      )}
      {choosing && (
        <SpellPickChooser
          option={choosing}
          busy={false}
          onClose={() => setChoosing(null)}
          onPick={(pick) => {
            setChoosing(null);
            controller.castSpellAction(pick.id);
          }}
        />
      )}
    </>
  );
}
