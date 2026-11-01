import { useMemo, useState, type ReactNode } from "react";
import type { ContentClassSummary, GmView, PlayerView } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { multiclassShortfalls, multiclassShortfallText } from "@vtt/rules-5e";
import {
  Alert,
  Button,
  ChoiceGrid,
  EmptyState,
  IconMore,
  Menu,
  MenuItem,
  Modal,
  Steps,
  useToast,
  type ChoiceOption
} from "@vtt/ui";
import { useBuilderCatalogs, type BuilderCatalogs } from "../content/catalogs";
import { useMediaQuery } from "../lib/useMediaQuery";
import { MAX_CLASSES } from "./build-payload";
import { CharacterBuilder } from "./CharacterBuilder";
import {
  choicesAbove,
  classOrderUnknown,
  draftFromLedger,
  hpRollGap,
  identityOf,
  keptClasses,
  ledgerOf,
  recordedAbilities,
  targetClassLevels,
  type LedgerIdentity
} from "./level-ledger";
import { useBuilderOffers } from "./useBuilderOffers";
import "./character-builder.css";

/**
 * Level up and level down (`/characters/<id>/level`): a dialog over the sheet that picks the level and its class, then
 * the wizard seeded from this character's own ledger. Every decision at or below a level survives a rebuild at that level, so
 * levelling back up restores earlier choices and HP rolls exactly.
 *
 * Gates: no ledger (a PDF import or pre-wizard sheet) cannot be rebuilt; up stops at the table's max
 * level, down always reaches 1; missing HP rolls use the average and say so. A level up goes to one of the
 * character's classes or, when the scores qualify, a new one (SRD Multiclassing). The table reads the ledger
 * back onto the offers at the chosen level before the wizard opens.
 * The server authorizes `character.rebuild` (`canInitiateForActor`) and re-checks cap and policy;
 * this surface mirrors those rules so a player is not walked into a rejection.
 */

type LevelState = GmView | PlayerView;

/** Ledger rows the build writes itself or the sheet keeps (a hand edit, a studied book), which a level-down preview
 *  does not list as choices. */
const BUILD_RECORDS: ReadonlySet<string> = new Set([
  "hp-roll",
  "class-levels",
  "ability-scores",
  "sheet-proficiencies",
  "studied-item"
]);

