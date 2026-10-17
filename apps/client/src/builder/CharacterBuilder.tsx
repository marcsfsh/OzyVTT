import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BuilderAbilityMethod, BuilderOffer, GmView, PlayerView } from "@vtt/domain";
import type { Ability } from "@vtt/rules-5e";
import { Alert, Button, Field, NameField, ReviewSummary, Select, Stepper, useToast, WizardShell } from "@vtt/ui";
import type { DiceEntryMode, StepItem } from "@vtt/ui";
import { useBuilderCatalogs, type BuilderCatalogs } from "../content/catalogs";
import { command } from "../lib/command";
import { newId } from "../lib/ids";
import {
  AbilitiesStep,
  abilityMethodOf,
  allowedMethodsOf,
  HitPointsSection,
  methodChange,
  useServerRolls
} from "./AbilitiesStep";
import {
  abilityBonusesOf,
  abilityCapPreview,
  baseScoresOf,
  buildCreatePayload,
  draftClassesOf,
  emptyDraft,
  FEAT_KINDS,
  levelsLeft,
  MAX_CLASSES,
  offerContext,
  offerFilled,
  offersRequestOf,
  rosterCapacity,
  STEP_IDS,
  STEP_LABELS,
  STEP_SHORT,
  stepBlockedReason,
  titleize,
  withAnswersFrom,
  withClassAdded,
  withClassLevels,
  withoutClass,
  withStartingClass,
  type BuilderDraft,
  type StepId
} from "./build-payload";
import { describeWhen, discardDraft, draftHasProgress, loadDraft, saveDraft, type StoredDraft } from "./draft";
import {
  AsiOffer,
  backgroundOptionsOf,
  classOptionsOf,
  OfferPicker,
  PrimaryPick,
  speciesOptionsOf
} from "./OfferPickers";
import { LevelStep } from "./LevelStep";
import { reviewSections } from "./review";
import { detailPlaceholder, stepDetail } from "./StepDetail";
import { useBuilderOffers } from "./useBuilderOffers";
import "./character-builder.css";
import { withArticle } from "@vtt/domain";

/**
 * The guided character-creation wizard: a full page on a laptop, a full-screen sheet on a phone.
 *
 * It renders the picks the server says the content asks for (`builder:offers`, asked again after every
 * answer) and submits one `character.create` carrying the ledger rows the server made from them. It
 * computes no game outcome: HP, AC, slots and riders are assembled server-side, and a rejection comes
 * back as the server's message on the review step.
 */

type BuilderState = GmView | PlayerView;

export type CharacterBuilderProps = Readonly<{
  state: BuilderState;
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
  rebuild?: Readonly<{
    actorId: string;
    name: string;
    seed: BuilderDraft;
    /** The method the character's scores were made with, kept even if the table no longer offers it. */
    recordedMethod?: BuilderAbilityMethod;
    /** The classes the character keeps at the rebuilt level. The table refuses a rebuild that drops one (only a
     *  level-down below where it was taken does), so the class step offers no way to remove them. */
    heldClasses?: readonly string[];
    /** Up opens on a step of the new level's choices; down opens on the review. */
    mode?: "up" | "down";
    notice?: ReactNode;
  }>;
}>;

/** The builder's steps, and in a level-up the step that gathers the new level's choices before the review. */
type WizardStep = StepId | "level";

/** Before the table's first answer there is nothing to pick. */
const NO_OFFERS: readonly BuilderOffer[] = [];

/** A species' given names and family names, drawn into five distinct suggestions. */
function nameSuggestions(names: BuilderCatalogs["names"], speciesId: string | null): readonly string[] {
  const bundle = names.find((entry) => entry.speciesId === speciesId);
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
}

