import { useRef, useState, type ReactNode } from "react";
import type { ActorDefinition, ActorDerivedSheet, DeathSaves, PendingSave, PlayerPendingSave } from "@vtt/domain";
import { Button, IconCheck, IconMoon, IconX, Menu, MenuItem } from "@vtt/ui";
import { abilityModifier } from "@vtt/rules-5e";
import { rollModeOf, useRollPreference } from "../dice/roll-preference";
import { DyingTracker } from "../encounter/DyingTracker";
import { useSaveLight } from "../encounter/saveLight";
import { signed } from "../encounter/format";
import { SavePrompt } from "../encounter/SavePrompt";
import type { SrdExtension } from "../encounter/sheet-extension";
import { command } from "../lib/command";
import { useMovementBudget } from "../scene/useMovementBudget";
import { SkillButton, useSkillRows, type SkillRow } from "./ChecksTab";
import { FoodAndWater } from "./FoodAndWater";
import { HitPointDice } from "./HitPointDice";
import { HpControls, HpReadout } from "./HitPoints";
import {
  armorClassOf,
  exhaustionLevel,
  hitDiceEntries,
  heroicInspirationOf,
  speedOf,
  type SheetActor,
  type SheetState
} from "./sheet-model";
import { slotPools } from "./spell-model";
import { StatusStrip } from "./StatusStrip";
import { UseBoxes, UseList, type Pool } from "./Uses";
import type { SheetRolls } from "./useSheetRolls";

/** A number read at a glance: AC, Speed, Initiative, Passive Perception. `note` names a lowered value's base. */
export function StatTile({
  label,
  value,
  note,
  caution = false
}: Readonly<{ label: string; value: ReactNode; note?: string | null; caution?: boolean }>) {
  return (
    <div className={`cs-stat${caution ? " is-caution" : ""}`}>
      <span className="cs-stat-k">{label}</span>
      <strong className="cs-stat-v">{value}</strong>
      {note && <span className="cs-stat-n">{note}</span>}
    </div>
  );
}

/** Rests through the server, which refuses one in a fight, at 0 Hit Points, or a Long Rest within 16 hours of the last,
 *  and says why. A player asks the GM for a Long Rest, which the GM approves. */
function useRest(actorId: string, role: "gm" | "player", onFeedback: (text: string) => void) {
  const [busy, setBusy] = useState(false);
  const rest = (kind: "short" | "long") => {
    setBusy(true);
    void command("actor:rest", { actorId, kind }).then((result) => {
      setBusy(false);
      onFeedback(
        !result.ok
          ? (result.message ?? "The rest could not be taken.")
          : role === "player" && kind === "short"
            ? "Short Rest started. Spend Hit Point Dice, then tap Done. The GM ends the rest."
            : `Finished a ${kind === "short" ? "Short Rest" : "Long Rest"}.`
      );
    });
  };
  const ask = (withdraw: boolean) => {
    setBusy(true);
    void command("rest:ask", { actorId, ...(withdraw ? { withdraw } : {}) }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? withdraw
            ? "You took back your Long Rest request."
            : "Asked the GM for a Long Rest."
          : (result.message ?? "The request could not be sent.")
      );
    });
  };
  return { busy, rest, ask };
}

/** The rests between fights: a player takes a Short Rest and asks for a Long Rest; the GM's Long Rest is in the GM
 *  tools. */
