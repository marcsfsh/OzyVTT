import { useState } from "react";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";
import type { SheetActor } from "./sheet-model";

type Size = NonNullable<SheetActor["size"]>;

/** SRD Malnutrition and Dehydration: a day's food in pounds and water in pints, by size. The server decides what a day
 *  costs; these only say what the line is measured against. */
export const NEEDS: Readonly<Record<Size, Readonly<{ food: number; water: number }>>> = {
  tiny: { food: 0.25, water: 2 },
  small: { food: 1, water: 8 },
  medium: { food: 1, water: 8 },
  large: { food: 4, water: 32 },
  huge: { food: 16, water: 128 },
  gargantuan: { food: 64, water: 512 }
};
const WATERSKIN_PINTS = 4;

type Row = Readonly<{ id: string; recordId?: string; quantity: number; waterPints?: number }>;
const isRow = (id: string) => (row: Row) => (row.recordId ?? row.id) === id && row.quantity > 0;
const pounds = (amount: number) => (amount === 1 ? "1 pound" : `${amount} pounds`);
const pints = (amount: number) => (amount === 1 ? "1 pint" : `${amount} pints`);

/**
 * Today's food and water while the table tracks them: what the character ate and drank, what hunger and thirst hold,
 * and eating or drinking now (a meal, a ration or a Bead of Nourishment, a Goodberry, its fill at a source, a
 * Waterskin). A character holding
 * Goodberries can eat one even when nothing is tracked.
 */
export function FoodAndWater({
  actor,
  role,
  onFeedback
}: Readonly<{ actor: SheetActor; role: "gm" | "player"; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  const today = "nourishment" in actor ? actor.nourishment : undefined;
  const inventory: readonly Row[] = "inventory" in actor && actor.inventory ? actor.inventory : [];
  const berries = inventory.filter(isRow("goodberry")).reduce((sum, row) => sum + row.quantity, 0);
  if (!today && berries === 0) return null;
  const need = NEEDS[actor.size ?? "medium"];
  const rations = inventory.filter(isRow("rations")).reduce((sum, row) => sum + row.quantity, 0);
  const beads = inventory.filter(isRow("bead-of-nourishment")).reduce((sum, row) => sum + row.quantity, 0);
  const water = inventory
    .filter(isRow("waterskin"))
    .reduce((sum, row) => sum + (row.waterPints ?? row.quantity * WATERSKIN_PINTS), 0);
  const held = (today?.hungerLevels ?? 0) + (today?.thirstLevels ?? 0);
  const send = (
    choice: Readonly<{ food?: "meal" | "ration" | "goodberry" | "bead"; water?: "fill" | "waterskin" }>,
    done: string
  ) => {
    setBusy(true);
    void command("actor:nourish", { actorId: actor.id, ...choice }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? done : (result.message ?? "That was refused."));
    });
  };
  return (
    <section className="cs-group cs-food" aria-label="Food and water">
      <span className="cs-eyebrow">Food and water</span>
      {today && (
        <p className="cs-food-line">
          Today {pounds(today.foodPounds)} of {pounds(need.food)} of food, {pints(today.waterPints)} of{" "}
          {pints(need.water)} of water.
          {today.daysUnfed > 0 ? ` ${today.daysUnfed} ${today.daysUnfed === 1 ? "day" : "days"} without food.` : ""}
        </p>
      )}
      {held > 0 && (
        <p className="cs-sub">
          Hunger and thirst hold {held} {held === 1 ? "level" : "levels"} of Exhaustion until a full day&apos;s food and
          water.
        </p>
      )}
      <div className="cs-food-actions">
        {/* A meal or a drink at a source comes from nothing carried, so it is the GM's to give. */}
        {today && role === "gm" && (
          <Button size="sm" disabled={busy} onClick={() => send({ food: "meal" }, "Ate a full meal.")}>
            Eat a meal
          </Button>
        )}
        {today && rations > 0 && (
          <Button size="sm" disabled={busy} onClick={() => send({ food: "ration" }, "Ate a day's Rations.")}>
            Eat a ration ({rations})
          </Button>
        )}
        {today && beads > 0 && (
          <Button size="sm" disabled={busy} onClick={() => send({ food: "bead" }, "Ate a Bead of Nourishment.")}>
            Eat a Bead of Nourishment ({beads})
          </Button>
        )}
        {berries > 0 && (
          <Button size="sm" disabled={busy} onClick={() => send({ food: "goodberry" }, "Ate a Goodberry.")}>
            Eat a Goodberry ({berries})
          </Button>
        )}
        {today && role === "gm" && (
          <Button size="sm" disabled={busy} onClick={() => send({ water: "fill" }, "Drank its fill.")}>
            Drink your fill
          </Button>
        )}
        {today && water > 0 && (
          <Button size="sm" disabled={busy} onClick={() => send({ water: "waterskin" }, "Drank from a Waterskin.")}>
            Drink from a Waterskin ({pints(water)})
          </Button>
        )}
      </div>
      {today && (
        <p className="cs-sub">
          At the day&apos;s end, the Rations, Beads of Nourishment and Waterskins you carry cover what you still need.
        </p>
      )}
    </section>
  );
}
