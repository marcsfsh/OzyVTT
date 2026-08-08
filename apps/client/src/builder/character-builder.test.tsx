import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ContentBackgroundSummary, ContentClassLevelRow, ContentClassSummary, ContentFeatureSummary,
  ContentSkillSummary, ContentSpeciesSummary, ContentSpellSummary, ContentSubclassSummary, GmView
} from "@vtt/domain";

/**
 * **The character wizard's three reading defects (Area 1: issues `1`, `2b`, `2c`).**
 *
 * `apps/client/src/builder/` had no component test at all before this file, which is most of why all
 * three shipped: every one of them is about what the STEP SHOWS, and nothing was reading the step.
 *
 *   - **`1`** — an answered offer hid every option the player did not take. The first fix gated the
 *     fold on option count, which left the rule true for a three-option skill pick and still false
 *     for every long list; the client rejected exactly that. The fold is now DELETED and the page
 *     height it bought comes from `ChoiceGrid bounded` — a capped, internally scrolling card list —
 *     so at every length every option stays mounted and greys at capacity rather than vanishing.
 *   - **`2b`** — the features step invited a subclass pick that does not exist below level 3, and
 *     said so in a pane a phone cannot see.
 *   - **`2c`** — 203 spell names with no way to read what any of them does.
 *
 * These are RENDERED-TEXT assertions on the real component with fixture catalogs, not unit tests of
 * a helper: "the option is still in `offer.options`" was true the whole time the option was invisible.
 *
 * The catalogs arrive over the socket, so the socket is mocked to answer each `content:*` emit
 * synchronously from the fixtures below. They are deliberately SMALL and shaped like the real SRD
 * records they stand for (an Elf whose Keen Senses is choose-1-of-3, a Cleric whose subclass lands at
 * level 3), plus one deliberately long spell list — the rule is universal, so proving it needs a
 * list long enough that the old threshold would have hidden it.
 */

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

const feature = (over: Partial<ContentFeatureSummary> & Pick<ContentFeatureSummary, "id" | "name">): ContentFeatureSummary => ({
  level: null, description: "", tags: [], choice: null, choices: [], grantedAtLevels: [], extraPicks: [], ...over
});
const choice = (kind: string, chooseCount: number, from: readonly string[]) =>
  ({ kind, choose: chooseCount, from, fromCatalog: null, maxSpellLevel: null, minSpellLevel: null, fromPicks: null, options: [] });

const SKILL_IDS = ["insight", "perception", "survival", "history", "medicine", "religion"] as const;
const skills: readonly ContentSkillSummary[] = SKILL_IDS.map((id) => ({
  id, name: id.charAt(0).toUpperCase() + id.slice(1), description: "", ability: "wis"
}));

/** Twelve cantrips: over `SEARCH_THRESHOLD`, so this offer earns a search box — and, under the old
    threshold, was the list that vanished when answered. It is the long case the rule must also hold for. */
const CANTRIPS = ["Guidance", "Light", "Mending", "Resistance", "Sacred Flame", "Spare the Dying",
  "Thaumaturgy", "Toll the Dead", "Word of Radiance", "Druidcraft", "Message", "Prestidigitation"];
const spell = (name: string, level: number): ContentSpellSummary => ({
  id: name.toLowerCase().replace(/ /g, "-"), name, level, school: "evocation",
  castingTime: "action", rangeText: level === 0 ? "Touch" : "60 feet", componentsText: "V, S",
  duration: "Instantaneous", concentration: false, ritual: false, attackRoll: false, rangeFeet: 120,
  description: `${name} does exactly what ${name} says on the tin, and this sentence is its rules text.`,
  higherLevel: null, classes: ["cleric"], damageRoll: null, damageTypes: [], castingOptions: []
});
const spells: readonly ContentSpellSummary[] = [
  ...CANTRIPS.map((name) => spell(name, 0)),
  spell("Bless", 1), spell("Cure Wounds", 1), spell("Healing Word", 1)
];

const levelRow = (level: number, over: Partial<ContentClassLevelRow> = {}): ContentClassLevelRow => ({
  level, proficiencyBonus: 2, spellSlots: null, pactSlots: null, cantripsKnown: null,
  spellsKnown: null, preparedFormula: null, preparedCount: null, classResources: [], ...over
});

