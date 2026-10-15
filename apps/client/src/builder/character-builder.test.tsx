import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  BuilderOffer,
  BuilderOffersRequest,
  ContentBackgroundSummary,
  ContentClassLevelRow,
  ContentClassSummary,
  ContentFeatureSummary,
  ContentSkillSummary,
  ContentSpeciesSummary,
  ContentSpellSummary,
  ContentSubclassSummary,
  GmView
} from "@vtt/domain";

/**
 * Rendered-text tests of the character wizard with fixture catalogs: answered offers keep their
 * options, the subclass note on the features step, and reading a spell's rules while choosing.
 * The socket is mocked to answer each `content:*` emit synchronously from the fixtures, and
 * `builder:offers` from a small stand-in for the server's survey over the same fixtures (the real
 * survey is tested server-side).
 */

// Fixtures

const feature = (
  over: Partial<ContentFeatureSummary> & Pick<ContentFeatureSummary, "id" | "name">
): ContentFeatureSummary => ({
  level: null,
  description: "",
  tags: [],
  choice: null,
  choices: [],
  grantedAtLevels: [],
  extraPicks: [],
  ...over
});
const choice = (kind: string, chooseCount: number, from: readonly string[]) => ({
  kind,
  choose: chooseCount,
  from,
  fromCatalog: null,
  maxSpellLevel: null,
  minSpellLevel: null,
  fromPicks: null,
  options: []
});

const SKILL_IDS = ["insight", "perception", "survival", "history", "medicine", "religion"] as const;
const skills: readonly ContentSkillSummary[] = SKILL_IDS.map((id) => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  description: "",
  ability: "wis"
}));

/** Twelve cantrips: over `SEARCH_THRESHOLD`, so this offer gets a search box. */
const CANTRIPS = [
  "Guidance",
  "Light",
  "Mending",
  "Resistance",
  "Sacred Flame",
  "Spare the Dying",
  "Thaumaturgy",
  "Toll the Dead",
  "Word of Radiance",
  "Druidcraft",
  "Message",
  "Prestidigitation"
];
const spell = (name: string, level: number): ContentSpellSummary => ({
  id: name.toLowerCase().replace(/ /g, "-"),
  name,
  level,
  school: "evocation",
  castingTime: "action",
  rangeText: level === 0 ? "Touch" : "60 feet",
  componentsText: "V, S",
  duration: "Instantaneous",
  concentration: false,
  ritual: false,
  attackRoll: false,
  rangeFeet: 120,
  description: `${name} does exactly what ${name} says on the tin, and this sentence is its rules text.`,
  higherLevel: null,
  classes: ["cleric"],
  damageRoll: null,
  damageTypes: [],
  castingOptions: []
});
const spells: readonly ContentSpellSummary[] = [
  ...CANTRIPS.map((name) => spell(name, 0)),
  spell("Bless", 1),
  spell("Cure Wounds", 1),
  spell("Healing Word", 1)
];

const levelRow = (level: number, over: Partial<ContentClassLevelRow> = {}): ContentClassLevelRow => ({
  level,
  proficiencyBonus: 2,
  spellSlots: null,
  pactSlots: null,
  cantripsKnown: null,
  spellsKnown: null,
  preparedFormula: null,
  preparedCount: null,
  classResources: [],
  ...over
});