export function LevelFlow({
  state,
  role,
  actorId,
  connection = "online",
  behind,
  startDown = false,
  onClose,
  onDone
}: Readonly<{
  state: LevelState;
  role: "gm" | "player";
  actorId: string;
  connection?: "online" | "reconnecting" | "offline";
  /** The sheet the dialog opens over (characters spec 2.3), which stays behind it. */
  behind: ReactNode;
  /** Open the dialog on Level down (the sheet's Level down item). */
  startDown?: boolean;
  onClose: () => void;
  onDone: (name: string) => void;
}>) {
  const catalogs = useBuilderCatalogs();
  const { toast } = useToast();
  const [target, setTarget] = useState<{ level: number; classLevels: string[] } | null>(null);
  /** The class the next level goes to; null keeps the class of the last level taken. */
  const [nextClass, setNextClass] = useState<string | null>(null);
  /** Whether the classes the character doesn't have yet are on offer; a level mostly goes to a class it has. */
  const [newClassOpen, setNewClassOpen] = useState(false);
  /** The dialog's More menu turns it to Level down, with what is kept. */
  const [goingDown, setGoingDown] = useState(startDown);

  const actor = state.actors.find((entry) => entry.id === actorId) ?? null;
  /**
   * The stored sheet. A GM reads the definition library; a player has only their own claimed
   * character's definition, so for anyone else this finds nothing, as the server would.
   */
  const definition: ActorDefinition | null = useMemo(() => {
    if (!actor) return null;
    if ("definition" in actor && actor.definition) return actor.definition as ActorDefinition;
    const library = "definitions" in state ? state.definitions : [];
    return (
      (library.find((entry) => entry.id === actor.definitionId)?.definition as ActorDefinition | undefined) ?? null
    );
  }, [actor, state]);

  const cap = state.builderPolicy.maxLevel;
  const identity = identityOf(definition);
  const ledger = ledgerOf(definition);
  const current = identity?.level ?? 1;
  const reading = useBuilderOffers(
    target !== null && identity && ledger && definition
      ? {
          speciesId: identity.speciesId,
          backgroundId: identity.backgroundId,
          classId: identity.classId,
          level: target.level,
          ...(new Set(target.classLevels).size > 1 ? { classLevels: target.classLevels } : {}),
          choices: ledger,
          // The sheet's own scores, so the table can say how they were made even where the ledger never recorded it.
          sheet: { level: current, abilityScores: definition.abilityScores }
        }
      : null
  );

  if (!actor)
    return (
      <Gate title="That character isn't here" onClose={onClose} behind={behind}>
        This sheet isn't on the table any more. It may have been archived or deleted.
      </Gate>
    );

  if (role === "player" && state.builderPolicy.playerBuilder !== "open")
    return (
      <Gate title="Your GM builds the characters at this table" onClose={onClose} behind={behind}>
        Ask them to level {actor.name} for you.
      </Gate>
    );

  if (classOrderUnknown(definition))
    return (
      <Gate title={`${actor.name}'s classes were added by hand`} onClose={onClose} behind={behind}>
        The sheet lists its classes but not which level went to which, so it can't be releveled step-by-step. Rebuild it
        in the builder to level it here.
      </Gate>
    );

  if (!identity || !ledger || !definition)
    return (
      <Gate title={`${actor.name} wasn't built here`} onClose={onClose} behind={behind}>
        This sheet wasn't built here, so it can't be releveled step-by-step yet. Edit the sheet directly, or rebuild it
        in the builder.
      </Gate>
    );

  if (target !== null && reading.refusal)
    return (
      <Gate title={`${actor.name}'s choices could not be read`} onClose={() => setTarget(null)} behind={behind}>
        {reading.refusal}
      </Gate>
    );

  if (target !== null && (!reading.current || !reading.reply || !catalogs.loaded))
    return (
      <LevelPage behind={behind} title={`Level ${target.level} for ${actor.name}`} onClose={onClose}>
        <p className="cb-note" role="status">
          Reading {actor.name}'s choices at level {target.level}…
        </p>
        <Button variant="ghost" onClick={() => setTarget(null)}>
          Back
        </Button>
      </LevelPage>
    );

  if (target !== null && reading.reply) {
    const seed = draftFromLedger(identity, ledger, definition, catalogs, target, state.builderPolicy, reading.reply);
    const gap = hpRollGap(ledger, target, identity.classLevels);
    const recordedMethod = reading.reply.abilities?.abilityMethod ?? recordedAbilities(ledger)?.method;
    return (
      <CharacterBuilder
        state={state}
        connection={connection}
        onClose={() => setTarget(null)}
        onCreated={(name) => {
          toast(`${name} is level ${target.level}.`, { tone: "success" });
          onDone(name);
        }}
        rebuild={{
          actorId,
          name: actor.name,
          seed,
          heldClasses: keptClasses(identity, target.level),
          mode: target.level > current ? "up" : "down",
          ...(recordedMethod ? { recordedMethod } : {}),
          ...(gap
            ? {
                notice: (
                  <Alert tone="info" title="About this character's hit points">
                    The table rolls hit points for level{gap.length > 1 ? "s" : ""} {gap.join(", ")} when you apply
                    this. Rolls already recorded are kept.
                  </Alert>
                )
              }
            : {})
        }}
      />
    );
  }

  // The rows the build writes for itself (the rolls, the class order) are not choices to give up.
  const removed = choicesAbove(ledger, current - 1).filter((row) => !BUILD_RECORDS.has(row.kind));
  const atCap = current >= cap;
  const classes = classesOf(identity, catalogs);
  const multiclass = classes.length > 1;
  const lastClass = identity.classLevels[current - 1];
  const upClass = nextClass ?? lastClass;
  const nameOf = (id: string) => catalogs.choice.classes.find((entry) => entry.id === id)?.name ?? id;
  const lastName = nameOf(lastClass);
  const onlyLevel = identity.classLevels.filter((id) => id === lastClass).length === 1;

  const choices = classChoices(identity, definition, catalogs);
  const held = choices.filter((option) => classes.some((entry) => entry.id === option.value));
  const goingNew = !classes.some((entry) => entry.id === upClass);
  const classSection = (
    <section className="cb-offer cb-level-class">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">Level {current + 1} goes to</h3>
      </div>
      <p className="cb-offer-help">
        {newClassOpen || goingNew
          ? "A new class needs 13 in its primary ability and in each class you already have."
          : multiclass
            ? "One of your classes."
            : `${lastName} level ${current + 1}, or a new class for a multiclass character.`}
      </p>
      <ChoiceGrid
        ariaLabel={`Level ${current + 1} goes to`}
        /* The classes the character has, and the rest only once asked for, so the dialog stays short. */
        options={newClassOpen || goingNew ? choices : held}
        value={upClass}
        onChange={setNextClass}
        bounded
        searchable={(newClassOpen || goingNew) && catalogs.choice.classes.length > 8}
        searchPlaceholder="Search classes…"
      />
      {!newClassOpen && !goingNew && (
        <Button size="sm" onClick={() => setNewClassOpen(true)}>
          Take a new class
        </Button>
      )}
    </section>
  );
  const up = () => setTarget({ level: current + 1, classLevels: targetClassLevels(identity, current + 1, upClass) });
  const down = () =>
    setTarget({ level: current - 1, classLevels: targetClassLevels(identity, current - 1, lastClass) });
  const summary = (
    <p className="cb-level-summary">
      Level {current}
      {multiclass ? ` · ${classes.map(({ name, levels }) => `${name} ${levels}`).join(" / ")}` : ""}
      {cap < 20 ? ` · the table's cap is ${cap}` : ""}
    </p>
  );
  const downPreview = current > 1 && (
    <section className="cb-level-preview">
      <h3>Leveling down to {current - 1}</h3>
      <p>
        {multiclass && (
          <>
            Level {current} went to {lastName}.
            {onlyLevel ? ` It is ${actor.name}'s only ${lastName} level, so ${lastName} comes off the sheet.` : ""}{" "}
          </>
        )}
        {removed.length > 0 ? (
          <>
            Leveling down removes:{" "}
            {removed
              .map((row) =>
                row.id
                  .split("-")
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join(" ")
              )
              .join(", ")}
            .
          </>
        ) : (
          <>Level {current} added no choices of its own.</>
        )}{" "}
        {actor.name}'s level {current} choices and HP roll are kept, and leveling back up restores them exactly.
      </p>
    </section>
  );

  /* Over the sheet (characters spec 2.3): the dialog opens on the next level up, and its More menu turns it to
     Level down. The level's hit points and choices then run in the builder's level step. */
  const showDown = goingDown && current > 1;
  const steps = showDown
    ? [{ label: "What is kept" }, { label: "Review and apply" }]
    : [{ label: "Class" }, { label: "Hit points and choices" }, { label: "Review and apply" }];
  return (
    <LevelPage
      behind={behind}
      title={
        showDown ? `Level ${current - 1} for ${actor.name}` : `Level ${Math.min(cap, current + 1)} for ${actor.name}`
      }
      onClose={onClose}
      footer={
        showDown ? (
          <>
            <Button variant="ghost" onClick={() => setGoingDown(false)}>
              Back to level up
            </Button>
            <Button variant="primary" className="cb-level-down" onClick={down}>
              Level down to {current - 1}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {current > 1 && (
              <Menu trigger={<IconMore />} icon align="end" label="More for this level">
                <MenuItem onClick={() => setGoingDown(true)}>Level down to {current - 1}</MenuItem>
              </Menu>
            )}
            <Button variant="primary" className="cb-level-up" disabled={atCap} onClick={up}>
              Level up to {Math.min(cap, current + 1)}
            </Button>
          </>
        )
      }
    >
      <Steps ariaLabel={showDown ? "Level down" : "Level up"} current={0} steps={steps} className="cb-level-steps" />
      {summary}
      {showDown ? (
        downPreview
      ) : atCap ? (
        <p className="cb-note">At the table's level cap ({cap}). Its More menu holds Level down.</p>
      ) : (
        classSection
      )}
    </LevelPage>
  );
}

