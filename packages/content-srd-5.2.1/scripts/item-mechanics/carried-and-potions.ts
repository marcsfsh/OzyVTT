/**
 * Riders for carried wondrous items (category `wondrous-item`, slot `wondrous`) and potions and oils
 * (category `consumable`). `spell-scroll` is also `consumable` but belongs to neither lane (see
 * `./index.ts`). A rider is authored only where a consumer reads it and produces the printed effect;
 * prose-only items are listed in place with the reason.
 *
 * Recurring limits:
 *   - Consumed items cannot be authored: no `per` value means "never recharges", and an unpooled
 *     action would be unlimited. This rules out every potion and oil and most dusts, beads and gems.
 *   - `itemAction` keeps only `attack`, `save`, `damage` and `uses`; `onHit`, `grants` and the rest
 *     are dropped, so an item action cannot apply a timed effect or an on-hit condition.
 *   - An item's `effects` ignore `duration`, so "Resistance for 1 hour" would be permanent.
 *   - Spell records describe the spell's text, not one cast (see `wands-rods-rings.ts`), and there
 *     is no healing or temporary-HP rider.
 *   - `halfOnSuccessFrom` reads "succeed ... or take X" as half on a success, where the SRD means none.
 *   - One use spends one charge, and pools are capped at 20.
 *   - `ability-score` is refused on items.
 *   - Item actions only resolve inside an encounter. Outside one, `iron-bands` (the only one with an
 *     attack) can still be rolled through the loose route, which spends no charge.
 *
 * A charged item may be authored for its charge alone (count and recharge exact) when the GM can
 * already produce what the charge buys: the elemental summons, `bag-of-tricks`, `gem-of-seeing`,
 * `pipes-of-the-sewers`, `cubic-gate` and `iron-bands`. Not when the sheet would then be wrong
 * (`pearl-of-power`). "Regains 1dN at dawn" becomes a full refill on a long rest.
 *
 * Trap items (`bag-of-devouring`, `potion-of-poison`, `dust-of-sneezing-and-choking`) are not
 * authored: a button naming the real effect would spoil the trap.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const CARRIED_AND_POTIONS: ItemMechanicsModule = {
  // ---- Carried wondrous items (alphabetical, absences inline) ----------------------------------

  // `apparatus-of-the-crab` - a vehicle, not a rider.
  // `bag-of-beans` - a GM-rolled table (temp HP and an ability score among its rows).
  // `bag-of-devouring` - a trap with a percentage pull and instant death.
  // `bag-of-holding` - no capacity/container model (also `handy-haversack`, `efficient-quiver`, `portable-hole`).

  // Charge-alone: three pulls a day. Which beast (a 1d8 table per bag color) is the GM's.
  "bag-of-tricks": {
    actions: [
      {
        id: "pull",
        name: "Pull a Fuzzy Object",
        activation: "action",
        description:
          "Pull the fuzzy object from the bag and throw it up to 20 feet. When the object lands, it transforms into a creature determined by rolling on the table for the bag's color. The creature vanishes at the next dawn or when it is reduced to 0 Hit Points. It is Friendly to you and your allies and acts immediately after you on your Initiative count.",
        uses: { limit: 3, per: "long-rest", pool: "bag-of-tricks-charges" }
      }
    ]
  },

  // `bead-of-force` - destroyed on use, and its save sentence would be read as half on a success.
  // `bead-of-nourishment` - no hunger model.

  /**
   * The four elemental-commanding items (`bowl-of-commanding-water-elementals`,
   * `brazier-of-commanding-fire-elementals`, `censer-of-controlling-air-elementals`,
   * `stone-of-controlling-earth-elementals`): charge-alone at one use per dawn. The elemental itself
   * is added by the GM; nothing mints an actor. Each description follows its own row's wording.
   */
  "bowl-of-commanding-water-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Water Elemental",
        activation: "action",
        description:
          "While this bowl is filled with water and you are within 5 feet of it, summon a Water Elemental. It appears in an unoccupied space as close to the bowl as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The bowl can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "bowl-of-commanding-water-elementals-charges" }
      }
    ]
  },
  "brazier-of-commanding-fire-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Fire Elemental",
        activation: "action",
        description:
          "While you are within 5 feet of this brazier, summon a Fire Elemental. It appears in an unoccupied space as close to the brazier as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The brazier can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "brazier-of-commanding-fire-elementals-charges" }
      }
    ]
  },

  // `broom-of-flying` - Fly Speed is not modeled (also `carpet-of-flying`, `horseshoes-of-a-zephyr`).

  // `candle-of-invocation` - advantage on all D20 Tests while within its light; no light-area gate or burn-down duration.

  // One of the four elemental-commanding items; see the bowl.
  "censer-of-controlling-air-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Air Elemental",
        activation: "action",
        description:
          "While gently swinging this censer, summon an Air Elemental. It appears in an unoccupied space as close to the censer as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The censer can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "censer-of-controlling-air-elementals-charges" }
      }
    ]
  },

  // `chime-of-opening` - ten uses that never come back.

  /**
   * Scrying at the printed DC 17 (the save Scrying's target makes). Any `spell-save-dc` rider in the
   * loadout raises this, since that rider applies to every save-bearing action. The sensor and the
   * save-modifier table stay prose.
   *
   * The Mind Reading and Telepathy orbs' second spells are cast through an active Scrying's sensor;
   * nothing can gate a cast on another cast or a target on a sensor, so they are not authored.
   */
  "crystal-ball": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // Not modeled: Detect Thoughts through the sensor, and waiving its Concentration.
  "crystal-ball-of-mind-reading": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // Not modeled: Suggestion through the sensor, and telepathy near the sensor.
  "crystal-ball-of-telepathy": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // Truesight around the sensor is not modeled.
  "crystal-ball-of-true-seeing": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // `cube-of-force` - faces cost 1 to 5 charges; one-charge buttons would over-grant.

  // Gate and Plane Shift on one shared 3-charge pool. Which plane each side opens is the GM's.
  "cubic-gate": {
    casts: [
      { spellId: "gate", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } },
      { spellId: "plane-shift", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } }
    ]
  },

  // `decanter-of-endless-water` - the geyser save would be read as half on a success.
  // `deck-of-illusions` - illusions and card state are not modeled.
  // `dimensional-shackles` - prevents extradimensional movement, which is not modeled.
  // `dragon-orb` - multi-charge spells, a healing cast, a self-charm on attunement and a curse.

  // `dust-of-disappearance` - single use, rolled duration, area effect.
  // `dust-of-dryness` - consumed pinches; its damage is gated on creature type.
  // `dust-of-sneezing-and-choking` - single use, and a trap.
  // `efficient-quiver` - a container.
  // `efreeti-bottle` - a first-opening table governing later uses.
  // `elemental-gem` - single use.
  // `eversmoking-bottle` - obscurement is not modeled.
  // `feather-token` - six single-use tokens in one row.
  // `figurine-of-wondrous-power` - ten figurines, summons, multi-day cooldowns.
  // `folding-boat` - a vehicle.
  // `gem-of-brightness` - 50 non-renewing charges, a 5-charge option.

  // Charge-alone. Not cast as True Seeing (that spell targets someone you touch); the Truesight is narrated.
  "gem-of-seeing": {
    actions: [
      {
        id: "peer",
        name: "Peer Through the Gem",
        activation: "action",
        description:
          "Expend 1 charge. For the next 10 minutes, you have Truesight out to 120 feet when you peer through the gem.",
        uses: { limit: 3, per: "long-rest", pool: "gem-of-seeing-charges" }
      }
    ]
  },

  // `handy-haversack` - a container.
  // `hat-of-many-spells` - a cast gated on an Arcana check outcome with a wild-magic table.
  // `horn-of-blasting` - authorable except its 20% chance to explode and damage the user; authoring
  //     only the blast would make it strictly better than printed.
  // `horn-of-valhalla` - a 7-day cooldown, summoned berserkers, four metals in one row.
  // `horseshoes-of-a-zephyr` - movement and travel are not modeled.
  // `horseshoes-of-speed` - speed reaches nothing from an item, and it is worn by a horse.
  // `instant-fortress` - a building.
  // `ioun-stone` - fourteen stones in one row; a rider would grant all of them.

  /**
   * Its to-hit is printed as Dexterity + Proficiency Bonus, which is exactly the derived form. Not
   * modeled: Restrained on a hit (`onHit` is dropped), the DC 20 break check, and the bands being
   * destroyed when broken.
   */
  "iron-bands": {
    actions: [
      {
        id: "throw",
        name: "Throw the Bands",
        activation: "action",
        description:
          "Throw the sphere at a Huge or smaller creature you can see within 60 feet of yourself. As the sphere moves through the air, it opens into a tangle of metal bands. On a hit, the target has the Restrained condition until you take a Bonus Action to issue a command that releases it. Doing so or missing with the attack causes the bands to contract and become a sphere once more. A creature that can touch the bands, including the one Restrained, can take an action to make a DC 20 Strength (Athletics) check to break the iron bands. On a successful check, the item is destroyed, and the Restrained creature is freed. On a failed check, any further attempts made by that creature automatically fail until 24 hours have elapsed. Once the bands are used, they can't be used again until the next dawn.",
        attack: { ability: "dex", proficient: true, rangeFeet: 60 },
        uses: { limit: 1, per: "long-rest", pool: "iron-bands-charges" }
      }
    ]
  },

  // No limit on attempts, as printed. Not modeled: the trapping itself and the "native to another
  // plane" precondition (carried in the description for the GM).
  "iron-flask": {
    actions: [
      {
        id: "trap",
        name: "Trap a Creature",
        activation: "action",
        description:
          "Target a creature you can see within 60 feet of yourself. If the flask is empty and the target is native to a plane of existence other than the one you are on, the target must succeed on a DC 17 Wisdom saving throw or be trapped in the flask. Once trapped, a creature remains in the flask until released.",
        save: { ability: "wis", dc: 17 }
      }
    ]
  },

  // `lantern-of-revealing` - no rider suppresses Invisible within a light radius.
  // `manual-of-bodily-health`, `manual-of-gainful-exercise`, `manual-of-quickness-of-action`,
  //     `tome-of-clear-thought`, `tome-of-leadership-and-influence`, `tome-of-understanding` - a
  //     permanent ability increase is a sheet edit, not a reversible item rider (and `ability-score`
  //     is refused on items).
  // `manual-of-golems` - crafting.
  // `marvelous-pigments` - GM fiat, consumed.
  // `mirror-of-life-trapping` - a passive save on anyone who sees their reflection.
  // `mysterious-deck` - GM-fiat cards; the death-save card has no reader.

  // `pearl-of-power` - no rider refunds a spent spell slot (`spell-slot` raises the maximum).

  /**
   * Spends a charge and puts a real DC 15 Wisdom save on the target; the resolver reads Frightened
   * from the description. Not modeled: the 1-minute duration (the GM clears the condition), the
   * repeat save, and the 24-hour immunity after a success.
   */
  "pipes-of-haunting": {
    actions: [
      {
        id: "play",
        name: "Play the Pipes",
        activation: "action",
        description:
          "Expend 1 charge to play an eerie, spellbinding tune. Each creature of your choice within 30 feet of you must succeed on a DC 15 Wisdom saving throw or have the Frightened condition for 1 minute. A creature that fails the save repeats it at the end of each of its turns, ending the effect on itself on a success. A creature that succeeds on its save is immune to the effect of these pipes for 24 hours.",
        save: { ability: "wis", dc: 15 },
        uses: { limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" }
      }
    ]
  },

  /**
   * Charge-alone, one action per swarm (the SRD allows 1-3 charges as one Bonus Action, so this is
   * slower than printed). The swarms and rat attitudes are the GM's; the save printed in the text is
   * made by the swarm, so it is not this action's `save`.
   */
  "pipes-of-the-sewers": {
    actions: [
      {
        id: "call",
        name: "Call a Swarm of Rats",
        activation: "action",
        description:
          "Play the pipes and expend 1 charge, calling forth one Swarm of Rats if enough rats are within half a mile of you to be called in this fashion (as determined by the GM). If there aren't enough rats to form a swarm, the charge is wasted. Called swarms move toward the music by the shortest available route but aren't under your control otherwise.",
        uses: { limit: 3, per: "long-rest", pool: "pipes-of-the-sewers-charges" }
      }
    ]
  },

  // `portable-hole` - a container.
  // `rope-of-climbing` - there is no climb check to gate its advantage on.

  // Unlimited, as printed; the resolver reads Restrained from the description. The escape check is not modeled.
  "rope-of-entanglement": {
    actions: [
      {
        id: "entangle",
        name: "Entangle",
        activation: "action",
        description:
          "Command the other end of the rope to dart forward and entangle one creature you can see within 20 feet of yourself. The target must succeed on a DC 15 Dexterity saving throw or have the Restrained condition. You can release the target by letting go of your end of the rope or by using a Bonus Action to repeat the command.",
        save: { ability: "dex", dc: 15 }
      }
    ]
  },

  // The pairing with the other stone is not modeled.
  "sending-stones": {
    casts: [{ spellId: "sending", uses: { limit: 1, per: "long-rest", pool: "sending-stones-charges" } }]
  },

  // `sovereign-glue` - consumed ounces, GM fiat.
  // `sphere-of-annihilation` - a map hazard controlled by an Arcana check.

  // One of the four elemental-commanding items; this one's wording differs (no languages, placed within 30 feet).
  "stone-of-controlling-earth-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Earth Elemental",
        activation: "action",
        description:
          "While touching this stone to the ground, summon an Earth Elemental. It appears in an unoccupied space you choose within 30 feet of yourself, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The stone can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "stone-of-controlling-earth-elementals-charges" }
      }
    ]
  },

  /**
   * "+1 bonus to ability checks and saving throws". The save half reaches the server's roll; the check
   * half reaches the sheet's skill rows but not the server's own builtin check rolls (Hide, Search...).
   */
  "stone-of-good-luck-luckstone": {
    modifiers: [
      { type: "check-bonus", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  }

  // `universal-solvent` - consumed ounces.
  // `well-of-many-worlds` - a rolled 1d8-hour cooldown and planar travel.
  // `wind-fan` - each reuse risks tearing it; authoring the cast alone would remove the risk.

  // ---- Consumables -----------------------------------------------------------------------------
  // None authored: each is consumed, which no `per` value can express. Prose-only: `elixir-of-health`,
  // `oil-of-etherealness`, `oil-of-sharpness`, `oil-of-slipperiness`, `philter-of-love`,
  // `potion-of-animal-friendship`, `potion-of-clairvoyance`, `potion-of-climbing`,
  // `potion-of-diminution`, `potion-of-growth`, `potion-of-flying`, `potion-of-gaseous-form`,
  // `potion-of-giant-strength`, `potion-of-heroism`, `potion-of-invisibility`,
  // `potion-of-invulnerability`, `potion-of-longevity`, `potion-of-mind-reading`, `potion-of-poison`,
  // `potion-of-resistance`, `potion-of-speed`, `potion-of-vitality`, `potion-of-water-breathing`,
  // `potions-of-healing`.
};
