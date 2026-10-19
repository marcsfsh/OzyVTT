import { useState } from "react";
import { catalogIdOf, rowUsesKey, type ContentActionSummary, type ContentEquipmentSummary } from "@vtt/domain";
import { ABILITY_NAMES } from "@vtt/rules-5e";
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
import { ItemCard, itemLine } from "./ItemCard";
import { returnsWords, UseBoxes } from "./Uses";
import type { RowFacts } from "./useSheetDefinition";
import type { SheetEdit } from "./useSheetEdit";

const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;
type Coins = Record<(typeof COINS)[number], number>;

const words = (slug: string) => slug.split("-").map(titleCase).join(" ");

/** One printed attunement prerequisite in words, as the server checks it: "a Paladin", "a Spellcaster", "a creature
 *  attuned to a Belt of Dwarvenkind". */
export function prerequisiteWords(prerequisite: string): string {
  const named = (slug: string) =>
    slug
      .split("-")
      .map((word) => (word === "of" || word === "the" ? word : titleCase(word)))
      .join(" ");
  const attunedTo = /^creature-attuned-to-an?-(.+)$/.exec(prerequisite)?.[1];
  return attunedTo !== undefined ? `a creature attuned to a ${named(attunedTo)}` : `a ${named(prerequisite)}`;
}

/** The server's rows an item gives: its swing (and two-handed and Light forms), a wand's casts, a potion's drink. */
const itemActions = (item: InventoryItem, serverActions: readonly ContentActionSummary[]) =>
  serverActions.filter((row) => row.id === `item-${item.id}` || row.id.startsWith(`item-${item.id}-`));

type ChargePool = Readonly<{
  pool: string;
  name: string;
  left: number;
  limit: number;
  per: string;
  afterHours?: string;
}>;

/** An item's charge pools, each with what is left: one its casts share ("Charges"), or a property's own (Staff of
 *  Thunder and Lightning's once-a-day Lightning). */
function chargePoolsOf(rows: readonly ContentActionSummary[], spent: Readonly<Record<string, number>>): ChargePool[] {
  const pools = new Map<string, ChargePool & { spenders: number }>();
  for (const row of rows) {
    if (row.usesLimit === null || row.usesPer === "turn") continue;
    const pool = row.usesPool ?? row.id;
    const known = pools.get(pool);
    pools.set(pool, {
      pool,
      name: known ? "Charges" : row.name,
      left: Math.max(0, Math.max(known?.limit ?? 0, row.usesLimit) - (spent[pool] ?? 0)),
      limit: Math.max(known?.limit ?? 0, row.usesLimit),
      per: row.usesPer ?? "long-rest",
      ...(row.usesAfterHours !== undefined ? { afterHours: row.usesAfterHours } : {}),
      spenders: (known?.spenders ?? 0) + 1
    });
  }
  // A pool its casts share reads as the item's charges.
  return [...pools.values()].map(({ spenders, ...pool }) =>
    spenders > 1 || pool.pool.endsWith("-charges") ? { ...pool, name: "Charges" } : pool
  );
}

