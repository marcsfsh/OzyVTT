import type { ReactNode } from "react";
import type { InventoryItem } from "@vtt/schemas";
import { titleCase } from "../encounter/format";
import "./sheet.css";

const words = (slug: string) => slug.split("-").map(titleCase).join(" ");

/** What an item's line reads from: an inventory row and a catalog row have these in the same shape. */
export type ItemLineSource = Readonly<{
  weapon?: Readonly<
    Pick<
      NonNullable<InventoryItem["weapon"]>,
      "damageDice" | "damageType" | "rangeFeet" | "longRangeFeet" | "versatileDice"
    > & {
      properties?: readonly string[];
    }
  > | null;
  armor?: Pick<
    NonNullable<InventoryItem["armor"]>,
    "acBase" | "addDexModifier" | "dexModifierCap" | "strengthRequired" | "stealthDisadvantage"
  > | null;
  description?: string | null;
  category?: string | null;
}>;

/** The item's own line: a weapon's damage and properties, an armor's AC, else what kind of thing it is. */
export function itemLine(item: ItemLineSource): string {
  if (item.weapon) {
    const weapon = item.weapon;
    const range = weapon.rangeFeet ? ` (${weapon.rangeFeet}/${weapon.longRangeFeet ?? weapon.rangeFeet})` : "";
    const properties = (weapon.properties ?? []).map((property) =>
      property === "versatile" && weapon.versatileDice
        ? `Versatile (${weapon.versatileDice})`
        : property === "thrown" || property === "ammunition"
          ? `${words(property)}${range}`
          : words(property)
    );
    return [`${weapon.damageDice} ${weapon.damageType}`, properties.join(", ")].filter(Boolean).join(" · ");
  }
  if (item.armor) {
    const armor = item.armor;
    const dex = armor.addDexModifier
      ? armor.dexModifierCap !== null
        ? ` + Dex (up to ${armor.dexModifierCap})`
        : " + Dex"
      : "";
    return [
      armor.acBase <= 3 && !armor.addDexModifier ? `+${armor.acBase} AC` : `AC ${armor.acBase}${dex}`,
      armor.strengthRequired ? `Strength ${armor.strengthRequired}` : null,
      armor.stealthDisadvantage ? "Stealth Disadvantage" : null
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const sentence = item.description?.split(/(?<=\.)\s/)[0] ?? "";
  return sentence || (item.category ? words(item.category) : "");
}

/**
 * An item as the sheet shows it: its name, its line and its text, with whatever the place adds under them (the
 * sheet's charges and controls). The Compendium's item card is this card.
 */
export function ItemCard({
  item,
  name,
  suffix = "",
  before,
  children
}: Readonly<{
  item: ItemLineSource;
  name: string;
  /** After the name: a mastered weapon's property. */
  suffix?: string;
  /** Before the name: the sheet's Back. */
  before?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <section className="cs-card cs-item-detail" aria-label={name}>
      <div className="cs-cast-head">
        {before}
        <span className="cs-cast-title">
          <strong className="cs-cast-name">
            {name}
            {suffix}
          </strong>
          <span className="cs-sub">{itemLine(item)}</span>
        </span>
      </div>
      {item.description && <p className="cs-item-desc">{item.description}</p>}
      {children}
    </section>
  );
}
