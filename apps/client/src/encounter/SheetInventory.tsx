import { useEffect, useState } from "react";
import { catalogIdOf, type ContentEquipmentSummary, type GmActor, type PlayerActor } from "@vtt/domain";
import { Badge, Button, IconButton, Select, Stepper, IconX } from "@vtt/ui";
import {
  ammunitionKindName,
  BindItemModal,
  EquipmentPicker,
  inventoryWeaponFrom,
  ScrollSpellModal,
  useEquipmentReference
} from "./equipment";
import { useSpellReference } from "./spells";
import { slugify, titleCase } from "./format";
import type { SheetEdit } from "./useSheetEdit";

const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;

/** A player character's gear: custom and SRD items, equip and attune toggles, and the purse. The GM also picks a
 *  resistance item's type and hands items to other characters. */
export function SheetInventory({
  actor,
  busy,
  edit,
  role = "player",
  others = [],
  attunementSlots = 3,
  inFight = false
}: Readonly<{
  actor: GmActor | PlayerActor;
  busy: boolean;
  edit: SheetEdit;
  role?: "gm" | "player";
  /** 3, or 4 with Use Magic Device; the server enforces it. */
  attunementSlots?: number;
  /** The characters the GM can hand an item to. */
  others?: readonly Readonly<{ id: string; name: string }>[];
  /** In a running fight its fired ammunition comes back when the fight ends, so there is nothing to pick up yet. */
  inFight?: boolean;
}>) {
  const inventory = actor.inventory ?? [];
  const currency = actor.currency ?? null;
  const [newItem, setNewItem] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which unbound template row (a magic weapon/armor with no base picked) has its chooser open, and
  // the catalog its detail resolves against.
  const [bindingRowId, setBindingRowId] = useState<string | null>(null);
  // Which scroll row with no spell yet has its spell list open.
  const [scrollRowId, setScrollRowId] = useState<string | null>(null);
  const spells = useSpellReference();
  const [giveItemId, setGiveItemId] = useState("");
  const [giveTo, setGiveTo] = useState("");
  const { catalog: equipmentCatalog } = useEquipmentReference();
  const [coins, setCoins] = useState({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  // Keep the coin editor in sync with the authoritative purse.
  useEffect(() => {
    setCoins({
      cp: currency?.cp ?? 0,
      sp: currency?.sp ?? 0,
      ep: currency?.ep ?? 0,
      gp: currency?.gp ?? 0,
      pp: currency?.pp ?? 0
    });
  }, [currency?.cp, currency?.sp, currency?.ep, currency?.gp, currency?.pp]);
  const attunedCount = inventory.filter((item) => item.attuned).length;
  const fired = inventory.reduce((sum, item) => sum + (item.ammunitionFired ?? 0), 0);
  // The pick a template row was bound to: magic ammunition names its kind ("Arrows"), a weapon or armor its base.
  const baseLabel = (baseId: string) => {
    const base = equipmentCatalog.find((entry) => entry.id === baseId);
    return base?.category === "ammunition" ? ammunitionKindName(base) : baseId.split("-").map(titleCase).join(" ");
  };
  // The server upserts by id, so adding to an existing stack resends the whole item with quantity+1
  // (keeping equipped/attuned); a new pick starts at 1 with the catalog's category, weight and text.
  const ownedCounts = new Map<string, number>();
  for (const item of inventory)
    ownedCounts.set(catalogIdOf(item), (ownedCounts.get(catalogIdOf(item)) ?? 0) + item.quantity);
  const addFromCatalog = (item: ContentEquipmentSummary, baseId?: string, spellId?: string) => {
    const copies = inventory.filter((entry) => catalogIdOf(entry) === item.id);
    // A template copy bound to another base is its own row (a +1 longsword beside a +1 dagger); the same base, or a
    // row still waiting for its pick, grows the stack. A scroll of another spell is its own row too.
    const existing = copies.find(
      (entry) =>
        (!item.appliesTo || baseId === undefined || entry.baseId === undefined || entry.baseId === baseId) &&
        (!item.spellScroll || entry.spellId === spellId)
    );
    const taken = new Set(inventory.map((entry) => entry.id));
    let rowId = existing?.id ?? item.id;
    for (let copy = 2; !existing && taken.has(rowId); copy += 1) rowId = `${item.id.slice(0, 76)}-${copy}`;
    void edit("character:set-inventory", {
      actorId: actor.id,
      item: {
        id: rowId,
        ...(rowId !== item.id ? { recordId: item.id } : {}),
        name: item.name,
        quantity: (existing?.quantity ?? 0) + 1,
        category: item.category,
        ...(existing ? { equipped: existing.equipped, attuned: existing.attuned } : {}),
        // The template pick from the chooser, or the one the owned row already has (a re-add must not
        // unbind it). The server validates the pick and copies the base's stats.
        ...(baseId ? { baseId } : existing?.baseId ? { baseId: existing.baseId } : {}),
        ...(spellId ? { spellId } : {}),
        ...(item.weightLb != null ? { weightEach: item.weightLb } : {}),
        ...(item.description ? { description: item.description } : {}),
        // Carry the weapon/armor stats so equipping matters. The weapon block is narrowed, not spread: the
        // browse summary's `mastery` is refused by the strict wire schema (see `inventoryWeaponFrom`).
        ...(item.weapon ? { weapon: inventoryWeaponFrom(item.weapon) } : {}),
        ...(item.armor ? { armor: item.armor } : {})
      }
    });
  };
  return (
    <section className="sheet-section">
      <h3>Inventory</h3>
      <form
        className="sheet-add-item"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newItem.trim();
          if (!name) return;
          void edit("character:set-inventory", {
            actorId: actor.id,
            item: { id: slugify(name), name, quantity: 1 }
          });
          setNewItem("");
        }}
      >
        <input
          type="text"
          value={newItem}
          maxLength={120}
          placeholder="Add a custom item…"
          aria-label="New item name"
          onChange={(event) => setNewItem(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !newItem.trim()}>
          Add
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>
          Browse SRD gear
        </Button>
      </form>
      {inventory.length > 0 && (
        <div className="sheet-inv">
          <div className="sheet-inv-row sheet-inv-head" aria-hidden="true">
            <span className="sheet-item-name">Item</span>
            <span>Qty</span>
            <span>Equip</span>
            <span>Attune</span>
            <span></span>
          </div>
          {inventory.map((item) => (
            <div key={item.id} className="sheet-inv-row">
              {/* The row's own description is the only place rarity or attunement requirements appear on
                  the sheet. Clamped to two lines so long entries cannot push the controls off a phone. */}
              {/* A bound template names its base in the row ("Dwarven Thrower (Warhammer)"), from the
                  recorded pick. An unbound template row keeps the item and offers the base chooser. */}
              <span className="sheet-item-name">
                {item.name}
                {item.baseId ? <span className="sheet-item-cat">({baseLabel(item.baseId)})</span> : null}
                {item.spellId ? (
                  <span className="sheet-item-cat">
                    (
                    {spells.find((spell) => spell.id === item.spellId)?.name ??
                      titleCase(item.spellId.replace(/-/g, " "))}
                    )
                  </span>
                ) : null}
                {(() => {
                  const summary = equipmentCatalog.find((entry) => entry.id === catalogIdOf(item));
                  return !item.spellId && summary?.spellScroll ? (
                    <button
                      type="button"
                      className="sheet-toggle-btn tap-target"
                      disabled={busy}
                      onClick={() => setScrollRowId(item.id)}
                    >
                      Choose its spell
                    </button>
                  ) : null;
                })()}
                {item.category ? (
                  <span className="sheet-item-cat">{item.category.split("-").map(titleCase).join(" ")}</span>
                ) : null}
                {(() => {
                  const summary = equipmentCatalog.find((entry) => entry.id === catalogIdOf(item));
                  return !item.baseId && summary?.appliesTo && summary.appliesTo.baseIds.length > 0 ? (
                    <button
                      type="button"
                      className="sheet-toggle-btn tap-target"
                      disabled={busy}
                      onClick={() => setBindingRowId(item.id)}
                    >
                      Choose what it is
                    </button>
                  ) : null;
                })()}
                {(() => {
                  // "The GM chooses the type": only the GM sees and sets the pick (the server refuses anyone else).
                  const choices = equipmentCatalog.find((entry) => entry.id === catalogIdOf(item))?.damageTypeChoice;
                  if (role !== "gm" || !choices) return null;
                  return (
                    <Select
                      className="sheet-item-choice"
                      aria-label={`Resistance type of ${item.name}`}
                      disabled={busy}
                      value={item.chosenDamageType ?? ""}
                      onChange={(event) => {
                        const { chosenDamageType: _old, ...row } = item;
                        const picked = choices.find((type) => type === event.target.value);
                        void edit("character:set-inventory", {
                          actorId: actor.id,
                          item: picked ? { ...row, chosenDamageType: picked as typeof item.chosenDamageType } : row
                        });
                      }}
                    >
                      <option value="">Resists: as printed</option>
                      {choices.map((type) => (
                        <option key={type} value={type}>
                          Resists {titleCase(type)}
                        </option>
                      ))}
                    </Select>
                  );
                })()}
                {/* A partly spent bundle of ammunition: the quantity counts bundles, this the pieces. */}
                {item.ammunitionLeft !== undefined ? (
                  <span className="sheet-item-cat">{item.ammunitionLeft} left</span>
                ) : null}
                {item.ammunitionFired ? <span className="sheet-item-cat">{item.ammunitionFired} fired</span> : null}
                {role === "player" && item.chosenDamageType ? (
                  <span className="sheet-item-cat">Resists {titleCase(item.chosenDamageType)}</span>
                ) : null}
                {item.description ? <span className="sheet-item-desc">{item.description}</span> : null}
              </span>
              <Stepper
                className="sheet-inv-qty"
                value={item.quantity}
                min={0}
                disabled={busy}
                aria-label={`Quantity of ${item.name}`}
                onChange={(quantity) => {
                  void edit("character:set-inventory", {
                    actorId: actor.id,
                    item: { ...item, quantity }
                  });
                }}
              />
              <button
                type="button"
                className={`sheet-toggle-btn${item.equipped ? " on" : ""}`}
                disabled={busy}
                aria-pressed={item.equipped}
                onClick={() => {
                  void edit("character:set-inventory", {
                    actorId: actor.id,
                    item: { ...item, equipped: !item.equipped }
                  });
                }}
              >
                {item.equipped ? "Equipped" : "Equip"}
              </button>
              {/* Only an item that needs attunement takes one of the slots; a stale attuned row can still be cleared. */}
              {item.magic?.attunementRequired || item.attuned ? (
                <button
                  type="button"
                  className={`sheet-toggle-btn${item.attuned ? " on" : ""}`}
                  disabled={busy}
                  aria-pressed={item.attuned}
                  onClick={() => {
                    void edit("character:set-inventory", {
                      actorId: actor.id,
                      item: { ...item, attuned: !item.attuned }
                    });
                  }}
                >
                  {item.attuned ? "Attuned" : "Attune"}
                </button>
              ) : (
                <span className="sheet-inv-blank" aria-hidden="true" />
              )}
              <IconButton
                label={`Remove ${item.name}`}
                size="sm"
                className="sheet-remove"
                disabled={busy}
                onClick={() => {
                  void edit("character:set-inventory", {
                    actorId: actor.id,
                    item: { ...item, quantity: 0 }
                  });
                }}
              >
                <IconX />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      {/* SRD Ammunition: a minute after shooting, half the pieces fired can be picked up again. */}
      {fired > 0 && !inFight && (
        <p className="sheet-recover-ammunition">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void edit("character:recover-ammunition", { actorId: actor.id })}
          >
            Pick up fired ammunition
          </Button>
          <span className="sheet-item-cat">Half of the {fired} fired come back, rounded down.</span>
        </p>
      )}
      {role === "gm" && others.length > 0 && inventory.length > 0 && (
        <form
          className="sheet-give"
          onSubmit={(event) => {
            event.preventDefault();
            if (!giveItemId || !giveTo) return;
            void edit("character:give-item", { actorId: actor.id, toActorId: giveTo, itemId: giveItemId }).then(
              (result) => {
                if (result.ok) setGiveItemId("");
              }
            );
          }}
        >
          <Select aria-label="Item to give" value={giveItemId} onChange={(event) => setGiveItemId(event.target.value)}>
            <option value="">Item to give</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.quantity > 1 ? ` (${item.quantity})` : ""}
              </option>
            ))}
          </Select>
          <Select aria-label="Give it to" value={giveTo} onChange={(event) => setGiveTo(event.target.value)}>
            <option value="">Give it to</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={busy || !giveItemId || !giveTo}>
            Give
          </Button>
        </form>
      )}
      {attunedCount > 0 && (
        <p className="sheet-attunement">
          <Badge tone={attunedCount > attunementSlots ? "danger" : "neutral"}>
            Attunement {attunedCount}/{attunementSlots}
          </Badge>
        </p>
      )}
      {pickerOpen && (
        <EquipmentPicker
          ownedCounts={ownedCounts}
          busy={busy}
          onAdd={addFromCatalog}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {(() => {
        if (!scrollRowId) return null;
        const rowItem = inventory.find((entry) => entry.id === scrollRowId);
        const summary = rowItem ? equipmentCatalog.find((entry) => entry.id === catalogIdOf(rowItem)) : undefined;
        if (!rowItem || !summary) return null;
        // The server checks the spell against the scroll's levels and keeps the pick.
        return (
          <ScrollSpellModal
            scroll={summary}
            busy={busy}
            onClose={() => setScrollRowId(null)}
            onPick={(spellId) => {
              void edit("character:set-inventory", { actorId: actor.id, item: { ...rowItem, spellId } });
              setScrollRowId(null);
            }}
          />
        );
      })()}
      {(() => {
        if (!bindingRowId) return null;
        const rowItem = inventory.find((entry) => entry.id === bindingRowId);
        const summary = rowItem ? equipmentCatalog.find((entry) => entry.id === catalogIdOf(rowItem)) : undefined;
        if (!rowItem || !summary) return null;
        // Binding resends the existing row plus the pick; the server validates and copies the base's stats.
        return (
          <BindItemModal
            template={summary}
            busy={busy}
            onClose={() => setBindingRowId(null)}
            onPick={(baseId) => {
              void edit("character:set-inventory", { actorId: actor.id, item: { ...rowItem, baseId } });
              setBindingRowId(null);
            }}
          />
        );
      })()}
      <div className="sheet-coins">
        {COINS.map((coin) => (
          <label key={coin}>
            {coin}
            <input
              type="number"
              min="0"
              max="1000000"
              value={coins[coin]}
              onChange={(event) =>
                setCoins((prev) => ({
                  ...prev,
                  [coin]: Math.max(0, Math.min(1000000, Math.floor(Number(event.target.value) || 0)))
                }))
              }
            />
          </label>
        ))}
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            void edit("character:set-currency", { actorId: actor.id, currency: coins });
          }}
        >
          Save coins
        </Button>
      </div>
    </section>
  );
}