/** A Cleric cut to what these tests read: a level-3 subclass pick and a cantrip budget. */
const cleric = {
  id: "cleric",
  name: "Cleric",
  source: "srd",
  summary: "A priestly champion.",
  description: "Clerics are conduits for divine power.",
  hitDie: "d8",
  statPriority: ["wis"],
  primaryAbilities: ["wis"],
  savingThrows: ["wis", "cha"],
  skillChoiceCount: 0,
  skillChoices: [],
  armorProficiencies: ["light"],
  weaponProficiencies: ["simple"],
  toolProficiencies: [],
  toolChoices: null,
  multiclassProficiencies: null,
  multiclassPrerequisites: null,
  subclassLevel: 3,
  subclassLabel: "Cleric Subclass",
  asiLevels: [4],
  spellcastingAbility: "wis",
  spellcastingProgression: "full",
  spellcasting: {
    ability: "wis",
    prepares: "prepared",
    ritual: true,
    focus: null,
    progression: "full",
    spellListId: "cleric"
  },
  levelTable: [
    levelRow(1, { cantripsKnown: 3, spellSlots: [2], preparedCount: 4 }),
    levelRow(2, { cantripsKnown: 3, spellSlots: [3], preparedCount: 5 }),
    levelRow(3, { cantripsKnown: 3, spellSlots: [4, 2], preparedCount: 6 })
  ],
  startingEquipmentOptions: [],
  features: [
    feature({
      id: "cleric-subclass",
      name: "Cleric Subclass",
      level: 3,
      grantedAtLevels: [3],
      description: "You gain a Cleric subclass of your choice.",
      choice: {
        kind: "subclass",
        choose: 1,
        from: [],
        fromCatalog: "cleric-subclasses",
        maxSpellLevel: null,
        minSpellLevel: null,
        fromPicks: null,
        options: []
      }
    })
  ]
} as unknown as ContentClassSummary;

const lifeDomain = {
  id: "life-domain",
  name: "Life Domain",
  source: "srd",
  classId: "cleric",
  summary: "Healers of the positive plane.",
  description: "The Life Domain focuses on the positive energy that sustains all life.",
  subclassLevel: null,
  spellcastingAbility: null,
  spellcastingProgression: null,
  spellcasting: null,
  features: [
    feature({
      id: "disciple-of-life",
      name: "Disciple of Life",
      level: 3,
      description: "Your healing spells restore extra Hit Points."
    })
  ]
} as unknown as ContentSubclassSummary;

/** An Elf whose Keen Senses is choose one of three. */
const elf = {
  id: "elf",
  name: "Elf",
  source: "srd",
  summary: "Long-lived and keen-sensed.",
  description: "Elves are magical people of otherworldly grace.",
  sizes: ["medium"],
  speedFeet: 30,
  darkvisionFeet: 60,
  creatureType: "humanoid",
  abilityBonuses: [],
  abilityBonusChoice: null,
  languages: ["common"],
  languageChoices: null,
  lineages: [],
  features: [
    feature({
      id: "elf-keen-senses",
      name: "Keen Senses",
      description: "You have proficiency in the Insight, Perception, or Survival skill.",
      choice: choice("skill", 1, ["insight", "perception", "survival"])
    })
  ]
} as unknown as ContentSpeciesSummary;

/** A second species whose trait asks for two of three. */
const halfling = {
  ...elf,
  id: "halfling",
  name: "Halfling",
  summary: "Small and lucky.",
  features: [
    feature({
      id: "halfling-lore",
      name: "Halfling Lore",
      description: "You gain proficiency in two skills of your choice.",
      choice: choice("skill", 2, ["insight", "perception", "survival"])
    })
  ]
} as unknown as ContentSpeciesSummary;

const acolyte = {
  id: "acolyte",
  name: "Acolyte",
  source: "srd",
  summary: "A temple servant.",
  description: "You served in a temple.",
  abilityOptions: null,
  originFeatId: null,
  skillProficiencies: ["religion"],
  skillChoices: null,
  toolProficiencies: [],
  toolChoices: null,
  languages: [],
  languageChoices: null,
  startingEquipmentOptions: [],
  features: []
} as unknown as ContentBackgroundSummary;

