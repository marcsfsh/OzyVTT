/** The step-by-step wizards' vocabulary: a wizard is data (its steps and its preview), and `WizardView` draws any
    of them. A step asks questions as `FieldDef`s, borrowed from the editor's own form where one exists so the
    record a step writes is the record the editor would write, or renders a bespoke composer. */

import type { ReactNode } from "react";
import type { Draft, FieldDef, SchemaContext } from "../schema";
import type { SpellMembership } from "../SpellListContents";
import type { HomebrewType } from "../types";

export type StepProps = Readonly<{
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  recordId: string;
  /** Every spell with the lists it is on, for a spell list's contents. */
  spells: readonly SpellMembership[];
  idPrefix: string;
}>;

/** A question no `FieldDef` can ask (a range with its unit, healing kept in the text), drawn in its place among the
    others. `key` is the record path it answers, for pointing an issue at it. */
export type CustomQuestion = Readonly<{ key: string; render: (props: StepProps) => ReactNode }>;

export type Question = FieldDef | CustomQuestion;

export const isCustomQuestion = (question: Question): question is CustomQuestion => "render" in question;

export type WizardStep = Readonly<{
  id: string;
  /** The step list's name for it: short, sentence case. */
  title: string;
  /** One or two sentences above the questions, in the SRD's own words where it has them. */
  intro?: string;
  questions?: readonly Question[];
  /** The record paths this step answers (dotted, array indexes left out, as a validity issue's path is read), so an
      issue lands on the step that can fix it. */
  owns: readonly string[];
  /** The editor sections this step stands in for: the fallback for an issue with no path, and where "Full editor"
      opens. */
  sections: readonly string[];
  /** A step the record's answers make irrelevant is left out of the flow (an item's weapon step for armor). */
  visibleWhen?: (draft: Draft) => boolean;
  /** Claims an issue by its whole path before `owns` is read: one row of a list that several steps share, such as a
      monster's actions, which belong to the step for their timing. */
  claims?: (segments: ReadonlyArray<string | number>, draft: Draft) => boolean;
}>;

export type PreviewProps = Readonly<{ draft: Draft; ctx: SchemaContext; recordId: string }>;

export type WizardDef = Readonly<{
  type: HomebrewType;
  steps: readonly WizardStep[];
  /** The record as the app shows it: the stat block, the spell card, the item card, the feature list. */
  Preview: (props: PreviewProps) => ReactNode;
}>;
