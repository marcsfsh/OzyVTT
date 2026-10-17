import type { BuilderPolicy, GameState } from "@vtt/domain";
import { importActorDefinition } from "./actor-roster.js";
import { buildCharacterDefinition } from "./character-build.js";
import { generateCharacterRequest } from "./character-generate.js";
import type { ContentView } from "./content-library.js";
import { equipmentCatalogOf } from "./equipment-derivation.js";

/**
 * The sample party a fresh table starts with: three level 7 characters built by the character builder itself from
 * SRD 5.2.1 content, so each carries the builder's ledger and levels up or down like any character built here. The
 * picks a builder asks for are answered by the random generator with a fixed seed and each character's signature
 * choices put first, so every fresh table gets the same three.
 */

export const SAMPLE_ACTOR_IDS = {
  fighter: "2b20e657-df27-4a8e-9a8d-a9c608763701",
  cleric: "d91ad7e6-d334-4596-885e-47ac9c981702",
  wizard: "b073fe5f-4394-4869-9e79-a0e3dc4e1703"
} as const;

const SAMPLE_NOTE = "A sample character. Remove the samples from the Roster once your own party is ready.";

type Sample = Readonly<{
  actorId: string;
  name: string;
  classId: string;
  speciesId: string;
  backgroundId: string;
  subclassId: string;
  seed: number;
  /** The picks that make the character read as its role at the table. */
  favour: readonly string[];
  notes: string;
}>;

const SAMPLES: readonly Sample[] = [
  {
    actorId: SAMPLE_ACTOR_IDS.fighter,
    name: "Borin Stoneguard",
    classId: "fighter",
    speciesId: "dwarf",
    backgroundId: "soldier",
    subclassId: "champion",
    seed: 7101,
    favour: ["athletics", "perception", "intimidation", "defense", "great-weapon-fighting", "longsword", "shield"],
    notes: SAMPLE_NOTE
  },
  {
    actorId: SAMPLE_ACTOR_IDS.cleric,
    name: "Mirena Dawnbright",
    classId: "cleric",
    speciesId: "human",
    backgroundId: "acolyte",
    subclassId: "life-domain",
    seed: 7102,
    favour: [
      "sacred-flame",
      "guidance",
      "light",
      "thaumaturgy",
      "cure-wounds",
      "guiding-bolt",
      "healing-word",
      "bless",
      "shield-of-faith",
      "spiritual-weapon",
      "hold-person",
      "lesser-restoration",
      "aid",
      "spirit-guardians",
      "mass-healing-word",
      "revivify",
      "dispel-magic",
      "guardian-of-faith",
      "death-ward",
      "insight",
      "medicine"
    ],
    notes: SAMPLE_NOTE
  },
  {
    actorId: SAMPLE_ACTOR_IDS.wizard,
    name: "Lyra Emberwise",
    classId: "wizard",
    speciesId: "elf",
    backgroundId: "sage",
    subclassId: "evoker",
    seed: 7103,
    favour: [
      "high-elf",
      "fire-bolt",
      "ray-of-frost",
      "light",
      "mage-hand",
      "prestidigitation",
      "shield",
      "magic-missile",
      "mage-armor",
      "burning-hands",
      "detect-magic",
      "sleep",
      "thunderwave",
      "misty-step",
      "scorching-ray",
      "web",
      "fireball",
      "counterspell",
      "lightning-bolt",
      "fly",
      "dimension-door",
      "greater-invisibility",
      "arcana",
      "investigation"
    ],
    notes: SAMPLE_NOTE
  }
];

/** A small seeded generator (mulberry32), so a sample is the same on every fresh table. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return 1 + Math.floor(unit * sides);
  };
}

/** Adds the sample party to a fresh state, each marked `sample`. */
export function addSampleParty(state: GameState, library: ContentView) {
  const policy: BuilderPolicy = state.builderPolicy;
  const catalog = equipmentCatalogOf(library);
  for (const sample of SAMPLES) {
    const generated = generateCharacterRequest(
      {
        level: 7,
        classId: sample.classId,
        name: sample.name,
        speciesId: sample.speciesId,
        backgroundId: sample.backgroundId,
        subclassId: sample.subclassId,
        favour: new Set(sample.favour)
      },
      library,
      policy,
      seeded(sample.seed)
    );
    // Hit points at each level's average, recorded as rolls so a level-up keeps them and has nothing to explain.
    const request = {
      ...generated.request,
      hp: { mode: "entries" as const, entries: generated.hitPointRolls.map(({ faces }) => faces / 2 + 1) }
    };
    importActorDefinition(state, buildCharacterDefinition(request, library, policy), sample.actorId, "public", catalog);
    const actor = state.actors.find((entry) => entry.id === sample.actorId)!;
    actor.sample = true;
    actor.notes = sample.notes;
  }
}
