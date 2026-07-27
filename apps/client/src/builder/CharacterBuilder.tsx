import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BuilderAbilityMethod, ContentFeatureSummary, GmView, PlayerView } from "@vtt/domain";
import {
  ABILITIES, ABILITY_ROLL_FORMULA, abilityModifier, hitDieAverage, hitDieFaces,
  POINT_BUY_BUDGET, POINT_BUY_MAXIMUM, POINT_BUY_MINIMUM, STANDARD_ARRAY, type Ability, type HitDie
} from "@vtt/rules-5e";
import {
  AbilityScoreAllocator, Alert, Badge, Button, ChoiceGrid, DiceInputRow, FeatureList, NameField,
  ReviewSummary, SegmentedControl, Select, Stepper, WizardShell, type ChoiceOption, type DiceEntryMode,
  type FeatureItem, type ReviewSection
} from "@vtt/ui";
import { useBuilderCatalogs } from "../content/catalogs";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import {
  ABILITY_LABELS, ASI_SHORTHAND, baseScoresOf, abilityBonusesOf, buildCreatePayload, computeOffers,
  emptyDraft, isAssignMethod, offerContext, pointBuySpent, prunePicks,
  STEP_IDS, STEP_LABELS, STEP_SHORT, stepBlockedReason,
  type BuilderDraft, type BuilderOffer, type StepId
} from "./build-payload";
import { clearDraft, describeWhen, draftHasProgress, loadDraft, saveDraft, type StoredDraft } from "./draft";
import "./character-builder.css";

/**
 * The guided character-creation wizard - the first path by which a character can be made in the UI.
 *
 * It is a FULL PAGE (builder decision 4): `WizardShell` owns the viewport on a laptop and becomes a
 * full-screen sheet on a phone. Deliberately not a modal - a seven-step flow inside a floating card
 * is a card you scroll inside a page you also scroll.
 *
 * What it does and does not decide: the wizard renders the picks the CONTENT asks for (resolving
 * every `fromCatalog` slug through `resolveCatalogChoice`, the same function the server validates
 * with), collects them, and submits ONE `character.create`. It computes no game outcome - hit
 * points, AC, slots, and every rider are assembled server-side from the choices, and a rejection
 * comes back as the server's own message, shown inline on the review step.
 */

type BuilderState = GmView | PlayerView;

export type CharacterBuilderProps = Readonly<{
  state: BuilderState;
  /** Scopes the saved draft. Phase 3 swaps localStorage for `GameState.characterDrafts[]`. */
  sessionKey: string;
  onClose: () => void;
  onCreated: (name: string) => void;
}>;

const METHOD_LABELS: Readonly<Record<BuilderAbilityMethod, string>> = {
  "standard-array": "Standard array", "point-buy": "Point buy", roll: "Roll 4d6", custom: "GM formula"
};

const titleize = (id: string) => id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const sourceBadge = (source: string) => source === "homebrew" ? <Badge tone="primary">Homebrew</Badge> : <Badge tone="info">SRD</Badge>;
const featureItems = (features: readonly ContentFeatureSummary[], limit = 40): FeatureItem[] =>
  features.slice(0, limit).map((feature) => ({
    id: feature.id,
    title: feature.name,
    meta: feature.level != null ? `Level ${feature.level}` : undefined,
    body: <p>{feature.description}</p>
  }));