export function RestButtons({
  actorId,
  role,
  asked,
  restOpen = false,
  onFeedback
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  asked: boolean;
  /** The character is in the Short Rest under way, which the GM ends. */
  restOpen?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const { busy, rest, ask } = useRest(actorId, role, onFeedback);
  return (
    <div className="cs-rest" role="group" aria-label="Rest">
      {role === "player" && restOpen ? (
        <span className="cs-sub">Short Rest under way · the GM ends it</span>
      ) : (
        <Button disabled={busy} onClick={() => rest("short")}>
          <IconMoon /> Short Rest
        </Button>
      )}
      {role === "player" &&
        (asked ? (
          <>
            <span className="cs-sub">Long Rest asked</span>
            <Button variant="ghost" disabled={busy} onClick={() => ask(true)}>
              Take back
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={() => ask(false)}>
            <IconMoon /> Ask for a Long Rest
          </Button>
        ))}
    </div>
  );
}

/** The laptop band's Rest: the same rests in a menu, kept out of a fight. */
export function RestMenu({
  actorId,
  role,
  asked,
  onFeedback
}: Readonly<{ actorId: string; role: "gm" | "player"; asked: boolean; onFeedback: (text: string) => void }>) {
  const { busy, rest, ask } = useRest(actorId, role, onFeedback);
  return (
    <Menu
      trigger={
        <>
          <IconMoon /> Rest
        </>
      }
      align="end"
      triggerClassName="cs-rest-trigger"
    >
      <MenuItem icon={<IconMoon />} disabled={busy} onClick={() => rest("short")}>
        Short Rest
      </MenuItem>
      {role === "gm" ? (
        <MenuItem icon={<IconMoon />} disabled={busy} onClick={() => rest("long")}>
          Long Rest
        </MenuItem>
      ) : asked ? (
        <MenuItem disabled={busy} onClick={() => ask(true)}>
          Take back the Long Rest request
        </MenuItem>
      ) : (
        <MenuItem icon={<IconMoon />} disabled={busy} onClick={() => ask(false)}>
          Ask for a Long Rest
        </MenuItem>
      )}
    </Menu>
  );
}

/** The GM's Long Rest: full Hit Points, every slot and Hit Point Die back, one less level of Exhaustion. */
export function GmLongRest({ actorId, onFeedback }: Readonly<{ actorId: string; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      className="cs-gm-control"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void command("actor:rest", { actorId, kind: "long" }).then((result) => {
          setBusy(false);
          onFeedback(result.ok ? "Finished a Long Rest." : (result.message ?? "The rest could not be taken."));
        });
      }}
    >
      Long Rest
    </Button>
  );
}

const pinnedKey = (actorId: string) => `vtt.sheet.pinned-checks.${actorId}`;
const readPinned = (actorId: string): string[] | null => {
  try {
    const stored = localStorage.getItem(pinnedKey(actorId));
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : null;
  } catch {
    return null;
  }
};
const writePinned = (actorId: string, ids: readonly string[]) => {
  try {
    localStorage.setItem(pinnedKey(actorId), JSON.stringify(ids));
  } catch {
    /* private mode: the pins last as long as the page */
  }
};

/** Until a player pins their own, the checks a table calls for most: Perception, then the character's best. */
function defaultPins(skills: readonly SkillRow[]): string[] {
  const best = [...skills]
    .filter((skill) => skill.tier && skill.bonus !== null && skill.id !== "perception")
    .sort((left, right) => (right.bonus ?? 0) - (left.bonus ?? 0))
    .map((skill) => skill.id);
  return ["perception", ...best].slice(0, 4);
}

/** The checks this player keeps on the Play tab, remembered on this device, with Edit to choose them. */
function PinnedChecks({
  actorId,
  definition,
  derived,
  rolls
}: Readonly<{ actorId: string; definition: ActorDefinition; derived: ActorDerivedSheet | null; rolls: SheetRolls }>) {
  const skills = useSkillRows(definition, derived);
  const [pinned, setPinned] = useState<string[] | null>(() => readPinned(actorId));
  const [editing, setEditing] = useState(false);
  const ids = pinned ?? defaultPins(skills);
  const shown = ids.flatMap((id) => skills.filter((skill) => skill.id === id));
  if (skills.length === 0) return null;
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
    setPinned(next);
    writePinned(actorId, next);
  };
  return (
    <section className="cs-group" aria-label="Pinned checks">
      <div className="cs-section-head">
        <span className="cs-eyebrow">Pinned checks</span>
        <Button size="sm" variant="ghost" aria-expanded={editing} onClick={() => setEditing((current) => !current)}>
          {editing ? "Done" : "Edit"}
        </Button>
      </div>
      {editing ? (
        <div className="cs-chiprow" role="group" aria-label="Choose the pinned checks">
          {skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className={`cs-toggle${ids.includes(skill.id) ? " is-on" : ""}`}
              aria-pressed={ids.includes(skill.id)}
              onClick={() => toggle(skill.id)}
            >
              {skill.name}
            </button>
          ))}
        </div>
      ) : shown.length > 0 ? (
        <div className="cs-chiprow">
          {shown.map((skill) => (
            <SkillButton key={skill.id} skill={skill} rolls={rolls} label />
          ))}
        </div>
      ) : (
        <p className="cs-sub">None pinned. Edit chooses the checks to keep here.</p>
      )}
    </section>
  );
}