const CATALOG_ANSWERS: Readonly<Record<string, unknown>> = {
  "content:classes": { ok: true, classes: [cleric], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:subclasses": { ok: true, subclasses: [lifeDomain], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:species": { ok: true, species: [elf, halfling], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:backgrounds": { ok: true, backgrounds: [acolyte], attribution: "SRD 5.2.1, CC BY 4.0." },
  // An empty catalog is never cached (`makeCatalog` refuses a miss), so the wizard would re-emit
  // forever and never load; one row each avoids that.
  "content:feats": {
    ok: true,
    feats: [
      {
        id: "alert",
        name: "Alert",
        source: "srd",
        summary: "You are hard to surprise.",
        description: "",
        category: "origin",
        repeatable: false,
        prerequisiteLevel: null,
        prerequisiteAbilities: [],
        prerequisiteRequires: [],
        prerequisiteText: null,
        feature: feature({ id: "alert-feature", name: "Alert" })
      }
    ],
    attribution: "SRD 5.2.1, CC BY 4.0."
  },
  "content:names": {
    ok: true,
    names: [{ speciesId: "elf", source: "srd", pools: [{ id: "given", label: "Given", names: ["Aerin"] }] }],
    attribution: "SRD 5.2.1, CC BY 4.0."
  },
  "content:skills": { ok: true, skills, attribution: "SRD 5.2.1, CC BY 4.0." },
  // `useBuilderCatalogs` waits on every catalog, so a missing one keeps the wizard loading forever.
  "content:languages": {
    ok: true,
    languages: [{ id: "dwarvish", name: "Dwarvish", description: "A standard language.", table: "standard" }],
    attribution: "SRD 5.2.1, CC BY 4.0."
  },
  "content:spells": { ok: true, spells, attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:equipment": {
    ok: true,
    equipment: [
      {
        id: "club",
        name: "Club",
        category: "weapon",
        costGp: 1,
        weightLb: 2,
        description: null,
        weapon: null,
        armor: null
      }
    ],
    attribution: "SRD 5.2.1, CC BY 4.0."
  }
};

/** One fixture offer with the fields these tests do not vary filled in. */
const fixtureOffer = (
  over: Pick<BuilderOffer, "key" | "step" | "kind" | "label" | "capacity" | "options"> & Partial<BuilderOffer>
): BuilderOffer => ({
  featureId: null,
  help: null,
  maxSpellLevel: null,
  level: 1,
  classId: null,
  unresolvable: null,
  unavailable: null,
  ...over
});

/** What the server's survey offers these fixtures: a species trait's pick, the Cleric's subclass from
 *  level 3, and its cantrip and prepared-spell budgets. Answers are kept where an offer takes them. */
function offersFor(request: BuilderOffersRequest) {
  const offers: BuilderOffer[] = [];
  const species = [elf, halfling].find((entry) => entry.id === request.speciesId);
  for (const trait of species?.features ?? []) {
    if (!trait.choice) continue;
    offers.push(
      fixtureOffer({
        key: `feature:${trait.id}`,
        step: "species",
        featureId: trait.id,
        kind: trait.choice.kind,
        label: trait.name,
        help: trait.description,
        capacity: trait.choice.choose,
        options: trait.choice.from.map((id) => ({ id, name: skills.find((skill) => skill.id === id)!.name })),
        unavailable: {}
      })
    );
  }
  if (request.classId === cleric.id) {
    if (request.level >= cleric.subclassLevel)
      offers.push(
        fixtureOffer({
          key: "feature:cleric-subclass",
          step: "features",
          featureId: "cleric-subclass",
          kind: "subclass",
          label: "Cleric Subclass",
          capacity: 1,
          options: [{ id: lifeDomain.id, name: lifeDomain.name }],
          level: cleric.subclassLevel,
          classId: cleric.id
        })
      );
    const row = cleric.levelTable[request.level - 1];
    offers.push(
      fixtureOffer({
        key: "class-cantrips",
        step: "features",
        kind: "cantrip",
        label: "Cleric cantrips",
        capacity: row.cantripsKnown ?? 0,
        options: spells.filter((entry) => entry.level === 0).map(({ id, name, level }) => ({ id, name, level })),
        maxSpellLevel: 0,
        classId: cleric.id
      }),
      fixtureOffer({
        key: "class-spells",
        step: "features",
        kind: "spell",
        label: "Cleric prepared spells",
        capacity: row.preparedCount ?? 0,
        options: spells.filter((entry) => entry.level >= 1).map(({ id, name, level }) => ({ id, name, level })),
        maxSpellLevel: 1,
        classId: cleric.id
      })
    );
  }
  const picks = Object.fromEntries(
    offers.flatMap((offer) => {
      const kept = (request.picks?.[offer.key] ?? []).filter((id) => offer.options.some((option) => option.id === id));
      return kept.length > 0 ? [[offer.key, kept.slice(0, offer.capacity)]] : [];
    })
  );
  return {
    ok: true,
    offers,
    picks,
    asiIncreases: {},
    subclassId: picks["feature:cleric-subclass"]?.[0] ?? null,
    choices: []
  };
}

vi.mock("../socket", () => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event: string, payload: unknown, ack?: (result: unknown) => void) => {
      if (!ack) return;
      if (event === "builder:offers") ack(offersFor(payload as BuilderOffersRequest));
      else ack((CATALOG_ANSWERS as Record<string, unknown>)[event] ?? { ok: false });
    }),
    // `lib/command` sends through `timeout(ms).emit`, whose ack takes an error first.
    timeout: () => ({
      emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
        socket.emit(event, payload, (reply: unknown) => ack(null, reply))
    })
  };
  return { socket };
});