/** One pick offered by the content: heading, count, and the grid that answers it. */
function OfferPicker({ offer, draft, onSet }: Readonly<{
  offer: BuilderOffer; draft: BuilderDraft; onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  if (offer.unresolvable) {
    return <section className="cb-offer">
      <h3 className="cb-offer-title">{offer.label}</h3>
      <Alert tone="warning" title="Not available yet">
        This choice has no options to show: {offer.unresolvable} You can finish the character without it.
      </Alert>
    </section>;
  }
  const options: ChoiceOption[] = offer.options.map((option) => ({
    value: option.id,
    title: offer.kind === "equipment" ? `Option ${option.id.split("-").pop()?.toUpperCase() ?? ""}` : option.name,
    description: offer.kind === "equipment" ? option.name : undefined,
    meta: option.level != null && option.level > 0 ? `Level ${option.level}` : option.level === 0 ? "Cantrip" : undefined,
    keywords: option.id
  }));
  const many = offer.capacity > 1;
  return <section className="cb-offer">
    <div className="cb-offer-head">
      <h3 className="cb-offer-title">{offer.label}</h3>
      <span className="cb-offer-count tabular" role="status">
        {many ? `${picks.length} of ${offer.capacity} chosen` : picks.length === 1 ? "Chosen" : "Choose one"}
      </span>
    </div>
    {offer.help && <p className="cb-offer-help">{offer.help}</p>}
    <ChoiceGrid
      ariaLabel={offer.label}
      options={options}
      searchable={offer.options.length > 8}
      searchPlaceholder="Search options…"
      selection={many ? "multiple" : "single"}
      value={many ? null : picks[0] ?? null}
      onChange={(value) => onSet(offer, [value])}
      values={many ? picks : undefined}
      max={many ? offer.capacity : undefined}
      onToggle={(value, next) => onSet(offer, next ? [...picks, value] : picks.filter((id) => id !== value))}
    />
  </section>;
}

/**
 * An Ability Score Improvement level: raise two points, or take a feat. Both routes write ONE
 * `asi-or-feat` ledger row. The catalog's own "Ability Score Improvement" feat is filtered out of
 * the feat list on purpose - it is the same idea as the ability route, and the system shows one
 * idea one way. (The server accepts either; the wizard offers the simpler one.)
 */
function AsiOffer({ offer, draft, onSet, onIncreases }: Readonly<{
  offer: BuilderOffer; draft: BuilderDraft;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
  onIncreases: (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  const route = picks[0] === ASI_SHORTHAND ? "asi" : picks.length > 0 ? "feat" : null;
  const increases = draft.asiIncreases[offer.key] ?? [];
  const split = increases.length === 2 ? "two" : "one";
  const featOptions: ChoiceOption[] = offer.options
    .filter((option) => option.id !== "ability-score-improvement")
    .map((option) => ({ value: option.id, title: option.name, keywords: option.id }));

  const setSplit = (next: string) => {
    onIncreases(offer, next === "one"
      ? [{ ability: increases[0]?.ability ?? "str", amount: 2 }]
      : [{ ability: increases[0]?.ability ?? "str", amount: 1 }, { ability: increases[1]?.ability ?? "dex", amount: 1 }]);
  };
  const setAbility = (index: number, ability: Ability) => {
    const next = increases.map((entry, position) => position === index ? { ...entry, ability } : entry);
    onIncreases(offer, next);
  };

  return <section className="cb-offer">
    <div className="cb-offer-head">
      <h3 className="cb-offer-title">{offer.label} <span className="cb-offer-level tabular">Level {offer.level}</span></h3>
    </div>
    <SegmentedControl
      ariaLabel={`Level ${offer.level} improvement`}
      value={route ?? ""}
      onChange={(next) => {
        if (next === "asi") { onSet(offer, [ASI_SHORTHAND]); onIncreases(offer, [{ ability: "str", amount: 2 }]); }
        else onSet(offer, []);
      }}
      options={[{ value: "asi", label: "Raise ability scores" }, { value: "feat", label: "Take a feat" }]}
    />
    {route === "asi" && <div className="cb-asi">
      <SegmentedControl
        size="sm"
        ariaLabel="How to split the increase"
        value={split}
        onChange={setSplit}
        options={[{ value: "one", label: "+2 to one" }, { value: "two", label: "+1 to two" }]}
      />
      <div className="cb-asi-rows">
        {increases.map((entry, index) => <label key={index} className="cb-asi-row">
          <span className="cb-asi-label">+{entry.amount} to</span>
          <Select value={entry.ability} aria-label={`Ability to raise by ${entry.amount}`} onChange={(event) => setAbility(index, event.target.value as Ability)}>
            {ABILITIES.map((ability) => <option key={ability} value={ability}>{ABILITY_LABELS[ability]}</option>)}
          </Select>
        </label>)}
      </div>
    </div>}
    {route !== "asi" && <ChoiceGrid
      ariaLabel={`Level ${offer.level} feat`}
      options={featOptions}
      searchable={featOptions.length > 8}
      searchPlaceholder="Search feats…"
      value={route === "feat" ? picks[0] ?? null : null}
      onChange={(value) => onSet(offer, [value])}
    />}
  </section>;
}

export function CharacterBuilder({ state, sessionKey, onClose, onCreated }: CharacterBuilderProps) {
  const catalogs = useBuilderCatalogs();
  const policy = state.builderPolicy;
  const [draft, setDraft] = useState<BuilderDraft>(() => emptyDraft());
  const [stepIndex, setStepIndex] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [resumable, setResumable] = useState<StoredDraft | null>(() => {
    const stored = loadDraft(sessionKey);
    return stored && draftHasProgress(stored.draft) ? stored : null;
  });
  const [abilityEntry, setAbilityEntry] = useState<DiceEntryMode>("auto");
  const [hpEntry, setHpEntry] = useState<DiceEntryMode>("auto");
  const [rolling, setRolling] = useState(false);
  const [nameSeed, setNameSeed] = useState(0);

  const step: StepId = STEP_IDS[stepIndex];
  const offers = useMemo(() => computeOffers(draft, catalogs), [draft, catalogs]);
  const context = useMemo(() => offerContext(draft, catalogs), [draft, catalogs]);

  // Keep the draft honest as the build changes shape: a Fighter's skills are not a Wizard's.
  useEffect(() => {
    setDraft((current) => {
      const pruned = prunePicks(current, computeOffers(current, catalogs));
      return pruned === current ? current : pruned;
    });
  }, [draft.classId, draft.speciesId, draft.backgroundId, draft.level, draft.subclassId, catalogs]);

  // Park the draft on every change so a reload (or Save & close) never costs the player their work.
  useEffect(() => { if (draftHasProgress(draft)) saveDraft(sessionKey, draft); }, [draft, sessionKey]);

  // Server-thrown rolls come back through the roll HISTORY (dice.roll acks with an id, not a total),
  // which is exactly what makes them auditable: the number the wizard uses is the number the table
  // can see was rolled.
  const pendingRolls = useRef(new Map<string, (total: number) => void>());
  useEffect(() => {
    if (pendingRolls.current.size === 0) return;
    for (const record of state.rolls) {
      const apply = pendingRolls.current.get(record.id);
      if (apply) { pendingRolls.current.delete(record.id); apply(record.total); }
    }
    if (pendingRolls.current.size === 0) setRolling(false);
  }, [state.rolls]);

  const rollOnServer = (formula: string, label: string, apply: (total: number) => void) => {
    setRolling(true);
    // GM-only: a character being rolled up is the GM's business in phase 2, and it still lands in
    // the roll history, so the roll stays server-thrown and auditable rather than client-invented.
    socket.emit("dice:roll", { commandId: newId(), formula, purpose: "manual", visibility: "gm-only", label }, (result) => {
      if (!result.ok || !result.rollId) { setRolling(false); setRejection(result.message ?? "That roll was rejected."); return; }
      pendingRolls.current.set(result.rollId, apply);
    });
  };

  const patch = (change: Partial<BuilderDraft>) => setDraft((current) => ({ ...current, ...change }));
  const setPicks = (offer: BuilderOffer, ids: readonly string[]) =>
    setDraft((current) => ({ ...current, picks: { ...current.picks, [offer.key]: ids.slice(0, offer.capacity) } }));
  const setIncreases = (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) =>
    setDraft((current) => ({ ...current, asiIncreases: { ...current.asiIncreases, [offer.key]: increases } }));

  const blockedReason = catalogs.loaded ? stepBlockedReason(step, draft, catalogs, offers, policy) : "Loading the content catalogs…";
  const stepsForShell = STEP_IDS.map((id) => ({ label: STEP_LABELS[id], shortLabel: STEP_SHORT[id] }));

  const submit = () => {
    setRejection(null);
    setSubmitting(true);
    let payload;
    try { payload = buildCreatePayload(draft, offers); }
    catch (error) { setSubmitting(false); setRejection(error instanceof Error ? error.message : "The character is not complete yet."); return; }
    socket.emit("character:create", { commandId: newId(), ...payload }, (result) => {
      setSubmitting(false);
      if (!result.ok) { setRejection(result.message ?? "The character could not be created."); return; }
      clearDraft(sessionKey);
      onCreated(payload.name);
      onClose();
    });
  };

  const saveAndClose = () => { if (draftHasProgress(draft)) saveDraft(sessionKey, draft); onClose(); };

  // ---- Ability scores ------------------------------------------------------------------------
  const base = baseScoresOf(draft);
  const bonuses = abilityBonusesOf(draft, catalogs, offers);
  const allowedMethods = policy.allowedAbilityMethods.filter((method) => method !== "custom" || policy.customFormula);
  const method = allowedMethods.includes(draft.abilityMethod) ? draft.abilityMethod : allowedMethods[0] ?? "standard-array";
  const rollFormula = method === "custom" ? policy.customFormula ?? ABILITY_ROLL_FORMULA : ABILITY_ROLL_FORMULA;
  const assignMode = isAssignMethod(method);

  const setMethod = (next: string) => {
    const chosen = next as BuilderAbilityMethod;
    patch({
      abilityMethod: chosen,
      poolAssignment: {},
      abilityPool: chosen === "standard-array" ? STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })) : [],
      spendScores: Object.fromEntries(ABILITIES.map((ability) => [ability, POINT_BUY_MINIMUM]))
    });
  };
  const addRolledScore = (total: number) => setDraft((current) => current.abilityPool.length >= 6
    ? current
    : { ...current, abilityPool: [...current.abilityPool, { id: `r-${current.abilityPool.length}-${total}`, value: total }] });
  const rollAllScores = () => {
    const missing = 6 - draft.abilityPool.length;
    for (let index = 0; index < missing; index += 1) rollOnServer(rollFormula, `Ability score ${draft.abilityPool.length + index + 1}`, addRolledScore);
  };
  const addHpRoll = (total: number) => setDraft((current) => current.hpEntries.length >= current.level - 1
    ? current
    : { ...current, hpEntries: [...current.hpEntries, total] });
  const hitDie = (context.hitDie ?? "d8") as HitDie;
  const rollAllHp = () => {
    const missing = (draft.level - 1) - draft.hpEntries.length;
    for (let index = 0; index < missing; index += 1) rollOnServer(`1d${hitDieFaces(hitDie)}`, `Hit points, level ${draft.hpEntries.length + index + 2}`, addHpRoll);
  };

  const allocatorRows = ABILITIES.map((ability) => {
    const score = base[ability];
    const bonus = bonuses[ability];
    const total = score == null ? null : score + bonus;
    return {
      id: ability, label: ABILITY_LABELS[ability], abbr: ability.toUpperCase(),
      score, bonus, total, modifier: total == null ? null : abilityModifier(total),
      min: POINT_BUY_MINIMUM, max: POINT_BUY_MAXIMUM
    };
  });

  // ---- Name suggestions ----------------------------------------------------------------------
  const suggestions = useMemo(() => {
    const bundle = catalogs.names.find((entry) => entry.speciesId === draft.speciesId);
    if (!bundle) return [];
    const surnames = bundle.pools.filter((pool) => /-(family|clan)$/.test(pool.id)).flatMap((pool) => pool.names);
    const givens = bundle.pools.filter((pool) => !/-(family|clan)$/.test(pool.id)).flatMap((pool) => pool.names);
    if (givens.length === 0) return [];
    const draw = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
    // Distinct: a small pool can draw the same name twice, and the list keys on the name itself -
    // a repeat is both a duplicate-key warning and a suggestion that suggests nothing.
    const batch = new Set<string>();
    for (let attempt = 0; attempt < 40 && batch.size < 5; attempt += 1) {
      batch.add(surnames.length > 0 ? `${draw(givens)} ${draw(surnames)}` : String(draw(givens)));
    }
    return [...batch];
    // nameSeed re-draws the batch when the shuffle button is pressed.
  }, [catalogs.names, draft.speciesId, nameSeed]);

  // ---- Step bodies ---------------------------------------------------------------------------
  const stepOffers = (owner: BuilderOffer["step"]) => offers.filter((offer) => offer.step === owner);
  const renderOffer = (offer: BuilderOffer) => offer.kind === "asi-or-feat"
    ? <AsiOffer key={offer.key} offer={offer} draft={draft} onSet={setPicks} onIncreases={setIncreases} />
    : <OfferPicker key={offer.key} offer={offer} draft={draft} onSet={setPicks} />;

  const speciesOptions: ChoiceOption[] = catalogs.choice.species.map((entry) => ({
    value: entry.id, title: entry.name, description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source), meta: `${entry.speedFeet} ft.${entry.darkvisionFeet ? ` · darkvision ${entry.darkvisionFeet} ft.` : ""}`,
    facet: entry.source, keywords: `${entry.creatureType} ${entry.languages.join(" ")}`
  }));
  const backgroundOptions: ChoiceOption[] = catalogs.backgrounds.map((entry) => ({
    value: entry.id, title: entry.name, description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: entry.abilityOptions ? entry.abilityOptions.from.map((ability) => ability.toUpperCase()).join(" / ") : undefined,
    facet: entry.source, keywords: entry.skillProficiencies.join(" ")
  }));
  const classOptions: ChoiceOption[] = catalogs.choice.classes.map((entry) => ({
    value: entry.id, title: entry.name, description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: `${entry.hitDie} · ${entry.savingThrows.map((ability) => ability.toUpperCase()).join("/")}${entry.spellcasting ? ` · ${entry.spellcasting.ability.toUpperCase()} caster` : ""}`,
    facet: entry.source, keywords: entry.primaryAbilities.join(" ")
  }));

  const body = (): ReactNode => {
    switch (step) {
      case "species":
        return <>
          <ChoiceGrid ariaLabel="Species" options={speciesOptions} value={draft.speciesId} onChange={(value) => patch({ speciesId: value })} searchPlaceholder="Search species…" />
          {stepOffers("species").map(renderOffer)}
        </>;
      case "background":
        return <>
          <ChoiceGrid ariaLabel="Backgrounds" options={backgroundOptions} value={draft.backgroundId} onChange={(value) => patch({ backgroundId: value })} searchPlaceholder="Search backgrounds…" />
          {context.originFeat && <p className="cb-note">{context.background?.name} grants the <strong>{context.originFeat.name}</strong> feat.</p>}
          {stepOffers("background").map(renderOffer)}
        </>;
      case "class":
        return <>
          <ChoiceGrid ariaLabel="Classes" options={classOptions} value={draft.classId} onChange={(value) => patch({ classId: value })} searchPlaceholder="Search classes…" />
          <section className="cb-offer">
            <div className="cb-offer-head">
              <h3 className="cb-offer-title">Level</h3>
              <span className="cb-offer-count tabular" role="status">Level {draft.level}</span>
            </div>
            <p className="cb-offer-help">Your GM grants the level; every choice it opens is yours to make.</p>
            <Stepper value={draft.level} min={1} max={20} aria-label="Character level" onChange={(level) => patch({ level, hpEntries: draft.hpEntries.slice(0, Math.max(0, level - 1)) })} />
          </section>
          {stepOffers("class").map(renderOffer)}
        </>;
      case "features":
        return stepOffers("features").length === 0
          ? <div className="nh-empty"><span className="nh-empty-title">Nothing to choose yet</span><span className="nh-empty-text">This class asks for no decisions at level {draft.level}. Carry on.</span></div>
          : <>{stepOffers("features").map(renderOffer)}</>;
      case "abilities": {
        const spent = pointBuySpent(draft);
        const options = context.background?.abilityOptions ?? null;
        const spread = draft.backgroundBonus.map((entry) => entry.amount).join("/");
        return <>
          <AbilityScoreAllocator
            mode={assignMode ? "assign" : "spend"}
            rows={allocatorRows}
            methods={allowedMethods.map((entry) => ({ value: entry, label: METHOD_LABELS[entry] }))}
            method={method}
            onMethodChange={setMethod}
            methodHint={method === "custom" ? `Your GM's formula: ${policy.customFormula}` : method === "roll" ? `Rolled with ${ABILITY_ROLL_FORMULA}.` : method === "point-buy" ? `Spend ${POINT_BUY_BUDGET} points across scores 8-15.` : `Assign ${STANDARD_ARRAY.join(", ")}, one each.`}
            pool={assignMode ? draft.abilityPool.map((entry) => ({ id: entry.id, value: entry.value, assignedTo: ABILITIES.find((ability) => draft.poolAssignment[ability] === entry.id) ?? null })) : undefined}
            onAssign={assignMode ? (abilityId, poolId) => setDraft((current) => {
              const cleared = Object.fromEntries(Object.entries(current.poolAssignment).map(([key, value]) => [key, value === poolId ? null : value]));
              return { ...current, poolAssignment: { ...cleared, [abilityId]: poolId } };
            }) : undefined}
            onScoreChange={assignMode ? undefined : (abilityId, score) => patch({ spendScores: { ...draft.spendScores, [abilityId]: score } })}
            budget={assignMode ? undefined : { spent, total: POINT_BUY_BUDGET }}
            toolbar={assignMode && method !== "standard-array"
              ? <DiceInputRow
                  label={`Ability scores (${draft.abilityPool.length} of 6)`}
                  notation={rollFormula}
                  mode={abilityEntry}
                  onModeChange={setAbilityEntry}
                  rollLabel="Roll the rest for me"
                  onRoll={rollAllScores}
                  onManual={addRolledScore}
                  onReroll={draft.abilityPool.length > 0 ? () => patch({ abilityPool: [], poolAssignment: {} }) : undefined}
                  result={draft.abilityPool.length > 0 ? draft.abilityPool.map((entry) => entry.value).join(", ") : undefined}
                  min={1}
                  max={30}
                  busy={rolling}
                  complete={draft.abilityPool.length >= 6}
                  hint="Roll them here, or type what your own dice showed."
                />
              : undefined}
          />

          {options && <section className="cb-offer">
            <div className="cb-offer-head">
              <h3 className="cb-offer-title">{context.background?.name} ability increases</h3>
              <span className="cb-offer-count tabular" role="status">{spread ? `+${spread.split("/").join(" / +")}` : "Not spent"}</span>
            </div>
            <SegmentedControl
              ariaLabel="Ability increase spread"
              value={draft.backgroundBonus.length === 3 ? "1/1/1" : draft.backgroundBonus.length === 2 ? "2/1" : ""}
              onChange={(next) => patch({
                backgroundBonus: next === "2/1"
                  ? [{ ability: (options.from[0] as Ability), amount: 2 }, { ability: (options.from[1] as Ability), amount: 1 }]
                  : options.from.slice(0, 3).map((ability) => ({ ability: ability as Ability, amount: 1 }))
              })}
              options={options.spreads.map((legal) => ({ value: legal.join("/"), label: `+${legal.join(" / +")}` }))}
            />
            <div className="cb-asi-rows">
              {draft.backgroundBonus.map((entry, index) => <label key={index} className="cb-asi-row">
                <span className="cb-asi-label">+{entry.amount} to</span>
                <Select
                  value={entry.ability}
                  aria-label={`Ability to raise by ${entry.amount}`}
                  onChange={(event) => patch({ backgroundBonus: draft.backgroundBonus.map((row, position) => position === index ? { ...row, ability: event.target.value as Ability } : row) })}
                >
                  {options.from.map((ability) => <option key={ability} value={ability}>{ABILITY_LABELS[ability as Ability]}</option>)}
                </Select>
              </label>)}
            </div>
          </section>}

          <section className="cb-offer">
            <div className="cb-offer-head">
              <h3 className="cb-offer-title">Hit points</h3>
              <span className="cb-offer-count tabular" role="status">{hitDie} · CON {base.con == null ? "—" : abilityModifier(base.con + bonuses.con) >= 0 ? `+${abilityModifier(base.con + bonuses.con)}` : abilityModifier(base.con + bonuses.con)}</span>
            </div>
            <p className="cb-offer-help">Level 1 is always the full die. From level 2 up, take the average or roll — rolling can only help, so the server keeps the better of your roll and the average.</p>
            <SegmentedControl
              ariaLabel="How to gain hit points"
              value={draft.hpMode}
              onChange={(next) => patch({ hpMode: next as "average" | "entries", hpEntries: [] })}
              options={[{ value: "average", label: `Take the average (${hitDieAverage(hitDie)}/level)` }, { value: "entries", label: "Roll each level" }]}
            />
            {draft.hpMode === "entries" && (draft.level === 1
              ? <p className="cb-note">A level 1 character rolls nothing — your hit points are the full {hitDie}.</p>
              : <DiceInputRow
                  label={`Levels 2-${draft.level} (${draft.hpEntries.length} of ${draft.level - 1})`}
                  notation={`1${hitDie}`}
                  mode={hpEntry}
                  onModeChange={setHpEntry}
                  rollLabel="Roll the rest for me"
                  onRoll={rollAllHp}
                  onManual={addHpRoll}
                  onReroll={draft.hpEntries.length > 0 ? () => patch({ hpEntries: [] }) : undefined}
                  result={draft.hpEntries.length > 0 ? draft.hpEntries.join(", ") : undefined}
                  min={1}
                  max={hitDieFaces(hitDie)}
                  busy={rolling}
                  complete={draft.hpEntries.length >= draft.level - 1}
                />)}
          </section>
        </>;
      }
      case "equipment":
        return stepOffers("equipment").length === 0
          ? <div className="nh-empty"><span className="nh-empty-title">No starting equipment</span><span className="nh-empty-text">Neither this class nor this background prints a starting kit.</span></div>
          : <>{stepOffers("equipment").map(renderOffer)}</>;
      case "review":
        return <>
          <NameField
            value={draft.name}
            onChange={(name) => patch({ name })}
            label="Character name"
            required
            maxLength={120}
            suggestions={suggestions}
            onShuffle={suggestions.length > 0 ? () => setNameSeed((seed) => seed + 1) : undefined}
            help={context.species ? `Suggestions come from the ${context.species.name} name bundle.` : undefined}
          />
          {rejection && <Alert tone="danger" title="The server rejected this character">{rejection}</Alert>}
          <ReviewSummary sections={reviewSections()} />
        </>;
      default:
        return null;
    }
  };

  function pickedNames(offer: BuilderOffer): string {
    const picks = draft.picks[offer.key] ?? [];
    if (picks.length === 0) return "—";
    return picks.map((id) => id === ASI_SHORTHAND
      ? (draft.asiIncreases[offer.key] ?? []).map((entry) => `+${entry.amount} ${entry.ability.toUpperCase()}`).join(", ")
      : offer.options.find((option) => option.id === id)?.name ?? titleize(id)).join(", ");
  }

  function sectionFor(id: StepId, owner: BuilderOffer["step"] | null, items: ReviewSection["items"]): ReviewSection {
    const extra = owner ? stepOffers(owner).map((offer) => ({ label: offer.label, value: pickedNames(offer) })) : [];
    const reason = catalogs.loaded ? stepBlockedReason(id, draft, catalogs, offers, policy) : null;
    return {
      id, title: STEP_LABELS[id], items: [...items, ...extra],
      onEdit: () => { setStepIndex(STEP_IDS.indexOf(id)); setRejection(null); },
      ...(reason ? { incomplete: reason } : {})
    };
  }

  function reviewSections(): ReviewSection[] {
    const scoreItems = ABILITIES.map((ability) => ({
      label: ABILITY_LABELS[ability],
      value: base[ability] == null ? "—" : `${base[ability]! + bonuses[ability]}${bonuses[ability] ? ` (${base[ability]} +${bonuses[ability]})` : ""}`,
      numeric: true
    }));
    return [
      sectionFor("species", "species", [{ label: "Species", value: context.species?.name ?? "—" }]),
      sectionFor("background", "background", [
        { label: "Background", value: context.background?.name ?? "—" },
        ...(context.originFeat ? [{ label: "Origin feat", value: context.originFeat.name }] : [])
      ]),
      sectionFor("class", "class", [
        { label: "Class", value: context.classRecord?.name ?? "—" },
        { label: "Level", value: String(draft.level), numeric: true },
        { label: "Hit die", value: context.hitDie ?? "—", numeric: true }
      ]),
      sectionFor("features", "features", context.subclass ? [{ label: context.classRecord?.subclassLabel ?? "Subclass", value: context.subclass.name }] : []),
      sectionFor("abilities", null, [
        ...scoreItems,
        { label: "Method", value: METHOD_LABELS[method] },
        { label: "Hit points", value: draft.hpMode === "average" ? "Average each level" : draft.hpEntries.length > 0 ? `Rolled ${draft.hpEntries.join(", ")}` : "Rolled (none entered)" }
      ]),
      sectionFor("equipment", "equipment", [])
    ];
  }

  const detail = (): ReactNode => {
    if (step === "species" && context.species) {
      return <>
        <p>{context.species.description ?? context.species.summary}</p>
        <FeatureList items={featureItems(context.species.features)} allowExpandAll={context.species.features.length > 6} ariaLabel={`${context.species.name} traits`} />
      </>;
    }
    if (step === "background" && context.background) {
      return <>
        <p>{context.background.description ?? context.background.summary}</p>
        <p className="tabular">Skills: {context.background.skillProficiencies.map(titleize).join(", ") || "—"}</p>
      </>;
    }
    if (step === "class" && context.classRecord) {
      return <>
        <p>{context.classRecord.description ?? context.classRecord.summary}</p>
        <p className="tabular">Hit die {context.classRecord.hitDie} · saves {context.classRecord.savingThrows.map((ability) => ability.toUpperCase()).join(", ")}</p>
        <p className="tabular">Armor: {context.classRecord.armorProficiencies.join(", ") || "none"} · weapons: {context.classRecord.weaponProficiencies.join(", ") || "none"}</p>
        <FeatureList items={featureItems(context.classRecord.features.filter((feature) => (feature.level ?? 1) <= draft.level))} allowExpandAll ariaLabel={`${context.classRecord.name} features`} />
      </>;
    }
    if (step === "features" && context.subclass) {
      return <>
        <p>{context.subclass.description ?? context.subclass.summary}</p>
        <FeatureList items={featureItems(context.subclass.features)} ariaLabel={`${context.subclass.name} features`} />
      </>;
    }
    return null;
  };

  const detailNode = detail();
  const isLast = stepIndex === STEP_IDS.length - 1;

  return <div className="cb-page">
    <WizardShell
      title="Create a character"
      eyebrow="Character builder"
      steps={stepsForShell}
      current={stepIndex}
      onStepSelect={(index) => { if (index < stepIndex) { setStepIndex(index); setDetailOpen(false); } }}
      onBack={stepIndex > 0 ? () => { setStepIndex(stepIndex - 1); setDetailOpen(false); } : undefined}
      onNext={() => { if (isLast) submit(); else { setStepIndex(stepIndex + 1); setDetailOpen(false); } }}
      nextLabel={isLast ? "Create character" : "Next"}
      blockedReason={blockedReason ?? undefined}
      busy={submitting}
      /* The ONE way out. The draft is parked on every change, so a second "leave without saving"
         exit would both lie (it is already saved) and, at 375px, overhang the last card in the step
         with its 44px tap area. Discarding lives where it belongs: "Start fresh" on the resume
         banner, next to the draft it throws away. */
      onSaveAndClose={saveAndClose}
      resume={resumable
        ? <Alert tone="info" title="Unfinished character found">
            You started a character on this device {describeWhen(resumable.updatedAt)}.{" "}
            <Button variant="ghost" size="sm" onClick={() => { setDraft(resumable.draft); setResumable(null); }}>Resume it</Button>
            <Button variant="ghost" size="sm" onClick={() => { clearDraft(sessionKey); setResumable(null); }}>Start fresh</Button>
          </Alert>
        : undefined}
      detail={detailNode}
      detailTitle={step === "species" ? context.species?.name : step === "background" ? context.background?.name : step === "class" ? context.classRecord?.name : context.subclass?.name}
      detailOpen={detailOpen}
      onOpenDetail={detailNode ? () => setDetailOpen(true) : undefined}
      detailOpenLabel="Show details"
      onCloseDetail={detailNode ? () => setDetailOpen(false) : undefined}
      footnote={catalogs.attributions.length > 0 ? catalogs.attributions.join(" ") : "Character content is served with its licence line; the catalogs have not loaded yet."}
    >
      <div className="cb-step">
        {!catalogs.loaded && <p className="cb-note" role="status">Loading the character catalogs…</p>}
        {body()}
      </div>
    </WizardShell>
  </div>;
}
