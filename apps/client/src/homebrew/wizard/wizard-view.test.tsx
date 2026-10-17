/** The wizards as a GM uses them: steps one at a time, answers through the controls, the preview beside them, and a
    review that reads the editor's own publish checklist back step by step. Driven the way `RecordDetail` drives it:
    one draft, the checklist worked out from it, and the step held outside. */

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/command", () => ({
  read: vi.fn(() =>
    Promise.resolve({
      ok: true,
      benchmarks: [
        {
          challengeRating: 2,
          count: 3,
          armorClass: { median: 13, min: 11, max: 15 },
          hitPoints: { median: 45, min: 30, max: 60 },
          attackBonus: { median: 5, min: 4, max: 6 },
          saveDc: { median: 12, min: 11, max: 13 },
          damagePerRound: { median: 14, min: 9, max: 20 }
        }
      ]
    })
  )
}));

vi.mock("../../content/catalogs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBuilderCatalogs: () => ({
    choice: {
      classes: [{ id: "fighter", name: "Fighter", subclassLevel: 3 }],
      subclasses: [{ id: "champion", classId: "fighter", features: [{ level: 3 }, { level: 7 }, { level: 10 }] }]
    }
  }),
  useFeatCatalog: () => ({
    items: [
      { id: "alert", name: "Alert", category: "origin" },
      { id: "grappler", name: "Grappler", category: "general" }
    ]
  })
}));

import { blankDraft, forStorage } from "../defaults";
import { EMPTY_CONTEXT, type Draft } from "../schema";
import type { HomebrewType } from "../types";
import { publishIssues } from "../validate";
import { WIZARDS } from "./index";
import { WizardView } from "./WizardView";
import { wizardSpell } from "./wizard-records";

const RECORD = "hb-wizard-probe";
const CTX = { ...EMPTY_CONTEXT, recordId: RECORD };

function Harness({
  type,
  initial,
  onDraft,
  onPublish,
  onOpenEditor
}: Readonly<{
  type: HomebrewType;
  initial: Draft;
  onDraft: (next: Draft) => void;
  onPublish: () => void;
  onOpenEditor: (section: string | null) => void;
}>) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(WIZARDS[type].steps[0].id);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  return (
    <WizardView
      def={WIZARDS[type]}
      draft={draft}
      onDraft={(next) => {
        setDraft(next);
        onDraft(next);
      }}
      ctx={CTX}
      recordId={RECORD}
      spells={[]}
      checklist={publishIssues(type, draft, CTX, RECORD)}
      warnings={[]}
      stepId={step}
      onStep={setStep}
      visited={visited}
      onVisited={(id) => setVisited((held) => new Set([...held, id]))}
      publishLabel="Publish"
      onPublish={onPublish}
      busy={false}
      actionError={null}
      published={null}
      onOpenEditor={onOpenEditor}
    />
  );
}

function mount(type: HomebrewType, initial: Draft = { ...blankDraft(type), name: "" }) {
  let latest = initial;
  const onPublish = vi.fn();
  const onOpenEditor = vi.fn();
  render(
    <Harness
      type={type}
      initial={initial}
      onDraft={(next) => {
        latest = next;
      }}
      onPublish={onPublish}
      onOpenEditor={onOpenEditor}
    />
  );
  const user = userEvent.setup();
  const foot = () => within(document.querySelector<HTMLElement>(".hb-wiz-foot")!);
  return {
    user,
    onPublish,
    onOpenEditor,
    draft: () => latest,
    body: () => within(document.querySelector<HTMLElement>(".hb-wiz-body")!),
    preview: () => within(document.querySelector<HTMLElement>(".hb-wiz-preview")!),
    heading: () => document.querySelector(".hb-wiz-heading")?.textContent,
    stepNames: () =>
      Array.from(document.querySelectorAll(".hb-wiz-steps .nh-step-label")).map(
        (label) => label.firstChild?.textContent ?? ""
      ),
    next: () => user.click(foot().getByRole("button", { name: /^(Next|Review)$/ })),
    publish: () => foot().queryByRole("button", { name: "Publish" })
  };
}