import { ToastProvider } from "@vtt/ui";
import { socket } from "../socket";
import { CharacterBuilder } from "./CharacterBuilder";

const gmView = {
  revision: 1,
  actors: [],
  definitions: [],
  rolls: [],
  builderPolicy: { allowedAbilityMethods: ["standard-array"], customFormula: null, maxLevel: 20, playerBuilder: "open" }
} as unknown as GmView;

function mount() {
  // `Save & close` toasts, so the wizard needs the provider its host page gives it.
  return render(
    <ToastProvider>
      <CharacterBuilder state={gmView} sessionKey={`test-${Math.random()}`} onClose={() => {}} onCreated={() => {}} />
    </ToastProvider>
  );
}

/** The `.cb-offer` section whose heading is exactly `label`. */
const offerNamed = (label: string) => {
  const heading = screen.getAllByRole("heading", { name: label }).at(-1);
  const section = heading?.closest("section.cb-offer");
  if (!section) throw new Error(`no offer named ${JSON.stringify(label)} on this step`);
  return section as HTMLElement;
};
/** Every option card in an offer, as `name -> disabled`. */
const cardsIn = (section: HTMLElement) =>
  Object.fromEntries(
    within(section)
      .queryAllByRole("radio")
      .concat(within(section).queryAllByRole("checkbox"))
      .map((card) => [card.textContent?.replace(/\s+/g, " ").trim() ?? "", (card as HTMLButtonElement).disabled])
  );