export function CharacterBuilder({ state, connection = "online", onClose, onCreated, rebuild }: CharacterBuilderProps) {
  const catalogs = useBuilderCatalogs();
  const { toast } = useToast();
  // A rebuild keeps the method its scores were made with, though the table may offer others today.
  const recordedMethod = rebuild?.recordedMethod;
  const policy = useMemo(
    () =>
      recordedMethod && !state.builderPolicy.allowedAbilityMethods.includes(recordedMethod)
        ? {
            ...state.builderPolicy,
            allowedAbilityMethods: [...state.builderPolicy.allowedAbilityMethods, recordedMethod]
          }
        : state.builderPolicy,
    [state.builderPolicy, recordedMethod]
  );
  const [draft, setDraft] = useState<BuilderDraft>(() => rebuild?.seed ?? emptyDraft());
  // A level-up opens on the new level's choices, with every earlier step answered and a tap away; it does not walk
  // the steps from Species again.
  const steps: readonly WizardStep[] = useMemo(
    () => (rebuild?.mode === "up" ? [...STEP_IDS.slice(0, -1), "level", "review"] : STEP_IDS),
    [rebuild?.mode]
  );
  const openingStep = rebuild?.mode === "up" ? steps.indexOf("level") : rebuild?.mode === "down" ? steps.length - 1 : 0;
  const [stepIndex, setStepIndex] = useState(openingStep);
  /**
   * The furthest step the player has reached. A null blocked reason alone does not mean done (e.g.
   * equipment has no reason before a class is chosen), so ticks and jumps are gated on this. A level change starts
   * with every step reached.
   */
  const [furthest, setFurthest] = useState(rebuild?.mode ? steps.length - 1 : 0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** The single submit-error surface, for both rejections and a silent server. */
  const [rejection, setRejection] = useState<{ title: string; text: string } | null>(null);
  const [resumable, setResumable] = useState<StoredDraft | null>(null);
  /** Whether the table has said if a draft is parked. Nothing is saved before then, so a build begun in the first
   *  moment never overwrites the one the banner is about to offer. A rebuild never offers one. */
  const [draftChecked, setDraftChecked] = useState(Boolean(rebuild));
  useEffect(() => {
    if (rebuild) return;
    let live = true;
    void loadDraft().then((stored) => {
      if (!live) return;
      if (stored && draftHasProgress(stored.draft)) setResumable(stored);
      setDraftChecked(true);
    });
    return () => {
      live = false;
    };
  }, [rebuild]);
  const [abilityEntry, setAbilityEntry] = useState<DiceEntryMode>("auto");
  const [hpEntry, setHpEntry] = useState<DiceEntryMode>("auto");

  const [pendingCreate, setPendingCreate] = useState<{ actorId: string; typedName: string } | null>(null);

  const step: WizardStep = steps[stepIndex];
  /**
   * The offers come from the table, asked again after each answer. Until the next answer lands the last
   * offers stay on screen with the new pick already shown, so a tap never waits on the network.
   */
  const {
    reply: offersReply,
    current: offersCurrent,
    refusal: offersRefusal
  } = useBuilderOffers(offersRequestOf(draft));
  const offers = offersReply?.offers ?? NO_OFFERS;
  const context = useMemo(() => offerContext(draft, catalogs), [draft, catalogs]);
  const abilityCap = useMemo(() => abilityCapPreview(draft, catalogs, offers), [draft, catalogs, offers]);
  // GM-only: `PlayerView` has no sheet library, and its projected actor list could only under-count.
  const capacity = useMemo(
    () => ("definitions" in state ? rosterCapacity(state.definitions.length, state.actors.length) : null),
    [state]
  );

  /**
   * Keeps the draft to what the build still offers as it changes shape (a Fighter's skills are not a
   * Wizard's): the table's answer drops picks it no longer takes and names the subclass. Only an answer to
   * this very draft is adopted.
   */
  useEffect(() => {
    if (!offersReply || !offersCurrent) return;
    setDraft((current) => withAnswersFrom(current, offersReply));
  }, [offersReply, offersCurrent]);

  // Park the draft as it changes, once a burst of picks settles, except while an unanswered resume offer is on
  // screen: saving then would overwrite the draft the banner offers. Only Resume, Discard or Save & close answer it.
  // Leaving the page sends what the pause was still holding.
  const unsaved = useRef<BuilderDraft | null>(null);
  useEffect(() => {
    if (!draftChecked || resumable || rebuild || !draftHasProgress(draft)) return;
    unsaved.current = draft;
    const timer = window.setTimeout(() => {
      unsaved.current = null;
      saveDraft(draft);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, draftChecked, resumable, rebuild]);
  useEffect(
    () => () => {
      if (unsaved.current) saveDraft(unsaved.current);
    },
    []
  );

  const rolls = useServerRolls(state.rolls, (text) => setRejection({ title: "That roll was rejected", text }));

  /** Every player edit goes through here; the pruning effect does not. */
  const editDraft = (update: (current: BuilderDraft) => BuilderDraft) => setDraft(update);
  const patch = (change: Partial<BuilderDraft>) => editDraft((current) => ({ ...current, ...change }));
  // A subclass answer shows its detail at once; the table's answer confirms it. Only the starting class's subclass is
  // the draft's `subclassId`; a later class's stays its own pick.
  const setPicks = (offer: BuilderOffer, ids: readonly string[]) =>
    editDraft((current) => ({
      ...current,
      picks: { ...current.picks, [offer.key]: ids.slice(0, offer.capacity) },
      ...(offer.kind === "subclass" && (offer.classId ?? current.classId) === current.classId
        ? { subclassId: ids[0] ?? null }
        : {})
    }));
  const setIncreases = (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) =>
    editDraft((current) => ({ ...current, asiIncreases: { ...current.asiIncreases, [offer.key]: increases } }));

  /** Every step's blocked reason, computed once per draft for the rail, review and footer. */
  const stepReasons = useMemo(() => {
    const reasonOf = (id: StepId) =>
      catalogs.loaded ? stepBlockedReason(id, draft, catalogs, offers, policy) : "Loading the content catalogs…";
    // The level step holds the class, features and hit point answers, so it waits on whatever those wait on.
    return steps.map((id) =>
      id === "level" ? (reasonOf("class") ?? reasonOf("features") ?? reasonOf("abilities")) : reasonOf(id)
    );
  }, [steps, draft, catalogs, offers, policy]);
  const stepReason = stepReasons[stepIndex];
  /** A resumed draft reaches its first unsatisfied step, read once the table has answered for it. */
  const [resuming, setResuming] = useState(false);
  useEffect(() => {
    if (!resuming || !offersCurrent || !catalogs.loaded) return;
    const first = stepReasons.findIndex((reason) => reason !== null);
    setFurthest(first === -1 ? steps.length - 1 : first);
    setResuming(false);
  }, [resuming, offersCurrent, catalogs.loaded, stepReasons, steps.length]);
  /** `.cb-page` is the scroll container, so a step change must reset its scrollTop. */
  const pageRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = 0;
  }, [stepIndex]);
  // A full or offline table blocks only once the character itself is finished, and Create waits for the
  // table's answer to this exact draft, since it sends the ledger rows that answer made.
  const reviewBlock =
    step !== "review"
      ? null
      : connection !== "online"
        ? "The table is offline — reconnecting…"
        : (offersRefusal ??
          (offersCurrent ? null : "Checking these choices with the table…") ??
          capacity?.blockedReason ??
          null);
  const blockedReason = stepReason ?? reviewBlock;
  /**
   * The rail's state machine:
   *   done(i)       ⟺  i <= furthest AND reasons[i] === null AND i !== current
   *   incomplete(i) ⟺  i <= furthest AND reasons[i] !== null AND i !== current
   *   clickable(i)  ⟺  i <= furthest AND i !== current      (via `maxSelectable`)
   * Beyond `furthest` `Steps` falls back to its position rule, so those read as upcoming and stay locked.
   */
  const stepsForShell: StepItem[] = steps.map((id, index) => ({
    label: id === "level" ? `Level ${draft.level}` : STEP_LABELS[id],
    shortLabel: id === "level" ? `Level ${draft.level}` : STEP_SHORT[id],
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

  const finishCreate = useEffectEvent((name: string) => {
    attemptId.current = null;
    setPendingCreate(null);
    unsaved.current = null;
    discardDraft();
    onCreated(name);
    onClose();
  });

  const submit = async () => {
    setRejection(null);
    setSubmitting(true);
    let payload;
    try {
      if (!offersCurrent || !offersReply) throw new Error("The table is still checking these choices.");
      payload = buildCreatePayload(draft, offersReply.choices);
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
    /** A lost reply is a refusal with code `timeout`, and Create resends the same id. */
    const silent = (code: string | undefined) =>
      code === "timeout"
        ? {
            title: "The table has not answered",
            text: "Press Create character again. It resends the same request, so it cannot make a second character."
          }
        : null;
    if (rebuild) {
      // A rebuild keeps the live character's name (the server ignores any other), so it is not sent.
      const { name: _typed, ...rest } = payload;
      const result = await command("character:rebuild", { actorId: rebuild.actorId, ...rest }, commandId);
      setSubmitting(false);
      if (!result.ok) {
        setRejection(
          silent(result.code) ?? {
            title: "The server rejected this change",
            text: result.message ?? "That level change could not be applied."
          }
        );
        return;
      }
      onCreated(rebuild.name);
      onClose();
      return;
    }
    const result = await command("character:create", payload, commandId);
    if (!result.ok) {
      setSubmitting(false);
      setRejection(
        silent(result.code) ?? {
          title: "The server rejected this character",
          text: result.message ?? "The character could not be created."
        }
      );
      return;
    }
    setPendingCreate({ actorId: result.actorId ?? commandId, typedName: payload.name });
  };

  // The reply carries no name and the server renames clashes ("Borin 2"), so the name is read back from
  // the broadcast state, which normally lands before the reply. The timer covers a late broadcast.
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
  // the work went. A level-up keeps no draft: the character it started from is still there to level.
  const saveAndClose = () => {
    const saved = !rebuild && draftHasProgress(draft);
    unsaved.current = null;
    if (saved) saveDraft(draft);
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
  const method = abilityMethodOf(policy, draft);
  // A parked draft can come back under a policy that no longer allows its method; write the
  // fallback into the draft.
  const fallbackMethod = method === draft.abilityMethod || allowedMethodsOf(policy).length === 0 ? null : method;
  useEffect(() => {
    if (fallbackMethod) setDraft((current) => ({ ...current, ...methodChange(fallbackMethod) }));
  }, [fallbackMethod]);

  // Name suggestions, drawn again when the species changes or the shuffle button is pressed.
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  useEffect(() => setSuggestions(nameSuggestions(catalogs.names, draft.speciesId)), [catalogs.names, draft.speciesId]);

  // Step bodies
  /**
   * Below the class's subclass level there is no subclass offer, so the step body (not the detail
   * pane, which is hidden on narrow screens) says when the subclass arrives.
   */
  const subclassPending =
    context.classRecord && (context.classes[0]?.levels ?? draft.level) < context.classRecord.subclassLevel
      ? {
          label: context.classRecord.subclassLabel?.toLowerCase() ?? "subclass",
          level: context.classRecord.subclassLevel
        }
      : null;
  /** A multiclass draft's later classes that have not reached their subclass level yet. */
  const laterSubclassesPending = context.classes
    .slice(1)
    .filter(({ record, levels }) => levels < record.subclassLevel)
    .map(({ record }) => ({
      name: record.name,
      label: record.subclassLabel?.toLowerCase() ?? "subclass",
      level: record.subclassLevel
    }));
  const multiclass = context.classes.length > 1;
  const room = levelsLeft(draft, policy.maxLevel);
  const addableClasses = catalogs.choice.classes.filter(
    (entry) => !context.classes.some(({ record }) => record.id === entry.id)
  );

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
            <PrimaryPick
              label="Species"
              ariaLabel="Species"
              options={speciesOptionsOf(catalogs)}
              value={draft.speciesId}
              onChange={(value) => patch({ speciesId: value })}
              searchPlaceholder="Search species…"
            />
            {stepOffers("species").map(renderOffer)}
          </>
        );
      case "background":
        return (
          <>
            <PrimaryPick
              label="Background"
              ariaLabel="Backgrounds"
              options={backgroundOptionsOf(catalogs)}
              value={draft.backgroundId}
              onChange={(value) => patch({ backgroundId: value })}
              searchPlaceholder="Search backgrounds…"
            />
            {context.originFeat && (
              <p className="cb-note">
                {context.background?.name} grants the <strong>{context.originFeat.name}</strong> feat.
              </p>
            )}
            {displacedSpeciesFeat && (
              <p className="cb-note">
                {context.background?.name} grants <strong>{context.originFeat!.name}</strong>, which replaces your{" "}
                {displacedSpeciesFeat.label} choice. Pick a different Origin feat on Species.
              </p>
            )}
            {stepOffers("background").map(renderOffer)}
          </>
        );
      case "class":
        return (
          <>
            <PrimaryPick
              label="Class"
              ariaLabel="Classes"
              options={classOptionsOf(catalogs)}
              value={draft.classId}
              onChange={(value) => editDraft((current) => withStartingClass(current, value))}
              searchPlaceholder="Search classes…"
            />
            <section className="cb-offer">
              <div className="cb-offer-head">
                {/* The Stepper below is the readout; a multiclass draft adds its classes up here. */}
                <h3 className="cb-offer-title">Level</h3>
                {multiclass && (
                  <span className="cb-offer-count tabular" role="status">
                    Level {draft.level}
                  </span>
                )}
              </div>
              <p className="cb-offer-help">
                {policy.maxLevel < 20
                  ? `Your GM has set the party's level cap to ${policy.maxLevel}.`
                  : "Your GM grants the level; every choice it opens is yours to make."}
              </p>
              {multiclass ? (
                /* One row per class in the order taken: its levels, and a way to drop a later class. */
                <ul className="cb-class-levels" aria-label="Class levels">
                  {context.classes.map(({ record, levels }, index) => (
                    <li key={record.id} className="cb-class-level">
                      <span className="cb-class-name">{record.name}</span>
                      <Stepper
                        value={levels}
                        min={1}
                        max={levels + room}
                        aria-label={`${record.name} levels`}
                        onChange={(next) => editDraft((current) => withClassLevels(current, record.id, next))}
                      />
                      {index > 0 && !rebuild?.heldClasses?.includes(record.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="cb-class-remove"
                          onClick={() => editDraft((current) => withoutClass(current, record.id))}
                        >
                          Remove {record.name}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                /* The cap is the control's maximum, so it cannot be typed past. */
                <Stepper
                  value={Math.min(draft.level, policy.maxLevel)}
                  min={1}
                  max={policy.maxLevel}
                  aria-label="Character level"
                  onChange={(level) => patch({ level, hpEntries: draft.hpEntries.slice(0, Math.max(0, level - 1)) })}
                />
              )}
              {draft.level >= policy.maxLevel && (
                <p className="cb-note">At the table&rsquo;s level cap ({policy.maxLevel}).</p>
              )}
              {draft.classId && room > 0 && context.classes.length < MAX_CLASSES && (
                <Field
                  label="Add a class"
                  htmlFor="cb-add-class"
                  help="Its first level goes after the levels above. A new class needs 13 in its primary ability and in each class before it, checked with your ability scores."
                >
                  <Select
                    id="cb-add-class"
                    value=""
                    onChange={(event) => {
                      const classId = event.target.value;
                      if (classId) editDraft((current) => withClassAdded(current, classId));
                    }}
                  >
                    <option value="">Choose a class</option>
                    {addableClasses.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                </Field>
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
                You choose {withArticle(subclassPending.label)} at {multiclass ? `${context.classRecord!.name} ` : ""}
                level {subclassPending.level}.
              </p>
            )}
            {laterSubclassesPending.map((pending) => (
              <p key={pending.name} className="cb-note">
                You choose {withArticle(`${pending.name} ${pending.label}`)} at {pending.name} level {pending.level}.
              </p>
            ))}
            {stepOffers("features").length === 0 ? (
              <div className="nh-empty">
                <span className="nh-empty-title">Nothing to choose yet</span>
                <span className="nh-empty-text">
                  {multiclass
                    ? `These classes ask for no decisions at level ${draft.level}. Carry on.`
                    : `This class asks for no decisions at level ${draft.level}. Carry on.`}
                </span>
              </div>
            ) : (
              stepOffers("features").map(renderOffer)
            )}
          </>
        );
      case "abilities":
        return (
          <AbilitiesStep
            draft={draft}
            policy={policy}
            mayTypeDice={"definitions" in state || policy.typedRolls === "open"}
            context={context}
            base={base}
            bonuses={bonuses}
            rolls={rolls}
            problem={problemAlert}
            abilityEntry={abilityEntry}
            hpEntry={hpEntry}
            onAbilityEntryChange={setAbilityEntry}
            onHpEntryChange={setHpEntry}
            onRollRefused={(text) => setRejection({ title: "That roll was rejected", text })}
            editDraft={editDraft}
          />
        );
      case "level":
        return (
          <LevelStep
            name={rebuild?.name ?? draft.name}
            draft={draft}
            context={context}
            offers={offers}
            catalogs={catalogs}
            renderOffer={renderOffer}
            earlier={steps
              .slice(0, steps.indexOf("level"))
              .map((id, index) => ({ label: STEP_LABELS[id as StepId], onOpen: () => goTo(index) }))}
            hitPoints={
              <HitPointsSection
                draft={draft}
                policy={policy}
                mayTypeDice={"definitions" in state || policy.typedRolls === "open"}
                context={context}
                base={base}
                bonuses={bonuses}
                rolls={rolls}
                hpEntry={hpEntry}
                onHpEntryChange={setHpEntry}
                editDraft={editDraft}
              />
            }
          />
        );
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
              onShuffle={
                suggestions.length > 0
                  ? () => setSuggestions(nameSuggestions(catalogs.names, draft.speciesId))
                  : undefined
              }
              help={context.species ? `Suggestions come from the ${context.species.name} name bundle.` : undefined}
            />
            {/* Caution, not danger: the table still has room. */}
            {capacity?.warning && (
              <Alert tone="warning" title="The table is filling up">
                {capacity.warning}
              </Alert>
            )}
            {problemAlert}
            <ReviewSummary
              sections={reviewSections({
                draft,
                offers,
                context,
                stepReasons: catalogs.loaded ? stepReasons : null,
                base,
                bonuses,
                method,
                onEdit: (id) => {
                  setStepIndex(steps.indexOf(id));
                  setRejection(null);
                }
              })}
            />
          </>
        );
      default:
        return null;
    }
  };

  /**
   * The detail column is reserved for the whole of any step that can fill it, so a pick does not
   * reflow the grid from five columns to three under the finger. Do not pass null until a pick: the
   * reflow on large grids is the cost this avoids.
   */
  // The level step spends the whole width on its choices.
  const realDetail = step === "level" ? null : stepDetail(step, context, draft.level);
  const placeholder = step === "level" ? undefined : detailPlaceholder(step, context, subclassPending !== null);
  const detailNode = realDetail ?? (placeholder ? <p className="cb-detail-empty">{placeholder}</p> : null);
  const isLast = stepIndex === steps.length - 1;
  const levelIndex = steps.indexOf("level");
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
        <Button variant="ghost" size="sm" onClick={() => goTo(steps.indexOf("features"))}>
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
          ? draftClassesOf(resumed)
              .map(
                ({ id, levels }) =>
                  `${catalogs.choice.classes.find((entry) => entry.id === id)?.name ?? titleize(id)} ${levels}`
              )
              .join(" / ")
          : null
      ].filter((part): part is string => part !== null)
    : [];

  return (
    <div className="cb-page" ref={pageRef}>
      <WizardShell
        title={
          rebuild ? `${rebuild.mode === "down" ? "Level down" : "Level up"} ${rebuild.name}` : "Create a character"
        }
        eyebrow="Character builder"
        steps={stepsForShell}
        current={stepIndex}
        /* Every reached step stays reachable, finished or not; steps past the frontier stay locked. */
        onStepSelect={(index) => {
          if (index <= furthest && index !== stepIndex) goTo(index);
        }}
        maxSelectable={furthest}
        /* A level-up's own step has nothing before it to walk back to; the earlier steps are on the rail. */
        onBack={stepIndex > 0 && step !== "level" ? () => goTo(stepIndex - 1) : undefined}
        /* After reaching the end, an edit from review is a detour: one tap returns. In a level-up an earlier step is a
           detour from the new level's choices. */
        footerSecondary={
          levelIndex !== -1 && stepIndex < levelIndex ? (
            <Button variant="secondary" onClick={() => goTo(levelIndex)}>
              Back to level {draft.level}
            </Button>
          ) : furthest === steps.length - 1 && stepIndex < furthest && step !== "level" ? (
            <Button variant="secondary" onClick={() => goTo(steps.length - 1)}>
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
        {...(rebuild ? { saveLabel: "Close" } : {})}
        resume={
          resumable ? (
            <Alert tone="info" title="Unfinished character found">
              {/* The stored record has identity fields and a timestamp but no step, so none is promised. */}
              {resumedNames.length > 0 ? (
                <>
                  You started <strong>{resumedNames.join(" · ")}</strong> {describeWhen(resumable.updatedAt)}.
                </>
              ) : (
                <>You started a character {describeWhen(resumable.updatedAt)}.</>
              )}{" "}
              It stays exactly as you left it until you answer — resume it, or discard it to save the one you build now.{" "}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft(resumable.draft);
                  setResuming(true);
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
                  discardDraft();
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
          {offersRefusal && (
            <Alert tone="danger" title="The table could not check these choices">
              {offersRefusal}
            </Alert>
          )}
          {body()}
        </div>
      </WizardShell>
    </div>
  );
}
