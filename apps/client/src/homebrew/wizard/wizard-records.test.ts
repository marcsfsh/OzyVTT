/** The records the wizards make are the editor's records: every question a wizard borrows writes what the editor's
    control writes, the few it composes are named here, and one complete record of each type passes the editor's
    own publish checklist. */

import { describe, expect, it } from "vitest";
import { applyField, contextFor, publishVerdict } from "../authoring-harness";
import { blankDraft, forStorage } from "../defaults";
import { getAt } from "../paths";
import type { Draft, FieldDef } from "../schema";
import { SCHEMAS } from "../schemas";
import type { HomebrewType } from "../types";
import { WIZARDS } from "./index";
import { placeIssues } from "./issues";
import { editorField } from "./questions";
import { isCustomQuestion } from "./types";
import { publishIssues } from "../validate";
import { BORROWED, WIZARD_RECORDS, answers } from "./wizard-records";
import { REVIEW_STEP, wizardSteps } from "./steps";

const TYPES = Object.keys(SCHEMAS) as HomebrewType[];

/** Every editor-shaped question a wizard asks, through its groups. */
function fieldQuestions(type: HomebrewType): FieldDef[] {
  const out: FieldDef[] = [];
  const walk = (fields: readonly FieldDef[]) => {
    for (const field of fields) {
      out.push(field);
      if (field.kind === "group" && field.rows) walk(field.rows);
    }
  };
  for (const step of WIZARDS[type].steps)
    walk((step.questions ?? []).filter((question) => !isCustomQuestion(question)) as FieldDef[]);
  return out;
}

/** The questions whose write is the wizard's own: each keeps something else in step with the answer. */
const COMPOSED: Readonly<Record<HomebrewType, readonly string[]>> = {
  // The level and the damage roll carry the upcast rows along; the attack-or-save answer is one control.
  spell: ["level", "attackRoll", "save.repeatSave", "save.endsOnDamage", "damage.roll"],
  // The name renames the generated texts, size moves the token and the Hit Points, and the type and alignment
  // move the bestiary line. The rest are stat-block bag keys the editor has no field for, and the tags, which the
  // editor keeps inside its rider list.
  monster: ["name", "size", "type", "alignment", "armorDetail", "languages", "tags"],
  equipment: [],
  class: [],
  subclass: [],
  species: [],
  background: [],
  feat: [],
  "spell-list": []
};

describe("the wizards cover every homebrew type", () => {
  it("has one wizard per type, each of its own type", () => {
    expect(Object.keys(WIZARDS).sort()).toEqual([...TYPES].sort());
    for (const type of TYPES) expect(WIZARDS[type].type).toBe(type);
  });

  it.each(TYPES)("%s: every step stands in for sections its editor has", (type) => {
    const sections = new Set(SCHEMAS[type].sections.map((section) => section.id));
    for (const step of WIZARDS[type].steps) {
      for (const section of step.sections) expect(sections.has(section), `${step.id} names "${section}"`).toBe(true);
      expect(step.title.trim(), `${step.id} has a title`).not.toBe("");
      // Steps are labels: no question marks, as DESIGN.md asks.
      expect(step.title).not.toMatch(/\?/);
    }
    expect(wizardSteps(WIZARDS[type], blankDraft(type)).at(-1)?.id).toBe(REVIEW_STEP);
  });
});

describe("a wizard question writes what the editor writes", () => {
  it.each(TYPES)("%s: only the composed questions have a write of their own", (type) => {
    const own: string[] = [];
    for (const question of fieldQuestions(type)) {
      let editor: FieldDef | null;
      try {
        editor = editorField(type, question.key);
      } catch {
        editor = null;
      }
      if (!editor || editor.write !== question.write || editor.read !== question.read) own.push(question.key);
    }
    expect([...new Set(own)].sort()).toEqual([...COMPOSED[type]].sort());
  });

  it.each(TYPES)("%s: the borrowed answers land on the record the editor's controls make", (type) => {
    // One blank for both, so the ids a blank mints match.
    const blank: Draft = { ...blankDraft(type), name: "Probe" };
    const wizard = answers(type, blank, BORROWED[type]);
    const editor = BORROWED[type].reduce<Draft>((draft, [key, value]) => applyField(type, draft, key, value), blank);
    expect(forStorage(wizard)).toEqual(forStorage(editor));
  });
});

describe("one complete record of each type", () => {
  it.each(TYPES)("%s: passes the editor's own publish checklist", (type) => {
    const verdict = publishVerdict(type, WIZARD_RECORDS[type](), "hb-wizard-probe");
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);
  });

  it.each(TYPES)("%s: a blank record's every requirement lands on a step that asks it", (type) => {
    const draft = blankDraft(type);
    const steps = wizardSteps(WIZARDS[type], draft);
    const reasons = publishIssues(type, draft, contextFor("hb-wizard-probe"), "hb-wizard-probe");
    const placed = placeIssues(steps, reasons, draft);
    for (const issue of placed) expect(issue.stepId, `"${issue.text}" (${issue.path ?? "no path"})`).not.toBeNull();
  });

  it("re-reads in the editor as the answers given", () => {
    const record = WIZARD_RECORDS.class();
    for (const [key, value] of BORROWED.class) {
      const field = editorField("class", key);
      expect(field.read ? field.read(record) : getAt(record, key), key).toEqual(value);
    }
    // The editor's own write of the same minimums is the same block.
    expect(
      applyField("class", blankDraft("class"), "multiclassPrerequisites.minimums", [{ ability: "wis", minimum: 13 }])
    ).toMatchObject({ multiclassPrerequisites: { minimums: [{ ability: "wis", minimum: 13 }] } });
  });
});