describe("the spell wizard, answered through its controls", () => {
  it("makes the record the wizard's own answers make, one step at a time", async () => {
    const wizard = mount("spell");
    expect(wizard.stepNames()).toEqual([
      "Name and level",
      "Casting",
      "Effect",
      "At higher levels",
      "Spell lists",
      "Spell text",
      "Review"
    ]);

    await wizard.user.type(wizard.body().getByLabelText("Name"), "Ember Burst");
    const level = wizard.body().getByRole("group", { name: "Level" });
    await wizard.user.click(within(level).getByRole("button", { name: "Increase" }));
    await wizard.user.click(within(level).getByRole("button", { name: "Increase" }));
    await wizard.next();

    expect(wizard.heading()).toBe("Casting");
    await wizard.user.click(wizard.body().getByRole("switch", { name: "Material (M)" }));
    await wizard.user.type(wizard.body().getByLabelText("Material"), "a pinch of ash");
    const feet = wizard.body().getByLabelText("Feet");
    await wizard.user.clear(feet);
    await wizard.user.type(feet, "120");
    await wizard.next();

    expect(wizard.heading()).toBe("Effect");
    await wizard.user.click(wizard.body().getByRole("button", { name: "A saving throw" }));
    await wizard.user.type(wizard.body().getByLabelText("Damage"), "6d6");
    await wizard.user.click(wizard.body().getByRole("button", { name: "An area" }));
    await wizard.user.type(wizard.body().getByLabelText("Area size"), "20");
    await wizard.next();

    expect(wizard.heading()).toBe("At higher levels");
    await wizard.user.type(wizard.body().getByLabelText("Extra dice per slot level"), "1d6");
    await wizard.next();
    await wizard.next();

    expect(wizard.heading()).toBe("Spell text");
    await wizard.user.click(wizard.body().getByRole("button", { name: "Write it from my answers" }));

    const made = forStorage(wizard.draft());
    const answered = forStorage(wizardSpell());
    for (const key of ["level", "range", "components", "save", "target", "shape", "castingOptions", "higherLevel"])
      expect(made[key], key).toEqual(answered[key]);
    expect(made.damage).toEqual({ roll: "6d6", types: [] });
    expect(made.description).toContain("20-foot-radius Sphere");

    // The preview is the spell card the table shows.
    expect(wizard.preview().getByText("Ember Burst")).toBeInTheDocument();
    expect(wizard.preview().getByText(/120 feet/)).toBeInTheDocument();
  });
});

describe("the review step", () => {
  it("lists what is left under the step that asks it, and goes to the question", async () => {
    const wizard = mount("spell", { ...blankDraft("spell"), name: "", description: "" });
    await wizard.user.click(screen.getByRole("button", { name: /^Review/ }));
    expect(wizard.heading()).toBe("Review");
    expect(wizard.body().getByText(/things? (is|are) left before this can be published/)).toBeInTheDocument();
    expect(wizard.publish()).toBeDisabled();

    const nameGroup = wizard.body().getByText("Name and level").closest(".hb-wiz-review-group") as HTMLElement;
    await wizard.user.click(within(nameGroup).getAllByRole("button", { name: "Go to it" })[0]);
    expect(wizard.heading()).toBe("Name and level");
    expect(document.activeElement).toBe(wizard.body().getByLabelText("Name"));
    // A step the GM has been through says what it still needs.
    await wizard.next();
    await wizard.user.click(screen.getByRole("button", { name: /^Name and level/ }));
    expect(wizard.body().getByText("Still needed here")).toBeInTheDocument();
  });

  it("offers Publish once the checklist is empty", async () => {
    const wizard = mount("spell", wizardSpell());
    await wizard.user.click(screen.getByRole("button", { name: /^Review/ }));
    expect(wizard.body().getByText(/Everything the game needs is here/)).toBeInTheDocument();
    await wizard.user.click(wizard.publish()!);
    expect(wizard.onPublish).toHaveBeenCalledTimes(1);
  });
});