/** The spell slots left at each level, read at a glance; the Spells tab spends and restores them. */
function SlotsLeft({ definition, actor }: Readonly<{ definition: ActorDefinition; actor: SheetActor }>) {
  const { slots, pact } = slotPools(definition, actor);
  const pools = [...slots, ...(pact ? [pact] : [])];
  if (pools.length === 0) return null;
  return (
    <section className="cs-group" aria-label="Spell slots">
      <span className="cs-eyebrow">Spell slots</span>
      <div className="cs-slots-left">
        {pools.map((pool) => (
          <span
            key={`${pool.pact ? "pact" : "slot"}-${pool.level}`}
            className="cs-slot-level"
            role="img"
            aria-label={`Level ${pool.level}${pool.pact ? " Pact Magic" : ""}: ${pool.remaining} of ${pool.max} left`}
          >
            <span className="cs-slot-n" aria-hidden="true">
              {pool.level}
            </span>
            <span className="cs-pips" aria-hidden="true">
              {Array.from({ length: pool.max }, (_, index) => (
                <i key={index} className={index < pool.remaining ? "is-on" : undefined} />
              ))}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

const DEATH_BOXES = {
  success: ".cs-death-box.is-success",
  failure: ".cs-death-box.is-failure",
  word: ".cs-death-title"
} as const;

/** The Death Saving Throws: three success boxes and three failure boxes with their marks, and the roll. */
export function DeathSavesCard({
  actor,
  deathSaves,
  myTurn,
  canRoll,
  role,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  deathSaves: DeathSaves;
  myTurn: boolean;
  /** The sheet holds the roll: outside a fight, or on the character's turn away from the table's prompt slot. */
  canRoll: boolean;
  role: "gm" | "player";
  onFeedback: (text: string) => void;
}>) {
  const { rollInput } = useRollPreference();
  const card = useRef<HTMLElement>(null);
  useSaveLight(card, deathSaves, DEATH_BOXES);
  const dead = deathSaves.failures >= 3;
  const inspired = heroicInspirationOf(actor) === true;
  const box = (kind: "success" | "failure", index: number) => {
    const on = kind === "success" ? index < deathSaves.successes : index < deathSaves.failures;
    return (
      <i key={`${kind}-${index}`} className={`cs-death-box is-${kind}${on ? " is-on" : ""}`}>
        {on && (kind === "success" ? <IconCheck /> : <IconX />)}
      </i>
    );
  };
  return (
    <section ref={card} className="cs-card cs-death" aria-label="Death Saving Throws">
      <span className="cs-eyebrow is-danger">Death Saving Throws</span>
      <strong className="cs-death-title">
        {dead ? `${actor.name} is dead` : deathSaves.stable ? `${actor.name} is stable` : `${actor.name} is dying`}
      </strong>
      <div className="cs-death-boxes">
        <span
          className="cs-death-row"
          role="img"
          aria-label={`${deathSaves.successes} ${deathSaves.successes === 1 ? "success" : "successes"}`}
        >
          <span className="cs-eyebrow">Successes</span>
          {[0, 1, 2].map((index) => box("success", index))}
        </span>
        <span
          className="cs-death-row"
          role="img"
          aria-label={`${deathSaves.failures} ${deathSaves.failures === 1 ? "failure" : "failures"}`}
        >
          <span className="cs-eyebrow">Failures</span>
          {[0, 1, 2].map((index) => box("failure", index))}
        </span>
      </div>
      {!dead && !deathSaves.stable && (
        <p className="cs-sub">
          {myTurn
            ? `Roll at the start of your turn. A 10 or higher is a success, and three successes make ${actor.name} stable.`
            : `The next Death Saving Throw comes at the start of ${actor.name}'s turn. An ally can heal ${actor.name} or use the Help action to stabilize.`}
        </p>
      )}
      {canRoll && !dead && !deathSaves.stable && (
        <DyingTracker
          actorId={actor.id}
          name={actor.name}
          deathSaves={deathSaves}
          canRoll
          showPips={false}
          onFeedback={onFeedback}
          rollMode={rollModeOf(rollInput)}
          isActingTurn={myTurn}
          viewer={role}
          inspired={inspired}
          rollLabel="Roll the death saving throw"
        />
      )}
    </section>
  );
}

/** A player's turn resources on the sheet's own Play tab; the table keeps them in its bar with End turn. */
export function EconomyPips({ state, actorId }: Readonly<{ state: SheetState; actorId: string }>) {
  const combat = state.combat;
  const myTurn = combat.turnActorId === actorId;
  const budget = useMovementBudget(myTurn ? actorId : null, state.revision);
  const reactionUsed = (combat.reactionsUsed ?? []).includes(actorId);
  const pip = (label: string, used: boolean) => (
    <span className={`cs-econ${used ? " is-used" : ""}`}>
      {label}
      <span className="cs-econ-state">{used ? "used" : "ready"}</span>
    </span>
  );
  return (
    <div className="cs-econ-row" role="group" aria-label="Your turn resources">
      {myTurn && pip("Action", combat.turn?.actionUsed === true)}
      {myTurn && pip("Bonus Action", combat.turn?.bonusActionUsed === true)}
      {pip("Reaction", reactionUsed)}
      {myTurn && budget?.speedFeet !== undefined && budget?.speedFeet !== null && (
        <span className="cs-econ">
          Move
          <span className="cs-econ-state">
            {Math.round(combat.turn?.movementUsedFeet ?? 0)}/{budget.speedFeet} ft
          </span>
        </span>
      )}
    </div>
  );
}

/** A save the character owes outside a fight (a trap, a Concentration check); in a fight it takes the prompt slot. */
export function SavesOwed({
  saves,
  actor,
  role,
  onFeedback
}: Readonly<{
  saves: ReadonlyArray<PendingSave | PlayerPendingSave>;
  actor: SheetActor;
  role: "gm" | "player";
  onFeedback: (text: string) => void;
}>) {
  if (saves.length === 0) return null;
  return (
    <section className="cs-group" aria-label="Saves owed">
      <span className="cs-eyebrow">Saves owed</span>
      {saves.map((save) => (
        <SavePrompt
          key={save.id}
          save={save}
          targetName={actor.name}
          canDismiss={role === "gm"}
          onFeedback={onFeedback}
          rollMode="auto"
          viewer={role}
          inspired={heroicInspirationOf(actor) === true}
        />
      ))}
    </section>
  );
}

/**
 * The phone's Vitals, at the top of the Play tab between fights: Hit Points with Damage and Heal, the numbers read at
 * a glance, Hit Point Dice as boxes, Heroic Inspiration and Exhaustion, the live states with Add, and the rests.
 */
function Vitals({
  actor,
  role,
  definition,
  extension,
  derived,
  inFight,
  restAsked,
  restOpen,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  definition: ActorDefinition | null;
  extension: SrdExtension;
  derived: ActorDerivedSheet | null;
  inFight: boolean;
  restAsked: boolean;
  /** The character is in the Short Rest under way, so its player may spend Hit Point Dice. */
  restOpen: boolean;
  onFeedback: (text: string) => void;
}>) {
  const speed = speedOf(actor, definition, extension, derived?.speedFeet ?? null);
  const hitDice = "hitDice" in actor ? actor.hitDice : null;
  const exhaustion = exhaustionLevel(actor);
  const inspired = heroicInspirationOf(actor);
  const passive = derived?.passivePerception ?? extension.passivePerception ?? null;
  const constitution = definition ? abilityModifier(definition.abilityScores.con) : null;
  return (
    <section className="cs-vitals" aria-label="Vitals">
      <div className="cs-vitals-grid">
        <div className="cs-vitals-hp">
          <HpReadout actor={actor} />
          <HpControls actor={actor} role={role} compact onFeedback={onFeedback} />
        </div>
        <StatTile
          label="AC"
          value={armorClassOf(actor) ?? "None"}
          note={actor.armorClassOverride !== undefined ? "Set by GM" : null}
        />
        <StatTile label="Initiative" value={actor.initiative !== undefined ? signed(actor.initiative) : "None"} />
        <StatTile
          label="Speed"
          value={speed.now ?? "None"}
          note={speed.lowered ? `of ${speed.base} ft` : "ft"}
          caution={speed.lowered}
        />
        {passive !== null && <StatTile label="Passive Perception" value={passive} />}
      </div>
      {hitDice && hitDiceEntries(actor).length > 0 && (
        <HitPointDice
          actorId={actor.id}
          hitDice={hitDice}
          constitution={constitution}
          boxes
          canSpend={role === "gm" || restOpen}
          canReroll={role === "gm" || inspired === true}
          onFeedback={onFeedback}
        />
      )}
      <div className="cs-vitals-pair">
        {inspired !== undefined && (
          <div className="cs-vital-line">
            <span className="cs-eyebrow">Heroic Inspiration</span>
            <span className={inspired ? "cs-held" : "cs-sub"}>{inspired ? "Held" : "None"}</span>
          </div>
        )}
        <div className="cs-vital-line">
          <span className="cs-eyebrow">Exhaustion</span>
          <span className="cs-boxes is-caution" role="img" aria-label={`Exhaustion ${exhaustion} of 6`}>
            {Array.from({ length: 6 }, (_, index) => (
              <i key={index} className={index < exhaustion ? "is-on" : undefined} />
            ))}
          </span>
        </div>
      </div>
      <div className="cs-group">
        <span className="cs-eyebrow">Conditions and effects</span>
        <StatusStrip actor={actor} role={role} inFight={inFight} inspiration={false} onFeedback={onFeedback} />
      </div>
      {!inFight && (
        <RestButtons actorId={actor.id} role={role} asked={restAsked} restOpen={restOpen} onFeedback={onFeedback} />
      )}
    </section>
  );
}

/** A grant's free casting of a spell, as the server names its pool. */
const FREE_CAST = / \(no slot\)$/;

/** The free casts a feat or a species gives, read as one row: the spells, and what is left of them together. */
function FreeCasts({ pools, spent }: Readonly<{ pools: readonly Pool[]; spent: Readonly<Record<string, number>> }>) {
  if (pools.length === 0) return null;
  const limit = pools.reduce((sum, pool) => sum + pool.limit, 0);
  const left = pools.reduce((sum, pool) => sum + Math.max(0, pool.limit - (spent[pool.id] ?? 0)), 0);
  return (
    <ul className="cs-uses">
      <li className="cs-use">
        <span className="cs-use-text">
          <strong className="cs-use-name">Free casts</strong>
          <span className="cs-sub">{pools.map((pool) => pool.name.replace(FREE_CAST, "")).join(" · ")}</span>
        </span>
        <UseBoxes left={left} limit={limit} label={`Free casts: ${left} of ${limit} left`} />
      </li>
    </ul>
  );
}

/**
 * The Play tab between fights: the rests and Hit Point Dice (or the phone's Vitals), the pinned checks, the spell slots
 * left and the uses that come back on a rest. At 0 Hit Points the Death Saving Throws come first.
 */
export function PlayCalm({
  actor,
  role,
  definition,
  extension,
  derived,
  rolls,
  pools,
  phoneViews,
  showHitDice,
  restAsked,
  restOpen,
  inFight,
  savesOwed,
  death,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  definition: ActorDefinition | null;
  extension: SrdExtension;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  pools: readonly Pool[];
  /** A player's phone: B's Vitals take the top. */
  phoneViews: boolean;
  /** False where the laptop's right column already lists them. */
  showHitDice: boolean;
  restAsked: boolean;
  /** The character is in the Short Rest under way. */
  restOpen: boolean;
  inFight: boolean;
  savesOwed: ReadonlyArray<PendingSave | PlayerPendingSave>;
  death: ReactNode;
  onFeedback: (text: string) => void;
}>) {
  const hitDice = "hitDice" in actor ? actor.hitDice : null;
  const inspired = heroicInspirationOf(actor);
  const restPools = pools.filter((pool) => pool.per === "short-rest" || pool.per === "long-rest");
  const constitution = definition ? abilityModifier(definition.abilityScores.con) : null;
  return (
    <div className="cs-play">
      {death}
      <SavesOwed saves={savesOwed} actor={actor} role={role} onFeedback={onFeedback} />
      {phoneViews ? (
        <Vitals
          actor={actor}
          role={role}
          definition={definition}
          extension={extension}
          derived={derived}
          inFight={inFight}
          restAsked={restAsked}
          restOpen={restOpen}
          onFeedback={onFeedback}
        />
      ) : (
        (actor.kind === "player-character" || role === "gm") && (
          <section className="cs-group" aria-label="Rest">
            <span className="cs-eyebrow">Rest</span>
            <RestButtons actorId={actor.id} role={role} asked={restAsked} restOpen={restOpen} onFeedback={onFeedback} />
            {showHitDice && hitDice && actor.kind === "player-character" && (
              <HitPointDice
                actorId={actor.id}
                hitDice={hitDice}
                constitution={constitution}
                canSpend={role === "gm" || restOpen}
                canReroll={role === "gm" || inspired === true}
                onFeedback={onFeedback}
              />
            )}
          </section>
        )
      )}
      {actor.kind === "player-character" && <FoodAndWater actor={actor} role={role} onFeedback={onFeedback} />}
      {definition && <PinnedChecks actorId={actor.id} definition={definition} derived={derived} rolls={rolls} />}
      {definition && <SlotsLeft definition={definition} actor={actor} />}
      {restPools.length > 0 && (
        <section className="cs-group" aria-label="Uses">
          <span className="cs-eyebrow">Uses</span>
          <UseList
            actorId={actor.id}
            role={role}
            pools={restPools.filter((pool) => !FREE_CAST.test(pool.name))}
            spent={actor.actionUses ?? {}}
            actions={false}
          />
          <FreeCasts pools={restPools.filter((pool) => FREE_CAST.test(pool.name))} spent={actor.actionUses ?? {}} />
        </section>
      )}
    </div>
  );
}
