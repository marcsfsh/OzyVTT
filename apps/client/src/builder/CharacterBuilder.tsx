import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BuilderAbilityMethod, ContentFeatureSummary, GmView, PlayerView } from "@vtt/domain";
import {
  ABILITIES, ABILITY_ROLL_FORMULA, ABILITY_SCORE_MAXIMUM, ABILITY_SCORE_MINIMUM, abilityModifier,
  hitDieAverage, hitDieFaces, POINT_BUY_BUDGET, POINT_BUY_MAXIMUM, POINT_BUY_MINIMUM, STANDARD_ARRAY,
  validateAbilityFormula, type Ability, type HitDie
} from "@vtt/rules-5e";
import {
  AbilityScoreAllocator, Alert, Badge, Button, Chip, ChoiceGrid, DiceInputRow, FeatureList, NameField,
  ReviewSummary, SegmentedControl, Select, Stepper, useToast, WizardShell, type ChoiceOption, type DiceEntryMode,
  type FeatureItem, type ReviewSection, type StepItem
} from "@vtt/ui";
import { useBuilderCatalogs, type BuilderCatalogs } from "../content/catalogs";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import {
  ABILITY_LABELS, ABILITY_SCORE_CAP, ASI_SHORTHAND, abilityCapPreview, baseScoresOf, abilityBonusesOf,
  buildCreatePayload, computeOffers, emptyDraft, FEAT_KINDS, isAssignMethod, offerContext, offerFilled,
  pointBuySpent, prunePicks, rosterCapacity, STEP_IDS, STEP_LABELS, STEP_SHORT, stepBlockedReason,
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
  /** The table connection. A create is a command, so an offline table blocks the LAST step with a
      reason - the mechanism the wizard already uses for "not finished yet" - rather than letting
      Create be pressed into a socket that cannot answer. */
  connection?: "online" | "reconnecting" | "offline";
  onClose: () => void;
  onCreated: (name: string) => void;
}>;

/** How long Create waits for the table's answer before offering the (idempotent) retry. */
const CREATE_ACK_TIMEOUT_MS = 10_000;

const METHOD_LABELS: Readonly<Record<BuilderAbilityMethod, string>> = {
  "standard-array": "Standard array", "point-buy": "Point buy", roll: "Roll 4d6", custom: "GM formula"
};

const titleize = (id: string) => id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const sourceBadge = (source: string) => source === "homebrew" ? <Badge tone="primary">Homebrew</Badge> : <Badge tone="info">SRD</Badge>;
/**
 * One row per distinct trait NAME. Content lists a species' per-lineage variants as separate
 * features, so Dragonborn's ten ancestries printed 25 rows for 15 titles — "Breath Weapon (Fire)"
 * five times, byte-identical each time. Keeping the first is lossless (the repeats say the same
 * thing) and it is the de-dupe, not the `limit`, that decides what is dropped: the slice used to
 * spend its budget on copies.
 */
const featureItems = (features: readonly ContentFeatureSummary[], limit = 40): FeatureItem[] => {
  const seen = new Set<string>();
  const distinct = features.filter((feature) => seen.has(feature.name) ? false : (seen.add(feature.name), true));
  return distinct.slice(0, limit).map((feature) => ({
    id: feature.id,
    title: feature.name,
    meta: feature.level != null ? `Level ${feature.level}` : undefined,
    body: <p>{feature.description}</p>
  }));
};

/** Sentence-case a stored provenance phrase for a card's disabled reason. */
const asReason = (phrase: string) => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/** A feat's one-line summary, for the grids whose options ARE feats. All 19 SRD feats carry one. */
const featSummary = (catalogs: BuilderCatalogs, id: string) =>
  catalogs.choice.feats.find((entry) => entry.id === id)?.summary ?? undefined;

/**
 * One pick offered by the content: heading, count, and the grid that answers it — until it IS
 * answered, at which point the grid folds down to the answer.
 *
 * A level-5 Wizard's fourth step asks seven questions and, once every one of them has been answered,
 * was still showing all 183 cards it asked them with: nine thousand pixels of scroll whose entire
 * content was options already declined. An answered question is a line, not a grid. Reopening it is
 * one press of Change, in the place the answer is.
 */
