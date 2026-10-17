import { useState } from "react";
import { catalogIdOf, type ContentActionSummary, type ContentEquipmentSummary } from "@vtt/domain";
import type { InventoryItem } from "@vtt/schemas";
import { Button, GmOnlyTag, IconChevronLeft, IconChevronRight, Input, NumberField, Select, Stepper } from "@vtt/ui";
import {
  ammunitionKindName,
  BindItemModal,
  EquipmentPicker,
  inventoryWeaponFrom,
  ScrollSpellModal,
  useEquipmentReference
} from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import { slugify, titleCase } from "../encounter/format";
import { SheetDetail, type DetailPlace } from "./SheetDetail";
import type { SheetActor } from "./sheet-model";
import { returnsWords, UseBoxes } from "./Uses";
import type { RowFacts } from "./useSheetDefinition";
import type { SheetEdit } from "./useSheetEdit";

const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;
type Coins = Record<(typeof COINS)[number], number>;

const words = (slug: string) => slug.split("-").map(titleCase).join(" ");

/** The item's own line: a weapon's damage and properties, an armor's AC, else what kind of thing it is. */
export function itemLine(item: InventoryItem): string {
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

/** The server's rows an item gives: its swing (and two-handed and Light forms), a wand's casts, a potion's drink. */
const itemActions = (item: InventoryItem, serverActions: readonly ContentActionSummary[]) =>
  serverActions.filter((row) => row.id === `item-${item.id}` || row.id.startsWith(`item-${item.id}-`));

/** An item's charges: the one pool its actions spend, and what is left of it. */
function chargesOf(rows: readonly ContentActionSummary[], spent: Readonly<Record<string, number>>) {
  const row = rows.find((candidate) => candidate.usesLimit !== null && candidate.usesPer !== "turn");
  if (!row || row.usesLimit === null) return null;
  const pool = row.usesPool ?? row.id;
  return {
    left: Math.max(0, row.usesLimit - (spent[pool] ?? 0)),
    limit: row.usesLimit,
    per: row.usesPer ?? "long-rest"
  };
}

/**
 * The Gear tab: attunement and what fills it, the coins in one row, what is worn and held, then the pack, and a way to
 * add an item. A row is the item's name, one line and its charges; a tap opens its detail (a drawer on a phone, the
 * right column on a laptop), whose primary is the item's own action. Equip, attune, quantity, give and remove live in
 * the detail; the GM's controls there are violet.
 */
export function GearTab({
  actor,
  role,
  busy,
  edit,
  place,
  serverActions,
  facts,
  attunementSlots = 3,
  inFight,
  others = [],
  actionBlocked = null,
  onUseAction
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  busy: boolean;
  edit: SheetEdit;
  place: DetailPlace;
  serverActions: readonly ContentActionSummary[];
  /** The server's word on each row: whether it can be used now, and a swing's Weapon Mastery. */
  facts: ReadonlyMap<string, RowFacts>;
  /** 3, or 4 with Use Magic Device; the server enforces it. */
  attunementSlots?: number;
  /** In a running fight fired ammunition comes back when the fight ends, so there is nothing to pick up yet. */
  inFight: boolean;
  /** The characters the GM can hand an item to. */
  others?: readonly Readonly<{ id: string; name: string }>[];
  /** Why an item's action can't be used from here now ("It isn't your turn."), or null. */
  actionBlocked?: string | null;
  onUseAction: (row: ContentActionSummary) => void;
}>) {
  const inventory = actor.inventory ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [bindingRowId, setBindingRowId] = useState<string | null>(null);
  const [scrollRowId, setScrollRowId] = useState<string | null>(null);
  const [coins, setCoins] = useState<Coins | null>(null);
  const spells = useSpellReference();
  const { catalog } = useEquipmentReference();
  const spent = actor.actionUses ?? {};
  const purse: Coins = {
    pp: actor.currency?.pp ?? 0,
    gp: actor.currency?.gp ?? 0,
    ep: actor.currency?.ep ?? 0,
    sp: actor.currency?.sp ?? 0,
    cp: actor.currency?.cp ?? 0
  };
  const attuned = inventory.filter((item) => item.attuned && item.quantity > 0);
  const fired = inventory.reduce((sum, item) => sum + (item.ammunitionFired ?? 0), 0);
  const summaryOf = (item: InventoryItem) => catalog.find((entry) => entry.id === catalogIdOf(item));
  const nameOf = (item: InventoryItem) => {
    const base = item.baseId ? catalog.find((entry) => entry.id === item.baseId) : undefined;
    const baseName = item.baseId
      ? base?.category === "ammunition"
        ? ammunitionKindName(base)
        : words(item.baseId)
      : null;
    const spellName = item.spellId
      ? (spells.find((spell) => spell.id === item.spellId)?.name ?? words(item.spellId))
      : null;
    return `${item.name}${baseName ? ` (${baseName})` : ""}${spellName ? ` (${spellName})` : ""}`;
  };
  const save = (item: InventoryItem) => void edit("character:set-inventory", { actorId: actor.id, item });

  const ownedCounts = new Map<string, number>();
  for (const item of inventory)
    ownedCounts.set(catalogIdOf(item), (ownedCounts.get(catalogIdOf(item)) ?? 0) + item.quantity);
  // The server upserts by id: a copy on the same base grows the stack, one on another base (or another scroll's
  // spell) is its own row. The server checks the pick and copies the base's stats.
  const addFromCatalog = (entry: ContentEquipmentSummary, baseId?: string, spellId?: string) => {
    const existing = inventory
      .filter((item) => catalogIdOf(item) === entry.id)
      .find(
        (item) =>
          (!entry.appliesTo || baseId === undefined || item.baseId === undefined || item.baseId === baseId) &&
          (!entry.spellScroll || item.spellId === spellId)
      );
    const taken = new Set(inventory.map((item) => item.id));
    let rowId = existing?.id ?? entry.id;
    for (let copy = 2; !existing && taken.has(rowId); copy += 1) rowId = `${entry.id.slice(0, 76)}-${copy}`;
    void edit("character:set-inventory", {
      actorId: actor.id,
      item: {
        id: rowId,
        ...(rowId !== entry.id ? { recordId: entry.id } : {}),
        name: entry.name,
        quantity: (existing?.quantity ?? 0) + 1,
        category: entry.category,
        ...(existing ? { equipped: existing.equipped, attuned: existing.attuned } : {}),
        ...(baseId ? { baseId } : existing?.baseId ? { baseId: existing.baseId } : {}),
        ...(spellId ? { spellId } : {}),
        ...(entry.weightLb != null ? { weightEach: entry.weightLb } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        // The browse summary's mastery is refused by the strict wire schema, so the weapon block is narrowed.
        ...(entry.weapon ? { weapon: inventoryWeaponFrom(entry.weapon) } : {}),
        ...(entry.armor ? { armor: entry.armor } : {})
      }
    });
  };

  const row = (item: InventoryItem) => {
    const rows = itemActions(item, serverActions);
    const mastery = facts.get(`item-${item.id}`)?.mastery ?? null;
    const charges = chargesOf(rows, spent);
    return (
      <li key={item.id}>
        <button
          type="button"
          className={`cs-item interactive${openId === item.id ? " is-open" : ""}`}
          aria-expanded={openId === item.id}
          onClick={() => setOpenId((current) => (current === item.id ? null : item.id))}
        >
          <span className="cs-item-text">
            <strong className="cs-item-name">
              {nameOf(item)}
              {mastery && (
                <>
                  {" · "}
                  <span className="cs-item-mastery">{mastery}</span>
                </>
              )}
              {item.quantity > 1 && <span className="cs-item-qty"> ×{item.quantity}</span>}
              {item.attuned && <span className="cs-tag is-free">Attuned</span>}
            </strong>
            <span className="cs-item-line">
              {[
                itemLine(item),
                item.ammunitionLeft !== undefined ? `${item.ammunitionLeft} left` : null,
                item.ammunitionFired ? `${item.ammunitionFired} fired` : null
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {charges && (
            <UseBoxes
              left={charges.left}
              limit={charges.limit}
              label={`${charges.left} of ${charges.limit} charges left`}
            />
          )}
          <IconChevronRight />
        </button>
      </li>
    );
  };

  const open = inventory.find((item) => item.id === openId && item.quantity > 0) ?? null;
  const detail = open
    ? (() => {
        const rows = itemActions(open, serverActions);
        const charges = chargesOf(rows, spent);
        const summary = summaryOf(open);
        const mastery = facts.get(`item-${open.id}`)?.mastery ?? null;
        const choices = summary?.damageTypeChoice;
        return (
          <section className="cs-card cs-item-detail" aria-label={nameOf(open)}>
            <div className="cs-cast-head">
              <button type="button" className="cs-back interactive" aria-label="Back" onClick={() => setOpenId(null)}>
                <IconChevronLeft />
              </button>
              <span className="cs-cast-title">
                <strong className="cs-cast-name">
                  {nameOf(open)}
                  {mastery ? ` · ${mastery}` : ""}
                </strong>
                <span className="cs-sub">{itemLine(open)}</span>
              </span>
            </div>
            {open.description && <p className="cs-item-desc">{open.description}</p>}
            {charges && (
              <p className="cs-item-charges">
                <UseBoxes
                  left={charges.left}
                  limit={charges.limit}
                  label={`${charges.left} of ${charges.limit} charges left`}
                />
                <span className="cs-sub">
                  {charges.left} of {charges.limit} charges left · {returnsWords(charges.per)}
                </span>
              </p>
            )}
            {open.ammunitionLeft !== undefined && (
              <p className="cs-sub">{open.ammunitionLeft} left in the open bundle.</p>
            )}
            {role === "player" && open.chosenDamageType && (
              <p className="cs-sub">Resists {titleCase(open.chosenDamageType)}.</p>
            )}
            <div className="cs-chiprow">
              <button
                type="button"
                className={`cs-toggle interactive${open.equipped ? " is-on" : ""}`}
                aria-pressed={open.equipped}
                disabled={busy}
                onClick={() => save({ ...open, equipped: !open.equipped })}
              >
                {open.equipped ? "Equipped" : "Equip"}
              </button>
              {/* Only an item that needs attunement takes a slot; a stale attuned row can still be cleared. */}
              {(open.magic?.attunementRequired || open.attuned) && (
                <button
                  type="button"
                  className={`cs-toggle interactive${open.attuned ? " is-on" : ""}`}
                  aria-pressed={open.attuned}
                  disabled={busy}
                  onClick={() => save({ ...open, attuned: !open.attuned })}
                >
                  {open.attuned ? "Attuned" : "Attune"}
                </button>
              )}
              <Stepper
                value={open.quantity}
                min={0}
                disabled={busy}
                aria-label={`Quantity of ${open.name}`}
                onChange={(quantity) => save({ ...open, quantity })}
              />
            </div>
            {!open.spellId && summary?.spellScroll && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setScrollRowId(open.id)}>
                Choose its spell
              </Button>
            )}
            {!open.baseId && summary?.appliesTo && summary.appliesTo.baseIds.length > 0 && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setBindingRowId(open.id)}>
                Choose what it is
              </Button>
            )}
            {role === "gm" && (choices || others.length > 0) && (
              <div className="cs-gmbox cs-item-gm" aria-label="GM tools for this item">
                <span className="cs-section-head">
                  <span className="cs-eyebrow">GM tools</span>
                  <GmOnlyTag />
                </span>
                {/* "The GM chooses the type": only the GM sees and sets it, and the server refuses anyone else. */}
                {choices && (
                  <Select
                    className="cs-gm-select"
                    aria-label={`Resistance type of ${open.name}`}
                    disabled={busy}
                    value={open.chosenDamageType ?? ""}
                    onChange={(event) => {
                      const { chosenDamageType: _old, ...rest } = open;
                      const picked = choices.find((type) => type === event.target.value);
                      save(picked ? { ...rest, chosenDamageType: picked as typeof open.chosenDamageType } : rest);
                    }}
                  >
                    <option value="">Resists: as printed</option>
                    {choices.map((type) => (
                      <option key={type} value={type}>
                        Resists {titleCase(type)}
                      </option>
                    ))}
                  </Select>
                )}
                {others.length > 0 && (
                  <GiveTo
                    itemId={open.id}
                    name={open.name}
                    others={others}
                    busy={busy}
                    actorId={actor.id}
                    edit={edit}
                    onGiven={() => setOpenId(null)}
                  />
                )}
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="cs-danger"
              disabled={busy}
              onClick={() => {
                setOpenId(null);
                save({ ...open, quantity: 0 });
              }}
            >
              Remove {open.name}
            </Button>
            {rows.length > 0 && (
              <div className="cs-item-actions">
                {rows.map((action, index) => {
                  // An action whose charges are all spent waits for them to come back.
                  const empty =
                    action.usesLimit !== null && action.usesLimit - (spent[action.usesPool ?? action.id] ?? 0) <= 0;
                  const why =
                    facts.get(action.id)?.reason ??
                    (empty ? `No charges left. ${returnsWords(action.usesPer ?? "long-rest")}.` : null);
                  return (
                    <span key={action.id} className="cs-item-action">
                      <Button
                        variant={index === 0 ? "primary" : "secondary"}
                        block
                        disabled={busy || actionBlocked !== null || why !== null}
                        onClick={() => onUseAction(action)}
                      >
                        {action.id === `item-${open.id}` && open.weapon ? `Attack with the ${open.name}` : action.name}
                      </Button>
                      {why && actionBlocked === null && <span className="cs-sub">{why}</span>}
                    </span>
                  );
                })}
                {actionBlocked && <p className="cs-sub">{actionBlocked}</p>}
              </div>
            )}
          </section>
        );
      })()
    : null;

  const modals = (
    <>
      {pickerOpen && (
        <EquipmentPicker
          ownedCounts={ownedCounts}
          busy={busy}
          onAdd={addFromCatalog}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {(() => {
        const item = scrollRowId ? inventory.find((entry) => entry.id === scrollRowId) : undefined;
        const summary = item ? summaryOf(item) : undefined;
        if (!item || !summary) return null;
        // The server checks the spell against the scroll's levels and keeps the pick.
        return (
          <ScrollSpellModal
            scroll={summary}
            busy={busy}
            onClose={() => setScrollRowId(null)}
            onPick={(spellId) => {
              save({ ...item, spellId });
              setScrollRowId(null);
            }}
          />
        );
      })()}
      {(() => {
        const item = bindingRowId ? inventory.find((entry) => entry.id === bindingRowId) : undefined;
        const summary = item ? summaryOf(item) : undefined;
        if (!item || !summary) return null;
        // Binding resends the row with the pick; the server validates it and copies the base's stats.
        return (
          <BindItemModal
            template={summary}
            busy={busy}
            onClose={() => setBindingRowId(null)}
            onPick={(baseId) => {
              save({ ...item, baseId });
              setBindingRowId(null);
            }}
          />
        );
      })()}
    </>
  );
  // On a phone the item replaces the list, with a way back.
  if (detail && place.kind === "inline")
    return (
      <div className="cs-gear">
        {detail}
        {modals}
      </div>
    );

  // An attuned item is listed with its attunement, so each item reads once.
  const worn = inventory.filter((item) => item.equipped && !item.attuned && item.quantity > 0);
  const pack = inventory.filter((item) => !item.equipped && !item.attuned && item.quantity > 0);
  return (
    <div className="cs-gear">
      <section className="cs-group" aria-label="Attunement">
        <span className="cs-section-head">
          <span className="cs-eyebrow">Attunement</span>
          <span className="cs-chiprow">
            <span className={`cs-count${attuned.length > attunementSlots ? " is-over" : ""}`}>
              {attuned.length} of {attunementSlots}
            </span>
            <span className="cs-boxes" aria-hidden="true">
              {Array.from({ length: attunementSlots }, (_, index) => (
                <i key={index} className={index < attuned.length ? "is-on" : undefined} />
              ))}
            </span>
          </span>
        </span>
        {attuned.length > 0 ? (
          <ul className="cs-items">{attuned.map(row)}</ul>
        ) : (
          <p className="cs-sub">Nothing is attuned.</p>
        )}
      </section>
      <section className="cs-group" aria-label="Coins">
        <span className="cs-section-head">
          <span className="cs-eyebrow">Coins</span>
          {coins === null ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCoins(purse)}>
              Edit
            </Button>
          ) : (
            <span className="cs-chiprow">
              <Button size="sm" variant="ghost" onClick={() => setCoins(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void edit("character:set-currency", { actorId: actor.id, currency: coins }).then((result) => {
                    if (result.ok) setCoins(null);
                  })
                }
              >
                Save coins
              </Button>
            </span>
          )}
        </span>
        <div className="cs-coins">
          {COINS.map((coin) =>
            coins === null ? (
              <span key={coin} className="cs-stat cs-coin">
                <span className="cs-stat-k">{coin.toUpperCase()}</span>
                <strong className="cs-stat-v">{purse[coin]}</strong>
              </span>
            ) : (
              <label key={coin} className="cs-stat cs-coin">
                <span className="cs-stat-k">{coin.toUpperCase()}</span>
                <NumberField
                  value={coins[coin]}
                  min={0}
                  max={1_000_000}
                  aria-label={`${coin.toUpperCase()} coins`}
                  onChange={(next) => setCoins((current) => ({ ...(current ?? purse), [coin]: next ?? 0 }))}
                />
              </label>
            )
          )}
        </div>
      </section>
      {worn.length > 0 && (
        <section className="cs-group" aria-label="Worn and held">
          <span className="cs-eyebrow">Worn and held</span>
          <ul className="cs-items">{worn.map(row)}</ul>
        </section>
      )}
      <section className="cs-group" aria-label="In the pack">
        <span className="cs-eyebrow">In the pack</span>
        {pack.length > 0 ? <ul className="cs-items">{pack.map(row)}</ul> : <p className="cs-sub">The pack is empty.</p>}
      </section>
      {/* SRD Ammunition: a minute after shooting, half the pieces fired can be picked up again. */}
      {fired > 0 && !inFight && (
        <p className="cs-chiprow">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void edit("character:recover-ammunition", { actorId: actor.id })}
          >
            Pick up fired ammunition
          </Button>
          <span className="cs-sub">Half of the {fired} fired come back, rounded down.</span>
        </p>
      )}
      <section className="cs-group" aria-label="Add an item">
        <span className="cs-eyebrow">Add an item</span>
        <form
          className="cs-add-item"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newItem.trim();
            if (!name) return;
            void edit("character:set-inventory", { actorId: actor.id, item: { id: slugify(name), name, quantity: 1 } });
            setNewItem("");
          }}
        >
          <Input
            value={newItem}
            maxLength={120}
            placeholder="An item of your own"
            aria-label="New item name"
            onChange={(event) => setNewItem(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy || !newItem.trim()}>
            Add
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPickerOpen(true)}>
            Browse SRD gear
          </Button>
        </form>
      </section>
      {detail && (
        <SheetDetail place={place} title={open ? nameOf(open) : ""} onClose={() => setOpenId(null)}>
          {detail}
        </SheetDetail>
      )}
      {modals}
    </div>
  );
}

/** The GM hands the item to another character. */
function GiveTo({
  actorId,
  itemId,
  name,
  others,
  busy,
  edit,
  onGiven
}: Readonly<{
  actorId: string;
  itemId: string;
  name: string;
  others: readonly Readonly<{ id: string; name: string }>[];
  busy: boolean;
  edit: SheetEdit;
  onGiven: () => void;
}>) {
  const [to, setTo] = useState("");
  return (
    <form
      className="cs-give"
      onSubmit={(event) => {
        event.preventDefault();
        if (!to) return;
        void edit("character:give-item", { actorId, toActorId: to, itemId }).then((result) => {
          if (result.ok) onGiven();
        });
      }}
    >
      <Select aria-label={`Give the ${name} to`} value={to} onChange={(event) => setTo(event.target.value)}>
        <option value="">Give it to</option>
        {others.map((other) => (
          <option key={other.id} value={other.id}>
            {other.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" className="cs-gm-control" disabled={busy || !to}>
        Give
      </Button>
    </form>
  );
}
