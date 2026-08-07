/**
 * Monk mechanics - the GENERATED half of the overlay for this class and for Warrior of the Open Hand.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B1. Author here and nowhere else: this file is the only place a Monk
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 *
 * ONE RULE GOVERNS EVERY FOCUS-POINT FEATURE BELOW, and it is worth stating once. `ActionUsesSchema`
 * counts uses; it has no notion of a use COSTING more than one. So a feature whose printed price is
 * exactly 1 Focus Point rides the shared `focus-points` pool and really debits it, and a feature
 * priced at 3 or 4 points does NOT - debiting one where the SRD charges four is wrong arithmetic, and
 * wrong arithmetic on a counter is worse than a sentence the GM reads (ADR-0008).
 */
import type { ClassMechanicsModule } from "./overlay.js";

/** Every damage type but Force - Superior Defense's "Resistance to all damage except Force damage". */
const ALL_BUT_FORCE = [
  "acid", "bludgeoning", "cold", "fire", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
] as const;

export const monk: ClassMechanicsModule = {
  features: {
    /**
     * "While you aren't wearing armor or wielding a Shield, your base Armor Class equals 10 plus your
     * Dexterity and Wisdom modifiers."
     *
     * The Barbarian prints a feature with this same id and different mechanics (Constitution, and a
     * Shield is allowed), which is exactly why the overlay is keyed on (recordId, featureId).
     */
    "unarmored-defense": {
      modifiers: [{ type: "unarmored-defense", ability: "wis", allowShield: false }]
    },
    /**
     * MONK'S FOCUS - the printed Focus Points column, wired to a pool the engine really spends.
     *
     * `scaling: {type: "class-resource", id: "focus-points"}` reads the column at the character's own
     * level (2 at level 2, 20 at level 20) instead of restating it as a `by-level` table beside the
     * table it would be copying, and `pool: "focus-points"` is what makes all three activations below
     * share ONE counter - the same mechanism Life Domain's Preserve Life uses to share Channel
     * Divinity. Naming the column in `liveResources` is what drops its `display: true`, at which point
     * `class-resource-pools.test.ts` stops accepting the annotation and starts requiring this pool.
     *
     * All three cost exactly 1 Focus Point, so all three are correct on the shared counter. Patient
     * Defense and Step of the Wind also have a FREE form (a bare Disengage or Dash as a Bonus
     * Action); the actions here are the paid form, which is the one that needs a button that spends.
     *
     * WHAT STAYS PROSE: the save DC sentence (it belongs to the features that force saves, and each
     * of those carries the derived DC itself), and the Flurry/Patient/Step upgrades that Heightened
     * Focus grants at level 10 - a rider conditioned on a later feature has no vocabulary.
     */
    "monks-focus": {
      uses: { scaling: { type: "class-resource", id: "focus-points" }, per: "short-rest", pool: "focus-points" },
      actions: [
        {
          id: "flurry-of-blows",
          name: "Flurry of Blows",
          activation: "bonus-action",
          description: "Expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action (three at Monk level 10).",
          damage: []
        },
        {
          id: "patient-defense",
          name: "Patient Defense",
          activation: "bonus-action",
          description: "Expend 1 Focus Point to take both the Disengage and the Dodge actions as a Bonus Action. Taking Disengage alone as a Bonus Action costs no Focus Point.",
          damage: []
        },
        {
          id: "step-of-the-wind",
          name: "Step of the Wind",
          activation: "bonus-action",
          description: "Expend 1 Focus Point to take both the Disengage and Dash actions as a Bonus Action, and your jump distance is doubled for the turn. Taking Dash alone as a Bonus Action costs no Focus Point.",
          damage: []
        }
      ]
    },
    /**
     * "When you roll Initiative, you can regain all expended Focus Points... Once you use this
     * feature, you can't use it again until you finish a Long Rest."
     *
     * The once-per-long-rest permission is the trackable half, and a feature with `uses` and no
     * action of its own gets a synthesized activation, so it lands on the sheet as a pool that a Long
     * Rest re-arms. The refill it performs writes ANOTHER pool's counter, which no rider can say - the
     * GM taps Focus Points back up, exactly as they do for every other printed refill.
     */
    "uncanny-metabolism": {
      uses: { limit: 1, per: "long-rest" }
    },
    /**
     * "You can attack twice instead of once whenever you take the Attack action on your turn."
     *
     * The same rider the Barbarian's own `extra-attack` carries, with the same measured caveat: the
     * builder raises `attack.count` only on FEATURE actions that carry an attack, and a martial
     * class's weapon attacks are derived from the equipped inventory instead. See `barbarian.ts`.
     */
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },
    /**
     * "...expend 1 Focus Point to attempt a stunning strike. The target must make a Constitution
     * saving throw. On a failed save, the target has the Stunned condition..."
     *
     * Two numbers the character owns, both derived rather than typed: the DC is
     * `FeatureSaveDcSchema`'s third form (8 + Wisdom + Proficiency Bonus), and the Focus Point comes
     * off the SAME `focus-points` pool Monk's Focus opened, so a Flurry and a Stunning Strike draw on
     * one counter. The Stunned condition needs no field of its own - the resolver reads it off this
     * action's prose (`conditionFrom`) and applies it on a failed save.
     *
     * WHAT STAYS PROSE: "once per turn". A second, differently-scoped limit on the same action is not
     * expressible - `uses` is one counter with one `per` - and the Focus Point is the scarcer of the
     * two, so it is the one the pool tracks.
     */
    "stunning-strike": {
      uses: { scaling: { type: "class-resource", id: "focus-points" }, per: "short-rest", pool: "focus-points" },
      actions: [{
        id: "stunning-strike",
        name: "Stunning Strike",
        activation: "other",
        description: "Once per turn, when you hit a creature with a Monk weapon or an Unarmed Strike, expend 1 Focus Point: the target makes a Constitution saving throw or has the Stunned condition until the start of your next turn. On a success its Speed is halved until the start of your next turn and the next attack roll against it before then has Advantage.",
        damage: [],
        save: { ability: "con", dc: { base: 8, ability: "wis", proficiencyBonus: true } }
      }]
    },
    /** "Your physical and mental discipline grant you proficiency in all saving throws." */
    "disciplined-survivor": {
      grants: { saves: ["str", "dex", "con", "int", "wis", "cha"] }
    },
    /**
     * "...bolster yourself against harm for 1 minute... you have Resistance to all damage except
     * Force damage."
     *
     * Authored as `effects`, so `interpretFeature` synthesizes the activation: the resistance is real
     * modelled vocabulary and a rider with no trigger would be inert. The 3-Focus-Point price is NOT
     * on the pool - see this file's header - so the description carries it, as it carries the
     * Incapacitated end condition that `duration` cannot express.
     */
    "superior-defense": {
      effects: [{
        name: "Superior Defense",
        tags: ["superior-defense"],
        duration: { type: "rounds", rounds: 10 },
        modifiers: [{ type: "damage-resistance", damageTypes: [...ALL_BUT_FORCE] }]
      }]
    },
    /**
     * "You gain an Epic Boon feat ... or another feat of your choice" - audit row 6, the Monk's share
     * of the nine classes that lost their level-19 feat outright. Same line Cleric, Fighter and
     * Wizard already carry.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },
    /** "Your Dexterity and Wisdom scores increase by 4, to a maximum of 25." */
    "body-and-mind": {
      modifiers: [
        { type: "ability-score", ability: "dex", amount: 4, maximum: 25 },
        { type: "ability-score", ability: "wis", amount: 4, maximum: 25 }
      ]
    }
    /**
     * NOT AUTHORED, each for a stated reason:
     *
     *   - `martial-arts`, `deflect-attacks`, `deflect-energy`, `wholeness-of-body`'s heal amount and
     *     `heightened-focus`'s temporary hit points are all denominated in the MARTIAL ARTS DIE, a
     *     printed column of dice strings. `damageByLevel` can scale an action's own damage but there
     *     is no scaled healing, no scaled damage REDUCTION and no scaled temporary hit points.
     *   - `unarmored-movement` is "+10 feet, increasing at certain levels" (10/15/20/25/30). The
     *     `speed` rider is a flat signed integer with no column scaling, so +10 would be right for
     *     four levels and short for the other fifteen.
     *   - `slow-fall`, `acrobatic-movement`, `empowered-strikes`, `evasion`, `self-restoration` and
     *     `perfect-focus` are falling damage, wall-running, a damage-type choice, a save-for-half
     *     carve-out, condition removal and a conditional partial refill. None has vocabulary, and
     *     every one is complete prose on the sheet today.
     */
  },
  subclasses: {
    "warrior-of-the-open-hand": {
      /**
       * "You can use this feature a number of times equal to your Wisdom modifier (minimum of once),
       * and you regain all expended uses when you finish a Long Rest."
       *
       * `scaling: {type: "ability-modifier", ability: "wis", minimum: 1}` is the printed sentence
       * exactly - the minimum is a field, not a special case - and it resolves against the finished
       * sheet's Wisdom, so the counter is right for every character rather than for one. The heal
       * itself rolls the Martial Arts die and stays prose with the rest of that column.
       */
      "wholeness-of-body": {
        uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
        actions: [{
          id: "wholeness-of-body",
          name: "Wholeness of Body",
          activation: "bonus-action",
          description: "Roll your Martial Arts die and regain a number of Hit Points equal to the number rolled plus your Wisdom modifier (minimum of 1 Hit Point regained).",
          damage: []
        }]
      },
      /**
       * "...the target must make a Constitution saving throw, taking 10d12 Force damage on a failed
       * save or half as much damage on a successful one."
       *
       * A flat printed 10d12 and the Monk's own derived DC - both fully expressible, and the reason
       * this record is authored while its neighbours are not. The 4-Focus-Point price stays prose per
       * this file's header, as do the vibrations' duration and the one-target-at-a-time rule.
       */
      "quivering-palm": {
        actions: [{
          id: "quivering-palm",
          name: "Quivering Palm",
          activation: "action",
          description: "End the vibrations you set in a creature. The target makes a Constitution saving throw, taking 10d12 Force damage on a failed save or half as much damage on a successful one.",
          damage: [{ formula: "10d12", type: "force" }],
          save: { ability: "con", dc: { base: 8, ability: "wis", proficiencyBonus: true } }
        }]
      }
      /**
       * NOT AUTHORED: `open-hand-technique` imposes one of three effects on a Flurry of Blows hit,
       * two of which force their own differently-abilitied save - one action carries one `save`, and
       * "choose one of the following on each hit" is a pick made mid-roll, not at build time.
       * `fleet-step` is a free extra Bonus Action, which the action economy has no rider for.
       */
    }
  },
  liveResources: ["focus-points"]
};
