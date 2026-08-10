/**
 * Barbarian mechanics - the GENERATED half of the overlay for this class and for Path of the Berserker.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B1. Author here and nowhere else: this file is the only place a Barbarian
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const barbarian: ClassMechanicsModule = {
  features: {
    /**
     * RAGE, as the SRD prints it, in the vocabulary the engine already resolves.
     *
     * `uses` reads the printed **Rages** column rather than restating it as a `by-level` table -
     * that is what `scaling: {type: "class-resource"}` exists for, and it is why the barbarian's
     * `rage` column is no longer marked `display: true`: it is now a live pool the engine spends.
     *
     * The action grants the effect, so Rage is entered the way every other self-buff is entered and
     * ends the way every other one ends. `tags: ["raging"]` is the tag `ActionSchema.requiresEffectTag`
     * already gates on, which is how a subclass's while-raging feature will attach later.
     *
     * WHAT STAYS PROSE, deliberately (ADR-0008). Rage Damage scales off a second printed column and
     * the effect vocabulary has no column-scaled `damage-bonus`, so it is not authored here rather
     * than authored wrong. The 10-minute cap, the extend-by-attacking clause and the heavy-armor
     * restriction are likewise judgement calls at the table, and the description carries all of them.
     */
    rage: {
      uses: { scaling: { type: "class-resource", id: "rage" }, per: "long-rest" },
      actions: [{
        id: "rage",
        name: "Rage",
        activation: "bonus-action",
        description: "You enter a Rage: Resistance to Bludgeoning, Piercing and Slashing damage, Advantage on Strength checks and Strength saving throws, and a bonus to Strength-based damage. You can't concentrate or cast spells while raging.",
        damage: [],
        grants: {
          name: "Raging",
          tags: ["raging"],
          duration: { type: "encounter" },
          modifiers: [
            { type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] },
            { type: "roll-mode", roll: "check", mode: "advantage", when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }] },
            { type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str"] }] }
          ]
        }
      }]
    },
    /**
     * "While you aren't wearing any armor, your base Armor Class equals 10 plus your Dexterity and
     * Constitution modifiers. You can use a Shield and still gain this benefit."
     *
     * `allowShield: true` is the whole difference between the Barbarian's Unarmored Defense and the
     * Monk's, and it is exactly why the overlay is keyed on (recordId, featureId) and never on a bare
     * feature id: both classes print `unarmored-defense` and the two records disagree.
     */
    "unarmored-defense": {
      modifiers: [{ type: "unarmored-defense", ability: "con", allowShield: true }]
    },
    /**
     * WEAPON MASTERY, as many as the printed column says: 2 -> 3 (L4) -> 4 (L10).
     *
     * Same shape as the Fighter's and the Warlock's Invocations; `choose: 2` plus the growth is the
     * printed number at every level. Paladin, Ranger and Rogue are deliberately NOT here: the SRD
     * prints no Weapon Mastery column for them and their text says a flat "two kinds of weapons".
     */
    "weapon-mastery": {
      extraPicks: [{ offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }]
    },
    /**
     * "You have Advantage on Dexterity saving throws unless you have the Incapacitated condition."
     *
     * The moment-plus-filter form `saveRollSources` documents by name: `on-saving-throw` says WHEN and
     * `ability-is` narrows it to the one ability, so the advantage lands on a Dexterity save and on
     * nothing else. The Incapacitated exception has no vocabulary on a `roll-mode` rider (`when` is an
     * AND-list with no negation - ADR-0008) and stays in the prose.
     */
    "danger-sense": {
      modifiers: [{ type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] }]
    },
    /**
     * RECKLESS ATTACK - the feature `EffectGrantSchema`'s own docstring names ("Rage, Reckless
     * Attack") and the first record in the whole bundle to use the `effects` half of the vocabulary.
     *
     * Authored as `effects` rather than `actions`: a feature with an effect grant and no action of
     * its own gets a synthesized activation from `interpretFeature`, so there is nothing for a
     * hand-written action wrapper to add. `attack-advantage` is documented as carrying exactly this
     * feature's semantics (the bearer's own turn), and `incoming-attack-advantage` is the cost.
     *
     * WHAT STAYS PROSE: "using Strength". `attack-advantage` takes no gate, and the general
     * `roll-mode` form would need an `ability-is` filter on an ATTACK roll, which the attack path
     * narrows by weapon and kind rather than by the ability the attack uses.
     */
    "reckless-attack": {
      effects: [{
        name: "Reckless Attack",
        tags: ["reckless-attack"],
        duration: { type: "until-source-next-turn" },
        modifiers: [{ type: "attack-advantage" }, { type: "incoming-attack-advantage" }]
      }]
    },
    /**
     * "You gain proficiency in another skill of your choice from the skill list available to
     * Barbarians at level 1." - audit row 20, and the textbook case `extraPicks` was built for.
     *
     * A budget, not a new list: `class-skills` is already scoped to the Barbarian's own six, already
     * offered by the wizard, and already validated by the server. Before the rider this needed the
     * class's skill list restated in a `from: [...]`, which is a second copy of the list one line
     * above it in the same record.
     *
     * The "make it as a Strength check" half is a re-ability-ing of five named skills while raging.
     * There is no rider for it and it is not a pick, so it stays prose.
     */
    "primal-knowledge": {
      extraPicks: [{ offer: "class-skills", amount: 1 }]
    },
    /**
     * "You can attack twice instead of once whenever you take the Attack action on your turn."
     *
     * AUTHORED, AND MEASURED AS REACHING NOTHING TODAY - said out loud because the alternative is a
     * silent claim. `interpretFeature` folds `extra-attack` into `interpreted.extraAttacks` and then
     * raises `attack.count` on the feature actions that carry an `attack` of their own; a martial
     * class has none, because its weapon attacks are derived from the equipped inventory at play
     * time. Removing this rider leaves the built definition byte-identical.
     *
     * It stays because it is the vocabulary's own name for this feature and because the shipped
     * HAND_AUTHORED Fighter carries the identical rider on `extra-attack`, `two-extra-attacks` and
     * `three-extra-attacks`. Deleting it here would leave the SRD's three martial classes disagreeing
     * about one printed feature, and would hide the gap instead of recording it.
     */
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },
    /**
     * "Your speed increases by 10 feet while you aren't wearing Heavy armor."
     *
     * Authored UNGATED on purpose, and it is not a shortcut: the Barbarian's armor training is
     * `["light", "medium", "shields"]`, so a legal Barbarian never satisfies the exclusion. (The gate
     * would also be inert if authored - `interpretFeature`'s `speed` case folds the amount into
     * `speedBonus` without reading `when`, which is the general limitation of the eight build-time
     * baked riders.)
     */
    "fast-movement": {
      modifiers: [{ type: "speed", amount: 10 }]
    },
    /** "Your instincts are so honed that you have Advantage on Initiative rolls." */
    "feral-instinct": {
      modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }]
    },
    /**
     * "When you roll Initiative, you can regain all expended uses of Rage. ... you can't do so again
     * until you finish a Long Rest."
     *
     * The once-per-long-rest permission is the mechanical half and it is a real pool: a feature with
     * `uses` and no action gets a synthesized activation, so the table can see it spent and a Long
     * Rest re-arms it. The refill itself ("regain all expended uses of Rage") would be a rider that
     * writes another pool's counter, which no vocabulary has - the GM taps Rage back up, as they do
     * for every other printed refill.
     */
    "persistent-rage": {
      uses: { limit: 1, per: "long-rest" }
    },
    /**
     * "You gain an Epic Boon feat ... or another feat of your choice" - audit row 6, the Barbarian's
     * share of the nine classes that lost their level-19 feat outright.
     *
     * Identical to the line Cleric, Fighter and Wizard already carry; the catalog resolves (seven
     * epic-boon feats ship) and `choice.maximum: 30` lives on the feats themselves.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },
    /**
     * "Your Strength and Constitution scores increase by 4, to a maximum of 25."
     *
     * `maximum` is the reason this is authorable at all: the builder clamps every increase at 20
     * unless the rider says otherwise, and a level-20 Barbarian is precisely the character already
     * sitting at 20.
     */
    "primal-champion": {
      modifiers: [
        { type: "ability-score", ability: "str", amount: 4, maximum: 25 },
        { type: "ability-score", ability: "con", amount: 4, maximum: 25 }
      ]
    }
  },
  subclasses: {
    "path-of-the-berserker": {
      /**
       * "each creature of your choice in a 30-foot Emanation ... must make a Wisdom saving throw
       * (DC 8 plus your Strength modifier and Proficiency Bonus). On a failed save, a creature has
       * the Frightened condition for 1 minute."
       *
       * The derived save DC - `FeatureSaveDcSchema`'s third form - so the number is the character's
       * own, not a printed constant. The Frightened condition needs no separate field: the resolver
       * reads it off THIS action's prose (`conditionFrom`), which is why the description below names
       * it in as many words.
       *
       * WHAT STAYS PROSE: the 30-foot Emanation (targeting is the GM's), the end-of-turn repeat save,
       * and "unless you expend a use of your Rage to restore your use of it" - a refill that writes
       * another pool, which no rider can say.
       */
      "intimidating-presence": {
        uses: { limit: 1, per: "long-rest" },
        actions: [{
          id: "intimidating-presence",
          name: "Intimidating Presence",
          activation: "bonus-action",
          description: "Each creature of your choice in a 30-foot Emanation makes a Wisdom saving throw. On a failed save, the creature has the Frightened condition for 1 minute; at the end of each of its turns it repeats the save, ending the effect on itself on a success.",
          damage: [],
          save: { ability: "wis", dc: { base: 8, ability: "str", proficiencyBonus: true } }
        }]
      }
      /**
       * NOT AUTHORED, and each for a stated reason rather than for want of attention:
       *
       *   - `frenzy` rolls "a number of d6s equal to your Rage Damage bonus", which is a second
       *     printed column. `extra-damage` takes a fixed `formula` and neither it nor the effect-side
       *     `damage-bonus` can read a column, so this is the same call the Rage record already makes
       *     about Rage Damage: left prose rather than authored wrong.
       *   - `mindless-rage` grants Immunity to Charmed and Frightened *while your Rage is active*.
       *     `grants.conditionImmunities` carries no `when` - `riderGate` is on the MODIFIER
       *     vocabulary, not on `FeatureGrantsSchema` - so authoring it would make a level-6 Berserker
       *     permanently immune. See the vocabulary note in the Stage-4 report.
       *   - `retaliation` is a Reaction to "make one melee attack ... using a weapon or an Unarmed
       *     Strike". The weapon is whatever the character is holding, so an authored action would
       *     have neither an attack bonus nor damage - a button that rolls nothing.
       */
    }
  },
  liveResources: ["rage"]
};
