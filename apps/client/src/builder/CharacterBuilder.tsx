import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BuilderAbilityMethod, ContentFeatureSummary, ContentSpellSummary, GmView, PlayerView } from "@vtt/domain";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  ABILITY_SCORE_MAXIMUM,
  ABILITY_SCORE_MINIMUM,
  abilityModifier,
  hitDieAverage,
  hitDieFaces,
  POINT_BUY_BUDGET,
  POINT_BUY_MAXIMUM,
  POINT_BUY_MINIMUM,
  STANDARD_ARRAY,
  validateAbilityFormula,
  type Ability,
  type HitDie
} from "@vtt/rules-5e";
import {
  AbilityScoreAllocator,
  Alert,
  Badge,
  Button,
  ChoiceGrid,
  DiceInputRow,
  FeatureList,
  NameField,
  ReviewSummary,
  SegmentedControl,
  Select,
  Stepper,
  useToast,
  WizardShell,
  type ChoiceOption,
  type DiceEntryMode,
  type FeatureItem,
  type ReviewSection,
  type StepItem
} from "@vtt/ui";
import { useBuilderCatalogs, type BuilderCatalogs } from "../content/catalogs";
// The fight's own spell card, so a spell reads the same while choosing it and while casting it.
import { SpellCard } from "../encounter/spells";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import {
  ABILITY_LABELS,
  ABILITY_SCORE_CAP,
  ASI_SHORTHAND,
  abilityCapPreview,
  baseScoresOf,
  abilityBonusesOf,
  buildCreatePayload,
  computeOffers,
  emptyDraft,
  FEAT_KINDS,
  isAssignMethod,
  offerContext,
  offerFilled,
  pointBuySpent,
  prunePicks,
  rosterCapacity,
  STEP_IDS,
  STEP_LABELS,
  STEP_SHORT,
  stepBlockedReason,
  type BuilderDraft,
  type BuilderOffer,
  type StepId
} from "./build-payload";
import { clearDraft, describeWhen, draftHasProgress, loadDraft, saveDraft, type StoredDraft } from "./draft";
import "./character-builder.css";

/**
 * The guided character-creation wizard: a full page on a laptop, a full-screen sheet on a phone.
 *
 * It renders the picks the content asks for (resolving `fromCatalog` slugs with
 * `resolveCatalogChoice`, the same function the server validates with) and submits one
 * `character.create`. It computes no game outcome: HP, AC, slots and riders are assembled
 * server-side, and a rejection comes back as the server's message on the review step.
 */

type BuilderState = GmView | PlayerView;

export type CharacterBuilderProps = Readonly<{
  state: BuilderState;
  /** Scopes the draft saved in localStorage. */
  sessionKey: string;
  /** The table connection. An offline table blocks the last step with a reason instead of letting
      Create be pressed into a socket that cannot answer. */
  connection?: "online" | "reconnecting" | "offline";
  onClose: () => void;
  onCreated: (name: string) => void;
  /**
   * Level-up / respec mode: the same wizard seeded from an existing character's choice ledger, with
   * its identity locked, submitted as `character.rebuild` instead of `character.create`. Sharing the
   * wizard keeps a level-up from drifting from a fresh build.
   */
  rebuild?: Readonly<{ actorId: string; name: string; seed: BuilderDraft; startStep?: StepId; notice?: ReactNode }>;
}>;

/** How long Create waits for the table's answer before offering the (idempotent) retry. */
const CREATE_ACK_TIMEOUT_MS = 10_000;

/**
 * How many options an offer needs before its grid gets a search box. Answered offers never fold
 * away: at capacity the unchosen options grey out, and `ChoiceGrid bounded` caps the grid's height.
 */
const SEARCH_THRESHOLD = 8;

/** The offer kinds whose options are spells, and therefore have rules worth reading while choosing. */
const SPELL_KINDS: ReadonlySet<string> = new Set(["spell", "cantrip"]);

const METHOD_LABELS: Readonly<Record<BuilderAbilityMethod, string>> = {
  "standard-array": "Standard array",
  "point-buy": "Point buy",
  roll: "Roll 4d6",
  custom: "GM formula"
};

const titleize = (id: string) =>
  id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
/**
 * Badge only the exception: nearly every option is SRD, so only homebrew gets a badge. `ChoiceCard`
 * collapses the slot when the badge is `undefined`.
 */
const sourceBadge = (source: string | undefined) =>
  source === "homebrew" ? <Badge tone="primary">Homebrew</Badge> : undefined;
/**
 * One row per distinct trait name. Content lists per-lineage variants as separate features
 * (Dragonborn's "Breath Weapon (Fire)" etc.), and the repeats say the same thing.
 */
const featureItems = (features: readonly ContentFeatureSummary[], limit = 40): FeatureItem[] => {
  const seen = new Set<string>();
  const distinct = features.filter((feature) => (seen.has(feature.name) ? false : (seen.add(feature.name), true)));
  return distinct.slice(0, limit).map((feature) => ({
    id: feature.id,
    title: feature.name,
    meta: feature.level != null ? `Level ${feature.level}` : undefined,
    body: <p>{feature.description}</p>
  }));
};

/** Sentence-cases a stored provenance phrase for a card's disabled reason. */
const asReason = (phrase: string) => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/** A feat's one-line summary, for grids whose options are feats. */
const featSummary = (catalogs: BuilderCatalogs, id: string) =>
  catalogs.choice.feats.find((entry) => entry.id === id)?.summary ?? undefined;

/** What an option's `level` says on the card. Only the spell catalogs carry one; 0 is a cantrip. */
const spellLevelLine = (level: number | null | undefined) =>
  level == null ? undefined : level === 0 ? "Cantrip" : `Level ${level}`;

/**
 * Provenance for an offer option, by id. `resolveCatalogChoice` narrows options to
 * `{ id, name, level? }`, so `source` is looked back up in the catalog the id came from.
 *
 * Subclasses and feats only: spell, equipment and monster summaries carry no `source`, so a
 * homebrew spell is still unbadged. These catalogs are audience-merged server-side, so nothing a
 * player may not see can be badged.
 */
const offerSource = (catalogs: BuilderCatalogs, id: string): string | undefined =>
  catalogs.choice.subclasses.find((entry) => entry.id === id)?.source ??
  catalogs.choice.feats.find((entry) => entry.id === id)?.source;

/**
 * One pick offered by the content: heading, count, and the grid that answers it.
 * The grid never folds away: every option stays mounted, unchosen ones grey at capacity, and a
 * chosen card stays tappable so the pick can be swapped. `ChoiceGrid bounded` caps the height.
 */