function OfferPicker({ offer, draft, catalogs, onSet }: Readonly<{
  offer: BuilderOffer; draft: BuilderDraft; catalogs: BuilderCatalogs;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  const complete = picks.length === offer.capacity;
  const [expanded, setExpanded] = useState(false);
  /**
   * DERIVED, never stored. An offer whose picks are pruned away by a change upstream (a new class,
   * a granted origin feat) becomes incomplete, and therefore open again, with no stale "collapsed"
   * flag anywhere to invalidate. It is also why an offer whose capacity exceeds its option count —
   * a choose-5-of-4 content gap — can never fold: it can never be complete.
   */
  const collapsed = complete && !expanded;
  const changeRef = useRef<HTMLButtonElement | null>(null);
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    const justCollapsed = collapsed && !wasCollapsed.current;
    wasCollapsed.current = collapsed;
    // The last pick unmounts the grid the finger (or the Space bar) was in, and focus falls to
    // <body> — a keyboard walk would then restart from the top of the page. Hand it to the control
    // that stands where the grid was. Only when it really was lost: a mouse user who never had
    // focus in the grid keeps whatever they had.
    if (justCollapsed && document.activeElement === document.body) changeRef.current?.focus();
  }, [collapsed]);

  if (offer.unresolvable) {
    return <section className="cb-offer">
      <h3 className="cb-offer-title">{offer.label}</h3>
      <Alert tone="warning" title="Not available yet">
        This choice has no options to show: {offer.unresolvable} You can finish the character without it.
      </Alert>
    </section>;
  }
  const isFeat = FEAT_KINDS.has(offer.kind);
  const options: ChoiceOption[] = offer.options.map((option) => ({
    value: option.id,
    // The option's NAME is the title, for every kind. Equipment used to be titled "Option A" with the
    // kit demoted to the description, which made the card's headline the one word carrying no
    // information and pushed the contents into a 3-line clamp that cut "…and 8 GP" — the number you
    // would compare against the other option's "50 GP". The review step already lists the real name
    // (`pickedNames`), so this is also the two agreeing about what was chosen.
    title: option.name,
    // Every feat in the catalog carries a summary; showing it turns a grid of bare names
    // ("Alert", "Savage Attacker") into a choice that can actually be made from the card.
    description: isFeat ? featSummary(catalogs, option.id) : undefined,
    meta: option.level != null && option.level > 0 ? `Level ${option.level}` : option.level === 0 ? "Cantrip" : undefined,
    // A proficiency this build already holds stays IN the list and greys out, saying where it
    // came from. Picked from a different source it would be merged away server-side, costing the
    // player the pick and leaving them one proficiency short with nothing said.
    ...(offer.unavailable?.[option.id]
      ? { disabled: true, disabledReason: asReason(offer.unavailable[option.id]) }
      : {}),
    keywords: option.id
  }));
  const many = offer.capacity > 1;
  const nameOf = (id: string) => offer.options.find((option) => option.id === id)?.name ?? titleize(id);
  /* The heading is byte-identical in both states: the question and its count do not change just
     because it has been answered, and a heading that moved would cost the collapse its whole point. */
  return <section className="cb-offer">
    <div className="cb-offer-head">
      <h3 className="cb-offer-title">{offer.label}</h3>
      <span className="cb-offer-count tabular" role="status">
        {many ? `${picks.length} of ${offer.capacity} chosen` : picks.length === 1 ? "Chosen" : "Choose one"}
      </span>
    </div>
    {collapsed
      /* DISPLAY chips, never `.nh-chip--pressable`: a readout is not a second place the pick can be
         made (the rule the count beside it already obeys). Change is the one way back in. */
      ? <div className="cb-offer-picks">
          {picks.map((pick) => <Chip key={pick}>{nameOf(pick)}</Chip>)}
          <Button ref={changeRef} variant="ghost" size="sm" onClick={() => setExpanded(true)}>Change</Button>
        </div>
      : <>
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
          {/* Only ever offered once the question is answered, so exactly one of Change / Done is on
              screen at a time. Reopening a finished offer needs a way back out that is not a pick. */}
          {complete && <div className="cb-offer-picks"><Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>Done</Button></div>}
        </>}
  </section>;
}

/**
 * An Ability Score Improvement level: raise two points, or take a feat. Both routes write ONE
 * `asi-or-feat` ledger row. The catalog's own "Ability Score Improvement" feat is filtered out of
 * the feat list on purpose - it is the same idea as the ability route, and the system shows one
 * idea one way. (The server accepts either; the wizard offers the simpler one.)
 */