/** A Cleric, cut to the two things these tests read: a level-3 subclass pick and a cantrip budget. */
const cleric = {
  id: "cleric", name: "Cleric", source: "srd", summary: "A priestly champion.",
  description: "Clerics are conduits for divine power.", hitDie: "d8",
  statPriority: ["wis"], primaryAbilities: ["wis"], savingThrows: ["wis", "cha"],
  skillChoiceCount: 0, skillChoices: [],
  armorProficiencies: ["light"], weaponProficiencies: ["simple"], toolProficiencies: [],
  toolChoices: null, multiclassProficiencies: null, multiclassPrerequisites: null,
  subclassLevel: 3, subclassLabel: "Cleric Subclass", asiLevels: [4],
  spellcastingAbility: "wis", spellcastingProgression: "full",
  spellcasting: { ability: "wis", prepares: "prepared", ritual: true, focus: null, progression: "full", spellListId: "cleric" },
  levelTable: [
    levelRow(1, { cantripsKnown: 3, spellSlots: [2], preparedCount: 4 }),
    levelRow(2, { cantripsKnown: 3, spellSlots: [3], preparedCount: 5 }),
    levelRow(3, { cantripsKnown: 3, spellSlots: [4, 2], preparedCount: 6 })
  ],
  startingEquipmentOptions: [],
  features: [
    feature({
      id: "cleric-subclass", name: "Cleric Subclass", level: 3, grantedAtLevels: [3],
      description: "You gain a Cleric subclass of your choice.",
      choice: { kind: "subclass", choose: 1, from: [], fromCatalog: "cleric-subclasses", maxSpellLevel: null, minSpellLevel: null, fromPicks: null, options: [] }
    })
  ]
} as unknown as ContentClassSummary;

const lifeDomain = {
  id: "life-domain", name: "Life Domain", source: "srd", classId: "cleric",
  summary: "Healers of the positive plane.",
  description: "The Life Domain focuses on the positive energy that sustains all life.",
  subclassLevel: null, spellcastingAbility: null, spellcastingProgression: null, spellcasting: null,
  features: [feature({ id: "disciple-of-life", name: "Disciple of Life", level: 3, description: "Your healing spells restore extra Hit Points." })]
} as unknown as ContentSubclassSummary;

/** An Elf whose Keen Senses is the reported case: choose ONE of three, three options total. */
const elf = {
  id: "elf", name: "Elf", source: "srd", summary: "Long-lived and keen-sensed.",
  description: "Elves are magical people of otherworldly grace.",
  sizes: ["medium"], speedFeet: 30, darkvisionFeet: 60, creatureType: "humanoid",
  abilityBonuses: [], abilityBonusChoice: null, languages: ["common"], languageChoices: null,
  lineages: [],
  features: [feature({
    id: "elf-keen-senses", name: "Keen Senses",
    description: "You have proficiency in the Insight, Perception, or Survival skill.",
    choice: choice("skill", 1, ["insight", "perception", "survival"])
  })]
} as unknown as ContentSpeciesSummary;

/** A second species whose trait asks for TWO of three — the multi-select half of issue `1`. */
const halfling = {
  ...elf, id: "halfling", name: "Halfling", summary: "Small and lucky.",
  features: [feature({
    id: "halfling-lore", name: "Halfling Lore",
    description: "You gain proficiency in two skills of your choice.",
    choice: choice("skill", 2, ["insight", "perception", "survival"])
  })]
} as unknown as ContentSpeciesSummary;

const acolyte = {
  id: "acolyte", name: "Acolyte", source: "srd", summary: "A temple servant.", description: "You served in a temple.",
  abilityOptions: null, originFeatId: null, skillProficiencies: ["religion"], skillChoices: null,
  toolProficiencies: [], toolChoices: null, languages: [], languageChoices: null,
  startingEquipmentOptions: [], features: []
} as unknown as ContentBackgroundSummary;