function OfferPicker({
  offer,
  draft,
  catalogs,
  onSet
}: Readonly<{
  offer: BuilderOffer;
  draft: BuilderDraft;
  catalogs: BuilderCatalogs;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  /** See `SEARCH_THRESHOLD`. */
  const long = offer.options.length > SEARCH_THRESHOLD;
  /**
   * The spell whose rules are open, or null. Read from the already-loaded spell catalog, so it costs
   * no round trip and tells the server nothing.
   */
  const [reading, setReading] = useState<ContentSpellSummary | null>(null);
  const spells = SPELL_KINDS.has(offer.kind) ? catalogs.choice.spells : null;

  if (offer.unresolvable) {
    return (
      <section className="cb-offer">
        <h3 className="cb-offer-title">{offer.label}</h3>
        <Alert tone="warning" title="Not available yet">
          This choice has no options to show: {offer.unresolvable} You can finish the character without it.
        </Alert>
      </section>
    );
  }
  const isFeat = FEAT_KINDS.has(offer.kind);
  const options: ChoiceOption[] = offer.options.map((option) => ({
    value: option.id,
    // The option's name is the title for every kind (equipment included), matching the review step.
    title: option.name,
    // Feats show their summary. A spell's type line ("Cantrip", "Level 3") also goes in `description`,
    // not `meta`, which is the mono micro-label meant for numbers.
    description: isFeat ? featSummary(catalogs, option.id) : spellLevelLine(option.level),
    badge: sourceBadge(offerSource(catalogs, option.id)),
    // A proficiency the build already holds stays listed but disabled, saying where it came from;
    // picked from another source it would be merged away server-side, silently costing a pick.
    ...(offer.unavailable?.[option.id]
      ? { disabled: true, disabledReason: asReason(offer.unavailable[option.id]) }
      : {}),
    keywords: option.id
  }));
  const many = offer.capacity > 1;
  return (
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">{offer.label}</h3>
        {/* Only choose-N offers show a running count; for choose-one the selected card says it all. */}
        {many && (
          <span className="cb-offer-count tabular" role="status">
            {picks.length} of {offer.capacity} chosen
          </span>
        )}
      </div>
      {offer.help && <p className="cb-offer-help">{offer.help}</p>}
      <ChoiceGrid
        ariaLabel={offer.label}
        options={options}
        /* Capped height with internal scroll, so a long step stays readable without unmounting options. */
        bounded
        searchable={long}
        searchPlaceholder="Search options…"
        selection={many ? "multiple" : "single"}
        value={many ? null : (picks[0] ?? null)}
        onChange={(value) => onSet(offer, [value])}
        values={many ? picks : undefined}
        /* `max` greys the unchosen cards at capacity for every choose-N offer. A choose-one offer is a
         radiogroup and passes none, so a keyboard user can still arrow between answers. */
        max={many ? offer.capacity : undefined}
        onToggle={(value, next) => onSet(offer, next ? [...picks, value] : picks.filter((id) => id !== value))}
        /* Opens a spell's rules in a modal; `onInspect` never changes `picks`. */
        onInspect={spells ? (id) => setReading(spells.find((spell) => spell.id === id) ?? null) : undefined}
        inspectLabel={(option) => `Read the ${option.title} rules`}
      />
      {reading && <SpellCard spell={reading} onClose={() => setReading(null)} />}
    </section>
  );
}

/**
 * An Ability Score Improvement level: raise two points, or take a feat. Both routes write one
 * `asi-or-feat` ledger row. The catalog's own "Ability Score Improvement" feat is filtered out of
 * the feat list since the ability route covers it (the server accepts either).
 */
function AsiOffer({
  offer,
  draft,
  catalogs,
  capBefore,
  onSet,
  onIncreases
}: Readonly<{
  offer: BuilderOffer;
  draft: BuilderDraft;
  catalogs: BuilderCatalogs;
  /** This build's scores just before this improvement, or null while the ability step has none.
      Lets each row show the result and refuse abilities with no room under the 20 cap. */
  capBefore: Readonly<Record<Ability, number>> | null;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
  onIncreases: (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  const route = picks[0] === ASI_SHORTHAND ? "asi" : picks.length > 0 ? "feat" : null;
  const increases = draft.asiIncreases[offer.key] ?? [];
  const featOptions: ChoiceOption[] = offer.options
    .filter((option) => option.id !== "ability-score-improvement")
    .map((option) => ({
      value: option.id,
      title: option.name,
      description: featSummary(catalogs, option.id),
      badge: sourceBadge(offerSource(catalogs, option.id)),
      keywords: option.id
    }));

  /**
   * Which shape of increase is being made: derived from the draft when it holds an answer (an
   * amount-1 entry only comes from the +1/+1 split), otherwise from the local pick. Choosing the
   * route writes no abilities; the step stays blocked until the split adds to 2 (`offerFilled`).
   */
  const [pickedSplit, setPickedSplit] = useState<"one" | "two" | null>(null);
  const split = increases.length > 0 ? (increases.some((entry) => entry.amount === 1) ? "two" : "one") : pickedSplit;
  const amount = split === "two" ? 1 : 2;
  const slotCount = split === "two" ? 2 : split === "one" ? 1 : 0;
  /** The ability shown in each row; `""` is "not answered yet", which the draft cannot represent. */
  const slots: readonly string[] = Array.from({ length: slotCount }, (_, index) => increases[index]?.ability ?? "");

  /** What raising `ability` by this row's amount would make it; null while there is nothing to cap. */
  const projected = (index: number, ability: Ability): number | null => {
    if (!capBefore) return null;
    const elsewhere = slots.reduce(
      (total, entry, position) => (position !== index && entry === ability ? total + amount : total),
      0
    );
    return capBefore[ability] + elsewhere + amount;
  };

  const changeSplit = (next: string) => {
    setPickedSplit(next as "one" | "two");
    // A +2 answer cannot carry over as a +1: keep the first ability if it still fits, invent nothing else.
    const first = increases[0]?.ability;
    const keeps = first && (capBefore?.[first] ?? 0) + (next === "two" ? 1 : 2) <= ABILITY_SCORE_CAP;
    onIncreases(offer, keeps ? [{ ability: first, amount: next === "two" ? 1 : 2 }] : []);
  };
  const setAbility = (index: number, ability: string) => {
    const next = slots.map((entry, position) => (position === index ? ability : entry));
    onIncreases(
      offer,
      next.filter((entry): entry is Ability => entry !== "").map((entry) => ({ ability: entry, amount }))
    );
  };

  return (
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">
          {offer.label} <span className="cb-offer-level tabular">Level {offer.level}</span>
        </h3>
      </div>
      <SegmentedControl
        ariaLabel={`Level ${offer.level} improvement`}
        value={route ?? ""}
        onChange={(next) => {
          if (next === "asi") {
            onSet(offer, [ASI_SHORTHAND]);
            setPickedSplit(null);
            onIncreases(offer, []);
          } else {
            onSet(offer, []);
            setPickedSplit(null);
          }
        }}
        options={[
          { value: "asi", label: "Raise ability scores" },
          { value: "feat", label: "Take a feat" }
        ]}
      />
      {route === "asi" && (
        <div className="cb-asi">
          <SegmentedControl
            size="sm"
            ariaLabel="How to split the increase"
            value={split ?? ""}
            onChange={changeSplit}
            options={[
              { value: "one", label: "+2 to one" },
              { value: "two", label: "+1 to two" }
            ]}
          />
          <div className="cb-asi-rows">
            {slots.map((chosen, index) => (
              <label key={index} className="cb-asi-row">
                <span className="cb-asi-label">+{amount} to</span>
                <Select
                  value={chosen}
                  aria-label={`Ability to raise by ${amount}`}
                  onChange={(event) => setAbility(index, event.target.value)}
                >
                  <option value="">Choose an ability…</option>
                  {ABILITIES.map((ability) => {
                    const total = projected(index, ability);
                    const noRoom = total != null && total > ABILITY_SCORE_CAP;
                    // The current pick stays selectable even when it no longer fits, so the control can let go of it;
                    // the step's blocked reason explains the rest.
                    return (
                      <option key={ability} value={ability} disabled={noRoom && ability !== chosen}>
                        {ABILITY_LABELS[ability]}
                        {total == null ? "" : ` — ${total}${noRoom ? ` (over ${ABILITY_SCORE_CAP})` : ""}`}
                      </option>
                    );
                  })}
                </Select>
              </label>
            ))}
          </div>
        </div>
      )}
      {route !== "asi" && (
        <ChoiceGrid
          ariaLabel={`Level ${offer.level} feat`}
          options={featOptions}
          /* Bounded like every other offer grid: a level-20 build can have five feat lists. */
          bounded
          searchable={featOptions.length > SEARCH_THRESHOLD}
          searchPlaceholder="Search feats…"
          value={route === "feat" ? (picks[0] ?? null) : null}
          onChange={(value) => onSet(offer, [value])}
        />
      )}
    </section>
  );
}

export function CharacterBuilder({
  state,
  sessionKey,
  connection = "online",
  onClose,
  onCreated,
  rebuild
}: CharacterBuilderProps) {
  const catalogs = useBuilderCatalogs();
  const { toast } = useToast();
  const policy = state.builderPolicy;
  const [draft, setDraft] = useState<BuilderDraft>(() => rebuild?.seed ?? emptyDraft());
  const [stepIndex, setStepIndex] = useState(0);
  /**
   * The furthest step the player has reached. A null blocked reason alone does not mean done (e.g.
   * equipment has no reason before a class is chosen), so ticks and jumps are gated on this.
   */
  const [furthest, setFurthest] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** The single submit-error surface, for both rejections and a silent server. */
  const [rejection, setRejection] = useState<{ title: string; text: string } | null>(null);
  const [resumable, setResumable] = useState<StoredDraft | null>(() => {
    // A rebuild starts from an existing character, so a parked create draft is never offered here.
    if (rebuild) return null;
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
  // GM-only: `PlayerView` has no sheet library, and its projected actor list could only under-count.
  const capacity = useMemo(
    () => ("definitions" in state ? rosterCapacity(state.definitions.length, state.actors.length) : null),
    [state]
  );

  /**
   * Keeps the draft consistent as the build changes shape (a Fighter's skills are not a Wizard's).
   * `draft.picks` is a required dependency: `prunePicks` mirrors the chosen subclass onto
   * `draft.subclassId`, which `computeOffers` reads to offer the subclass's own choices.
   */
  useEffect(() => {
    setDraft((current) => {
      const pruned = prunePicks(current, computeOffers(current, catalogs));
      return pruned === current ? current : pruned;
    });
  }, [draft.classId, draft.speciesId, draft.backgroundId, draft.level, draft.subclassId, draft.picks, catalogs]);

  // Park the draft on every change, except while an unanswered resume offer is on screen: saving then
  // would overwrite the draft the banner offers. Only Resume, Discard or Save & close answer it.
  useEffect(() => {
    if (resumable || rebuild) return;
    if (draftHasProgress(draft)) saveDraft(sessionKey, draft);
  }, [draft, sessionKey, resumable, rebuild]);

  // Server-thrown rolls arrive through the roll history (dice.roll acks with an id, not a total), so
  // the number the wizard uses is the one the table can see was rolled.
  const pendingRolls = useRef(new Map<string, (total: number) => void>());
  useEffect(() => {
    if (pendingRolls.current.size === 0) return;
    for (const record of state.rolls) {
      const apply = pendingRolls.current.get(record.id);
      if (apply) {
        pendingRolls.current.delete(record.id);
        apply(record.total);
      }
    }
    if (pendingRolls.current.size === 0) setRolling(false);
  }, [state.rolls]);

  const rollOnServer = (formula: string, label: string, apply: (total: number) => void) => {
    setRolling(true);
    // GM-only visibility, but still server-thrown and recorded in the roll history.
    socket.emit(
      "dice:roll",
      { commandId: newId(), formula, purpose: "manual", visibility: "gm-only", label },
      (result) => {
        if (!result.ok || !result.rollId) {
          setRolling(false);
          setRejection({ title: "That roll was rejected", text: result.message ?? "The table refused the roll." });
          return;
        }
        pendingRolls.current.set(result.rollId, apply);
      }
    );
  };

  /** Every player edit goes through here; the pruning effect does not. */
  const editDraft = (update: (current: BuilderDraft) => BuilderDraft) => setDraft(update);
  const patch = (change: Partial<BuilderDraft>) => editDraft((current) => ({ ...current, ...change }));
  const setPicks = (offer: BuilderOffer, ids: readonly string[]) =>
    editDraft((current) => ({ ...current, picks: { ...current.picks, [offer.key]: ids.slice(0, offer.capacity) } }));
  const setIncreases = (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) =>
    editDraft((current) => ({ ...current, asiIncreases: { ...current.asiIncreases, [offer.key]: increases } }));

  /** Every step's blocked reason, computed once per draft for the rail, review and footer. */
  const stepReasons = useMemo(
    () =>
      STEP_IDS.map((id) =>
        catalogs.loaded ? stepBlockedReason(id, draft, catalogs, offers, policy) : "Loading the content catalogs…"
      ),
    [draft, catalogs, offers, policy]
  );
  const stepReason = stepReasons[stepIndex];
  /** How far a resumed draft got: its first unsatisfied step. Earlier steps read as done. */
  const reachedIn = (resumed: BuilderDraft) => {
    const resumedOffers = computeOffers(resumed, catalogs);
    const first = STEP_IDS.findIndex((id) => stepBlockedReason(id, resumed, catalogs, resumedOffers, policy) !== null);
    return first === -1 ? STEP_IDS.length - 1 : first;
  };
  /** `.cb-page` is the scroll container, so a step change must reset its scrollTop. */
  const pageRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = 0;
  }, [stepIndex]);
  // A full or offline table blocks only once the character itself is finished.
  const reviewBlock =
    step !== "review"
      ? null
      : connection !== "online"
        ? "The table is offline — reconnecting…"
        : (capacity?.blockedReason ?? null);
  const blockedReason = stepReason ?? reviewBlock;
  /**
   * The rail's state machine:
   *   done(i)       ⟺  i <= furthest AND reasons[i] === null AND i !== current
   *   incomplete(i) ⟺  i <= furthest AND reasons[i] !== null AND i !== current
   *   clickable(i)  ⟺  i <= furthest AND i !== current      (via `maxSelectable`)
   * Beyond `furthest` `Steps` falls back to its position rule, so those read as upcoming and stay locked.
   */
  const stepsForShell: StepItem[] = STEP_IDS.map((id, index) => ({
    label: STEP_LABELS[id],
    shortLabel: STEP_SHORT[id],
    ...(index <= furthest && index !== stepIndex
      ? { state: stepReasons[index] === null ? ("done" as const) : ("incomplete" as const) }
      : {})
  }));

  /**
   * One commandId per attempt. It is also the created actor's id and the server's idempotency key,
   * so a retry after a dropped ack must resend the same id. A rejected command burns no receipt, so
   * the id stays good for the retry.
   */
  const attemptId = useRef<string | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (ackTimer.current !== null) clearTimeout(ackTimer.current);
    },
    []
  );

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
    try {
      payload = buildCreatePayload(draft, offers);
    } catch (error) {
      setSubmitting(false);
      setRejection({
        title: "The character is not complete yet",
        text: error instanceof Error ? error.message : "Something is still missing."
      });
      return;
    }
    attemptId.current ??= newId();
    const commandId = attemptId.current;
    // Bound the wait so a lost ack cannot leave Create spinning forever.
    if (ackTimer.current !== null) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => {
      ackTimer.current = null;
      setSubmitting(false);
      setRejection({
        title: "The table has not answered",
        text: "Press Create character again. It resends the same request, so it cannot make a second character."
      });
    }, CREATE_ACK_TIMEOUT_MS);
    if (rebuild) {
      // A rebuild keeps the live character's name (the server ignores any other), so it is not sent.
      const { name: _typed, ...rest } = payload;
      socket.emit("character:rebuild", { commandId, actorId: rebuild.actorId, ...rest }, (result) => {
        if (ackTimer.current !== null) {
          clearTimeout(ackTimer.current);
          ackTimer.current = null;
        }
        setSubmitting(false);
        if (!result.ok) {
          setRejection({
            title: "The server rejected this change",
            text: result.message ?? "That level change could not be applied."
          });
          return;
        }
        onCreated(rebuild.name);
        onClose();
      });
      return;
    }
    socket.emit("character:create", { commandId, ...payload }, (result) => {
      if (ackTimer.current !== null) {
        clearTimeout(ackTimer.current);
        ackTimer.current = null;
      }
      if (!result.ok) {
        setSubmitting(false);
        setRejection({
          title: "The server rejected this character",
          text: result.message ?? "The character could not be created."
        });
        return;
      }
      setPendingCreate({ actorId: result.actorId ?? commandId, typedName: payload.name });
    });
  };

  // The ack carries no name and the server renames clashes ("Borin 2"), so the name is read back from
  // the broadcast state, which normally lands before the ack. The timer covers a late broadcast.
  useEffect(() => {
    if (!pendingCreate) return;
    const created = (state.actors as ReadonlyArray<{ id: string; name: string }>).find(
      (actor) => actor.id === pendingCreate.actorId
    );
    if (created) {
      finishCreate(created.name);
      return;
    }
    const timer = setTimeout(() => finishCreate(pendingCreate.typedName), 2000);
    return () => clearTimeout(timer);
  }, [pendingCreate, state.actors]);

  /**
   * Focus the rejection banner and scroll it to mid-viewport: Create sits at the foot of a long
   * step, so the message would otherwise land out of view.
   */
  const rejectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = rejectionRef.current;
    if (!rejection || !node) return;
    // Only one step mounts the alert at a time, so the ref always points at the live one.
    node.focus({ preventScroll: true });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [rejection]);

  // Leaving answers a pending resume offer: this build takes the draft slot. The toast says where
  // the work went.
  const saveAndClose = () => {
    const saved = draftHasProgress(draft);
    if (saved) saveDraft(sessionKey, draft);
    onClose();
    if (saved) toast("Draft saved — resume it from Create a character.", { tone: "success" });
  };
  // Escape saves and closes like the header button; this is a full page, not a Modal.
  const saveAndCloseRef = useRef(saveAndClose);
  saveAndCloseRef.current = saveAndClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      /**
       * Unless a `<dialog>` (the spell-rules Modal) is open: Escape reaches this listener as a plain
       * keydown while the dialog handles it separately as `cancel`, so one press would close both.
       * The keydown fires before the dialog closes, so it can still be found here.
       */
      if (document.querySelector("dialog[open]")) return;
      saveAndCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ability scores
  const base = baseScoresOf(draft);
  const bonuses = abilityBonusesOf(draft, catalogs, offers);
  const allowedMethods = policy.allowedAbilityMethods.filter((method) => method !== "custom" || policy.customFormula);
  const method = allowedMethods.includes(draft.abilityMethod)
    ? draft.abilityMethod
    : (allowedMethods[0] ?? "standard-array");
  const rollFormula = method === "custom" ? (policy.customFormula ?? ABILITY_ROLL_FORMULA) : ABILITY_ROLL_FORMULA;
  const assignMode = isAssignMethod(method);
  // The server bound-checks manual scores against this formula (`validateBaseScores`), so the input
  // must not accept a value that would be rejected at Create.
  const rollBounds = useMemo(() => {
    const check = validateAbilityFormula(rollFormula);
    return check.ok
      ? { min: check.minimum, max: check.maximum }
      : { min: ABILITY_SCORE_MINIMUM, max: ABILITY_SCORE_MAXIMUM };
  }, [rollFormula]);

  /**
   * Switching method clears only what the new method owns: point buy leaves the pool alone and the
   * assign methods leave the point-buy spread alone. Roll -> standard array replaces the pool.
   */
  const setMethod = (next: string) => {
    const chosen = next as BuilderAbilityMethod;
    patch({
      abilityMethod: chosen,
      ...(isAssignMethod(chosen)
        ? {
            poolAssignment: {},
            abilityPool:
              chosen === "standard-array" ? STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })) : []
          }
        : {})
    });
  };
  // A parked draft can come back under a policy that no longer allows its method; write the
  // fallback into the draft. Keyed on the joined list because the filtered array is new every render.
  const allowedKey = allowedMethods.join(",");
  useEffect(() => {
    if (allowedMethods.length > 0 && !allowedMethods.includes(draft.abilityMethod)) setMethod(allowedMethods[0]);
  }, [allowedKey, draft.abilityMethod]);
  const addRolledScore = (total: number) =>
    editDraft((current) =>
      current.abilityPool.length >= 6
        ? current
        : {
            ...current,
            abilityPool: [...current.abilityPool, { id: `r-${current.abilityPool.length}-${total}`, value: total }]
          }
    );
  const rollAllScores = () => {
    const missing = 6 - draft.abilityPool.length;
    for (let index = 0; index < missing; index += 1)
      rollOnServer(rollFormula, `Ability score ${draft.abilityPool.length + index + 1}`, addRolledScore);
  };
  const addHpRoll = (total: number) =>
    editDraft((current) =>
      current.hpEntries.length >= current.level - 1 ? current : { ...current, hpEntries: [...current.hpEntries, total] }
    );
  const hitDie = (context.hitDie ?? "d8") as HitDie;
  const rollAllHp = () => {
    const missing = draft.level - 1 - draft.hpEntries.length;
    for (let index = 0; index < missing; index += 1)
      rollOnServer(`1d${hitDieFaces(hitDie)}`, `Hit points, level ${draft.hpEntries.length + index + 2}`, addHpRoll);
  };

  const allocatorRows = ABILITIES.map((ability) => {
    const score = base[ability];
    const bonus = bonuses[ability];
    const total = score == null ? null : score + bonus;
    return {
      id: ability,
      label: ABILITY_LABELS[ability],
      abbr: ability.toUpperCase(),
      score,
      bonus,
      total,
      modifier: total == null ? null : abilityModifier(total),
      min: POINT_BUY_MINIMUM,
      max: POINT_BUY_MAXIMUM
    };
  });

  // Name suggestions
  const suggestions = useMemo(() => {
    const bundle = catalogs.names.find((entry) => entry.speciesId === draft.speciesId);
    if (!bundle) return [];
    const surnames = bundle.pools.filter((pool) => /-(family|clan)$/.test(pool.id)).flatMap((pool) => pool.names);
    const givens = bundle.pools.filter((pool) => !/-(family|clan)$/.test(pool.id)).flatMap((pool) => pool.names);
    if (givens.length === 0) return [];
    const draw = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
    // Distinct: a small pool can repeat a name, and the list keys on the name.
    const batch = new Set<string>();
    for (let attempt = 0; attempt < 40 && batch.size < 5; attempt += 1) {
      batch.add(surnames.length > 0 ? `${draw(givens)} ${draw(surnames)}` : String(draw(givens)));
    }
    return [...batch];
    // `nameSeed` re-draws the batch when the shuffle button is pressed.
  }, [catalogs.names, draft.speciesId, nameSeed]);

  // Step bodies
  /**
   * Species, Background and Class get the same `.cb-offer` shell and heading as every other decision.
   * Choose-one, so no count (keep in step with `OfferPicker`).
   */
  const primaryPick = (label: string, grid: ReactNode): ReactNode => (
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">{label}</h3>
      </div>
      {grid}
    </section>
  );

  /**
   * Below the class's subclass level there is no subclass offer, so the step body (not the detail
   * pane, which is hidden on narrow screens) says when the subclass arrives.
   */
  const subclassPending =
    context.classRecord && draft.level < context.classRecord.subclassLevel
      ? {
          label: context.classRecord.subclassLabel?.toLowerCase() ?? "subclass",
          level: context.classRecord.subclassLevel
        }
      : null;

  const stepOffers = (owner: BuilderOffer["step"]) => offers.filter((offer) => offer.step === owner);
  const renderOffer = (offer: BuilderOffer) =>
    offer.kind === "asi-or-feat" ? (
      <AsiOffer
        key={offer.key}
        offer={offer}
        draft={draft}
        catalogs={catalogs}
        capBefore={abilityCap.before.get(offer.key) ?? null}
        onSet={setPicks}
        onIncreases={setIncreases}
      />
    ) : (
      <OfferPicker key={offer.key} offer={offer} draft={draft} catalogs={catalogs} onSet={setPicks} />
    );

  /**
   * The species feat pick that the background's origin feat displaced. The granted feat is dropped
   * from the species list and a pick already made there is pruned, so it is named here.
   */
  const displacedSpeciesFeat = context.originFeat
    ? stepOffers("species").find((offer) => FEAT_KINDS.has(offer.kind) && !offerFilled(offer, draft))
    : undefined;

  /* No `facet`: `ChoiceGrid` only reads it alongside `facets`, and there is one source. */
  const speciesOptions: ChoiceOption[] = catalogs.choice.species.map((entry) => ({
    value: entry.id,
    title: entry.name,
    description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: `${entry.speedFeet} ft.${entry.darkvisionFeet ? ` · darkvision ${entry.darkvisionFeet} ft.` : ""}`,
    keywords: `${entry.creatureType} ${entry.languages.join(" ")}`
  }));
  const backgroundOptions: ChoiceOption[] = catalogs.backgrounds.map((entry) => ({
    value: entry.id,
    title: entry.name,
    description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: entry.abilityOptions
      ? entry.abilityOptions.from.map((ability) => ability.toUpperCase()).join(" / ")
      : undefined,
    keywords: entry.skillProficiencies.join(" ")
  }));
  const classOptions: ChoiceOption[] = catalogs.choice.classes.map((entry) => ({
    value: entry.id,
    title: entry.name,
    description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: `${entry.hitDie} · ${entry.savingThrows.map((ability) => ability.toUpperCase()).join("/")}${entry.spellcasting ? ` · ${entry.spellcasting.ability.toUpperCase()} caster` : ""}`,
    keywords: entry.primaryAbilities.join(" ")
  }));

  /* One failure surface, shown on the two steps that can produce one: a refused roll on the ability
     step, a refused create on the review step. */
  const problemAlert = rejection ? (
    <div ref={rejectionRef} tabIndex={-1} className="cb-rejection">
      <Alert tone="danger" title={rejection.title}>
        {rejection.text}
      </Alert>
    </div>
  ) : null;

  const body = (): ReactNode => {
    switch (step) {
      case "species":
        return (
          <>
            {primaryPick(
              "Species",
              <ChoiceGrid
                ariaLabel="Species"
                options={speciesOptions}
                value={draft.speciesId}
                onChange={(value) => patch({ speciesId: value })}
                searchable={speciesOptions.length > 8}
                searchPlaceholder="Search species…"
              />
            )}
            {stepOffers("species").map(renderOffer)}
          </>
        );
      case "background":
        return (
          <>
            {primaryPick(
              "Background",
              <ChoiceGrid
                ariaLabel="Backgrounds"
                options={backgroundOptions}
                value={draft.backgroundId}
                onChange={(value) => patch({ backgroundId: value })}
                searchable={backgroundOptions.length > 8}
                searchPlaceholder="Search backgrounds…"
              />
            )}
            {context.originFeat && (
              <p className="cb-note">
                {context.background?.name} grants the <strong>{context.originFeat.name}</strong> feat.
              </p>
            )}
            {displacedSpeciesFeat && (
              <p className="cb-note">
                {context.background?.name} grants <strong>{context.originFeat!.name}</strong>, which replaces your{" "}
                {displacedSpeciesFeat.label} choice — pick a different Origin feat on Species.
              </p>
            )}
            {stepOffers("background").map(renderOffer)}
          </>
        );
      case "class":
        return (
          <>
            {primaryPick(
              "Class",
              <ChoiceGrid
                ariaLabel="Classes"
                options={classOptions}
                value={draft.classId}
                onChange={(value) => patch({ classId: value })}
                searchable={classOptions.length > 8}
                searchPlaceholder="Search classes…"
              />
            )}
            <section className="cb-offer">
              <div className="cb-offer-head">
                {/* The Stepper below is the readout. */}
                <h3 className="cb-offer-title">Level</h3>
              </div>
              <p className="cb-offer-help">
                {policy.maxLevel < 20
                  ? `Your GM has set the party's level cap to ${policy.maxLevel}.`
                  : "Your GM grants the level; every choice it opens is yours to make."}
              </p>
              {/* The cap is the control's maximum, so it cannot be typed past. */}
              <Stepper
                value={Math.min(draft.level, policy.maxLevel)}
                min={1}
                max={policy.maxLevel}
                aria-label="Character level"
                onChange={(level) => patch({ level, hpEntries: draft.hpEntries.slice(0, Math.max(0, level - 1)) })}
              />
              {draft.level >= policy.maxLevel && (
                <p className="cb-note">At the table&rsquo;s level cap ({policy.maxLevel}).</p>
              )}
            </section>
            {stepOffers("class").map(renderOffer)}
          </>
        );
      case "features":
        return (
          <>
            {subclassPending && (
              <p className="cb-note">
                You choose a {subclassPending.label} at level {subclassPending.level}.
              </p>
            )}
            {stepOffers("features").length === 0 ? (
              <div className="nh-empty">
                <span className="nh-empty-title">Nothing to choose yet</span>
                <span className="nh-empty-text">
                  This class asks for no decisions at level {draft.level}. Carry on.
                </span>
              </div>
            ) : (
              stepOffers("features").map(renderOffer)
            )}
          </>
        );
      case "abilities": {
        const spent = pointBuySpent(draft);
        const options = context.background?.abilityOptions ?? null;
        return (
          <>
            {problemAlert}
            {/* What this class wants from the six scores about to be assigned. */}
            {context.classRecord && (
              <p className="cb-note tabular">
                {context.classRecord.name} · {context.classRecord.hitDie} ·{" "}
                {context.classRecord.savingThrows.map((ability) => ability.toUpperCase()).join("/")}
                {context.classRecord.primaryAbilities.length > 0 &&
                  ` · primary ${context.classRecord.primaryAbilities.map((ability) => ability.toUpperCase()).join(", ")}`}
              </p>
            )}
            <AbilityScoreAllocator
              mode={assignMode ? "assign" : "spend"}
              rows={allocatorRows}
              methods={allowedMethods.map((entry) => ({ value: entry, label: METHOD_LABELS[entry] }))}
              method={method}
              onMethodChange={setMethod}
              methodHint={
                method === "custom"
                  ? `Your GM's formula: ${policy.customFormula}`
                  : method === "roll"
                    ? `Rolled with ${ABILITY_ROLL_FORMULA}.`
                    : method === "point-buy"
                      ? `Spend ${POINT_BUY_BUDGET} points across scores 8-15.`
                      : `Assign ${STANDARD_ARRAY.join(", ")}, one each.`
              }
              pool={
                assignMode
                  ? draft.abilityPool.map((entry) => ({
                      id: entry.id,
                      value: entry.value,
                      assignedTo: ABILITIES.find((ability) => draft.poolAssignment[ability] === entry.id) ?? null
                    }))
                  : undefined
              }
              onAssign={
                assignMode
                  ? (abilityId, poolId) =>
                      editDraft((current) => {
                        const cleared = Object.fromEntries(
                          Object.entries(current.poolAssignment).map(([key, value]) => [
                            key,
                            value === poolId ? null : value
                          ])
                        );
                        return { ...current, poolAssignment: { ...cleared, [abilityId]: poolId } };
                      })
                  : undefined
              }
              onScoreChange={
                assignMode
                  ? undefined
                  : (abilityId, score) => patch({ spendScores: { ...draft.spendScores, [abilityId]: score } })
              }
              budget={assignMode ? undefined : { spent, total: POINT_BUY_BUDGET }}
              toolbar={
                assignMode && method !== "standard-array" ? (
                  <DiceInputRow
                    label={`Ability scores (${draft.abilityPool.length} of 6)`}
                    notation={rollFormula}
                    mode={abilityEntry}
                    onModeChange={setAbilityEntry}
                    rollLabel="Roll the rest for me"
                    onRoll={rollAllScores}
                    onManual={addRolledScore}
                    onReroll={
                      draft.abilityPool.length > 0 ? () => patch({ abilityPool: [], poolAssignment: {} }) : undefined
                    }
                    result={
                      draft.abilityPool.length > 0
                        ? draft.abilityPool.map((entry) => entry.value).join(", ")
                        : undefined
                    }
                    min={rollBounds.min}
                    max={rollBounds.max}
                    busy={rolling}
                    complete={draft.abilityPool.length >= 6}
                    hint={`Roll them here, or type what your own dice showed (${rollBounds.min}-${rollBounds.max}).`}
                  />
                ) : undefined
              }
            />

            {options && (
              <section className="cb-offer">
                <div className="cb-offer-head">
                  {/* The SegmentedControl and the Selects below are the readout. */}
                  <h3 className="cb-offer-title">{context.background?.name} ability increases</h3>
                </div>
                <SegmentedControl
                  ariaLabel="Ability increase spread"
                  value={draft.backgroundBonus.length === 3 ? "1/1/1" : draft.backgroundBonus.length === 2 ? "2/1" : ""}
                  onChange={(next) =>
                    patch({
                      backgroundBonus:
                        next === "2/1"
                          ? [
                              { ability: options.from[0] as Ability, amount: 2 },
                              { ability: options.from[1] as Ability, amount: 1 }
                            ]
                          : options.from.slice(0, 3).map((ability) => ({ ability: ability as Ability, amount: 1 }))
                    })
                  }
                  options={options.spreads.map((legal) => ({
                    value: legal.join("/"),
                    label: `+${legal.join(" / +")}`
                  }))}
                />
                <div className="cb-asi-rows">
                  {draft.backgroundBonus.map((entry, index) => (
                    <label key={index} className="cb-asi-row">
                      <span className="cb-asi-label">+{entry.amount} to</span>
                      <Select
                        value={entry.ability}
                        aria-label={`Ability to raise by ${entry.amount}`}
                        onChange={(event) =>
                          patch({
                            backgroundBonus: draft.backgroundBonus.map((row, position) =>
                              position === index ? { ...row, ability: event.target.value as Ability } : row
                            )
                          })
                        }
                      >
                        {options.from.map((ability) => (
                          <option key={ability} value={ability}>
                            {ABILITY_LABELS[ability as Ability]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="cb-offer">
              <div className="cb-offer-head">
                <h3 className="cb-offer-title">Hit points</h3>
                {/* The hit die and CON modifier that decide the hit points about to be rolled. */}
                <span className="cb-offer-count tabular" role="status">
                  {hitDie} · CON{" "}
                  {base.con == null
                    ? "—"
                    : abilityModifier(base.con + bonuses.con) >= 0
                      ? `+${abilityModifier(base.con + bonuses.con)}`
                      : abilityModifier(base.con + bonuses.con)}
                </span>
              </div>
              {/* The same "max-of-both" rule `character-build.ts` applies, said in table terms. */}
              <p className="cb-offer-help">
                Level 1 is always the full die. From level 2 up, take the average or roll — a roll below the average is
                topped up to it, so rolling can only help. Rolled HP is remembered — leveling down and back up restores
                it.
              </p>
              <SegmentedControl
                ariaLabel="How to gain hit points"
                value={draft.hpMode}
                onChange={(next) => patch({ hpMode: next as "average" | "entries", hpEntries: [] })}
                options={[
                  { value: "average", label: `Take the average (${hitDieAverage(hitDie)}/level)` },
                  { value: "entries", label: "Roll each level" }
                ]}
              />
              {draft.hpMode === "entries" &&
                (draft.level === 1 ? (
                  <p className="cb-note">A level 1 character rolls nothing — your hit points are the full {hitDie}.</p>
                ) : (
                  <DiceInputRow
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
                  />
                ))}
            </section>
          </>
        );
      }
      case "equipment":
        return stepOffers("equipment").length === 0 ? (
          <div className="nh-empty">
            <span className="nh-empty-title">No starting equipment</span>
            <span className="nh-empty-text">Neither this class nor this background prints a starting kit.</span>
          </div>
        ) : (
          <>{stepOffers("equipment").map(renderOffer)}</>
        );
      case "review":
        return (
          <>
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
            {/* Caution, not danger: the table still has room. */}
            {capacity?.warning && (
              <Alert tone="warning" title="The table is filling up">
                {capacity.warning}
              </Alert>
            )}
            {problemAlert}
            <ReviewSummary sections={reviewSections()} />
          </>
        );
      default:
        return null;
    }
  };

  function pickedNames(offer: BuilderOffer): string {
    const picks = draft.picks[offer.key] ?? [];
    if (picks.length === 0) return "—";
    // The full ability name, matching the "Strength / 17" row above.
    return picks
      .map((id) =>
        id === ASI_SHORTHAND
          ? (draft.asiIncreases[offer.key] ?? [])
              .map((entry) => `+${entry.amount} ${ABILITY_LABELS[entry.ability]}`)
              .join(", ")
          : (offer.options.find((option) => option.id === id)?.name ?? titleize(id))
      )
      .join(", ");
  }

  function sectionFor(id: StepId, owner: BuilderOffer["step"] | null, items: ReviewSection["items"]): ReviewSection {
    // Stamp the level as the footer does: several ASI decisions would otherwise share one label.
    const siblings = owner ? stepOffers(owner) : [];
    const extra = siblings.map((offer) => ({
      label:
        siblings.filter((other) => other.label === offer.label).length > 1
          ? `${offer.label} (level ${offer.level})`
          : offer.label,
      value: pickedNames(offer)
    }));
    const reason = catalogs.loaded ? stepReasons[STEP_IDS.indexOf(id)] : null;
    return {
      id,
      title: STEP_LABELS[id],
      items: [...items, ...extra],
      onEdit: () => {
        setStepIndex(STEP_IDS.indexOf(id));
        setRejection(null);
      },
      ...(reason ? { incomplete: reason } : {})
    };
  }

  function reviewSections(): ReviewSection[] {
    const scoreItems = ABILITIES.map((ability) => {
      const total = base[ability] == null ? null : base[ability]! + bonuses[ability];
      const modifier = total == null ? null : abilityModifier(total);
      return {
        label: ABILITY_LABELS[ability],
        // The modifier is what the player rolls with, so show it beside the score.
        value:
          total == null
            ? "—"
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
      /* No separate subclass item: the subclass is a feature offer, so `sectionFor` already emits it. */
      sectionFor("features", "features", []),
      sectionFor("abilities", null, [
        ...scoreItems,
        { label: "Method", value: METHOD_LABELS[method] },
        {
          label: "Hit points",
          value:
            draft.hpMode === "average"
              ? "Average each level"
              : draft.hpEntries.length > 0
                ? `Rolled ${draft.hpEntries.join(", ")}`
                : "Rolled (none entered)"
        }
      ]),
      sectionFor("equipment", "equipment", [])
    ];
  }

  const detail = (): ReactNode => {
    if (step === "species" && context.species) {
      return (
        <>
          <p>{context.species.description ?? context.species.summary}</p>
          <FeatureList
            items={featureItems(context.species.features)}
            allowExpandAll={context.species.features.length > 6}
            ariaLabel={`${context.species.name} traits`}
          />
        </>
      );
    }
    if (step === "background" && context.background) {
      return (
        <>
          <p>{context.background.description ?? context.background.summary}</p>
          <p className="tabular">Skills: {context.background.skillProficiencies.map(titleize).join(", ") || "—"}</p>
        </>
      );
    }
    if (step === "class" && context.classRecord) {
      return (
        <>
          <p>{context.classRecord.description ?? context.classRecord.summary}</p>
          <p className="tabular">
            Hit die {context.classRecord.hitDie} · saves{" "}
            {context.classRecord.savingThrows.map((ability) => ability.toUpperCase()).join(", ")}
          </p>
          {/* "—" for absent, matching every review row and allocator cell. */}
          <p className="tabular">
            Armor: {context.classRecord.armorProficiencies.join(", ") || "—"} · weapons:{" "}
            {context.classRecord.weaponProficiencies.join(", ") || "—"}
          </p>
          <FeatureList
            items={featureItems(context.classRecord.features.filter((feature) => (feature.level ?? 1) <= draft.level))}
            allowExpandAll
            ariaLabel={`${context.classRecord.name} features`}
          />
        </>
      );
    }
    if (step === "features" && context.subclass) {
      return (
        <>
          <p>{context.subclass.description ?? context.subclass.summary}</p>
          <FeatureList
            items={featureItems(context.subclass.features)}
            ariaLabel={`${context.subclass.name} features`}
          />
        </>
      );
    }
    return null;
  };

  /** What the reserved detail column says while it has nothing to show. */
  const DETAIL_PLACEHOLDER: Partial<Record<StepId, string>> = {
    species: "Pick a species to read its traits here.",
    background: "Pick a background to read about it here.",
    class: "Pick a class to read about it here.",
    /* Reserve the features pane only when a subclass can be picked; below the subclass level the step
       body says so and keeps the full width. */
    ...(subclassPending
      ? {}
      : {
          features: context.classRecord?.subclassLabel
            ? `Pick a ${context.classRecord.subclassLabel.toLowerCase()} to read about it here.`
            : "Pick a subclass to read about it here."
        })
  };

  /**
   * The detail column is reserved for the whole of any step that can fill it, so a pick does not
   * reflow the grid from five columns to three under the finger. Do not pass null until a pick: the
   * reflow on large grids is the cost this avoids.
   */
  const realDetail = detail();
  const placeholder = DETAIL_PLACEHOLDER[step];
  const detailNode = realDetail ?? (placeholder ? <p className="cb-detail-empty">{placeholder}</p> : null);
  const isLast = stepIndex === STEP_IDS.length - 1;
  const goTo = (index: number) => {
    setStepIndex(index);
    setDetailOpen(false);
  };
  /**
   * A blocked reason may name a control on another step (an improvement chosen on Class features
   * can break the 20 cap), so offer the way there.
   */
  const breachOffer =
    step === "abilities" && stepReason === abilityCap.breach?.reason ? abilityCap.breach.offerKey : null;
  const reasonNode: ReactNode =
    blockedReason == null ? undefined : breachOffer ? (
      <>
        {blockedReason}{" "}
        <Button variant="ghost" size="sm" onClick={() => goTo(STEP_IDS.indexOf("features"))}>
          Edit that improvement
        </Button>
      </>
    ) : (
      blockedReason
    );
  const resumed = resumable?.draft;
  const resumedNames = resumed
    ? [
        resumed.name.trim() || null,
        catalogs.choice.species.find((entry) => entry.id === resumed.speciesId)?.name ?? null,
        resumed.classId
          ? `${catalogs.choice.classes.find((entry) => entry.id === resumed.classId)?.name ?? titleize(resumed.classId)} ${resumed.level}`
          : null
      ].filter((part): part is string => part !== null)
    : [];

  return (
    <div className="cb-page" ref={pageRef}>
      <WizardShell
        title={rebuild ? `Level ${rebuild.name}` : "Create a character"}
        eyebrow="Character builder"
        steps={stepsForShell}
        current={stepIndex}
        /* Every reached step stays reachable, finished or not; steps past the frontier stay locked. */
        onStepSelect={(index) => {
          if (index <= furthest && index !== stepIndex) goTo(index);
        }}
        maxSelectable={furthest}
        onBack={stepIndex > 0 ? () => goTo(stepIndex - 1) : undefined}
        /* After reaching the end, an edit from review is a detour: one tap returns. */
        footerSecondary={
          furthest === STEP_IDS.length - 1 && stepIndex < furthest ? (
            <Button variant="secondary" onClick={() => goTo(STEP_IDS.length - 1)}>
              Back to review
            </Button>
          ) : undefined
        }
        onNext={() => {
          if (isLast) submit();
          else {
            setFurthest((reached) => Math.max(reached, stepIndex + 1));
            goTo(stepIndex + 1);
          }
        }}
        nextLabel={isLast ? (rebuild ? `Apply level ${draft.level}` : "Create character") : "Next"}
        blockedReason={reasonNode}
        busy={submitting}
        /* The one way out: the draft is already parked, so no "leave without saving" exit. Discarding
         lives on the resume banner. */
        onSaveAndClose={saveAndClose}
        resume={
          resumable ? (
            <Alert tone="info" title="Unfinished character found">
              {/* The stored record has identity fields and a timestamp but no step, so none is promised. */}
              {resumedNames.length > 0 ? (
                <>
                  You started <strong>{resumedNames.join(" · ")}</strong> on this device{" "}
                  {describeWhen(resumable.updatedAt)}.
                </>
              ) : (
                <>You started a character on this device {describeWhen(resumable.updatedAt)}.</>
              )}{" "}
              It stays exactly as you left it until you answer — resume it, or discard it to save the one you build now.{" "}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft(resumable.draft);
                  setFurthest(reachedIn(resumable.draft));
                  setResumable(null);
                }}
              >
                Resume it
              </Button>
              {/* The one action here that destroys work. */}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  clearDraft(sessionKey);
                  setResumable(null);
                  attemptId.current = null;
                }}
              >
                Discard it
              </Button>
            </Alert>
          ) : undefined
        }
        detail={detailNode}
        detailTitle={
          step === "species"
            ? context.species?.name
            : step === "background"
              ? context.background?.name
              : step === "class"
                ? context.classRecord?.name
                : context.subclass?.name
        }
        detailOpen={detailOpen}
        /* Real content only: below 760px this button leaves the step. */
        onOpenDetail={realDetail ? () => setDetailOpen(true) : undefined}
        detailOpenLabel="Show details"
        onCloseDetail={realDetail ? () => setDetailOpen(false) : undefined}
        footnote={
          catalogs.attributions.length > 0
            ? catalogs.attributions.join(" ")
            : "Character content is served with its licence line; the catalogs have not loaded yet."
        }
      >
        <div className="cb-step">
          {!catalogs.loaded && (
            <p className="cb-note" role="status">
              Loading the character catalogs…
            </p>
          )}
          {rebuild?.notice}
          {body()}
        </div>
      </WizardShell>
    </div>
  );
}