/** Walk to the class step and choose the Cleric at `level`. */
async function toClassFeatures(user: ReturnType<typeof userEvent.setup>, level: number) {
  await user.click(await screen.findByRole("radio", { name: /Elf/ }));
  await user.click(within(offerNamed("Keen Senses")).getByRole("radio", { name: /Perception/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("radio", { name: /Acolyte/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("radio", { name: /Cleric/ }));
  const stepper = screen.getByRole("group", { name: "Character level" });
  for (let at = 1; at < level; at++) await user.click(within(stepper).getByRole("button", { name: "Increase" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
}

// Issue 1

describe("Issue 1 — an answered offer keeps the options it did not take", () => {
  it("leaves all three Keen Senses skills on screen after Perception is picked, and lets the pick be swapped", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /Elf/ }));

    const keen = () => offerNamed("Keen Senses");
    expect(Object.keys(cardsIn(keen()))).toEqual(["Insight", "Perception", "Survival"]);

    await user.click(within(keen()).getByRole("radio", { name: /Perception/ }));

    // Answered, the offer still shows every option with the answer marked.
    expect(Object.keys(cardsIn(keen()))).toEqual(["Insight", "Perception", "Survival"]);
    expect(within(keen()).getByRole("radio", { name: /Perception/ })).toHaveAttribute("aria-checked", "true");
    expect(within(keen()).queryByRole("button", { name: "Change" })).toBeNull();

    /**
     * A choose-one offer is a radiogroup, so the untaken options stay enabled: swapping is one tap.
     * Disabling them would leave a keyboard user unable to arrow to another answer. Greying belongs
     * to capacity in a choose-N offer (next test).
     */
    expect(Object.values(cardsIn(keen()))).toEqual([false, false, false]);
    await user.click(within(keen()).getByRole("radio", { name: /Survival/ }));
    expect(within(keen()).getByRole("radio", { name: /Survival/ })).toHaveAttribute("aria-checked", "true");
    expect(within(keen()).getByRole("radio", { name: /Perception/ })).toHaveAttribute("aria-checked", "false");
  });

  it("greys the unchosen options at capacity, and un-picking one puts every option back", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /Halfling/ }));

    const lore = () => offerNamed("Halfling Lore");
    await user.click(within(lore()).getByRole("checkbox", { name: /Insight/ }));
    await user.click(within(lore()).getByRole("checkbox", { name: /Perception/ }));

    // At 2 of 2 the third option is still there, greyed, with the reason stated once beside the count.
    expect(cardsIn(lore())).toEqual({ Insight: false, Perception: false, Survival: true });
    expect(within(lore()).getByText(/You have already chosen 2/)).toBeInTheDocument();

    // Deselecting a pick immediately re-enables every other option.
    await user.click(within(lore()).getByRole("checkbox", { name: /Insight/ }));
    expect(cardsIn(lore())).toEqual({ Insight: false, Perception: false, Survival: false });
    expect(within(lore()).queryByText(/You have already chosen 2/)).toBeNull();
  });

  /**
   * Any multi-select offer greys its unselected options at the maximum, regardless of length; a
   * 12-option offer behaves like the 3-option one, and the grid's bounded scroll region keeps the
   * page height in check.
   */
  it("keeps a LONG answered offer's options mounted and greys them — the fold is deleted, not gated", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    // Twelve options, over `SEARCH_THRESHOLD`: the grid carries a search box.
    expect(Object.keys(cardsIn(cantrips()))).toHaveLength(12);
    expect(within(cantrips()).getByRole("searchbox")).toBeInTheDocument();

    for (const name of ["Guidance", "Light", "Mending"]) {
      await user.click(within(cantrips()).getByRole("checkbox", { name: new RegExp(`^${name}`) }));
    }

    // 3 of 3, and all twelve cards are still in the DOM: the chosen enabled (swappable), the rest
    // greyed, and no Change / Done button anywhere.
    const cards = cardsIn(cantrips());
    expect(Object.keys(cards)).toHaveLength(12);
    expect(Object.entries(cards).filter(([, disabled]) => disabled)).toHaveLength(9);
    for (const name of ["Guidance", "Light", "Mending"]) {
      const card = within(cantrips()).getByRole("checkbox", { name: new RegExp(`^${name}`) }) as HTMLButtonElement;
      expect(card).toHaveAttribute("aria-checked", "true");
      expect(card.disabled).toBe(false);
    }
    expect(within(cantrips()).queryByRole("button", { name: "Change" })).toBeNull();
    expect(within(cantrips()).queryByRole("button", { name: "Done" })).toBeNull();

    /**
     * jsdom computes no layout, so this asserts the mechanism: the card list is a declared scroll
     * region (`.scroll-y`) carrying the cap class.
     */
    const items = cantrips().querySelector(".nh-choicegrid-items");
    expect(items).toHaveClass("scroll-y");
    expect(items).toHaveClass("nh-choicegrid-items--bounded");
  });

  /** Greying depends on an offer's capacity, never its kind, so it is held on a spell offer too. */
  it("greys at capacity on a NON-SKILL offer, and un-picking one puts every option back", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    const disabledIn = () =>
      Object.entries(cardsIn(cantrips()))
        .filter(([, off]) => off)
        .map(([name]) => name);
    expect(disabledIn()).toEqual([]);

    for (const name of ["Guidance", "Light", "Mending"]) {
      await user.click(within(cantrips()).getByRole("checkbox", { name: new RegExp(`^${name}`) }));
    }
    expect(disabledIn()).toHaveLength(9);
    expect(disabledIn()).toContain("ResistanceCantrip");
    expect(within(cantrips()).getByText(/You have already chosen 3/)).toBeInTheDocument();

    // One tap on an own pick puts the other nine back.
    await user.click(within(cantrips()).getByRole("checkbox", { name: /^Light/ }));
    expect(disabledIn()).toEqual([]);
    expect(within(cantrips()).queryByText(/You have already chosen 3/)).toBeNull();
  });
});