const CATALOG_ANSWERS: Readonly<Record<string, unknown>> = {
  "content:classes": { ok: true, classes: [cleric], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:subclasses": { ok: true, subclasses: [lifeDomain], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:species": { ok: true, species: [elf, halfling], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:backgrounds": { ok: true, backgrounds: [acolyte], attribution: "SRD 5.2.1, CC BY 4.0." },
  // An EMPTY feats/names catalog is never cached (`makeCatalog` refuses a miss), so the wizard would
  // re-emit forever and `catalogs.loaded` would stay false. One row each is the cheapest honest fix.
  "content:feats": { ok: true, feats: [{ id: "alert", name: "Alert", source: "srd", summary: "You are hard to surprise.", description: "", category: "origin", repeatable: false, prerequisiteLevel: null, prerequisiteAbilities: [], prerequisiteRequires: [], prerequisiteText: null, feature: feature({ id: "alert-feature", name: "Alert" }) }], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:names": { ok: true, names: [{ speciesId: "elf", source: "srd", pools: [{ id: "given", label: "Given", names: ["Aerin"] }] }], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:skills": { ok: true, skills, attribution: "SRD 5.2.1, CC BY 4.0." },
  // `useBuilderCatalogs` waits on EVERY catalog; a miss is never cached, so leaving this out kept the
  // wizard on its loading state forever rather than failing anywhere near the cause.
  "content:languages": { ok: true, languages: [{ id: "dwarvish", name: "Dwarvish", description: "A standard language.", table: "standard" }], attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:spells": { ok: true, spells, attribution: "SRD 5.2.1, CC BY 4.0." },
  "content:equipment": { ok: true, equipment: [{ id: "club", name: "Club", category: "weapon", costGp: 1, weightLb: 2, description: null, weapon: null, armor: null }], attribution: "SRD 5.2.1, CC BY 4.0." }
};

vi.mock("../socket", () => ({
  socket: {
    on: vi.fn(), off: vi.fn(),
    emit: vi.fn((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (ack) ack((CATALOG_ANSWERS as Record<string, unknown>)[event] ?? { ok: false });
    })
  }
}));

import { ToastProvider } from "@vtt/ui";
import { CharacterBuilder } from "./CharacterBuilder";

const gmView = {
  revision: 1, actors: [], definitions: [], rolls: [],
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
  Object.fromEntries(within(section).queryAllByRole("radio").concat(within(section).queryAllByRole("checkbox"))
    .map((card) => [card.textContent?.replace(/\s+/g, " ").trim() ?? "", (card as HTMLButtonElement).disabled]));

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

// ── issue 1 ─────────────────────────────────────────────────────────────────────────────────────

describe("Issue 1 — an answered offer keeps the options it did not take", () => {
  it("leaves all three Keen Senses skills on screen after Perception is picked, and lets the pick be swapped", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("radio", { name: /Elf/ }));

    const keen = () => offerNamed("Keen Senses");
    expect(Object.keys(cardsIn(keen()))).toEqual(["Insight", "Perception", "Survival"]);

    await user.click(within(keen()).getByRole("radio", { name: /Perception/ }));

    // THE DEFECT: this offer used to fold to a single "Perception" chip the moment it was answered,
    // and Insight and Survival left the DOM. Nothing folds now, at any length, so the whole
    // question stays on screen with the answer marked on it.
    expect(Object.keys(cardsIn(keen()))).toEqual(["Insight", "Perception", "Survival"]);
    expect(within(keen()).getByRole("radio", { name: /Perception/ })).toHaveAttribute("aria-checked", "true");
    expect(within(keen()).queryByRole("button", { name: "Change" })).toBeNull();

    /**
     * A choose-ONE offer is a radiogroup, so the two it did not take stay ENABLED — swapping is one
     * tap on the other option, not a de-select of this one.
     *
     * This is where the plan's own test text was wrong, and deliberately not followed: it asked for
     * Insight and Survival to be *disabled* after Perception. Disabling them would make `ChoiceGrid`'s
     * `selectable` set a single card, so arrow keys would move nowhere and a keyboard player would be
     * locked into their first answer with no way to change it. The greying belongs to capacity in a
     * choose-N offer, which the next test holds.
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

    // At 2 of 2 the third option is still THERE, greyed, with the reason stated once beside the count.
    expect(cardsIn(lore())).toEqual({ Insight: false, Perception: false, Survival: true });
    expect(within(lore()).getByText(/You have already chosen 2/)).toBeInTheDocument();

    // "A selected option can be clicked again to deselect it, which immediately re-enables every
    // other option" — the reported expectation, held at the far end.
    await user.click(within(lore()).getByRole("checkbox", { name: /Insight/ }));
    expect(cardsIn(lore())).toEqual({ Insight: false, Perception: false, Survival: false });
    expect(within(lore()).queryByText(/You have already chosen 2/)).toBeNull();
  });

  /**
   * THE REPLACEMENT for "still folds a LONG offer once it is answered — the collapse is gated, not
   * deleted", which encoded the behaviour the client then rejected on sight. Their rule, verbatim:
   * *"it needs to be any time the player is choosing multiple options, once they've selected the
   * max, all unselected options are greyed out."* No threshold — so a 12-option offer must behave
   * exactly like the 3-option one above, and the page height that the fold was buying is bought by
   * the grid's own bounded scroll region instead.
   */
  it("keeps a LONG answered offer's options mounted and greys them — the fold is deleted, not gated", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    // Twelve options, over `SEARCH_THRESHOLD`: the grid is on screen, and it carries a search box.
    expect(Object.keys(cardsIn(cantrips()))).toHaveLength(12);
    expect(within(cantrips()).getByRole("searchbox")).toBeInTheDocument();

    for (const name of ["Guidance", "Light", "Mending"]) {
      await user.click(within(cantrips()).getByRole("checkbox", { name: new RegExp(`^${name}`) }));
    }

    // 3 of 3, and ALL TWELVE cards are still in the DOM: the three chosen enabled (so the pick can
    // be swapped), the nine declined greyed, and no Change / Done button anywhere — there is
    // nothing left to reopen.
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
     * ...and the height the fold was buying is bought HERE. jsdom computes no layout, so this
     * asserts the mechanism rather than the pixels: the card list is a DECLARED scroll region
     * (`.scroll-y` in the markup, design-language.md §7) carrying the cap class. The measured
     * numbers live in the report — Wizard L20's answered step at 1280px.
     */
    const items = cantrips().querySelector(".nh-choicegrid-items");
    expect(items).toHaveClass("scroll-y");
    expect(items).toHaveClass("nh-choicegrid-items--bounded");
  });

  /**
   * The client watched this work for a Cleric's SKILL picks and reported it as broken everywhere
   * else — which was accurate, because the offers that hid their options were the long ones, and
   * the long ones are spells, cantrips, feats and equipment. Greying is a fact about an offer's
   * CAPACITY and never about its kind, so this holds the rule on a spell offer end to end.
   */
  it("greys at capacity on a NON-SKILL offer, and un-picking one puts every option back", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    const disabledIn = () => Object.entries(cardsIn(cantrips())).filter(([, off]) => off).map(([name]) => name);
    expect(disabledIn()).toEqual([]);

    for (const name of ["Guidance", "Light", "Mending"]) {
      await user.click(within(cantrips()).getByRole("checkbox", { name: new RegExp(`^${name}`) }));
    }
    expect(disabledIn()).toHaveLength(9);
    expect(disabledIn()).toContain("ResistanceCantrip");
    expect(within(cantrips()).getByText(/You have already chosen 3/)).toBeInTheDocument();

    // One tap on their own pick puts the other nine back — the reported expectation, on a kind the
    // client never saw it work on.
    await user.click(within(cantrips()).getByRole("checkbox", { name: /^Light/ }));
    expect(disabledIn()).toEqual([]);
    expect(within(cantrips()).queryByText(/You have already chosen 3/)).toBeNull();
  });
});

// ── issue 2b ────────────────────────────────────────────────────────────────────────────────────

describe("Issue 2b — the class features step and its subclass", () => {
  it("names the level the subclass arrives at, in the step body, when the build is below it", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    // There is no subclass offer at level 1 — every SRD class carries `subclassLevel: 3` — so the
    // step says WHEN instead of inviting a pick nothing on screen can answer.
    expect(screen.getByText("You choose a cleric subclass at level 3.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cleric Subclass" })).toBeNull();

    /**
     * IN THE BODY, not the detail pane. Below 761px the pane is master-detail and hidden, and its
     * only door is gated on real content — so the sentence lived where a phone could never read it.
     * jsdom loads no stylesheet, so this asserts the STRUCTURE that makes it visible: the note is
     * inside the step, and the pane is not rendered at all (nothing on this step can ever fill it).
     */
    expect(document.querySelector(".cb-step")).toContainElement(screen.getByText("You choose a cleric subclass at level 3."));
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
    // The narrow-screen door only appears once there is something behind it; now there is.
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
  });
});

// ── issue 2c ────────────────────────────────────────────────────────────────────────────────────

describe("Issue 2c — a spell's rules can be read while choosing spells", () => {
  it("opens the rules in a modal, changes no pick, and closes on Escape", async () => {
    const user = userEvent.setup();
    mount();
    await toClassFeatures(user, 1);

    const cantrips = () => offerNamed("Cleric cantrips");
    await user.click(within(cantrips()).getByRole("checkbox", { name: /^Guidance/ }));
    const picked = () => within(cantrips()).queryAllByRole("checkbox")
      .filter((card) => card.getAttribute("aria-checked") === "true")
      .map((card) => card.querySelector(".nh-choice-title")?.textContent);
    expect(picked()).toEqual(["Guidance"]);

    // The control is a SIBLING of the card, never inside it: a `ChoiceCard` is a <button>, and a
    // nested button would be reparented out of the card's own hit area at parse time.
    const info = within(cantrips()).getByRole("button", { name: "Read the Light rules" });
    expect(info.closest("[role='checkbox']")).toBeNull();

    /**
     * ...and a sibling of EXACTLY ONE card, in a wrapper that holds nothing else. That is the
     * re-opened half of `2g`: the client could not tell which icon belonged to which spell, because
     * the two were separate boxes 8px apart in a grid whose own gap was 10px, and reading order was
     * the only tie-break. The frame moved to `.nh-choice-wrap` (ChoiceCard.css) so the pairing is
     * structural — this holds the structure the paint depends on. The pixels are in the report:
     * card and control both 46.25px tall, 1px apart, 14px between pairs, measured at 320/375/1280.
     */
    const pair = info.parentElement as HTMLElement;
    expect(pair).toHaveClass("nh-choice-wrap");
    expect(pair.querySelectorAll("[role='checkbox']")).toHaveLength(1);
    expect(pair.querySelector("[role='checkbox']")?.querySelector(".nh-choice-title")?.textContent).toBe("Light");
    expect(pair.children).toHaveLength(2);
    // The wrapper IS the grid item, so nothing sits between a pair and the gap that separates it
    // from the next one.
    expect(pair.parentElement).toHaveClass("nh-choicegrid-items");

    await user.click(info);

    const modal = await screen.findByRole("dialog", { name: "Light spell rules" });
    expect(within(modal).getByRole("heading", { name: "Light" })).toBeInTheDocument();
    expect(within(modal).getByText("Casting Time")).toBeInTheDocument();
    expect(within(modal).getByText("Action")).toBeInTheDocument();
    expect(within(modal).getByText("Range")).toBeInTheDocument();
    expect(within(modal).getByText("Touch")).toBeInTheDocument();
    expect(within(modal).getByText(/this sentence is its rules text/)).toBeInTheDocument();

    // Reading is not answering. The whole point of a modal over an inline expansion: 203 cards behind
    // it, and a stray tap must not land on one.
    expect(picked()).toEqual(["Guidance"]);

    /**
     * Escape, through the `cancel` event a native <dialog> raises for it. jsdom implements neither
     * `showModal()` nor its Escape handling (`test/setup.ts` shims `show()` semantics), so the key
     * itself would prove nothing here; dispatching `cancel` is the exact event the browser sends and
     * the one `Modal` listens for. The real-browser press was verified separately.
     */
    (modal as HTMLDialogElement).dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Light spell rules" })).toBeNull());
    expect(picked()).toEqual(["Guidance"]);
    // ...and the wizard is still standing. Its own window-level Escape used to fire alongside the
    // dialog's, so one press dismissed the card AND left the builder.
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
    // The locked cards are simply still there — nothing has to be reopened to reach them.
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
    // One idea, one place: a skill has no rules card to open, so its cards grow no second control.
    expect(within(offerNamed("Keen Senses")).queryAllByRole("button", { name: /^Read the/ })).toHaveLength(0);
  });
});