/** The level dialog over the sheet: the Dialog pattern at 620px, a sheet from the bottom on a phone (characters spec
 *  2.3, theme rule 16). */
function LevelPage({
  children,
  footer,
  behind,
  title,
  onClose
}: Readonly<{ children: ReactNode; footer?: ReactNode; behind: ReactNode; title: string; onClose: () => void }>) {
  const phone = useMediaQuery("(max-width: 760px)");
  return (
    <>
      {behind}
      <Modal
        open
        onClose={onClose}
        title={title}
        ariaLabel={title}
        className="cb-level-dialog"
        align={phone ? "bottom" : "center"}
        footer={footer}
      >
        <div className="cb-level">{children}</div>
      </Modal>
    </>
  );
}

/** The character's classes in the order taken, with their levels. */
function classesOf(identity: LedgerIdentity, catalogs: BuilderCatalogs) {
  const counts = new Map<string, number>();
  for (const id of identity.classLevels) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, levels]) => ({
    id,
    levels,
    name: catalogs.choice.classes.find((entry) => entry.id === id)?.name ?? id,
    record: catalogs.choice.classes.find((entry) => entry.id === id) ?? null
  }));
}

/**
 * Where the next level can go: each class the character has, then every other class, unavailable with the reason
 * when the scores don't qualify (SRD: 13 in the primary ability of the new class and of each current class, with
 * the scores as they stand now) or the character has its most classes.
 */