// Issue 2b

describe("Issue 2b — the class features step and its subclass", () => {
  it("names the level the subclass arrives at, in the step body, when the build is below it", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    // No subclass offer at level 1 (SRD `subclassLevel: 3`), so the step says when instead.
    expect(screen.getByText("You choose a cleric subclass at level 3.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cleric Subclass" })).toBeNull();

    /**
     * In the step body, not the detail pane, which is hidden on narrow screens. jsdom loads no
     * stylesheet, so this asserts structure: the note is in the step and the pane is not rendered.
     */
    expect(document.querySelector(".cb-step")).toContainElement(
      screen.getByText("You choose a cleric subclass at level 3.")
    );
    expect(document.querySelector(".nh-wizard-detail")).toBeNull();
  });

  it("fills the pane with the subclass's own description and features the moment one is picked", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 3);

    // At level 3 the offer is there, and the pane holds its place with the invitation.
    expect(screen.queryByText(/You choose a cleric subclass at level/)).toBeNull();
    expect(screen.getByText("Pick a cleric subclass to read about it here.")).toBeInTheDocument();

    await user.click(within(offerNamed("Cleric Subclass")).getByRole("radio", { name: /Life Domain/ }));

    const pane = document.querySelector(".nh-wizard-detail") as HTMLElement;
    expect(within(pane).getByRole("heading", { name: "Life Domain" })).toBeInTheDocument();
    expect(within(pane).getByText(/positive energy that sustains all life/)).toBeInTheDocument();
    expect(within(pane).getByText("Disciple of Life")).toBeInTheDocument();
    // The narrow-screen door appears only once there is something behind it.
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
  });
});

// Issue 2c

describe("Issue 2c — a spell's rules can be read while choosing spells", () => {
  it("opens the rules in a modal, changes no pick, and closes on Escape", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    await user.click(within(cantrips()).getByRole("checkbox", { name: /^Guidance/ }));
    const picked = () =>
      within(cantrips())
        .queryAllByRole("checkbox")
        .filter((card) => card.getAttribute("aria-checked") === "true")
        .map((card) => card.querySelector(".nh-choice-title")?.textContent);
    expect(picked()).toEqual(["Guidance"]);

    // The control is a sibling of the card, never inside it: a `ChoiceCard` is a <button>, and a
    // nested button would be reparented out of the card at parse time.
    const info = within(cantrips()).getByRole("button", { name: "Read the Light rules" });
    expect(info.closest("[role='checkbox']")).toBeNull();

    /**
     * ...and a sibling of exactly one card, in a wrapper holding nothing else (`.nh-choice-wrap`,
     * ChoiceCard.css), so each icon visibly belongs to its spell.
     */
    const pair = info.parentElement as HTMLElement;
    expect(pair).toHaveClass("nh-choice-wrap");
    expect(pair.querySelectorAll("[role='checkbox']")).toHaveLength(1);
    expect(pair.querySelector("[role='checkbox']")?.querySelector(".nh-choice-title")?.textContent).toBe("Light");
    expect(pair.children).toHaveLength(2);
    // The wrapper is the grid item, so nothing sits between a pair and the gap after it.
    expect(pair.parentElement).toHaveClass("nh-choicegrid-items");

    await user.click(info);

    const modal = await screen.findByRole("dialog", { name: "Light spell rules" });
    expect(within(modal).getByRole("heading", { name: "Light" })).toBeInTheDocument();
    expect(within(modal).getByText("Casting Time")).toBeInTheDocument();
    expect(within(modal).getByText("Action")).toBeInTheDocument();
    expect(within(modal).getByText("Range")).toBeInTheDocument();
    expect(within(modal).getByText("Touch")).toBeInTheDocument();
    expect(within(modal).getByText(/this sentence is its rules text/)).toBeInTheDocument();

    // Reading is not answering: no pick changes.
    expect(picked()).toEqual(["Guidance"]);

    /**
     * jsdom implements neither `showModal()` nor its Escape handling, so dispatch the `cancel` event
     * the browser sends and `Modal` listens for.
     */
    (modal as HTMLDialogElement).dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Light spell rules" })).toBeNull());
    expect(picked()).toEqual(["Guidance"]);
    // ...and the wizard is still open: its window-level Escape must not fire alongside the dialog's.
    expect(offerNamed("Cleric cantrips")).toBeInTheDocument();
  });

  it("offers the rules on a card that capacity has locked — the two you did NOT take are the ones worth reading", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    for (const name of ["Guidance", "Light", "Mending"]) {
      await user.click(within(cantrips()).getByRole("checkbox", { name: new RegExp(`^${name}`) }));
    }
    // The locked cards are still there; nothing has to be reopened to reach them.
    const locked = within(cantrips()).getByRole("checkbox", { name: /^Resistance/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    const info = within(cantrips()).getByRole("button", { name: "Read the Resistance rules" }) as HTMLButtonElement;
    expect(info.disabled).toBe(false);
    await user.click(info);
    expect(await screen.findByRole("dialog", { name: "Resistance spell rules" })).toBeInTheDocument();
  });

  it("puts no reference control on an offer whose options are not spells", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /Elf/ }));
    // A skill has no rules card, so its cards get no second control.
    expect(within(offerNamed("Keen Senses")).queryAllByRole("button", { name: /^Read the/ })).toHaveLength(0);
  });
});

