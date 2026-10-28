import { useId, useState, type ReactNode } from "react";
import type {
  ActorDefinition,
  ActorDerivedSheet,
  ContentActionSummary,
  PendingSave,
  PlayerPendingSave
} from "@vtt/domain";
import { Tabs } from "@vtt/ui";
import { SavePrompt } from "../encounter/SavePrompt";
import { SavingThrowList } from "./ChecksTab";
import { PlayFight, SheetActionList, type ActionFilter } from "./PlayFight";
import { heroicInspirationOf, type SheetActor, type SheetState } from "./sheet-model";
import type { DetailPlace } from "./SheetDetail";
import type { TurnOption } from "./turn-options";
import type { RowFacts } from "./useSheetDefinition";
import type { SheetController } from "./useSheetController";
import type { SheetRolls } from "./useSheetRolls";

export type ActionSubtab = "all" | "attack" | "action" | "bonus-action" | "reaction" | "other" | "saves";

/** The subtabs in the order a turn reads them, each with its full label. */
export const ACTION_SUBTABS: ReadonlyArray<readonly [ActionSubtab, string]> = [
  ["all", "All"],
  ["attack", "Attack"],
  ["action", "Action"],
  ["bonus-action", "Bonus Action"],
  ["reaction", "Reaction"],
  ["other", "Other"],
  ["saves", "Saving throws"]
];

const isAttack = (option: TurnOption) => option.kind === "weapon" || option.summary.attackBonus !== null;

/** Each list subtab's rows: an attack under Attack as well as under its cost; the generic actions (Dash, Dodge) cost
 *  an Action. */
export const ACTION_FILTERS: Readonly<Record<Exclude<ActionSubtab, "saves">, ActionFilter>> = {
  all: { option: () => true, common: true },
  attack: { option: isAttack, common: false },
  action: { option: (option) => option.cost === "action" || option.cost === "magic", common: true },
  "bonus-action": { option: (option) => option.cost === "bonus-action", common: false },
  reaction: { option: (option) => option.cost === "reaction", common: false },
  other: { option: (option) => option.cost === "other", common: false }
};

const EMPTY: Readonly<Record<Exclude<ActionSubtab, "saves">, string>> = {
  all: "Nothing to use yet.",
  attack: "No attacks. Equip a weapon on the Gear tab.",
  action: "No actions of its own.",
  "bonus-action": "No Bonus Actions.",
  reaction: "No Reactions.",
  other: "Nothing that costs no action."
};

/**
 * The sheet's Actions tab (ADR-0044): everything the character can do, under subtabs by what it costs, and its six
 * saving throws. In an encounter a tap goes the way the table's turn card sends it, so the server checks the turn,
 * the cost and the target; outside one the server rolls it as the sheet always has.
 */
export function ActionsTab({
  actor,
  role,
  state,
  definition,
  derived,
  serverActions,
  facts,
  place,
  controller,
  rolls,
  showEconomy,
  card,
  death,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  state: SheetState | undefined;
  definition: ActorDefinition;
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
  onFeedback: (text: string) => void;
}>) {
  const [subtab, setSubtab] = useState<ActionSubtab>("all");
  const idBase = useId();
  let body: ReactNode;
  if (subtab === "saves")
    body = (
      <SavingThrows
        actor={actor}
        role={role}
        definition={definition}
        derived={derived}
        rolls={rolls}
        owed={controller.savesOwed}
        onFeedback={onFeedback}
      />
    );
  else if (controller.inFight)
    body = (
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
        card={card && subtab === "all"}
        death={death}
        filter={ACTION_FILTERS[subtab]}
      />
    );
  else
    body = (
      <div className="cs-play">
        {death}
        <SheetActionList
          actor={actor}
          definition={definition}
          serverActions={serverActions}
          facts={facts}
          place={place}
          controller={controller}
          filter={ACTION_FILTERS[subtab]}
          empty={EMPTY[subtab]}
        />
      </div>
    );
  return (
    <div className="cs-actions-tab">
      <Tabs
        className="cs-subtabs"
        ariaLabel="Actions"
        idBase={idBase}
        activeId={subtab}
        onChange={(id) => setSubtab(id as ActionSubtab)}
        tabs={ACTION_SUBTABS.map(([id, label]) => ({ id, label }))}
      />
      <div role="tabpanel" id={`${idBase}-panel-${subtab}`} aria-labelledby={`${idBase}-tab-${subtab}`}>
        {body}
      </div>
    </div>
  );
}

/** The six saves: one the character owes takes its ability's row, so the tap answers it; the rest roll freely. */
function SavingThrows({
  actor,
  role,
  definition,
  derived,
  rolls,
  owed,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  definition: ActorDefinition;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  owed: ReadonlyArray<PendingSave | PlayerPendingSave>;
  onFeedback: (text: string) => void;
}>) {
  return (
    <section className="cs-group" aria-label="Saving throws">
      {owed.length > 0 && (
        <p className="cs-sub">
          {owed.length === 1 ? "A save waits" : "Saves wait"} for {actor.name}. Answer{" "}
          {owed.length === 1 ? "it" : "them"} below.
        </p>
      )}
      <SavingThrowList
        definition={definition}
        derived={derived}
        rolls={rolls}
        owed={(ability) => {
          const save = owed.find((candidate) => candidate.ability === ability);
          return save ? (
            <SavePrompt
              save={save}
              targetName={actor.name}
              canDismiss={role === "gm"}
              onFeedback={onFeedback}
              rollMode="auto"
              viewer={role}
              inspired={heroicInspirationOf(actor) === true}
            />
          ) : null;
        }}
      />
    </section>
  );
}