function classChoices(
  identity: LedgerIdentity,
  definition: ActorDefinition,
  catalogs: BuilderCatalogs
): ChoiceOption[] {
  const taken = classesOf(identity, catalogs);
  const current = taken.flatMap(({ record }) => (record ? [record] : []));
  const held: ChoiceOption[] = taken.map(({ id, name, levels, record }) => ({
    value: id,
    title: name,
    description: `${name} level ${levels + 1}`,
    meta: record?.hitDie
  }));
  const fresh = catalogs.choice.classes
    .filter((record) => !taken.some((entry) => entry.id === record.id))
    .map((record: ContentClassSummary): ChoiceOption => {
      const shortfalls = multiclassShortfalls(definition.abilityScores, record, current);
      const reason =
        taken.length >= MAX_CLASSES
          ? `A character can have at most ${MAX_CLASSES} classes.`
          : shortfalls.length > 0
            ? multiclassShortfallText(definition.abilityScores, record, shortfalls)
            : null;
      return {
        value: record.id,
        title: record.name,
        description: `New class · ${record.name} level 1`,
        meta: record.hitDie,
        keywords: record.primaryAbilities.join(" "),
        ...(reason ? { disabled: true, disabledReason: reason } : {})
      };
    });
  return [...held, ...fresh];
}

/** A gate is the dialog's empty state (T rule 3): its title names what stops the level, one line says why, and Back
 *  closes it. */
function Gate({
  title,
  children,
  onClose,
  behind
}: Readonly<{ title: string; children: ReactNode; onClose: () => void; behind: ReactNode }>) {
  return (
    <LevelPage behind={behind} title={title} onClose={onClose}>
      <EmptyState
        action={
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
        }
      >
        {children}
      </EmptyState>
    </LevelPage>
  );
}
