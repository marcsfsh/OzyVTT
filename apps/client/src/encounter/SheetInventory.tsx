import { useEffect, useState } from "react";
import type { ContentEquipmentSummary, GmActor, PlayerActor } from "@vtt/domain";
import { Badge, Button, IconButton, Stepper, IconX } from "@vtt/ui";
import { BindItemModal, EquipmentPicker, inventoryWeaponFrom, useEquipmentReference } from "./equipment";
import { slugify, titleCase } from "./format";
import type { SheetEdit } from "./useSheetEdit";

const COINS = ["pp", "gp", "ep", "sp", "cp"] as const;

/** A player character's gear: custom and SRD items, equip and attune toggles, and the purse. */
export function SheetInventory({
  actor,
  busy,
  edit
}: Readonly<{ actor: GmActor | PlayerActor; busy: boolean; edit: SheetEdit }>) {
  const inventory = actor.inventory ?? [];
  const currency = actor.currency ?? null;
  const [newItem, setNewItem] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which unbound template row (a magic weapon/armor with no base picked) has its chooser open, and
  // the catalog its detail resolves against.
  const [bindingRowId, setBindingRowId] = useState<string | null>(null);
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
  // The server upserts by id, so adding to an existing stack resends the whole item with quantity+1
  // (keeping equipped/attuned); a new pick starts at 1 with the catalog's category, weight and text.
  const ownedCounts = new Map(inventory.map((item) => [item.id, item.quantity]));
  const addFromCatalog = (item: ContentEquipmentSummary, baseId?: string) => {
    const existing = inventory.find((entry) => entry.id === item.id);
    void edit("character:set-inventory", {
      actorId: actor.id,
      item: {
        id: item.id,
        name: item.name,
        quantity: (existing?.quantity ?? 0) + 1,
        category: item.category,
        ...(existing ? { equipped: existing.equipped, attuned: existing.attuned } : {}),
        // The template pick from the chooser, or the one the owned row already has (a re-add must not
        // unbind it). The server validates the pick and copies the base's stats.
        ...(baseId ? { baseId } : existing?.baseId ? { baseId: existing.baseId } : {}),
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
                {item.baseId ? (
                  <span className="sheet-item-cat">({item.baseId.split("-").map(titleCase).join(" ")})</span>
                ) : null}
                {item.category ? (
                  <span className="sheet-item-cat">{item.category.split("-").map(titleCase).join(" ")}</span>
                ) : null}
                {(() => {
                  const summary = equipmentCatalog.find((entry) => entry.id === item.id);
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
      {attunedCount > 0 && (
        <p className="sheet-attunement">
          <Badge tone={attunedCount > 3 ? "danger" : "neutral"}>Attunement {attunedCount}/3</Badge>
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
        if (!bindingRowId) return null;
        const rowItem = inventory.find((entry) => entry.id === bindingRowId);
        const summary = equipmentCatalog.find((entry) => entry.id === bindingRowId);
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