describe("the monster wizard", () => {
  it("sets the Proficiency Bonus and XP from the challenge rating and shows the SRD's numbers for it", async () => {
    const wizard = mount("monster", { ...blankDraft("monster"), name: "Ash Hound" });
    await wizard.user.selectOptions(wizard.body().getByLabelText("Challenge rating"), "2");
    expect(wizard.draft().proficiencyBonus).toBe(2);
    expect(wizard.body().getByText(/XP 450/)).toBeInTheDocument();
    expect(await wizard.body().findByText(/The SRD's 3 stat blocks of CR 2/)).toBeInTheDocument();
    expect(wizard.preview().getByText(/450; PB \+2/)).toBeInTheDocument();
  });

  it("builds an attack in the SRD's words and prints it in the stat block", async () => {
    const wizard = mount("monster", { ...blankDraft("monster"), name: "Ash Hound" });
    await wizard.user.click(screen.getByRole("button", { name: /^Actions/ }));
    await wizard.user.click(wizard.body().getByRole("button", { name: "Add an action" }));
    await wizard.user.type(wizard.body().getByLabelText("Name"), "Bite");
    const actions = wizard.draft().actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ name: "Bite", activation: "action", attack: { bonus: 2, reachFeet: 5 } });
    expect(actions[0].description).toBe("Melee Attack Roll: +2, reach 5 ft. 3 (1d6) Slashing damage.");
    expect(wizard.preview().getByText(/Melee Attack Roll: \+2/)).toBeInTheDocument();

    // The GM's own words stay once typed.
    const text = wizard.body().getByLabelText("Stat block text");
    await wizard.user.clear(text);
    await wizard.user.type(text, "It bites.");
    await wizard.user.clear(wizard.body().getByLabelText("Reach"));
    await wizard.user.type(wizard.body().getByLabelText("Reach"), "10");
    expect((wizard.draft().actions as Array<Record<string, unknown>>)[0].description).toBe("It bites.");
  });
});

describe("the item wizard", () => {
  it("asks only the steps its kind has", async () => {
    const wizard = mount("equipment", { ...blankDraft("equipment"), name: "Ember Blade" });
    expect(wizard.stepNames()).toEqual(["Name and kind", "Cost and weight", "Item text", "Review"]);
    await wizard.user.click(wizard.body().getByRole("button", { name: "Weapon" }));
    expect(wizard.stepNames()).toEqual(["Name and kind", "Weapon", "Cost and weight", "Item text", "Review"]);
    await wizard.user.click(wizard.body().getByRole("switch", { name: "Magic item" }));
    expect(wizard.stepNames()).toEqual([
      "Name and kind",
      "Weapon",
      "Rarity and attunement",
      "Powers",
      "Cost and weight",
      "Item text",
      "Review"
    ]);
    await wizard.user.click(wizard.body().getByRole("button", { name: "Shield" }));
    expect(wizard.stepNames()).toContain("Armor");
    expect(wizard.draft()).toMatchObject({ category: "shield", armor: { acBase: 2 } });
    expect(wizard.draft().weapon).toBeUndefined();
  });
});

describe("the class and subclass wizards", () => {
  it("shows what each level of the class gives beside its features", async () => {
    const wizard = mount("class", { ...blankDraft("class"), name: "Warden", subclassLevel: 3, asiLevels: [4, 8] });
    await wizard.user.click(screen.getByRole("button", { name: /^Features/ }));
    const levels = wizard.body().getByText("Features by level").closest(".hb-field") as HTMLElement;
    expect(within(levels).getAllByRole("listitem")).toHaveLength(20);
    expect(within(levels).getByText("Level 3").nextSibling?.textContent).toBe("Subclass");
    expect(within(levels).getByText("Level 4").nextSibling?.textContent).toBe("Ability Score Improvement");
  });

  it("reads the levels a class gives subclass features from the subclasses it has", async () => {
    const wizard = mount("subclass", { ...blankDraft("subclass"), name: "Path of Cinders", classId: "fighter" });
    await wizard.user.click(screen.getByRole("button", { name: /^Features/ }));
    const levels = wizard.body().getByText("Subclass feature levels").closest(".hb-field") as HTMLElement;
    expect(
      within(levels)
        .getAllByRole("listitem")
        .map((item) => item.firstChild?.textContent)
    ).toEqual(["Level 3", "Level 7", "Level 10"]);
  });

  it("offers a background only Origin feats", async () => {
    const wizard = mount("background", { ...blankDraft("background"), name: "Lamplighter" });
    await wizard.user.click(screen.getByRole("button", { name: /^Origin feat/ }));
    const select = wizard.body().getByLabelText("Origin feat");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Not set", "Alert"]);
    await wizard.user.selectOptions(select, "alert");
    expect(wizard.draft().originFeatId).toBe("alert");
  });
});

describe("every wizard", () => {
  it.each(Object.keys(WIZARDS) as HomebrewType[])("%s: walks from the first step to the review", async (type) => {
    const wizard = mount(type, { ...blankDraft(type), name: "Probe" });
    const names = wizard.stepNames();
    for (const name of names.slice(1)) {
      await wizard.next();
      expect(wizard.heading()).toBe(name);
    }
    expect(wizard.publish()).toBeInTheDocument();
  });
});
