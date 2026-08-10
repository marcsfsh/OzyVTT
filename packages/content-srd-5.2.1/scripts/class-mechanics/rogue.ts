/**
 * Rogue mechanics - the GENERATED half of the overlay for this class and for Thief.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B2. Author here and nowhere else: this file is the only place a Rogue
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const rogue: ClassMechanicsModule = {
  features: {
    /**
     * SNEAK ATTACK - the class's defining number, read off the printed Sneak Attack column.
     *
     * `damageByLevel` is the field that exists FOR this record: `FeatureActionSchema` names Sneak
     * Attack in its own doc comment. The builder keeps the highest row at or below the character's
     * level, so a level-11 Rogue's button rolls 6d6 and a level-1 Rogue's rolls 1d6 - one record,
     * no `by-level` table beside the column it would be duplicating.
     *
     * "ONCE PER TURN" is a real gate, not prose: `per: "turn"` is counted in
     * `state.combat.turn.turnUses`, so the second Sneak Attack in one turn is refused with
     * "no uses remaining (1/turn)" and the counter clears when the turn does. `pool: "sneak-attack"`
     * is the id `ActionUsesSchema` uses as its own worked example ("Sneak Attack once per turn
     * regardless of weapon"), so a second carrier of the same pool would share this counter.
     *
     * THE DAMAGE TYPE IS THE ONE THING THE VOCABULARY CANNOT SAY. The SRD reads "The extra damage's
     * type is the same as the weapon's type", which is not knowable when the record is authored -
     * it depends on the weapon in hand at the moment of the hit. Naming a real type would be
     * authoring a rule the SRD does not print (a Rogue with a Shortsword deals Slashing, with a
     * Shortbow Piercing), so the part is labelled `weapon` and the description carries the rule.
     * A GM reads "6d6 weapon" and applies the weapon's type, which is what they were going to do.
     *
     * WHAT STAYS PROSE (ADR-0008): the two ways to QUALIFY for it - Advantage on the roll, or an
     * ally within 5 feet of the target - are a table judgement about positioning and line of sight,
     * and the `when` vocabulary has no "an ally is adjacent to the target" trigger. The printed
     * column keeps `display: true` for the same reason it always had it: "6d6" is a damage die, not
     * a count of uses, and `liveResources` would claim the column's NUMBER is the pool's size.
     */
    "sneak-attack": {
      uses: { limit: 1, per: "turn", pool: "sneak-attack" },
      actions: [{
        id: "sneak-attack",
        name: "Sneak Attack",
        activation: "other",
        description: "Once per turn, deal this extra damage to one creature you hit with an attack roll, if you have Advantage on the roll (or an ally is within 5 feet of the target, that ally isn't Incapacitated, and you don't have Disadvantage) and the attack uses a Finesse or a Ranged weapon. The extra damage's type is the same as the weapon's, which is why the part below is labelled \"weapon\" rather than a fixed type.",
        damage: [],
        damageByLevel: [
          { level: 1, formula: "1d6", type: "weapon" },
          { level: 3, formula: "2d6", type: "weapon" },
          { level: 5, formula: "3d6", type: "weapon" },
          { level: 7, formula: "4d6", type: "weapon" },
          { level: 9, formula: "5d6", type: "weapon" },
          { level: 11, formula: "6d6", type: "weapon" },
          { level: 13, formula: "7d6", type: "weapon" },
          { level: 15, formula: "8d6", type: "weapon" },
          { level: 17, formula: "9d6", type: "weapon" },
          { level: 19, formula: "10d6", type: "weapon" }
        ]
      }]
    },

    /**
     * THIEVES' CANT - audit row 62, BOTH halves, now that ruling C has landed.
     *
     * "You know Thieves' Cant AND one other language of your choice, which you choose from the
     * language tables in Character Creation." The first half is a plain grant. The second is one
     * `extraPicks` line raising the SAME budget Character Creation opens (`species-languages`) - the
     * shape the audit prescribed, which used to name a budget no real build had because no SRD
     * species declared `languageChoices` at all. Every species now does, so a level-1 Rogue is
     * offered three languages where the printed table offers two.
     */
    "thieves-cant": {
      grants: { languages: ["thieves-cant"] },
      extraPicks: [{ offer: "species-languages", amount: 1 }]
    },

    /**
     * STEADY AIM - a Bonus Action that buys Advantage.
     *
     * The effect lasts `until-source-next-turn` where the SRD says "your next attack roll on the
     * current turn". That is the same simplification the builtin Help action documents ("the SRD's
     * distract variant, simplified from next-attack-only"), and it costs almost nothing here: a
     * Rogue has no Extra Attack, so "the next attack roll this turn" and "attack rolls this turn"
     * are the same roll in every ordinary case.
     *
     * WHAT STAYS PROSE (ADR-0008): both halves of the price. "Only if you haven't moved this turn"
     * reads movement already spent, and "your Speed is 0 until the end of the turn" would need a
     * speed override rather than the signed `speed` bonus the vocabulary has. The description
     * carries them and the GM applies them, which is the same call Rage's 10-minute cap makes.
     */
    "steady-aim": {
      actions: [{
        id: "steady-aim",
        name: "Steady Aim",
        activation: "bonus-action",
        description: "You give yourself Advantage on your next attack roll on the current turn. You can use this only if you haven't moved during this turn, and after you use it your Speed is 0 until the end of the turn.",
        damage: [],
        grants: {
          name: "Steady Aim",
          tags: ["steady-aim"],
          duration: { type: "until-source-next-turn" },
          modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage" }]
        }
      }]
    },

    /**
     * UNCANNY DODGE - the record `ActionSchema.reaction` was added for, named in its own doc.
     *
     * `{trigger: "hit-by-attack", response: "half-damage"}` is not decoration: when an attack hits a
     * creature whose effective actions declare it, the resolver parks the damage on a pending
     * reaction prompt instead of applying it, and the owner answers. Nothing else in the vocabulary
     * halves damage - `damage-reduction` is a flat integer.
     */
    "uncanny-dodge": {
      actions: [{
        id: "uncanny-dodge",
        name: "Uncanny Dodge",
        activation: "reaction",
        description: "When an attacker you can see hits you with an attack roll, you can take a Reaction to halve the attack's damage against you (round down).",
        damage: [],
        reaction: { trigger: "hit-by-attack", response: "half-damage" }
      }]
    },

    /**
     * SLIPPERY MIND - "You gain proficiency in Wisdom and Charisma saving throws."
     *
     * Two more entries in `proficiencies.saves`, which is what every Wisdom save on the sheet is
     * rolled from. A Rogue prints Dexterity and Intelligence at level 1; from level 15 they have
     * four.
     */
    "slippery-mind": {
      grants: { saves: ["wis", "cha"] }
    },

    /**
     * EPIC BOON - audit row 6, the Rogue's share of the nine classes that lost theirs.
     *
     * Cleric, Fighter and Wizard already author exactly this and `epic-boon-feats` resolves against
     * the seven shipped boons. Without it a level-19 Rogue is simply never offered the feat the text
     * hands them.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },

    /**
     * STROKE OF LUCK - one use, back on a Short Rest.
     *
     * No action of its own: `interpretFeature` synthesises the rollable for a feature that prints a
     * use count and nothing else, so the pool is real and the rest machinery re-arms it. Turning a
     * failed D20 Test into a 20 is a re-roll of a roll already made and has no vocabulary; what this
     * authors is the COUNTER, which is the half a player actually has to track.
     */
    "stroke-of-luck": {
      uses: { limit: 1, per: "short-rest" }
    }
  },
  subclasses: {
    thief: {
      /**
       * FAST HANDS - two Bonus Action uses under one heading, so one rollable carrying both.
       *
       * The Dexterity (Sleight of Hand) check itself is rolled from the sheet's skill block; what
       * this record adds is the ACTIVATION, which is the whole of the feature's mechanical content.
       */
      "fast-hands": {
        actions: [{
          id: "fast-hands",
          name: "Fast Hands",
          activation: "bonus-action",
          description: "As a Bonus Action you can either make a Dexterity (Sleight of Hand) check to pick a lock or disarm a trap with Thieves' Tools or to pick a pocket, or take the Utilize action (or the Magic action to use a magic item that requires it).",
          damage: []
        }]
      }
    }
  }
};
