import type { ReactNode } from "react";
import type { ActorDefinition, ActorDerivedSheet, ContentActionSummary } from "@vtt/domain";
import { PlayFight, SheetActionList } from "./PlayFight";
import { FREE_CAST, FreeCasts, SlotsLeft } from "./PlayTab";
import { UseList, type Pool } from "./Uses";
import type { SheetActor, SheetState } from "./sheet-model";
import type { DetailPlace } from "./SheetDetail";
import type { RowFacts } from "./useSheetDefinition";
import type { SheetController } from "./useSheetController";
import type { SheetRolls } from "./useSheetRolls";

/**
 * The sheet's Actions tab (ADR-0044, ADR-0047): the spell slots left, then everything the character can do in one list
 * grouped by what it costs, laid out as a table, then the uses that come back on a rest. The saving throws are the
 * Save cells of the Abilities card. In an encounter a tap goes the way the table's turn card sends it, so the server
 * checks the turn, the cost and the target; outside one the server rolls it as the sheet always has.
 */
export function ActionsTab({
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
  pools = []
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  state: SheetState | undefined;
  definition: ActorDefinition;
  /** Kept for callers; the saving throws now live in the Abilities card. */
  derived: ActorDerivedSheet | null;
  serverActions: readonly ContentActionSummary[];
  facts: ReadonlyMap<string, RowFacts>;
  place: DetailPlace;
  controller: SheetController;
  rolls: SheetRolls;
  showEconomy: boolean;
  /** A player's phone: All shows the turn card with its favourite tiles. */
  card: boolean;
  death: ReactNode;
  /** The uses that come back on a rest, for the Limited use group at the end. */
  pools?: readonly Pool[];
  onFeedback: (text: string) => void;
}>) {
  const restPools = pools.filter((pool) => pool.per === "short-rest" || pool.per === "long-rest");
  const body = controller.inFight ? (
    <PlayFight
      actor={actor}
      role={role}
      state={state}
      definition={definition}
      serverActions={serverActions}
      facts={facts}
      place={place}
      controller={controller}
      showEconomy={showEconomy}
      card={card}
      death={death}
    />
  ) : (
    <div className="cs-play">
      {death}
      <SheetActionList
        actor={actor}
        definition={definition}
        serverActions={serverActions}
        facts={facts}
        place={place}
        controller={controller}
        empty="Nothing to use yet."
      />
    </div>
  );
  return (
    <div className="cs-actions-tab">
      <SlotsLeft definition={definition} actor={actor} />
      {body}
      {restPools.length > 0 && (
        <section className="cs-group" aria-label="Limited use">
          <span className="cs-eyebrow">Limited use</span>
          <UseList
            actorId={actor.id}
            role={role}
            pools={restPools.filter((pool) => !FREE_CAST.test(pool.name))}
            spent={actor.actionUses ?? {}}
            actions={false}
          />
          <FreeCasts pools={restPools.filter((pool) => FREE_CAST.test(pool.name))} spent={actor.actionUses ?? {}} />
        </section>
      )}
    </div>
  );
}
