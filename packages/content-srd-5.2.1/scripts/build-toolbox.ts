/**
 * The SRD 5.2.1 Gameplay Toolbox as two bundles, from the vendored markdown transcription (see its PROVENANCE.json):
 * `toolbox.v1.json`, one record per trap, poison, environmental effect, contagion and curse plus the chapter's other
 * sections, each with its text; and `poisons.v1.json`, the sample poisons as consumables. Each trap carries its
 * mechanics (`TRAPS`) and each poison its delivery and effect (`POISONS`), authored here against the text beside them:
 * a number the text doesn't print fails the build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ActorAction } from "@vtt/schemas";
import {
  EquipmentReferenceSchema,
  ToolboxRecordSchema,
  type EquipmentReference,
  type ToolboxRecord,
  type TrapMechanics
} from "../src/schemas.js";
import { slug, strip, withTables } from "./markdown.js";
import { outDir, sourcePath } from "./paths.js";

const markdown = readFileSync(sourcePath("dnd-5e-srd-markdown", "gameplay-toolbox.md"), "utf8");

/** Markdown emphasis and HTML out, paragraphs and list items kept as lines, as the glossary reads them. */
const LIST_BREAK = "~list~";
function plain(body: string): string {
  return withTables(body)
    .split(/\n{2,}/)
    .map((paragraph) =>
      strip(paragraph.replace(/\n(?=[-*] )/g, LIST_BREAK).replace(/\n(?=\*\*[A-Z])/g, LIST_BREAK))
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(^|[\s("\u201c])_([^_]+)_/g, "$1$2")
        .replaceAll(LIST_BREAK, "\n")
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}

/** The body under a heading of this level, up to the next heading of the same or a higher level. */
function bodyOf(heading: string, level: number): string {
  const marker = `${"#".repeat(level)} ${heading}\n`;
  const start = markdown.indexOf(marker);
  if (start < 0) throw new Error(`The toolbox has no heading "${heading}".`);
  const rest = markdown.slice(start + marker.length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, "m"));
  return next < 0 ? rest : rest.slice(0, next);
}

/** The headings one level below `parent`'s body, each with its own body. */
function childrenOf(parentBody: string, level: number): Array<{ heading: string; body: string }> {
  const marker = "#".repeat(level);
  return [
    ...parentBody.matchAll(new RegExp(`^${marker} (.+)\\n([\\s\\S]*?)(?=^#{1,${level}} |(?![\\s\\S]))`, "gm"))
  ].map(([, heading, body]) => ({ heading: heading!.trim(), body: body! }));
}

/** A record's first italic line ("_Deadly Trap (Levels 1-4)_", its dash an en dash), and the text after it. */
function withSubtitle(body: string): { subtitle: string | null; text: string } {
  const match = /^\s*_([^_\n]+)_\s*\n/.exec(body);
  return match ? { subtitle: match[1]!.trim(), text: body.slice(match[0].length) } : { subtitle: null, text: body };
}

// ---- traps ------------------------------------------------------------------------------------------------------

const ironSpike = (after: string, where: string) => ({
  id: "wedge-spike",
  name: `Wedge an Iron Spike ${where}`,
  after,
  spends: "iron-spikes"
});
const cutWire = { id: "cut-wire", name: "Cut the trip wire", after: "trip-wire" };
const tripWire = (finds: string) => ({
  id: "trip-wire",
  action: "search" as const,
  skill: "perception" as const,
  dc: 11,
  finds
});
const dexHalf = (dc: number, formula: string, type: "bludgeoning" | "fire") => ({
  save: { ability: "dex" as const, dc, successDamage: "half" as const, failureConditions: [] },
  damage: [{ formula, type }]
});
const lid = { id: "lid", action: "study" as const, skill: "investigation" as const, dc: 15, finds: "the pit's lid" };
const plate = (dc: number, action: "search" | "study" = "search") => ({
  id: "plate",
  action,
  skill: action === "search" ? ("perception" as const) : ("investigation" as const),
  dc,
  finds: "the pressure plate"
});
const netSave = (dc: number) => ({
  ability: "dex" as const,
  dc,
  successDamage: "none" as const,
  failureConditions: ["restrained" as const],
  escapeDc: dc,
  escapeAthletics: true as const,
  heldBy: {
    name: "Net",
    armorClass: 10,
    hitPoints: 5,
    immunities: ["bludgeoning" as const, "poison" as const, "psychic" as const]
  },
  endedBy: {
    name: "Free the creature from the Net",
    by: "others" as const,
    check: { ability: "str" as const, skill: "athletics", dc }
  }
});
const needleSave = (dc: number) => ({
  ability: "con" as const,
  dc,
  successDamage: "half" as const,
  failureConditions: ["poisoned" as const],
  failureDuration: { type: "minutes" as const, minutes: 60 }
});

/** Each sample trap's mechanics, its bands of levels from its At Higher Levels table. */
const TRAPS: Readonly<Record<string, TrapMechanics>> = {
  "collapsing-roof": {
    severity: "deadly",
    trigger: "enter",
    targets: "area",
    rubble: true,
    avoidable: true,
    detect: [tripWire("the trip wire and the unstable section of ceiling")],
    disarm: [cutWire],
    tiers: [
      { levels: "1-4", ...dexHalf(13, "2d10", "bludgeoning") },
      { levels: "5-10", ...dexHalf(15, "4d10", "bludgeoning") },
      { levels: "11-16", ...dexHalf(17, "10d10", "bludgeoning") },
      { levels: "17-20", ...dexHalf(19, "18d10", "bludgeoning") }
    ]
  },
  "falling-net": {
    severity: "nuisance",
    trigger: "enter",
    targets: "triggerer",
    avoidable: true,
    detect: [tripWire("the trip wire and the suspended Net")],
    disarm: [cutWire],
    tiers: [10, 12, 14, 16].map((dc, index) => ({
      levels: ["1-4", "5-10", "11-16", "17-20"][index]!,
      save: netSave(dc),
      damage: [],
      hugeSucceeds: true as const
    }))
  },
  "fire-casting-statue": {
    severity: "deadly",
    trigger: "enter-or-start",
    targets: "area",
    blast: true,
    resets: {},
    detect: [
      {
        id: "glyph",
        action: "search",
        skill: "perception",
        dc: 10,
        finds: "a tiny glyph on the statue",
        withinFeet: 5
      },
      plate(15)
    ],
    disarm: [
      { id: "deface", name: "Deface the glyph", after: "glyph" },
      ironSpike("plate", "under the pressure plate")
    ],
    tiers: [
      { levels: "1-4", ...dexHalf(15, "2d10", "fire") },
      { levels: "5-10", ...dexHalf(15, "4d10", "fire") },
      { levels: "11-16", ...dexHalf(15, "10d10", "fire") },
      { levels: "17-20", ...dexHalf(15, "18d10", "fire") }
    ]
  },
  "hidden-pit": {
    severity: "nuisance",
    trigger: "enter",
    targets: "triggerer",
    pit: true,
    detect: [lid],
    disarm: [ironSpike("lid", "between the lid and the floor")],
    tiers: [10, 30, 60, 120].map((feet, index) => ({
      levels: ["1-4", "5-10", "11-16", "17-20"][index]!,
      damage: [],
      pitFeet: feet
    }))
  },
  "poisoned-darts": {
    severity: "deadly",
    trigger: "enter",
    targets: "area",
    blast: true,
    resets: { maxActivations: 3 },
    detect: [
      { id: "holes", action: "search", skill: "perception", dc: 15, finds: "the holes the darts shoot from" },
      plate(15)
    ],
    disarm: [{ id: "plug", name: "Plug the holes", after: "holes" }, ironSpike("plate", "under the pressure plate")],
    tiers: ["1d6", "2d6", "4d6", "7d6"].map((formula, index) => ({
      levels: ["1-4", "5-10", "11-16", "17-20"][index]!,
      save: { ability: "dex" as const, dc: 13, successDamage: "none" as const, failureConditions: [] },
      damage: [{ formula, type: "poison" as const }],
      darts: "1d3"
    }))
  },
  "poisoned-needle": {
    severity: "nuisance",
    trigger: "manual",
    targets: "triggerer",
    detect: [{ id: "needle", action: "search", skill: "perception", dc: 15, finds: "the needle in the lock" }],
    disarm: [
      {
        id: "disarm",
        name: "Disarm the needle",
        after: "needle",
        check: { ability: "dex", skill: "sleight-of-hand", dc: 15, failureSprings: true }
      }
    ],
    tiers: [
      { levels: "1-4", save: needleSave(11), damage: [{ formula: "1d10", type: "poison" }] },
      { levels: "5-10", save: needleSave(13), damage: [{ formula: "2d10", type: "poison" }] },
      { levels: "11-16", save: needleSave(15), damage: [{ formula: "4d10", type: "poison" }] },
      { levels: "17-20", save: needleSave(17), damage: [{ formula: "10d10", type: "poison" }] }
    ]
  },
  "rolling-stone": {
    severity: "deadly",
    trigger: "enter",
    targets: "triggerer",
    rolls: true,
    detect: [plate(15, "study")],
    disarm: [ironSpike("plate", "under the pressure plate")],
    tiers: [{ levels: "11-20", damage: [] }]
  },
  "spiked-pit": {
    severity: "deadly",
    trigger: "enter",
    targets: "triggerer",
    pit: true,
    detect: [lid],
    disarm: [ironSpike("lid", "between the lid and the floor")],
    tiers: (
      [
        [10, "2d8"],
        [30, "3d8"],
        [60, "8d8"],
        [120, "13d8"]
      ] as const
    ).map(([feet, formula], index) => ({
      levels: ["1-4", "5-10", "11-16", "17-20"][index]!,
      damage: [{ formula, type: "piercing" as const }],
      pitFeet: feet
    }))
  }
};

// ---- poisons ---------------------------------------------------------------------------------------------------

type PoisonKind = "contact" | "ingested" | "inhaled" | "injury";
type ActionSave = NonNullable<ActorAction["save"]>;
type Poison = Readonly<{
  kind: PoisonKind;
  save?: ActionSave;
  damage?: ActorAction["damage"];
  /** A grant in place of a save (Midnight Tears, which poisons no one before midnight). */
  grants?: ActorAction["grants"];
}>;

const con = (dc: number, rest: Partial<ActionSave> = {}): ActionSave =>
  ({ ability: "con", dc, successDamage: "none", failureConditions: [], ...rest }) as ActionSave;
const poison = (formula: string) => [{ formula, type: "poison" as const }];
const hours = (count: number) => ({ type: "minutes" as const, minutes: count * 60 });
const sleepsWhilePoisoned = (endedByShake: boolean) => ({
  by: 1,
  whileFailed: {
    conditions: ["unconscious" as const],
    endsOnDamage: true as const,
    ...(endedByShake ? { endedBy: { name: "Wake", by: "others" as const } } : {})
  }
});

/** Each sample poison's delivery and what a creature exposed to it meets. */
const POISONS: Readonly<Record<string, Poison>> = {
  "assassins-blood": {
    kind: "ingested",
    save: con(10, { successDamage: "half", failureConditions: ["poisoned"], failureDuration: hours(24) }),
    damage: poison("1d12")
  },
  "burnt-othur-fumes": {
    kind: "inhaled",
    save: con(13, {
      failureEffect: { name: "Burnt Othur Fumes", tags: ["burnt-othur-fumes"], modifiers: [] },
      repeatSave: true,
      repeatAtTurnStart: true,
      repeatFailureDamage: poison("1d6"),
      repeatTally: 3,
      repeatTallySuccessesOnly: true
    }),
    damage: poison("3d6")
  },
  "crawler-mucus": {
    kind: "contact",
    save: con(13, {
      failureConditions: ["poisoned", "paralyzed"],
      failureDuration: { type: "rounds", rounds: 10 },
      repeatSave: true
    })
  },
  "essence-of-ether": {
    kind: "inhaled",
    save: con(15, {
      failureConditions: ["poisoned"],
      failureDuration: hours(8),
      failureByMargin: sleepsWhilePoisoned(true)
    })
  },
  malice: {
    kind: "inhaled",
    save: con(15, { failureConditions: ["poisoned", "blinded"], failureDuration: hours(1) })
  },
  "midnight-tears": {
    kind: "ingested",
    grants: {
      name: "Midnight Tears",
      tags: ["latent-poison", "midnight-tears"],
      duration: { type: "manual" },
      modifiers: [],
      onEnd: [],
      target: "target",
      voidWhileIncapacitated: false,
      concentration: false,
      atRest: {
        at: "midnight",
        save: { ability: "con", dc: 17 },
        damage: poison("9d6"),
        halfOnSuccess: true,
        once: true
      }
    }
  },
  "oil-of-taggit": {
    kind: "contact",
    save: con(13, {
      failureConditions: ["poisoned"],
      failureDuration: hours(24),
      failureByMargin: sleepsWhilePoisoned(false)
    })
  },
  "pale-tincture": {
    kind: "ingested",
    save: con(16, {
      failureConditions: ["poisoned"],
      atRest: {
        at: "day",
        save: { ability: "con", dc: 16 },
        damage: poison("1d6"),
        drainsMaximum: true,
        successesNeeded: 7
      }
    }),
    damage: poison("1d6")
  },
  "purple-worm-poison": { kind: "injury", save: con(21, { successDamage: "half" }), damage: poison("10d6") },
  "serpent-venom": { kind: "injury", save: con(11, { successDamage: "half" }), damage: poison("3d6") },
  "spiders-sting": {
    kind: "injury",
    save: con(13, {
      failureConditions: ["poisoned"],
      failureDuration: hours(1),
      failureByMargin: { by: 5, whileFailed: sleepsWhilePoisoned(true).whileFailed }
    })
  },
  torpor: {
    kind: "ingested",
    save: con(15, {
      failureConditions: ["poisoned"],
      failureHoursRolled: "4d6",
      failureEffect: { name: "Torpor", tags: ["speed-halved"], modifiers: [] }
    })
  },
  "truth-serum": {
    kind: "ingested",
    save: con(11, { failureConditions: ["poisoned"], failureDuration: hours(1) })
  },
  "wyvern-poison": { kind: "injury", save: con(14, { successDamage: "half" }), damage: poison("7d6") }
};

const DELIVERY: Readonly<Record<Exclude<PoisonKind, "injury">, { id: string; verb: string }>> = {
  ingested: { id: "feed", verb: "Feed a dose to a creature" },
  contact: { id: "touch", verb: "Bring a creature into contact with it" },
  inhaled: { id: "release", verb: "Release it in a 5-foot Cube" }
};

/** A poison's actions: an injury poison coats a weapon or a piece of ammunition as a Bonus Action; another is given to
 *  a creature within 5 feet, or released over a 5-foot Cube beside its user. */
function poisonActions(id: string, name: string, entry: Poison): ActorAction[] {
  if (entry.kind === "injury") {
    const coat = (ammunition: boolean): ActorAction => ({
      id: ammunition ? "coat-ammunition" : "coat-weapon",
      name: `Coat ${ammunition ? "a Piece of Ammunition" : "a Weapon"} with ${name}`,
      activation: "bonus-action",
      description: `Coat ${ammunition ? "one piece of ammunition" : "one weapon"} you carry. The poison stays potent until delivered through a wound: the next hit with it that deals Piercing or Slashing damage exposes the creature hit.`,
      damage: [],
      grants: {
        name: `${name} (${ammunition ? "ammunition" : "weapon"})`,
        tags: ["poison-coat", `coat-${id}`],
        duration: { type: "manual" },
        modifiers: [],
        onEnd: [],
        target: "self",
        voidWhileIncapacitated: false,
        concentration: false,
        bindsWeapon: ammunition ? { ammunition: true } : {}
      }
    });
    return [coat(false), coat(true)];
  }
  const delivery = DELIVERY[entry.kind];
  const area = entry.kind === "inhaled";
  return [
    {
      id: delivery.id,
      name: `${delivery.verb.split(" ")[0]} ${name}`,
      activation: "action",
      description: `${delivery.verb}: a creature exposed to it suffers its effect.`,
      damage: entry.damage ? structuredClone(entry.damage) : [],
      ...(entry.save ? { save: structuredClone(entry.save) } : {}),
      ...(entry.grants ? { grants: structuredClone(entry.grants) } : {}),
      ...(area
        ? { area: { shape: "cube", sizeFeet: 5, widthFeet: null, rangeFeet: 5 } }
        : { targets: { count: 1, rangeFeet: 5 } })
    } as ActorAction
  ];
}

// ---- the records -------------------------------------------------------------------------------------------------

const records: ToolboxRecord[] = [];
const poisonItems: EquipmentReference[] = [];
const add = (record: Omit<ToolboxRecord, "id"> & { id?: string }) =>
  records.push({ ...record, id: record.id ?? slug(record.name) } as ToolboxRecord);

/** A number the authored mechanics use that the record's text never prints. */
function checkPrinted(name: string, text: string, numbers: readonly string[]): void {
  for (const number of numbers)
    if (!text.includes(number)) throw new Error(`${name}: the text doesn't print ${number}.`);
}

for (const { heading, body } of childrenOf(bodyOf("Example Traps", 3), 4)) {
  const { subtitle, text } = withSubtitle(body);
  const id = slug(heading);
  const trap = TRAPS[id];
  if (!trap) throw new Error(`No mechanics are authored for the trap "${heading}".`);
  const description = plain(text);
  checkPrinted(heading, description, [
    ...trap.detect.map((way) => `DC ${way.dc}`),
    ...trap.tiers.flatMap((tier) => (tier.save ? [String(tier.save.dc)] : [])),
    ...trap.tiers.flatMap((tier) => tier.damage.map((part) => part.formula))
  ]);
  add({ id, name: heading, kind: "trap", section: "Traps", subtitle, description, trap });
}

for (const { heading, body } of childrenOf(bodyOf("Sample Poisons", 3), 4)) {
  const priced = /^(.+?) \(([\d,]+) GP\)$/.exec(heading);
  if (!priced) throw new Error(`The poison "${heading}" has no price.`);
  const name = priced[1]!;
  const id = slug(name);
  const entry = POISONS[id];
  if (!entry) throw new Error(`No effect is authored for the poison "${name}".`);
  const { subtitle, text } = withSubtitle(body);
  if (subtitle?.toLowerCase() !== `${entry.kind} poison`) throw new Error(`${name} isn't an ${entry.kind} poison.`);
  const description = plain(text);
  const save = entry.save ?? null;
  checkPrinted(name, description, [
    ...(save ? [`DC ${save.dc}`] : []),
    ...(entry.damage ?? []).map((part) => part.formula)
  ]);
  add({ id, name, kind: "poison", section: "Poison", subtitle, description, itemId: id });
  poisonItems.push(
    EquipmentReferenceSchema.parse({
      id,
      name,
      category: "poison",
      costGp: Number(priced[2]!.replace(/,/g, "")),
      weightLb: 0,
      description: `${subtitle}. ${description}`,
      consumedOnUse: true,
      ...(save ? { poison: { kind: entry.kind, save, damage: entry.damage ?? [] } } : {}),
      actions: poisonActions(id, name, entry)
    })
  );
}

for (const { heading, body } of childrenOf(bodyOf("Environmental Effects", 2), 3))
  add({
    name: heading,
    kind: "environment",
    section: "Environmental Effects",
    subtitle: null,
    description: plain(body)
  });

for (const name of ["Cackle Fever", "Sewer Plague", "Sight Rot"]) {
  const { subtitle, text } = withSubtitle(bodyOf(name, 4));
  add({ name, kind: "contagion", section: "Curses and Magical Contagions", subtitle, description: plain(text) });
}

const possession = bodyOf("Environmental Curses", 4);
add({
  name: "Demonic Possession",
  kind: "curse",
  section: "Curses and Magical Contagions",
  subtitle: "Environmental Curse",
  description: plain(possession.slice(possession.indexOf("_Demonic Possession._")))
});

/** The chapter's other sections, each whole: travel, backgrounds, curses, contagions, fear, poison, traps, encounters. */
const sections: ReadonlyArray<readonly [name: string, heading: string, level: number, until?: string]> = [
  ["Travel Pace", "Travel Pace", 2],
  ["Creating a Background", "Creating a Background", 2],
  ["Curses", "Curses", 3],
  ["Magical Contagions", "Magical Contagions", 3, "#### Example Contagions"],
  ["Fear and Mental Stress", "Fear and Mental Stress", 2],
  ["Poison", "Poison", 2, "### Sample Poisons"],
  ["Traps", "Traps", 2, "### Example Traps"],
  ["Combat Encounters", "Combat Encounters", 2],
  ["Troubleshooting", "Troubleshooting", 2]
];
for (const [name, heading, level, until] of sections) {
  const whole = bodyOf(heading, level);
  // Subsections read as their own paragraphs, headed by their name.
  // A subsection's name leads its first paragraph; one followed by a table or another heading stands alone.
  const body = (until ? whole.slice(0, whole.indexOf(until)) : whole)
    .replace(/^#{3,5} (.+)\n+(?=[^<#*\n])/gm, "**$1.** ")
    .replace(/^#{3,5} (.+)$/gm, "**$1.**");
  add({ id: `section-${slug(name)}`, name, kind: "section", section: name, subtitle: null, description: plain(body) });
}

const parsed = z.array(ToolboxRecordSchema).safeParse(records);
if (!parsed.success) {
  console.error("REFUSING TO WRITE - toolbox failed validation:");
  for (const issue of parsed.error.issues.slice(0, 10)) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const ids = new Set<string>();
for (const record of records) {
  if (ids.has(record.id)) throw new Error(`Duplicate toolbox id: ${record.id}`);
  ids.add(record.id);
}
writeFileSync(join(outDir, "toolbox.v1.json"), `${JSON.stringify(parsed.data, null, 1)}\n`);
writeFileSync(join(outDir, "poisons.v1.json"), `${JSON.stringify(poisonItems, null, 1)}\n`);
console.log(`toolbox: ${records.length} records, ${poisonItems.length} poisons`);
