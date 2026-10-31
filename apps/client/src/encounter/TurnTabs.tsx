import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, LampLight, SegmentedControl, type LampKind } from "@vtt/ui";
import type { CostTab } from "../sheet/turn-options";
import "./turn-tabs.css";

/** A cost the turn spends once: whether it is spent, and whether it can be spent now at all. */
export type CostState = Readonly<{
  used: boolean;
  /** Off the creature's turn an Action or Bonus Action waits: NOT NOW. */
  now: boolean;
  /** Why Mark used or Mark ready can't be pressed (only the GM gives a spent one back). */
  locked?: string | undefined;
}>;

export type TurnEconomy = Readonly<{
  action: CostState;
  bonus: CostState;
  reaction: CostState;
  /** This turn's movement, or null off the turn or with no speed known. */
  move: Readonly<{ speedFeet: number; usedFeet: number }> | null;
  /** A creature with Legendary Actions: how many are left of its pool. */
  legendary?: Readonly<{ left: number; max: number }> | undefined;
  /** Action Surge or Haste gives another action this turn. */
  extraActionReady?: boolean;
}>;

const SPENT_ORDER = ["action", "bonus-action", "reaction"] as const;
type Spendable = (typeof SPENT_ORDER)[number];

const NAMES: Record<CostTab, string> = {
  action: "Action",
  "bonus-action": "Bonus Action",
  reaction: "Reaction",
  move: "Move",
  legendary: "Legendary"
};
const LAMPS: Record<Spendable, LampKind> = { action: "action", "bonus-action": "bonus", reaction: "reaction" };

const costOf = (economy: TurnEconomy, tab: Spendable): CostState =>
  tab === "action" ? economy.action : tab === "bonus-action" ? economy.bonus : economy.reaction;
const stateWord = (cost: CostState) => (!cost.now ? "not now" : cost.used ? "used" : "ready");

/**
 * Which cost tab is chosen: Action at the start of a turn (Reaction while the creature waits), the next unspent cost
 * when the chosen one is spent, and otherwise wherever the person put it.
 */
export function useCostTab(
  turnKey: string,
  economy: TurnEconomy,
  waiting: boolean
): readonly [CostTab, (tab: CostTab) => void] {
  const opening: CostTab = waiting ? "reaction" : "action";
  const [tab, setTab] = useState<CostTab>(opening);
  const key = `${turnKey}:${waiting}`;
  const seenKey = useRef(key);
  useEffect(() => {
    if (seenKey.current === key) return;
    seenKey.current = key;
    setTab(opening);
  }, [key, opening]);
  const spent = SPENT_ORDER.map((cost) => costOf(economy, cost).used);
  const was = useRef(spent);
  const spentKey = spent.join(",");
  useEffect(() => {
    const before = was.current;
    was.current = spent;
    setTab((current) => {
      const index = SPENT_ORDER.indexOf(current as Spendable);
      if (index === -1 || !spent[index] || before[index]) return current;
      const next = SPENT_ORDER.find((cost, at) => !spent[at] && costOf(economy, cost).now);
      return next ?? current;
    });
    // `spentKey` stands for `spent`, which is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spentKey]);
  return [tab, setTab];
}

/**
 * The turn's economy as four tabs in one row (table spec 2.3): Action, Bonus Action and Reaction each with its lamp and
 * state, and Move with the feet left; Legendary is a fifth for a creature with Legendary Actions. Under them the chosen
 * cost's state, with Mark used or Mark ready: the toggle the lamps were. The chosen tab picks what the list shows.
 */
export function TurnTabs({
  label,
  economy,
  tab,
  onTab,
  busy = false,
  onMark,
  legendaryControls,
  feedback
}: Readonly<{
  /** The group's name ("Your turn resources", "This turn"). */
  label: string;
  economy: TurnEconomy;
  tab: CostTab;
  onTab: (tab: CostTab) => void;
  busy?: boolean;
  /** Spends or gives back a cost; absent where it can't be marked here. */
  onMark?: (cost: Spendable, used: boolean) => void;
  /** What the Legendary tab's state line offers (spend one, give one back). */
  legendaryControls?: ReactNode;
  /** A refusal from the last mark. */
  feedback?: string;
}>) {
  const { move, legendary } = economy;
  const feetLeft = move ? Math.max(0, move.speedFeet - Math.round(move.usedFeet)) : null;
  const options = [
    ...SPENT_ORDER.map((cost) => {
      const state = costOf(economy, cost);
      const word = stateWord(state);
      return {
        value: cost,
        ariaLabel: `${NAMES[cost]}, ${word}`,
        label: (
          <span className="turn-tab-face">
            <LampLight kind={LAMPS[cost]} lit={state.now && !state.used} />
            <span className="turn-tab-name">{NAMES[cost]}</span>
            <span className="turn-tab-state">{word.toUpperCase()}</span>
          </span>
        )
      };
    }),
    {
      value: "move",
      ariaLabel: feetLeft === null ? "Move, not now" : `Move, ${feetLeft} feet left`,
      label: (
        <span className="turn-tab-face is-move">
          <span className="turn-tab-feet">{feetLeft === null ? "--" : feetLeft}</span>
          <span className="turn-tab-name">Move</span>
        </span>
      )
    },
    ...(legendary
      ? [
          {
            value: "legendary",
            ariaLabel: `Legendary, ${legendary.left} of ${legendary.max} left`,
            label: (
              <span className="turn-tab-face is-move">
                <span className="turn-tab-feet">{legendary.left}</span>
                <span className="turn-tab-name">Legendary</span>
              </span>
            )
          }
        ]
      : [])
  ];
  const usedFeet = move ? Math.round(move.usedFeet) : 0;
  let line: ReactNode;
  if (tab === "move") {
    line = (
      <>
        <span className="turn-state-words">
          {move
            ? `Move · ${feetLeft} ft left of ${move.speedFeet}${usedFeet > 0 ? ` · ${usedFeet} ft used` : ""}`
            : "Move · on your turn"}
        </span>
        {move && usedFeet > move.speedFeet && (
          <span className="turn-state-extra">{usedFeet - move.speedFeet} ft over</span>
        )}
      </>
    );
  } else if (tab === "legendary") {
    line = (
      <>
        <span className="turn-state-words">
          {legendary ? `Legendary · ${legendary.left} of ${legendary.max} left` : "Legendary"}
        </span>
        {legendaryControls}
      </>
    );
  } else {
    const state = costOf(economy, tab);
    line = (
      <>
        <span className="turn-state-words">
          {NAMES[tab]} · {stateWord(state)}
        </span>
        {tab === "action" && economy.extraActionReady && state.now && (
          <span className="turn-state-extra" title="Action Surge or Haste gives another action this turn">
            +1 action
          </span>
        )}
        {onMark && state.now && (
          <Button
            size="sm"
            variant="secondary"
            className="turn-state-mark"
            disabled={busy || state.locked !== undefined}
            title={state.locked}
            onClick={() => onMark(tab, !state.used)}
          >
            {state.used ? "Mark ready" : "Mark used"}
          </Button>
        )}
      </>
    );
  }
  return (
    <div className="turn-tabs">
      <SegmentedControl
        className="turn-tabs-row"
        ariaLabel={label}
        options={options}
        value={tab}
        onChange={(value) => onTab(value as CostTab)}
      />
      <div className="turn-state" aria-live="polite">
        {line}
      </div>
      {feedback && (
        <p className="turn-state-feedback" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