function AsiOffer({ offer, draft, catalogs, capBefore, onSet, onIncreases }: Readonly<{
  offer: BuilderOffer; draft: BuilderDraft; catalogs: BuilderCatalogs;
  /** This build's scores as they stand just BEFORE this improvement, or null while the ability step
      has none yet. With it the row shows what each ability would reach and refuses the ones with no
      room, so the 20 ceiling is met at the point of choice rather than at Create. */
  capBefore: Readonly<Record<Ability, number>> | null;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
  onIncreases: (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  const route = picks[0] === ASI_SHORTHAND ? "asi" : picks.length > 0 ? "feat" : null;
  const increases = draft.asiIncreases[offer.key] ?? [];
  const featOptions: ChoiceOption[] = offer.options
    .filter((option) => option.id !== "ability-score-improvement")
    .map((option) => ({ value: option.id, title: option.name, description: featSummary(catalogs, option.id), keywords: option.id }));

  /**
   * Which shape of increase is being made. Derived from the draft when it holds an answer (an
   * amount-1 entry can only come from the +1/+1 split), and only otherwise from the local pick.
   *
   * The split is a QUESTION, not an answer: choosing "Raise ability scores" used to write
   * `+2 Strength` into the draft on the player's behalf, which is wrong for most classes and
   * illegal at level 20 (five unasked-for +2s put Strength at 27). So the route is recorded, the
   * abilities stay empty until chosen, and the step's own gate refuses to move on - `offerFilled`
   * already requires the split to add to 2.
   */
  const [pickedSplit, setPickedSplit] = useState<"one" | "two" | null>(null);
  const split = increases.length > 0 ? (increases.some((entry) => entry.amount === 1) ? "two" : "one") : pickedSplit;
  const amount = split === "two" ? 1 : 2;
  const slotCount = split === "two" ? 2 : split === "one" ? 1 : 0;
  /** The ability shown in each row. `""` is "not answered yet", which the draft cannot represent. */
  const slots: readonly string[] = Array.from({ length: slotCount }, (_, index) => increases[index]?.ability ?? "");

  /** What raising `ability` by this row's amount would make it - null while there is nothing to cap. */
  const projected = (index: number, ability: Ability): number | null => {
    if (!capBefore) return null;
    const elsewhere = slots.reduce((total, entry, position) => position !== index && entry === ability ? total + amount : total, 0);
    return capBefore[ability] + elsewhere + amount;
  };

  const changeSplit = (next: string) => {
    setPickedSplit(next as "one" | "two");
    // Changing the split changes the question, so the old answer cannot simply carry: a +2 is not
    // a +1. The first ability is kept when it still fits, and nothing is invented for the rest.
    const first = increases[0]?.ability;
    const keeps = first && (capBefore?.[first] ?? 0) + (next === "two" ? 1 : 2) <= ABILITY_SCORE_CAP;
    onIncreases(offer, keeps ? [{ ability: first, amount: next === "two" ? 1 : 2 }] : []);
  };
  const setAbility = (index: number, ability: string) => {
    const next = slots.map((entry, position) => position === index ? ability : entry);
    onIncreases(offer, next.filter((entry): entry is Ability => entry !== "").map((entry) => ({ ability: entry, amount })));
  };

  return <section className="cb-offer">
    <div className="cb-offer-head">
      <h3 className="cb-offer-title">{offer.label} <span className="cb-offer-level tabular">Level {offer.level}</span></h3>
    </div>
    <SegmentedControl
      ariaLabel={`Level ${offer.level} improvement`}
      value={route ?? ""}
      onChange={(next) => {
        if (next === "asi") { onSet(offer, [ASI_SHORTHAND]); setPickedSplit(null); onIncreases(offer, []); }
        else { onSet(offer, []); setPickedSplit(null); }
      }}
      options={[{ value: "asi", label: "Raise ability scores" }, { value: "feat", label: "Take a feat" }]}
    />
    {route === "asi" && <div className="cb-asi">
      <SegmentedControl
        size="sm"
        ariaLabel="How to split the increase"
        value={split ?? ""}
        onChange={changeSplit}
        options={[{ value: "one", label: "+2 to one" }, { value: "two", label: "+1 to two" }]}
      />
      <div className="cb-asi-rows">
        {slots.map((chosen, index) => <label key={index} className="cb-asi-row">
          <span className="cb-asi-label">+{amount} to</span>
          <Select value={chosen} aria-label={`Ability to raise by ${amount}`} onChange={(event) => setAbility(index, event.target.value)}>
            <option value="">Choose an ability…</option>
            {ABILITIES.map((ability) => {
              const total = projected(index, ability);
              const noRoom = total != null && total > ABILITY_SCORE_CAP;
              // The current pick stays selectable even when it no longer fits, or the control would
              // show an answer it refuses to let go of; the step's blocked reason says the rest.
              return <option key={ability} value={ability} disabled={noRoom && ability !== chosen}>
                {ABILITY_LABELS[ability]}{total == null ? "" : ` — ${total}${noRoom ? ` (over ${ABILITY_SCORE_CAP})` : ""}`}
              </option>;
            })}
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

export function CharacterBuilder({ state, sessionKey, connection = "online", onClose, onCreated }: CharacterBuilderProps) {
  const catalogs = useBuilderCatalogs();
  const { toast } = useToast();
  const policy = state.builderPolicy;
  const [draft, setDraft] = useState<BuilderDraft>(() => emptyDraft());
  const [stepIndex, setStepIndex] = useState(0);
  /**
   * The furthest step the player has actually REACHED. Position alone cannot tell a rail whether a
   * step is finished: `stepBlockedReason("equipment", …)` is legitimately null before a class has
   * been chosen (a build with no equipment offers owes no equipment pick), so a rail that checked
   * off every step whose reason was null would show Equipment done on a blank wizard. Gating every
   * ✓ and every jump on "have you been here" is what makes the rail true.
   */
  const [furthest, setFurthest] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** The one thing that went wrong with a submit, said in the wizard's own words. A rejection and a
      silent server are different messages but the SAME surface - one alert, in one place, found. */
  const [rejection, setRejection] = useState<{ title: string; text: string } | null>(null);
  const [resumable, setResumable] = useState<StoredDraft | null>(() => {
    const stored = loadDraft(sessionKey);
    return stored && draftHasProgress(stored.draft) ? stored : null;
  });
  const [abilityEntry, setAbilityEntry] = useState<DiceEntryMode>("auto");
  const [hpEntry, setHpEntry] = useState<DiceEntryMode>("auto");
  const [rolling, setRolling] = useState(false);
  const [nameSeed, setNameSeed] = useState(0);

  const [pendingCreate, setPendingCreate] = useState<{ actorId: string; typedName: string } | null>(null);

  const step: StepId = STEP_IDS[stepIndex];
  const offers = useMemo(() => computeOffers(draft, catalogs), [draft, catalogs]);
  const context = useMemo(() => offerContext(draft, catalogs), [draft, catalogs]);
  const abilityCap = useMemo(() => abilityCapPreview(draft, catalogs, offers), [draft, catalogs, offers]);
  // How full the table already is. GM-only by construction: `PlayerView` carries no sheet library,
  // and its actor list is projected (hidden combatants stripped), so it could only under-count.
  const capacity = useMemo(() => "definitions" in state ? rosterCapacity(state.definitions.length, state.actors.length) : null, [state]);

  /**
   * Keep the draft honest as the build changes shape: a Fighter's skills are not a Wizard's.
   *
   * `draft.picks` IS a dependency, and not an optional one. `prunePicks` also mirrors the chosen
   * subclass onto `draft.subclassId`, and that id is what `computeOffers` reads to offer the
   * subclass's OWN choices — so a pick is what makes the next question appear (choosing Evocation
   * is what asks for its two Evocation Savant spells). While `catalogs` was rebuilt every render
   * this effect ran constantly and happened to catch that; memoising the catalogs (correctly) took
   * the accident away, and the subclass's offers stopped appearing. The reconciler runs when the
   * draft's PICKS change, which is when the set of offers can change — and no longer when the
   * player types a name, assigns a score, or opens the detail pane.
   */
  useEffect(() => {
    setDraft((current) => {
      const pruned = prunePicks(current, computeOffers(current, catalogs));
      return pruned === current ? current : pruned;
    });
  }, [draft.classId, draft.speciesId, draft.backgroundId, draft.level, draft.subclassId, draft.picks, catalogs]);

  // Park the draft on every change so a reload (or Save & close) never costs the player their work -
  // EXCEPT while an unanswered resume offer is on screen. Saving then would overwrite the very draft
  // the banner is advertising: one click on a different species and the unfinished character it just
  // promised is gone on the next reload. So the offer owns the store until it is ANSWERED, and only
  // Resume / Discard / Save & close answer it. That is also why the banner stays put rather than
  // auto-dismissing on the first pick: a pending question that would destroy work has to keep being
  // asked, and its copy says exactly which two answers release the store.
  useEffect(() => {
    if (resumable) return;
    if (draftHasProgress(draft)) saveDraft(sessionKey, draft);
  }, [draft, sessionKey, resumable]);

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
      if (!result.ok || !result.rollId) { setRolling(false); setRejection({ title: "That roll was rejected", text: result.message ?? "The table refused the roll." }); return; }
      pendingRolls.current.set(result.rollId, apply);
    });
  };

  /** Every edit the PLAYER makes goes through here; the pruning effect does not, being bookkeeping. */
  const editDraft = (update: (current: BuilderDraft) => BuilderDraft) => setDraft(update);
  const patch = (change: Partial<BuilderDraft>) => editDraft((current) => ({ ...current, ...change }));
  const setPicks = (offer: BuilderOffer, ids: readonly string[]) =>
    editDraft((current) => ({ ...current, picks: { ...current.picks, [offer.key]: ids.slice(0, offer.capacity) } }));
  const setIncreases = (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) =>
    editDraft((current) => ({ ...current, asiIncreases: { ...current.asiIncreases, [offer.key]: increases } }));

  /**
   * Every step's reason, computed ONCE per draft. The rail, the review sections, and the footer all
   * ask the same seven questions; recomputing them per consumer meant seven `computeOffers` walks on
   * every keystroke and on purely visual state (opening the detail pane, rolling a die).
   */
  const stepReasons = useMemo(
    () => STEP_IDS.map((id) => catalogs.loaded ? stepBlockedReason(id, draft, catalogs, offers, policy) : "Loading the content catalogs…"),
    [draft, catalogs, offers, policy]
  );
  const stepReason = stepReasons[stepIndex];
  /** How far a RESUMED draft had got: the first step it does not satisfy, so everything behind it
      reads as done and stays clickable, and nothing ahead of it is claimed. */
  const reachedIn = (resumed: BuilderDraft) => {
    const resumedOffers = computeOffers(resumed, catalogs);
    const first = STEP_IDS.findIndex((id) => stepBlockedReason(id, resumed, catalogs, resumedOffers, policy) !== null);
    return first === -1 ? STEP_IDS.length - 1 : first;
  };
  /** `.cb-page` is the scroll container (the shell's header and footer are sticky inside it), so a
      step change that does not reset ITS scrollTop leaves the next step opened halfway down. */
  const pageRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { if (pageRef.current) pageRef.current.scrollTop = 0; }, [stepIndex]);
  // A full table is the LAST thing that can stop a create, so it blocks only once the character
  // itself is finished - and it blocks rather than letting Create come back as a rejection. An
  // offline table is the same shape of answer: the create cannot land, so the step says so.
  const reviewBlock = step !== "review" ? null
    : connection !== "online" ? "The table is offline — reconnecting…"
      : capacity?.blockedReason ?? null;
  const blockedReason = stepReason ?? reviewBlock;
  /**
   * The rail's state machine, in one place:
   *   done(i)       ⟺  i <= furthest AND reasons[i] === null AND i !== current
   *   incomplete(i) ⟺  i <= furthest AND reasons[i] !== null AND i !== current
   *   clickable(i)  ⟺  i <= furthest AND i !== current      (via `maxSelectable`)
   * Beyond `furthest` no state is declared, so `Steps` falls back to its own position rule and the
   * step reads as upcoming. Forward jumps past the frontier stay locked, deliberately.
   */
  const stepsForShell: StepItem[] = STEP_IDS.map((id, index) => ({
    label: STEP_LABELS[id],
    shortLabel: STEP_SHORT[id],
    ...(index <= furthest && index !== stepIndex ? { state: stepReasons[index] === null ? "done" as const : "incomplete" as const } : {})
  }));

  /**
   * ONE commandId per attempt. It is also the created actor's id AND the server's idempotency key,
   * so pressing Create again after a dropped ack must resend the SAME id - minting a fresh one made
   * one intention into two characters. A rejected command burns no receipt (`game-store.ts` writes
   * it only inside the successful transaction), so the id stays good for the retry.
   */
  const attemptId = useRef<string | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (ackTimer.current !== null) clearTimeout(ackTimer.current); }, []);

  const finishCreate = (name: string) => {
    attemptId.current = null;
    setPendingCreate(null);
    clearDraft(sessionKey);
    onCreated(name);
    onClose();
  };

  const submit = () => {
    setRejection(null);
    setSubmitting(true);
    let payload;
    try { payload = buildCreatePayload(draft, offers); }
    catch (error) { setSubmitting(false); setRejection({ title: "The character is not complete yet", text: error instanceof Error ? error.message : "Something is still missing." }); return; }
    attemptId.current ??= newId();
    const commandId = attemptId.current;
    // A lost ack would otherwise leave Create spinning for ever, which is the ONE state the reused
    // commandId cannot help with - there is no way to press it again. So the wait is bounded and the
    // way out says why resending is safe.
    if (ackTimer.current !== null) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => {
      ackTimer.current = null;
      setSubmitting(false);
      setRejection({ title: "The table has not answered", text: "Press Create character again. It resends the same request, so it cannot make a second character." });
    }, CREATE_ACK_TIMEOUT_MS);
    socket.emit("character:create", { commandId, ...payload }, (result) => {
      if (ackTimer.current !== null) { clearTimeout(ackTimer.current); ackTimer.current = null; }
      if (!result.ok) { setSubmitting(false); setRejection({ title: "The server rejected this character", text: result.message ?? "The character could not be created." }); return; }
      setPendingCreate({ actorId: result.actorId ?? commandId, typedName: payload.name });
    });
  };

  // The ack carries the actor id and no name, and the server RENAMES a clash (a second "Borin"
  // lands as "Borin 2"), so the name announced is READ BACK from the state the server broadcast -
  // emitted before the ack, so this normally resolves on the first pass. The timer is the belt for
  // a broadcast that has not landed: a created character is never left unannounced.
  useEffect(() => {
    if (!pendingCreate) return;
    const created = (state.actors as ReadonlyArray<{ id: string; name: string }>).find((actor) => actor.id === pendingCreate.actorId);
    if (created) { finishCreate(created.name); return; }
    const timer = setTimeout(() => finishCreate(pendingCreate.typedName), 2000);
    return () => clearTimeout(timer);
  }, [pendingCreate, state.actors]);

  /**
   * A rejection has to be SEEN. The Create button is sticky at the foot of a long review step, so
   * the message it produces lands most of a screen above the eye and focus stays on the button that
   * looked like it did nothing. So the banner takes focus (announcing itself to a screen reader,
   * since it is also `role="alert"`) and is scrolled to the middle of the viewport. One message in
   * one place - found, rather than restated somewhere else as well.
   */
  const rejectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = rejectionRef.current;
    if (!rejection || !node) return;
    // Only one of the two steps mounts the alert at a time, so the ref always points at the live one.
    node.focus({ preventScroll: true });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [rejection]);

  // Leaving IS an answer to a pending resume offer: the player has decided this build is the one
  // worth keeping, so it takes the slot rather than being thrown away in favour of the older draft.
  // "Save & close" claims to have saved something, and then the wizard vanishes: the receipt is the
  // only evidence the claim was true, and it says where the work went.
  const saveAndClose = () => {
    const saved = draftHasProgress(draft);
    if (saved) saveDraft(sessionKey, draft);
    onClose();
    if (saved) toast("Draft saved — resume it from Create a character.", { tone: "success" });
  };
  // Escape leaves the way the header button does. This is a full page, not a Modal, so nothing
  // else owns the key - and because the draft is parked on every change, leaving costs nothing.
  const saveAndCloseRef = useRef(saveAndClose);
  saveAndCloseRef.current = saveAndClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      saveAndCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Ability scores ------------------------------------------------------------------------
  const base = baseScoresOf(draft);
  const bonuses = abilityBonusesOf(draft, catalogs, offers);
  const allowedMethods = policy.allowedAbilityMethods.filter((method) => method !== "custom" || policy.customFormula);
  const method = allowedMethods.includes(draft.abilityMethod) ? draft.abilityMethod : allowedMethods[0] ?? "standard-array";
  const rollFormula = method === "custom" ? policy.customFormula ?? ABILITY_ROLL_FORMULA : ABILITY_ROLL_FORMULA;
  const assignMode = isAssignMethod(method);
  // What a typed score may be. The server bound-checks every manual score against exactly this
  // (`character-build.ts` validateBaseScores), so a `4d6kh3` table must not let 22 be typed and
  // then invalidate seven steps at Create - the hit-point row below already derives its own bounds
  // from the hit die, and this is the same idea for the same reason.
  const rollBounds = useMemo(() => {
    const check = validateAbilityFormula(rollFormula);
    return check.ok ? { min: check.minimum, max: check.maximum } : { min: ABILITY_SCORE_MINIMUM, max: ABILITY_SCORE_MAXIMUM };
  }, [rollFormula]);

  /**
   * Switching method clears only what the NEW method OWNS. Clearing everything meant a player who
   * looked at standard array for a moment came back to a wiped 27-point spread, with no warning and
   * no undo - so point buy no longer touches the pool, and an assign method no longer touches the
   * spend spread. Roll -> standard array still replaces the pool: that pool IS the standard array.
   */
  const setMethod = (next: string) => {
    const chosen = next as BuilderAbilityMethod;
    patch({
      abilityMethod: chosen,
      ...(isAssignMethod(chosen)
        ? {
            poolAssignment: {},
            abilityPool: chosen === "standard-array" ? STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })) : []
          }
        : {})
    });
  };
  // A parked draft can come back under a policy that no longer allows its method. The allocator
  // already FELL BACK for display, but the draft kept the disallowed method, so the controls showed
  // a legal method selected while the footer said the GM does not allow it. Write the fallback down.
  // Keyed on the joined list, not the array: `policy.allowedAbilityMethods.filter(...)` mints a new
  // array every render, which as a dependency would run this on every render instead of on change.
  const allowedKey = allowedMethods.join(",");
  useEffect(() => {
    if (allowedMethods.length > 0 && !allowedMethods.includes(draft.abilityMethod)) setMethod(allowedMethods[0]);
  }, [allowedKey, draft.abilityMethod]);
  const addRolledScore = (total: number) => editDraft((current) => current.abilityPool.length >= 6
    ? current
    : { ...current, abilityPool: [...current.abilityPool, { id: `r-${current.abilityPool.length}-${total}`, value: total }] });
  const rollAllScores = () => {
    const missing = 6 - draft.abilityPool.length;
    for (let index = 0; index < missing; index += 1) rollOnServer(rollFormula, `Ability score ${draft.abilityPool.length + index + 1}`, addRolledScore);
  };
  const addHpRoll = (total: number) => editDraft((current) => current.hpEntries.length >= current.level - 1
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
  /**
   * Species, Background, and Class are the three PRIMARY picks, and they were the only decisions in
   * the wizard rendered as a bare grid: no heading, no count. That made "Species" carry less
   * typographic weight than "Keen Senses" — a sub-choice of the thing it decides — and it left the
   * step's first element unlabelled. Same `.cb-offer` shell as every other decision, so a player who
   * has answered one has answered all of them.
   */
  const primaryPick = (label: string, answered: boolean, grid: ReactNode): ReactNode =>
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">{label}</h3>
        <span className="cb-offer-count tabular" role="status">{answered ? "Chosen" : "Choose one"}</span>
      </div>
      {grid}
    </section>;

  const stepOffers = (owner: BuilderOffer["step"]) => offers.filter((offer) => offer.step === owner);
  const renderOffer = (offer: BuilderOffer) => offer.kind === "asi-or-feat"
    ? <AsiOffer key={offer.key} offer={offer} draft={draft} catalogs={catalogs} capBefore={abilityCap.before.get(offer.key) ?? null} onSet={setPicks} onIncreases={setIncreases} />
    : <OfferPicker key={offer.key} offer={offer} draft={draft} catalogs={catalogs} onSet={setPicks} />;

  /**
   * The species feat pick the background's granted origin feat took away. A feat is something you
   * HAVE, so the granted one is dropped from the species' own feat list - and a pick already made
   * there is then pruned, silently, one step after the player made it. Naming it at the moment of
   * cause is what makes that legible: the background step is where the collision happens.
   */
  const displacedSpeciesFeat = context.originFeat
    ? stepOffers("species").find((offer) => FEAT_KINDS.has(offer.kind) && !offerFilled(offer, draft))
    : undefined;

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

  /* ONE failure surface, rendered on the two steps that can produce one: a rejected server roll
     belongs to the ability step, a rejected create to the review step. Rendering it only on review
     (as this did) meant a refused roll set a message the player was never on the step to see. */
  const problemAlert = rejection ? <div ref={rejectionRef} tabIndex={-1} className="cb-rejection">
    <Alert tone="danger" title={rejection.title}>{rejection.text}</Alert>
  </div> : null;

  const body = (): ReactNode => {
    switch (step) {
      case "species":
        return <>
          {primaryPick("Species", draft.speciesId != null,
            <ChoiceGrid ariaLabel="Species" options={speciesOptions} value={draft.speciesId} onChange={(value) => patch({ speciesId: value })}
              searchable={speciesOptions.length > 8} searchPlaceholder="Search species…" />)}
          {stepOffers("species").map(renderOffer)}
        </>;
      case "background":
        return <>
          {primaryPick("Background", draft.backgroundId != null,
            <ChoiceGrid ariaLabel="Backgrounds" options={backgroundOptions} value={draft.backgroundId} onChange={(value) => patch({ backgroundId: value })}
              searchable={backgroundOptions.length > 8} searchPlaceholder="Search backgrounds…" />)}
          {context.originFeat && <p className="cb-note">{context.background?.name} grants the <strong>{context.originFeat.name}</strong> feat.</p>}
          {displacedSpeciesFeat && <p className="cb-note">
            {context.background?.name} grants <strong>{context.originFeat!.name}</strong>, which replaces your{" "}
            {displacedSpeciesFeat.label} choice — pick a different Origin feat on Species.
          </p>}
          {stepOffers("background").map(renderOffer)}
        </>;
      case "class":
        return <>
          {primaryPick("Class", draft.classId != null,
            <ChoiceGrid ariaLabel="Classes" options={classOptions} value={draft.classId} onChange={(value) => patch({ classId: value })}
              searchable={classOptions.length > 8} searchPlaceholder="Search classes…" />)}
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
          {problemAlert}
          {/* What this class actually wants from the six numbers about to be assigned. Every field
              is already loaded - `primaryAbilities` was being used only as a hidden search keyword
              on the class grid, one step where the decision is no longer being made. */}
          {context.classRecord && <p className="cb-note tabular">
            {context.classRecord.name} · {context.classRecord.hitDie} · {context.classRecord.savingThrows.map((ability) => ability.toUpperCase()).join("/")}
            {context.classRecord.primaryAbilities.length > 0 && ` · primary ${context.classRecord.primaryAbilities.map((ability) => ability.toUpperCase()).join(", ")}`}
          </p>}
          <AbilityScoreAllocator
            mode={assignMode ? "assign" : "spend"}
            rows={allocatorRows}
            methods={allowedMethods.map((entry) => ({ value: entry, label: METHOD_LABELS[entry] }))}
            method={method}
            onMethodChange={setMethod}
            methodHint={method === "custom" ? `Your GM's formula: ${policy.customFormula}` : method === "roll" ? `Rolled with ${ABILITY_ROLL_FORMULA}.` : method === "point-buy" ? `Spend ${POINT_BUY_BUDGET} points across scores 8-15.` : `Assign ${STANDARD_ARRAY.join(", ")}, one each.`}
            pool={assignMode ? draft.abilityPool.map((entry) => ({ id: entry.id, value: entry.value, assignedTo: ABILITIES.find((ability) => draft.poolAssignment[ability] === entry.id) ?? null })) : undefined}
            onAssign={assignMode ? (abilityId, poolId) => editDraft((current) => {
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
                  min={rollBounds.min}
                  max={rollBounds.max}
                  busy={rolling}
                  complete={draft.abilityPool.length >= 6}
                  hint={`Roll them here, or type what your own dice showed (${rollBounds.min}-${rollBounds.max}).`}
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
          {/* Not finished is caution, never danger: the table still has room, it is just filling up. */}
          {capacity?.warning && <Alert tone="warning" title="The table is filling up">{capacity.warning}</Alert>}
          {problemAlert}
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
    const reason = catalogs.loaded ? stepReasons[STEP_IDS.indexOf(id)] : null;
    return {
      id, title: STEP_LABELS[id], items: [...items, ...extra],
      onEdit: () => { setStepIndex(STEP_IDS.indexOf(id)); setRejection(null); },
      ...(reason ? { incomplete: reason } : {})
    };
  }

  function reviewSections(): ReviewSection[] {
    const scoreItems = ABILITIES.map((ability) => {
      const total = base[ability] == null ? null : base[ability]! + bonuses[ability];
      const modifier = total == null ? null : abilityModifier(total);
      return {
        label: ABILITY_LABELS[ability],
        // The score is what the player assigned; the MODIFIER is what they will roll with all
        // evening, and it was the one number the review did not show.
        value: total == null ? "—"
          : `${total}${bonuses[ability] ? ` (${base[ability]} +${bonuses[ability]})` : ""} · ${modifier! >= 0 ? "+" : ""}${modifier}`,
        numeric: true
      };
    });
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

  /** What the reserved column says while it has nothing to show. One line per step, in that step's
      own words — it is a held place, not a state to be fixed. */
  const DETAIL_PLACEHOLDER: Partial<Record<StepId, string>> = {
    species: "Pick a species to read its traits here.",
    background: "Pick a background to read about it here.",
    class: "Pick a class to read about it here.",
    features: context.classRecord?.subclassLabel
      ? `Pick a ${context.classRecord.subclassLabel.toLowerCase()} to read about it here.`
      : "Pick a subclass to read about it here."
  };

  /**
   * The detail COLUMN is reserved for the whole of any step that can fill it, so choosing a species
   * or a subclass no longer re-lays the entire grid out under the finger that just tapped it.
   * `WizardShell` splits the body on `detail != null`, so passing null until something was picked
   * meant one tap both mounted a 472-element pane AND reflowed every card from five columns to
   * three. That cost lands hardest exactly where the grid is biggest.
   *
   * The trade is deliberate and must not be "fixed" back: these steps are three columns from
   * arrival rather than five. Five columns for the two taps before a pick is not worth a
   * 183-to-397-card reflow on the tap itself.
   */
  const realDetail = detail();
  const placeholder = DETAIL_PLACEHOLDER[step];
  const detailNode = realDetail ?? (placeholder ? <p className="cb-detail-empty">{placeholder}</p> : null);
  const isLast = stepIndex === STEP_IDS.length - 1;
  const goTo = (index: number) => { setStepIndex(index); setDetailOpen(false); };
  /**
   * A blocked reason may name a control on ANOTHER step: the 20 ceiling is broken by an improvement
   * chosen on Class features and only becomes visible once these scores exist. Saying which step
   * owns the fix and not offering the way there is a message that describes a journey.
   */
  const breachOffer = step === "abilities" && stepReason === abilityCap.breach?.reason ? abilityCap.breach.offerKey : null;
  const reasonNode: ReactNode = blockedReason == null ? undefined : breachOffer
    ? <>{blockedReason}{" "}<Button variant="ghost" size="sm" onClick={() => goTo(STEP_IDS.indexOf("features"))}>Edit that improvement</Button></>
    : blockedReason;
  const resumed = resumable?.draft;
  const resumedNames = resumed ? [
    resumed.name.trim() || null,
    catalogs.choice.species.find((entry) => entry.id === resumed.speciesId)?.name ?? null,
    resumed.classId ? `${catalogs.choice.classes.find((entry) => entry.id === resumed.classId)?.name ?? titleize(resumed.classId)} ${resumed.level}` : null
  ].filter((part): part is string => part !== null) : [];

  return <div className="cb-page" ref={pageRef}>
    <WizardShell
      title="Create a character"
      eyebrow="Character builder"
      steps={stepsForShell}
      current={stepIndex}
      /* Every step already reached stays reachable, finished or not - going back to change a
         species must not cost the walk forward again. Steps PAST the frontier stay locked. */
      onStepSelect={(index) => { if (index <= furthest && index !== stepIndex) goTo(index); }}
      maxSelectable={furthest}
      onBack={stepIndex > 0 ? () => goTo(stepIndex - 1) : undefined}
      /* Once the end has been reached, an edit made from the review step is a DETOUR, not a
         restart: one tap returns, instead of six presses of Next. */
      footerSecondary={furthest === STEP_IDS.length - 1 && stepIndex < furthest
        ? <Button variant="secondary" onClick={() => goTo(STEP_IDS.length - 1)}>Back to review</Button>
        : undefined}
      onNext={() => { if (isLast) submit(); else { setFurthest((reached) => Math.max(reached, stepIndex + 1)); goTo(stepIndex + 1); } }}
      nextLabel={isLast ? "Create character" : "Next"}
      blockedReason={reasonNode}
      busy={submitting}
      /* The ONE way out. The draft is parked on every change, so a second "leave without saving"
         exit would both lie (it is already saved) and, at 375px, overhang the last card in the step
         with its 44px tap area. Discarding lives where it belongs: "Discard it" on the resume
         banner, next to the draft it throws away. */
      onSaveAndClose={saveAndClose}
      resume={resumable
        ? <Alert tone="info" title="Unfinished character found">
            {/* Named, so the offer is a choice rather than a gamble. The stored record carries the
                identity fields and a timestamp - and NO step, so none is promised. */}
            {resumedNames.length > 0 ? <>You started <strong>{resumedNames.join(" · ")}</strong> on this device {describeWhen(resumable.updatedAt)}.</>
              : <>You started a character on this device {describeWhen(resumable.updatedAt)}.</>}{" "}
            It stays exactly as you left it until you answer — resume it, or discard it to save the
            one you build now.{" "}
            <Button variant="secondary" size="sm" onClick={() => { setDraft(resumable.draft); setFurthest(reachedIn(resumable.draft)); setResumable(null); }}>Resume it</Button>
            {/* Discarding is the one action here that destroys work, so it takes the destructive
                treatment rather than reading as the twin of the button beside it. */}
            <Button variant="destructive" size="sm" onClick={() => { clearDraft(sessionKey); setResumable(null); attemptId.current = null; }}>Discard it</Button>
          </Alert>
        : undefined}
      detail={detailNode}
      detailTitle={step === "species" ? context.species?.name : step === "background" ? context.background?.name : step === "class" ? context.classRecord?.name : context.subclass?.name}
      detailOpen={detailOpen}
      /* Gated on REAL content, never the placeholder: below 760px this is a button that leaves the
         step, and it must not lead to a sentence saying there is nothing here yet. */
      onOpenDetail={realDetail ? () => setDetailOpen(true) : undefined}
      detailOpenLabel="Show details"
      onCloseDetail={realDetail ? () => setDetailOpen(false) : undefined}
      footnote={catalogs.attributions.length > 0 ? catalogs.attributions.join(" ") : "Character content is served with its licence line; the catalogs have not loaded yet."}
    >
      <div className="cb-step">
        {!catalogs.loaded && <p className="cb-note" role="status">Loading the character catalogs…</p>}
        {body()}
      </div>
    </WizardShell>
  </div>;
}