describe("the offers come from the table", () => {
  /** Holds every `builder:offers` answer until the test releases it; catalogs still answer at once. */
  function holdOffers() {
    const held: Array<{ payload: BuilderOffersRequest; ack: (result: unknown) => void }> = [];
    vi.mocked(socket.emit).mockImplementation(((event: string, payload: unknown, ack?: (result: unknown) => void) => {
      if (!ack) return socket;
      if (event === "builder:offers") held.push({ payload: payload as BuilderOffersRequest, ack });
      else ack((CATALOG_ANSWERS as Record<string, unknown>)[event] ?? { ok: false });
      return socket;
    }) as never);
    return {
      requests: () => held.map((entry) => entry.payload),
      answerAll: (answer: (request: BuilderOffersRequest) => unknown = offersFor) =>
        act(() => {
          for (const { payload, ack } of held.splice(0)) ack(answer(payload));
        })
    };
  }

  it("shows a pick at once, asks again, and keeps the last offers on screen meanwhile", async () => {
    const offers = holdOffers();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /Elf/ }));
    // Nothing to pick until the table answers for an Elf.
    expect(screen.queryByRole("heading", { name: "Keen Senses" })).toBeNull();
    await offers.answerAll();
    const keen = () => offerNamed("Keen Senses");

    await user.click(within(keen()).getByRole("radio", { name: /Perception/ }));
    // The answer shows before the table has seen it, on the offer it already had.
    expect(within(keen()).getByRole("radio", { name: /Perception/ })).toHaveAttribute("aria-checked", "true");
    expect(offers.requests().at(-1)?.picks).toEqual({ "feature:elf-keen-senses": ["perception"] });
    await offers.answerAll();
    expect(within(keen()).getByRole("radio", { name: /Perception/ })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the table's refusal in its own words, beside the last offers", async () => {
    const offers = holdOffers();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /Elf/ }));
    await offers.answerAll();
    await user.click(within(offerNamed("Keen Senses")).getByRole("radio", { name: /Survival/ }));
    await offers.answerAll(() => ({
      ok: false,
      code: "refused",
      message: 'No species "elf" is in the content catalog.'
    }));
    const alert = screen.getByText("The table could not check these choices").closest(".nh-alert");
    expect(alert).toHaveTextContent('No species "elf" is in the content catalog.');
    expect(offerNamed("Keen Senses")).toBeInTheDocument();
  });
});
