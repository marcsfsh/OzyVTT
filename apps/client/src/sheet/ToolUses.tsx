import { useState } from "react";
import type { ActorDerivedSheet } from "@vtt/domain";
import { Button, Select } from "@vtt/ui";
import { signed } from "../encounter/format";
import type { SheetActor, SheetState } from "./sheet-model";
import type { SheetRolls } from "./useSheetRolls";

type Derived = ActorDerivedSheet;
type UseRow = Readonly<{
  key: string;
  label: string;
  itemName: string;
  dc: number;
  /** What the roll sends: the tool or the gear, and the use's place in its list. */
  target: Readonly<{ tool?: string; item?: string; index: number; ability: Derived["tools"][number]["ability"] }>;
  carried: boolean;
  forAnother: boolean;
  bonus?: number;
}>;

/** Every Utilize use the character's tools and carried gear print, in one list. */
function useRows(derived: Derived): UseRow[] {
  const tools = derived.tools.flatMap((tool) =>
    tool.uses.map((use, index) => ({
      key: `${tool.id}-${index}`,
      label: use.label,
      itemName: tool.name,
      dc: use.dc,
      target: { tool: tool.id, index, ability: tool.ability },
      carried: tool.carried,
      forAnother: use.forAnother === true
    }))
  );
  const gear = (derived.gearUses ?? []).flatMap((item) =>
    item.uses.map((use, index) => ({
      key: `${item.id}-${index}`,
      label: use.label,
      itemName: item.name,
      dc: use.dc,
      target: { item: item.id, index, ability: use.ability },
      carried: true,
      forAnother: use.forAnother === true,
      bonus: use.bonus
    }))
  );
  return [...tools, ...gear];
}

/**
 * What the character's tools and gear do when it takes the Utilize action, each at its printed DC (SRD 5.2.1 Tools).
 * The server rolls the record's check; a use needs the item in the pack, and in a fight it takes the action, or a
 * Thief's Bonus Action with Fast Hands. Cobbler's Tools work for a creature the roller picks.
 */
export function ToolUses({
  actor,
  derived,
  rolls,
  inFight,
  state
}: Readonly<{
  actor: SheetActor;
  derived: Derived | null;
  rolls: SheetRolls;
  inFight: boolean;
  state?: SheetState | undefined;
}>) {
  const [wearer, setWearer] = useState(actor.id);
  if (!derived) return null;
  const rows = useRows(derived);
  const fastHands = derived.fastHands === true && inFight;
  if (rows.length === 0 && !fastHands) return null;
  const party = (state?.actors ?? []).filter(
    (other) => other.kind === "player-character" && other.id !== actor.id && !("archived" in other && other.archived)
  );
  const roll = (row: UseRow, bonusAction: boolean) =>
    void rolls.rollUse({
      ...row.target,
      label: `${row.label} (${row.itemName})`,
      ...(bonusAction ? { bonusAction: true } : {}),
      ...(row.forAnother && wearer !== actor.id ? { forActorId: wearer } : {})
    });
  return (
    <div className="cs-tool-uses-block">
      <span className="cs-eyebrow">Utilize</span>
      <p className="cs-sub">
        {inFight
          ? "Each use takes your action, and needs the item in your pack."
          : "Each use needs the item in your pack. In a fight it takes your action."}
      </p>
      <ul className="cs-tool-uses" aria-label="Tool uses">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="cs-tool-use-name">
              {row.label} <em>{row.itemName}</em>
              {row.bonus !== undefined && <em> · {signed(row.bonus)}</em>}
              {!row.carried && <strong className="cs-tool-use-why">Not in your pack</strong>}
            </span>
            {row.forAnother && party.length > 0 && (
              <Select
                aria-label={`Who ${row.label} is for`}
                value={wearer}
                disabled={rolls.rolling}
                onChange={(event) => setWearer(event.target.value)}
              >
                <option value={actor.id}>{actor.name}</option>
                {party.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </Select>
            )}
            <span className="cs-tool-use-buttons">
              <Button
                size="sm"
                variant="secondary"
                disabled={rolls.rolling || !row.carried}
                aria-label={`Roll ${row.label} with ${row.itemName}, DC ${row.dc}`}
                onClick={() => roll(row, false)}
              >
                DC {row.dc}
              </Button>
              {fastHands && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rolls.rolling || !row.carried}
                  aria-label={`Roll ${row.label} with ${row.itemName} as a Bonus Action, DC ${row.dc}`}
                  onClick={() => roll(row, true)}
                >
                  Bonus Action
                </Button>
              )}
            </span>
          </li>
        ))}
        {fastHands && (
          <li>
            <span className="cs-tool-use-name">
              Sleight of Hand check <em>Fast Hands</em>
            </span>
            <span className="cs-tool-use-buttons">
              <Button
                size="sm"
                variant="ghost"
                disabled={rolls.rolling}
                aria-label="Roll Dexterity (Sleight of Hand) as a Bonus Action"
                onClick={() =>
                  void rolls.rollCheck(
                    { ability: "dex", skill: "sleight-of-hand" },
                    "Dexterity (Sleight of Hand)",
                    undefined,
                    undefined,
                    { bonusAction: true }
                  )
                }
              >
                Bonus Action
              </Button>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
