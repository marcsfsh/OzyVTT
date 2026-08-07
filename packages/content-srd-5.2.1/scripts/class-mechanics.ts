/**
 * ============================================================================================
 * THE CLASS MECHANICS OVERLAY - hand-authored riders merged over ETL-generated prose
 * ============================================================================================
 *
 * `bundles/classes.v1.json` is GENERATED from `sources/dnd-5e-srd-markdown/classes.md` by
 * `build-class-bundle.ts`. That is where the PROSE comes from and it must stay there: the ETL is
 * what recovered 149 dropped feature descriptions, and hand-editing the bundle is destroyed by the
 * next rebuild.
 *
 * But the SRD markdown contains no riders. There is no sentence in it that says
 * `{type: "damage-resistance", damageTypes: [...]}`; the mechanics have to be authored by a human
 * reading the prose, and there is nowhere in a generated artifact to put them.
 *
 * The alternative was moving each class to `HAND_AUTHORED`, which freezes its prose too - 242
 * records' worth of description stop being derived from the source and become a hand-maintained
 * copy that the cross-check below deliberately does NOT compare ("the descriptions are legitimately
 * reworded in places"). That trades a generated artifact for a manual one to gain a place to hang
 * three lines of riders.
 *
 * SO: prose is generated, mechanics are authored, and the ETL merges the two. Each class keeps ONE
 * record in the bundle, so `loadClasses`, the homebrew merge, the validator and every consumer are
 * unchanged - the overlay is a build-time input, not a runtime layer.
 *
 * THE PRECEDENT IS ALREADY IN THIS PACKAGE. `SpellListReferenceSchema` is the identical call, made
 * for the identical reason and documented in its own header: "A spell list as a membership OVERLAY,
 * never an edit to `spells.v1.json` ... Hand-editing a homebrew tag into it is destroyed by the next
 * rebuild." Only the merge point differs, and only because a spell list is a runtime concern while
 * a class's riders are fixed at build time.
 *
 * KEYED ON (classId, featureId) AND NEVER ON featureId ALONE. A bare id is genuinely ambiguous:
 * `unarmored-defense` is a Barbarian feature AND a Monk feature with different mechanics,
 * `weapon-mastery` belongs to five classes, `spellcasting` to seven. This is the same ambiguity
 * `content-library.ts`'s `featureIndexOf` documents, and the same answer.
 *
 * A KEY THAT MATCHES NO FEATURE IS A BUILD ERROR, not a silent no-op. The whole failure mode this
 * area has been fixing is authored mechanics that vanish without a trace; an overlay that quietly
 * dropped a renamed feature's riders would be a new instance of exactly that.
 */
import type { z } from "zod";
import type { FeatureRecordSchema } from "../src/character-content.js";

/**
 * The rider fields an overlay may add. Prose (`id`, `name`, `level`, `description`, `choice`) is
 * the ETL's and is never overwritten.
 *
 * Typed off the schema's INPUT rather than its output, deliberately: an overlay is authored the way
 * the JSON bundle is authored, so a `.default()`ed key like `concentration` should not have to be
 * restated. The build re-parses each finished record, which is where the defaults materialise and
 * where an authoring mistake stops the build.
 */
type FeatureInput = z.input<typeof FeatureRecordSchema>;
export type FeatureMechanics = Partial<Pick<FeatureInput, "actions" | "effects" | "modifiers" | "grants" | "uses">>;

/**
 * Mechanics by class id, then feature id. Stage 4 fills this in; `barbarian.rage` is the worked
 * example that proves the mechanism end to end.
 */
export const CLASS_MECHANICS: Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>> = {
  barbarian: {
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
    }
  }
};

/**
 * The same overlay for subclass features, keyed on (subclassId, featureId) - and merged by
 * `build-class-bundle.ts`'s subclass loop exactly as the class half is merged by its class loop.
 *
 * Nine of the twelve subclasses are ETL-generated, so until this was wired there was no authoring
 * surface for a subclass rider AT ALL: the only three that carried one (Champion, Evoker, Life
 * Domain) were reachable purely because their class is HAND_AUTHORED and the whole record is copied
 * through. `draconic-resilience` is the worked example that proves the mechanism end to end.
 */
export const SUBCLASS_MECHANICS: Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>> = {
  "draconic-sorcery": {
    /**
     * "While you aren't wearing armor, your base Armor Class equals 10 plus your Dexterity and
     * Charisma modifiers" - the `unarmored-defense` variant, spelled with the ability the SRD prints.
     *
     * WHAT STAYS PROSE, deliberately (ADR-0008): the Hit Point half ("+3, and +1 whenever you gain
     * another Sorcerer level") is a level-3 lump plus a per-level step, and `hit-points-per-level`
     * has no lump. Authoring `amount: 1` would be wrong for every level below 3 and short by 2 above
     * it, so the description carries it instead of the record carrying it incorrectly.
     */
    "draconic-resilience": {
      modifiers: [{ type: "unarmored-defense", ability: "cha" }]
    }
  }
};

/**
 * Printed columns that STOP being display-only because the overlay wired them to a real pool.
 *
 * `build-class-bundle.ts` marks every generated `classResources` column `display: true`, which is
 * true right up until an overlay names it in a `class-resource` scaling. Listing it here rather than
 * inferring it keeps `class-resource-pools.test.ts`'s two-way check meaningful: the content says
 * which columns it believes are live, and the test proves a pool actually answers to each one.
 */
export const LIVE_CLASS_RESOURCES: Readonly<Record<string, readonly string[]>> = {
  barbarian: ["rage"]
};

/**
 * Merge the overlay into one class's features, in place, and report keys that matched nothing.
 *
 * Returns the unmatched `class.feature` keys so the caller can FAIL the build: a rider authored
 * against a feature id the ETL no longer emits is precisely the silent drop this file exists to
 * avoid.
 */
export function applyMechanics(
  classId: string,
  features: Array<{ id: string }>,
  overlay: Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>> = CLASS_MECHANICS
): string[] {
  const entries = overlay[classId];
  if (!entries) return [];
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const unmatched: string[] = [];
  for (const [featureId, mechanics] of Object.entries(entries)) {
    const feature = byId.get(featureId);
    if (!feature) { unmatched.push(`${classId}.${featureId}`); continue; }
    // The overlay only ADDS keys. Prose the ETL produced is never overwritten, so a source rewording
    // lands on the next build with the mechanics still attached.
    Object.assign(feature, mechanics);
  }
  return unmatched;
}