/** The pool the item's row shows: the charges its casts share, else its first. */
const chargesOf = (rows: readonly ContentActionSummary[], spent: Readonly<Record<string, number>>) => {
  const pools = chargePoolsOf(rows, spent);
  return pools.find((pool) => pool.name === "Charges") ?? pools[0] ?? null;
};

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
  carrying = null,
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
  /** What the character carries against its carrying capacity, as the server weighs it. */
  carrying?: Readonly<{ pounds: number; capacity: number }> | null;
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
  // The uses left in the copy in hand (a Healer's Kit's ten), which the server counts on the row.
  const usesOf = (item: InventoryItem) => {
    const limit = summaryOf(item)?.uses?.limit;
    return limit === undefined ? null : { left: Math.max(0, limit - (spent[rowUsesKey(item)] ?? 0)), limit };
  };
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
    const variantName = item.variantId
      ? (summaryOf(item)?.variants?.find((variant) => variant.id === item.variantId)?.name ?? words(item.variantId))
      : null;
    return `${item.name}${baseName ? ` (${baseName})` : ""}${spellName ? ` (${spellName})` : ""}${
      variantName ? ` (${variantName})` : ""
    }`;
  };
  const save = (item: InventoryItem) => void edit("character:set-inventory", { actorId: actor.id, item });

  const ownedCounts = new Map<string, number>();
  for (const item of inventory)
    ownedCounts.set(catalogIdOf(item), (ownedCounts.get(catalogIdOf(item)) ?? 0) + item.quantity);
  // The server upserts by id: a copy on the same base grows the stack, one on another base (or another scroll's
  // spell) is its own row. The server checks the pick and copies the base's stats.
  const addFromCatalog = (entry: ContentEquipmentSummary, baseId?: string, spellId?: string) => {
    // A studied book's spent copy is its own row: a new copy has its magic.
    const existing = inventory
      .filter((item) => catalogIdOf(item) === entry.id && !item.dormant)
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
    const uses = usesOf(item);
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
                item.ammunitionFired ? `${item.ammunitionFired} fired` : null,
                uses ? `${uses.left} of ${uses.limit} uses left` : null,
                item.dormant ? "Magic spent" : null
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
        const pools = chargePoolsOf(rows, spent);
        const summary = summaryOf(open);
        const mastery = facts.get(`item-${open.id}`)?.mastery ?? null;
        const choices = summary?.damageTypeChoice;
        const study = summary?.study;
        const kinds = summary?.variants && summary.variantChoice?.by !== "holder" ? summary.variants : null;
        const forms = summary?.variants && summary.variantChoice?.by === "holder" ? summary.variants : null;
        const prerequisites = summary?.attunement?.required ? summary.attunement.restrictedTo : [];
        return (
          <ItemCard
            item={open}
            name={nameOf(open)}
            suffix={mastery ? ` · ${mastery}` : ""}
            before={
              <button type="button" className="cs-back interactive" aria-label="Back" onClick={() => setOpenId(null)}>
                <IconChevronLeft />
              </button>
            }
          >
            {pools.map((charges) => (
              <p key={charges.pool} className="cs-item-charges">
                <UseBoxes
                  left={charges.left}
                  limit={charges.limit}
                  label={`${charges.name}: ${charges.left} of ${charges.limit} left`}
                />
                <span className="cs-sub">
                  {charges.name === "Charges"
                    ? `${charges.left} of ${charges.limit} charges left`
                    : `${charges.name} · ${charges.left} of ${charges.limit} left`}{" "}
                  · {returnsWords(charges.per, charges.afterHours)}
                </span>
              </p>
            ))}
            {open.ammunitionLeft !== undefined && (
              <p className="cs-sub">{open.ammunitionLeft} left in the open bundle.</p>
            )}
            {(() => {
              const uses = usesOf(open);
              return (
                uses && (
                  <p className="cs-item-charges">
                    <UseBoxes left={uses.left} limit={uses.limit} label={`${uses.left} of ${uses.limit} uses left`} />
                    <span className="cs-sub">
                      {uses.left} of {uses.limit} uses left
                      {open.quantity > 1 ? " in this one. The next starts full." : ". Spending the last uses it up."}
                    </span>
                  </p>
                )
              );
            })()}
            {role === "player" && open.chosenDamageType && (
              <p className="cs-sub">Resists {titleCase(open.chosenDamageType)}.</p>
            )}
            {open.dormant ? (
              <p className="cs-sub">Its magic is spent. It regains it in a century.</p>
            ) : (
              study && (
                <p className="cs-sub">
                  {study.hours} hours of study over {study.days} days or fewer raise {ABILITY_NAMES[study.ability]} by{" "}
                  {study.amount}, to at most {study.maximum}.{role === "player" ? " Your GM marks the study done." : ""}
                </p>
              )
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
            {(open.magic?.attunementRequired || open.attuned) && (
              <p className="cs-sub">
                {prerequisites.length > 0
                  ? `Requires attunement by ${prerequisites.map(prerequisiteWords).join(" or ")}. `
                  : ""}
                {role === "player" ? "Attune or end it during a Short Rest." : "You can attune anyone at any time."}
              </p>
            )}
            {forms && (
              <div className="cs-item-forms" role="group" aria-label={`Form of ${open.name}`}>
                <span className="cs-eyebrow">Form</span>
                <div className="cs-chiprow">
                  {[{ id: null, name: "Its own" }, ...forms].map((form) => {
                    const current = (open.variantId ?? null) === form.id;
                    return (
                      <button
                        key={form.id ?? "own"}
                        type="button"
                        className={`cs-toggle interactive${current ? " is-on" : ""}`}
                        aria-pressed={current}
                        disabled={busy || current || !open.equipped}
                        onClick={() =>
                          void edit("item:set-form", { actorId: actor.id, itemId: open.id, variantId: form.id })
                        }
                      >
                        {form.name}
                      </button>
                    );
                  })}
                </div>
                <span className="cs-sub">
                  {open.equipped ? "" : `Hold it to change its form. `}
                  {summary?.variantChoice?.activation === "bonus-action"
                    ? "Changing it takes a Bonus Action in a fight."
                    : ""}
                </span>
              </div>
            )}
            {summary?.light && !summary.light.always && (
              <LightControls
                item={open}
                light={summary.light}
                busy={busy}
                onChange={(change) => void edit("item:set-light", { actorId: actor.id, itemId: open.id, ...change })}
              />
            )}
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
            {role === "player" && kinds && open.variantId && (
              <p className="cs-sub">
                It is {kinds.find((kind) => kind.id === open.variantId)?.name ?? words(open.variantId)}.
              </p>
            )}
            {role === "gm" && (choices || kinds || others.length > 0 || (study && !open.dormant)) && (
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
                {/* What a found copy is (an Ioun Stone's stone) is the GM's to say; the player learns it on attuning. */}
                {kinds && (
                  <Select
                    className="cs-gm-select"
                    aria-label={`Kind of ${open.name}`}
                    disabled={busy}
                    value={open.variantId ?? ""}
                    onChange={(event) => {
                      const { variantId: _old, ...rest } = open;
                      const picked = kinds.find((kind) => kind.id === event.target.value);
                      save(picked ? { ...rest, variantId: picked.id } : rest);
                    }}
                  >
                    <option value="">Kind: not chosen</option>
                    {kinds.map((kind) => (
                      <option key={kind.id} value={kind.id}>
                        {kind.name}
                      </option>
                    ))}
                  </Select>
                )}
                {/* The hours are downtime the GM gives, so the GM says when they are done. */}
                {study && !open.dormant && (
                  <Button
                    size="sm"
                    className="cs-gm-control"
                    disabled={busy}
                    onClick={() => void edit("character:study-item", { actorId: actor.id, itemId: open.id })}
                  >
                    Mark it studied
                  </Button>
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
                    (empty
                      ? `No charges left. ${returnsWords(action.usesPer ?? "long-rest", action.usesAfterHours)}.`
                      : null);
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
          </ItemCard>
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
          gm={role === "gm"}
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
        <span className="cs-section-head">
          <span className="cs-eyebrow">In the pack</span>
          {carrying && (
            <span className={`cs-count${carrying.pounds > carrying.capacity ? " is-over" : ""}`}>
              {carrying.pounds} of {carrying.capacity} lb.
            </span>
          )}
        </span>
        {pack.length > 0 ? <ul className="cs-items">{pack.map(row)}</ul> : <p className="cs-sub">The pack is empty.</p>}
        {carrying && carrying.pounds > carrying.capacity && (
          <p className="cs-sub">That is more than {actor.name} can carry, so their Speed is at most 5 feet.</p>
        )}
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

/** Where a Bullseye Lantern's Cone points, as the map shows it: 0 is to the right, turning clockwise. */
const AIMS = [
  { degrees: 0, label: "Right" },
  { degrees: 45, label: "Down and right" },
  { degrees: 90, label: "Down" },
  { degrees: 135, label: "Down and left" },
  { degrees: 180, label: "Left" },
  { degrees: 225, label: "Up and left" },
  { degrees: 270, label: "Up" },
  { degrees: 315, label: "Up and right" }
] as const;

/** A light source on its row: light it or put it out (it must be in hand, and lighting it takes a Tinderbox or another
 *  flame, which the server checks), lower its hood, and aim its Cone. */
function LightControls({
  item,
  light,
  busy,
  onChange
}: Readonly<{
  item: InventoryItem;
  light: NonNullable<ContentEquipmentSummary["light"]>;
  busy: boolean;
  onChange: (change: Readonly<{ lit?: boolean; hoodLowered?: boolean; facingDegrees?: number }>) => void;
}>) {
  if (!item.equipped) return <p className="cs-sub">Equip it to light it.</p>;
  return (
    <div className="cs-chiprow" role="group" aria-label={`Light of the ${item.name}`}>
      <button
        type="button"
        className={`cs-toggle interactive${item.lit ? " is-on" : ""}`}
        aria-pressed={item.lit === true}
        disabled={busy}
        onClick={() => onChange({ lit: item.lit !== true })}
      >
        {item.lit ? "Lit" : "Light it"}
      </button>
      {light.hooded && (
        <button
          type="button"
          className={`cs-toggle interactive${item.hoodLowered ? " is-on" : ""}`}
          aria-pressed={item.hoodLowered === true}
          disabled={busy}
          onClick={() => onChange({ hoodLowered: item.hoodLowered !== true })}
        >
          {item.hoodLowered ? "Hood down" : "Lower the hood"}
        </button>
      )}
      {light.cone && (
        <Select
          aria-label={`Aim the ${item.name}`}
          disabled={busy}
          value={String(item.facingDegrees ?? 0)}
          onChange={(event) => onChange({ facingDegrees: Number(event.target.value) })}
        >
          {AIMS.map((aim) => (
            <option key={aim.degrees} value={aim.degrees}>
              Aimed {aim.label.toLowerCase()}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
