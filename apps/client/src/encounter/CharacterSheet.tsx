import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  rosterActors,
  type ActorDefinition,
  type GmActor,
  GmView,
  type PendingSave,
  type PlayerActor,
  type PlayerPendingSave,
  type PlayerView,
  type RollVisibility
} from "@vtt/domain";
import { Button, IconButton, Modal, SegmentedControl, Select, IconX, useToast } from "@vtt/ui";
import { ConditionEditor } from "./conditions";
import { SavePrompt } from "./SavePrompt";
import { RichText } from "./RichText";
import { DicePanel, ROLL_VISIBILITY_WORD, VISIBILITY_OPTIONS } from "../dice/DicePanel";
import { rollModeOf, useRollPreference } from "../dice/roll-preference";
import { DyingTracker } from "./DyingTracker";
import { HealTargetPicker, type LooseHeal } from "./HealTargetPicker";
import { isKnockedOut, partyHelpers, StabilizeControl } from "./StabilizeControl";
import { summaryOfOwnAction } from "./PlayerActionRunner";
import { beginTargeting, setTargetingResult, useTargeting } from "./targeting";
import { formatChallenge, titleCase } from "./format";
import type { SrdExtension } from "./sheet-extension";
import { sameName } from "./sheet-names";
import { initialsOf } from "../scene/tokenGlyph";
import { SheetAbilities } from "./SheetAbilities";
import { SheetActions } from "./SheetActions";
import { SheetIdentityEditor } from "./SheetIdentityEditor";
import { SheetInspiration } from "./SheetInspiration";
import { SheetInventory } from "./SheetInventory";
import { SheetProficiencies, type Quarry } from "./SheetProficiencies";
import { SheetPools } from "./SheetPools";
import { SheetRest } from "./SheetRest";
import { SheetSpells } from "./SheetSpells";
import { SheetVitals } from "./SheetVitals";
import { useSheetDefinition } from "./useSheetDefinition";
import { useSheetEdit } from "./useSheetEdit";
import { useSheetRolls } from "./useSheetRolls";
import { command } from "../lib/command";
import "./character-sheet.css";

/** Per-browser storage for the sheet's dice dock (private-mode safe). */
const readSetting = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSetting = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; setting stays in-session */
  }
};

/**
 * Read/track sheet: live actor state (hp, conditions) over the immutable stat block; no editing of
 * scores or actions. The GM opens any combatant; a player only ever receives their own actor.
 */
export function CharacterSheet({
  actor,
  role,
  state,
  standalone = false,
  embedded = false,
  combat,
  onJumpToInitiative,
  standaloneActions,
  onLevel,
  onClose
}: Readonly<{
  actor: GmActor | PlayerActor;
  role: "gm" | "player";
  state?: GmView | PlayerView;
  standalone?: boolean;
  embedded?: boolean;
  /** Combat context for the player's OWN sheet, enabling structured attacks from the Actions section on their turn. */ combat?: {
    revision: number;
    active: boolean;
    myTurn: boolean;
    playerDamageMode: "proposal" | "direct";
    targets: readonly { actorId: string; name: string }[];
  };
  /** In "jump" sheet-attack mode, called after an attack chip starts targeting so the panel hops to the initiative view. */ onJumpToInitiative?: () => void;
  /** Page-level doors for the standalone presentation, shown as the frame's bottom row. Only the SPA's `/characters/:id` passes any; `sheet.html` has no router. */ standaloneActions?: React.ReactNode;
  /** Opens the level page for this character; a sheet opened over another page passes it, so levelling is one tap
   *  from wherever the sheet is. */
  onLevel?: () => void;
  onClose: () => void;
}>) {
  const [feedback, setFeedback] = useState("");
  const { toast } = useToast();
  // The GM's state carries every stored sheet (a built character's), which stays current when the sheet is rebuilt.
  const liveDefinition =
    role === "gm" && state && "definitions" in state && "definitionId" in actor
      ? state.definitions.find((entry) => entry.id === actor.definitionId)?.definition
      : undefined;
  const { definitionId, definition, serverActions, derived, rechoices, spellChoices, showEdited } = useSheetDefinition(
    actor,
    role,
    setFeedback,
    liveDefinition
  );
  // On the player's own turn, targeted stat-block actions resolve through the shared structured flow
  // (pick target -> roll -> resolve). Combat context is the `combat` prop when embedded in the
  // initiative panel, else derived from the player's `state`, so it works from any sheet surface.
  // Player-only; the GM uses their own runner.
  const liveCombat =
    combat ??
    (role === "player" && state
      ? (() => {
          const pv = state as PlayerView;
          return {
            revision: pv.revision,
            active: pv.combat.active,
            myTurn: pv.combat.turnActorId === actor.id,
            playerDamageMode: pv.combat.playerDamageMode,
            targets: pv.combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name }))
          };
        })()
      : undefined);
  // A save the GM called for is answered on the player's call card, so their sheet does not prompt it twice.
  const calledSaveIds = new Set(
    role === "player"
      ? (state?.rollCalls ?? []).flatMap((call) =>
          call.entries.flatMap((entry) => (entry.saveId ? [entry.saveId] : []))
        )
      : []
  );
  const savesOwed: ReadonlyArray<PendingSave | PlayerPendingSave> = (state?.combat.pendingSaves ?? []).filter(
    (save) => save.targetActorId === actor.id && !calledSaveIds.has(save.id)
  );
  // Readied, a character acts off its turn with its Reaction (a readied spell is released by casting it), so the sheet
  // resolves its actions then too.
  const readied = actor.effects.some((effect) => effect.tags.includes("readied"));
  const structuredAttacks =
    liveCombat?.active === true &&
    (liveCombat.myTurn === true || readied) &&
    actor.kind === "player-character" &&
    definition !== null;
  // Outside the fight an item's action goes to the server's loose route, which rolls it and spends its charges.
  // A cast past an empty slot is stopped here only when the fight enforces spell slots; otherwise the server warns
  // or lets it through, and outside a fight it decides from the table's policy.
  const slotsPoliced =
    state?.combat.active === true && (state.combat.ruleExceptions.slots ?? state.combat.rulesMode) === "strict";
  const inFight = state
    ? state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id)
    : liveCombat?.active === true;
  const sendLoose = (actionId: string, extra: Readonly<Record<string, unknown>>, failure: string) =>
    void command("action:use", { actorId: actor.id, actionId, ...extra }).then((response) => {
      if (!response.ok) toast(response.message ?? failure, { tone: "error" });
    });
  // Who a heal outside a fight may land on, as the server allows: this character, then the party (for the GM, anyone
  // on the roster).
  const healCandidates = [
    { id: actor.id, name: actor.name },
    ...rosterActors<GmActor | PlayerActor>(state?.actors ?? [])
      .filter(
        (other) =>
          other.id !== actor.id &&
          !("archived" in other && other.archived) &&
          (role === "gm" || other.kind === "player-character")
      )
      .sort((left, right) => Number(right.kind === "player-character") - Number(left.kind === "player-character"))
      .map((other) => ({ id: other.id, name: other.name }))
  ];
  const [looseHeal, setLooseHeal] = useState<LooseHeal | null>(null);
  // A heal outside a fight asks who regains the hit points, unless it only heals its user (Second Wind).
  const looseHealOf = (actionId: string, slotLevel?: number, includeDamage?: boolean): LooseHeal | null => {
    const own = definition?.actions.find((candidate) => candidate.id === actionId);
    const row = serverActions.find((candidate) => candidate.id === actionId);
    if (!(own?.healing ?? row?.healing) || own?.healing?.self || (!own && row?.targeting === "none")) return null;
    const limit = row?.usesLimit ?? own?.uses?.limit ?? null;
    const spent = actor.actionUses?.[row?.usesPool ?? own?.uses?.pool ?? actionId] ?? 0;
    return {
      actionId,
      name: own?.name ?? row?.name ?? "Heal",
      most: own?.healing?.divided ? healCandidates.length : (row?.healTargets ?? 1),
      spendUpTo: (own?.useCost ?? row?.useCost) === "chosen" && limit !== null ? Math.max(1, limit - spent) : null,
      ...(slotLevel !== undefined ? { slotLevel } : {}),
      ...(includeDamage ? { includeDamage } : {})
    };
  };
  const onLooseUse = inFight
    ? null
    : (actionId: string) => {
        const heal = looseHealOf(actionId);
        if (heal) setLooseHeal(heal);
        else sendLoose(actionId, {}, "That could not be used.");
      };
  const healDialog = looseHeal ? (
    <HealTargetPicker
      heal={looseHeal}
      candidates={healCandidates}
      defaultId={actor.id}
      onClose={() => setLooseHeal(null)}
      onConfirm={(targetIds, spend) => {
        setLooseHeal(null);
        sendLoose(
          looseHeal.actionId,
          {
            targetIds,
            ...(spend !== null ? { spend } : {}),
            ...(looseHeal.slotLevel !== undefined ? { slotLevel: looseHeal.slotLevel } : {}),
            ...(looseHeal.includeDamage ? { includeDamage: true } : {})
          },
          "That could not be used."
        );
      }}
    />
  ) : null;
  const { busy, edit } = useSheetEdit(setFeedback);
  const rolls = useSheetRolls(actor.id, setFeedback);
  const [editMode, setEditMode] = useState<null | "prof" | "identity">(null);
  // The shared per-browser dice-input preference: thrown by the server, or a typed face from a physical die. A
  // player at a table that keeps players' dice on the server has no choice to make.
  const {
    rollInput,
    mayType,
    sheetAttackMode,
    setRollInput: chooseRollInput,
    setSheetAttackMode: chooseSheetAttackMode
  } = useRollPreference();
  // Only the embedded panel can jump to the initiative view and back, so elsewhere the picker is
  // always inline.
  const effectiveAttackMode = onJumpToInitiative ? sheetAttackMode : "inline";
  // The dice log sits behind the header's Sheet/Dice toggle, one pane at a time. Defaults to the sheet.
  const hasLog = state !== undefined;
  const [mobilePane, setMobilePane] = useState<"sheet" | "log">("sheet");
  // Optional desktop dock: pin the dice log beside the sheet. Off by default; remembered per browser.
  const [docked, setDocked] = useState<boolean>(() => readSetting("vtt.sheet.docked") === "1");
  const chooseDocked = (value: boolean) => {
    setDocked(value);
    writeSetting("vtt.sheet.docked", value ? "1" : "0");
  };
  // The latest roll from this character, shown under the rolls bar (hidden when the log is visible). An initiative
  // roll belongs to its fight, so it leaves the bar when the fight ends.
  const lastRoll = state ? ([...state.rolls].reverse().find((roll) => roll.actorId === actor.id) ?? null) : null;
  const latestRoll = lastRoll?.label === "Initiative" && state?.combat.active !== true ? null : lastRoll;
  // A check this sheet rolled is rerolled while it is still the character's latest roll: with Heroic Inspiration for a
  // player, freely by the GM. Without the roll history (the embedded sheet) the server judges that.
  const holdsInspiration = "heroicInspiration" in actor && actor.heroicInspiration === true;
  const canReroll =
    rolls.lastCheck !== null &&
    (state === undefined || rolls.lastCheck.rollId === latestRoll?.id) &&
    (role === "gm" || holdsInspiration);
  // The creatures this character's Hunter's Mark is on: its Perception and Survival checks to find them have Advantage.
  const quarry: Quarry[] = (state?.actors ?? []).flatMap((other: GmActor | PlayerActor) =>
    other.id !== actor.id &&
    other.effects.some(
      (effect) =>
        effect.tags.includes("hunters-mark") &&
        (("yours" in effect && effect.yours === true) ||
          ("sourceActorId" in effect && effect.sourceActorId === actor.id))
    )
      ? [{ id: other.id, name: other.name }]
      : []
  );
  // "modal" is the docked main panel; "floating" detaches it into a movable, resizable in-tab panel.
  const [presentation, setPresentation] = useState<"modal" | "floating">("modal");
  const [rect, setRect] = useState({ x: 48, y: 48, width: 760, height: 620 });
  const [drag, setDrag] = useState<null | {
    mode: "move" | "resize";
    grabX: number;
    grabY: number;
    start: typeof rect;
  }>(null);
  const beginDrag = (mode: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button")) return; // let title-bar buttons click through
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, start: rect });
  };
  const continueDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.grabX,
      dy = event.clientY - drag.grabY;
    if (drag.mode === "move")
      setRect({ ...drag.start, x: Math.max(0, drag.start.x + dx), y: Math.max(0, drag.start.y + dy) });
    else
      setRect({
        ...drag.start,
        width: Math.max(340, drag.start.width + dx),
        height: Math.max(320, drag.start.height + dy)
      });
  };
  const endDrag = () => setDrag(null);
  // Hands a stat-block action to the structured flow (pick target -> roll -> resolve). Every attack
  // from the sheet routes through here. "jump" goes to the initiative view and back on commit;
  // "inline" drives the runner in the Actions section.
  const routeAttack = (action: ActorDefinition["actions"][number], slotLevel?: number) => {
    setTargetingResult(null);
    // Magic Missile makes one more dart for each slot level above its own; the server counts them again.
    const darts =
      action.darts !== undefined && slotLevel !== undefined && action.spellSlot
        ? action.darts + Math.max(0, slotLevel - action.spellSlot.level)
        : undefined;
    beginTargeting(summaryOfOwnAction(action), actor.id, slotLevel, darts);
    if (effectiveAttackMode === "jump") onJumpToInitiative?.();
  };
  // A smite is added to a hit in a fight, so its Cast tap says where to find it rather than starting a refused cast.
  const hitExtraNote = (actionId: string | null | undefined): string | null => {
    const row = inFight && actionId ? serverActions.find((candidate) => candidate.id === actionId) : undefined;
    return row?.ridesAHit
      ? `${row.name} is added to a hit: choose it on the attack's result, before you confirm.`
      : null;
  };
  // A leveled spell's cast: on your turn it goes through targeting with its slot; otherwise the server routes it,
  // spending the slot and rolling its dice outside a fight, or refusing off turn.
  const castSpellAction = (actionId: string, slotLevel?: number) => {
    const note = hitExtraNote(actionId);
    if (note) {
      toast(note);
      return;
    }
    const structured = structuredAttacks ? definition?.actions.find((action) => action.id === actionId) : undefined;
    if (structured) {
      routeAttack(structured, slotLevel);
      return;
    }
    const heal = inFight ? null : looseHealOf(actionId, slotLevel, true);
    if (heal) {
      setLooseHeal(heal);
      return;
    }
    sendLoose(
      actionId,
      { includeDamage: true, ...(slotLevel !== undefined ? { slotLevel } : {}) },
      "The spell could not be cast."
    );
  };
  // The player's own server-resolvable action (has an attack, a save or damage) for an equipped
  // weapon (by name) or a spell (by linked actionId); null falls back to the quick roll.
  const structuredActionFor = (opts: {
    actionId?: string;
    name?: string;
  }): ActorDefinition["actions"][number] | null => {
    if (!definition) return null;
    const match =
      (opts.actionId ? definition.actions.find((candidate) => candidate.id === opts.actionId) : undefined) ??
      (opts.name ? definition.actions.find((candidate) => sameName(candidate.name, opts.name!)) : undefined);
    return match && (match.attack || match.save || match.damage.length > 0) ? match : null;
  };
  // In "inline" mode the picker and result render in the Actions-section runner; an attack tapped
  // elsewhere on the sheet scrolls that runner into view.
  const runnerRef = useRef<HTMLDivElement | null>(null);
  const targetingSession = useTargeting();
  useEffect(() => {
    if (effectiveAttackMode === "inline" && targetingSession?.attackerId === actor.id)
      runnerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [effectiveAttackMode, targetingSession?.attackerId, targetingSession?.action.id, actor.id]);

  const extension = (definition?.extensions["open5e.srd-2024"] ?? {}) as SrdExtension;
  const character = definition?.character;
  const identity = character
    ? [
        character.classes
          .map((klass) => `${klass.subclass ? `${klass.subclass.name} ` : ""}${klass.name} ${klass.level}`)
          .join(" / "),
        character.race?.name,
        character.background?.name
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // The sheet's scrolling content. Identity and roll settings live in the fixed header and rollbar;
  // only the identity edit form scrolls.
  const sheetScroll = (
    <div className="sheet-scroll">
      {editMode === "identity" && definition && (
        <SheetIdentityEditor
          actorId={actor.id}
          definition={definition}
          role={role}
          busy={busy}
          edit={edit}
          onEdited={showEdited}
          onDone={() => setEditMode(null)}
        />
      )}
      <SheetVitals
        actor={actor}
        role={role}
        definition={definition}
        extension={extension}
        speedFeet={derived?.speedFeet ?? null}
        onFeedback={setFeedback}
      />
      <div className="sheet-conditions">
        <span className="sheet-section-label">Conditions</span>
        <ConditionEditor
          actorId={actor.id}
          conditions={actor.conditions}
          effects={actor.effects}
          viewer={role}
          canAsk={role === "player" && liveCombat?.active === true}
          onFeedback={setFeedback}
        />
      </div>
      {actor.kind === "player-character" && (role === "gm" || "heroicInspiration" in actor) && (
        <SheetInspiration
          actorId={actor.id}
          name={actor.name}
          held={holdsInspiration}
          role={role}
          onFeedback={setFeedback}
        />
      )}
      {/* A save owed outside a fight (a concentration check after a trap): in a fight it waits on the
        initiative row instead. */}
      {state && !state.combat.active && savesOwed.length > 0 && (
        <div className="sheet-saves-owed">
          <span className="sheet-section-label">Saves owed</span>
          {savesOwed.map((save) => (
            <SavePrompt
              key={save.id}
              save={save}
              targetName={actor.name}
              canDismiss={role === "gm"}
              onFeedback={setFeedback}
              rollMode="auto"
              viewer={role}
              inspired={holdsInspiration}
            />
          ))}
        </div>
      )}
      {/* Dying or knocked out outside a fight: the death saves, and for the GM the aid that ends it. In a fight
        both live on the turn order. */}
      {!inFight && (actor.deathSaves || isKnockedOut(actor)) && (
        <div className="sheet-dying-block">
          {actor.deathSaves ? (
            <DyingTracker
              actorId={actor.id}
              name={actor.name}
              deathSaves={actor.deathSaves}
              canRoll
              onFeedback={setFeedback}
              rollMode={rollModeOf(rollInput)}
              isActingTurn={false}
              viewer={role}
              inspired={holdsInspiration}
              aid={
                role === "gm" && state ? (
                  <StabilizeControl
                    targetId={actor.id}
                    targetName={actor.name}
                    helpers={partyHelpers(state as GmView, actor.id)}
                    gm
                    onFeedback={setFeedback}
                  />
                ) : undefined
              }
            />
          ) : (
            role === "gm" &&
            state && (
              <StabilizeControl
                targetId={actor.id}
                targetName={actor.name}
                helpers={partyHelpers(state as GmView, actor.id)}
                gm
                knockedOut
                onFeedback={setFeedback}
              />
            )
          )}
        </div>
      )}
      {/* The GM rests monsters and NPCs too (a Long Rest re-arms Legendary Resistance and per-day uses), without
          Hit Dice to spend. */}
      {(actor.kind === "player-character" || role === "gm") && (
        <div className="sheet-rest-block">
          <span className="sheet-section-label">Rest</span>
          <SheetRest
            actorId={actor.id}
            role={role}
            hitDice={actor.kind === "player-character" && "hitDice" in actor ? actor.hitDice : null}
            asked={state?.rest?.requests.includes(actor.id) ?? false}
            onFeedback={setFeedback}
          />
        </div>
      )}
      {actor.actionUses && (role === "gm" || actor.kind === "player-character") && (
        <SheetPools actorId={actor.id} role={role} actions={serverActions} spent={actor.actionUses} />
      )}

      {definition && (
        <>
          <SheetAbilities definition={definition} extension={extension} derived={derived} rolls={rolls} />
          <SheetProficiencies
            actor={actor}
            definition={definition}
            derived={derived}
            rolls={rolls}
            quarry={quarry}
            editing={editMode === "prof"}
            onEditingChange={(editing) => setEditMode(editing ? "prof" : null)}
            busy={busy}
            edit={edit}
            onEdited={showEdited}
          />
          <SheetSpells
            actor={actor}
            definition={definition}
            busy={busy}
            edit={edit}
            rolls={rolls}
            onFeedback={setFeedback}
            spellSaveDcBonus={derived?.spellSaveDcBonus ?? 0}
            policeSlots={slotsPoliced}
            canPrepare={role === "gm" || Boolean(actor.preparation)}
            rechoices={rechoices}
            spellChoices={spellChoices}
            gm={role === "gm"}
            readiedActionId={
              actor.effects.flatMap((effect) => (effect.readiedSpell ? [effect.readiedSpell.actionId] : []))[0] ?? null
            }
            castSpellAction={castSpellAction}
            routeSpell={(spell) => {
              const note = hitExtraNote(spell.actionId);
              if (note) {
                toast(note);
                return true;
              }
              const structured = structuredAttacks
                ? structuredActionFor({ actionId: spell.actionId ?? undefined, name: spell.name })
                : null;
              if (structured) routeAttack(structured);
              return structured !== null;
            }}
          />
          {actor.kind === "player-character" && (
            <SheetInventory
              actor={actor}
              busy={busy}
              edit={edit}
              role={role}
              attunementSlots={derived?.attunementSlots ?? 3}
              inFight={inFight}
              others={
                role === "gm" && state
                  ? state.actors
                      .filter(
                        (other) =>
                          other.kind === "player-character" &&
                          other.id !== actor.id &&
                          !("archived" in other && other.archived)
                      )
                      .map((other) => ({ id: other.id, name: other.name }))
                  : []
              }
            />
          )}
          {extension.traits && extension.traits.length > 0 && (
            <section className="sheet-section">
              <h3>Traits</h3>
              {extension.traits.map((trait) => (
                <p key={trait.name} className="sheet-entry">
                  <strong>{trait.name}.</strong> <RichText text={trait.description} />
                </p>
              ))}
            </section>
          )}
          <SheetActions
            actor={actor}
            definition={definition}
            serverActions={serverActions}
            rolls={rolls}
            structuredAttacks={structuredAttacks}
            inline={structuredAttacks && effectiveAttackMode === "inline" ? (liveCombat ?? null) : null}
            runnerRef={runnerRef}
            routeAttack={routeAttack}
            structuredActionFor={structuredActionFor}
            onLooseUse={onLooseUse}
          />
          <p className="sheet-attribution">
            Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.
          </p>
        </>
      )}
      {!definition && role === "gm" && definitionId && !feedback && <p className="sheet-status">Loading stat block…</p>}
      {actor.kind === "player-character" && !definitionId && (
        <p className="sheet-status">
          No imported sheet yet - the GM can import this character's JSON sheet from the roster.
        </p>
      )}
      <p className="sheet-feedback" role="status">
        {feedback}
      </p>
    </div>
  );

  // Identity line under the name: class/level/race for a PC, size/CR typeline for a monster.
  const identityLine =
    identity ??
    (definition
      ? `${titleCase(definition.size)} ${extension.type ?? "being"}${extension.alignment ? `, ${extension.alignment}` : ""}${extension.challengeRating !== undefined ? ` · CR ${formatChallenge(extension.challengeRating)}` : ""}`
      : `${titleCase(actor.kind.replace("-", " "))}${actor.visibility === "gm-only" ? " · GM-only" : ""}`);

  // One header row for every presentation: name and identity on the left; the log toggle, Pop out /
  // New tab and × on the right. In the floating panel it is the drag handle (buttons opt out).
  const header = (draggable: boolean) => (
    <div
      className={`sheet-header${draggable ? " sheet-header--drag" : ""}`}
      onPointerDown={draggable ? beginDrag("move") : undefined}
    >
      <span className="sheet-portrait" aria-hidden="true">
        {initialsOf(actor.name)}
      </span>
      <div className="sheet-header-id">
        <strong className="sheet-name">{actor.name}</strong>
        <span className="sheet-name-rule" aria-hidden="true" />
        <div className="sheet-header-sub">
          <span className="sheet-idline">{identityLine}</span>
          {actor.kind === "player-character" && definition && editMode !== "identity" && (
            <Button size="sm" variant="ghost" className="sheet-section-edit" onClick={() => setEditMode("identity")}>
              Edit
            </Button>
          )}
          {onLevel && actor.kind === "player-character" && (
            <Button size="sm" variant="ghost" className="sheet-section-edit" onClick={onLevel}>
              Level up or down…
            </Button>
          )}
        </div>
      </div>
      <div className="sheet-header-controls">
        {hasLog && (
          <SegmentedControl
            className="sheet-pane-toggle"
            size="sm"
            ariaLabel="Show sheet or dice"
            value={mobilePane}
            onChange={(pane) => setMobilePane(pane as "sheet" | "log")}
            options={[
              { value: "sheet", label: "Sheet" },
              { value: "log", label: "Dice" }
            ]}
          />
        )}
        {hasLog && !embedded && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-dock-btn"
            title={docked ? "Collapse the dice log back behind the toggle" : "Pin the dice log beside the sheet"}
            onClick={() => chooseDocked(!docked)}
          >
            {docked ? "Undock dice" : "Dock dice"}
          </Button>
        )}
        {!standalone && !embedded && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-tool"
            title={presentation === "floating" ? "Dock the panel back into place" : "Pop out into a moveable panel"}
            onClick={() => setPresentation((current) => (current === "floating" ? "modal" : "floating"))}
          >
            {presentation === "floating" ? "Dock" : "Pop out"}
          </Button>
        )}
        {!standalone && !embedded && role === "player" && (
          <Button
            size="sm"
            variant="ghost"
            className="sheet-tool"
            title="Open this sheet in its own browser tab"
            onClick={() => window.open(`/sheet.html?actor=${encodeURIComponent(actor.id)}`, `vtt-sheet-${actor.id}`)}
          >
            New tab
          </Button>
        )}
        {/* Embedded in the table's panel, the tabs are the way back. */}
        {!embedded && (
          <IconButton label="Close" size="sm" className="sheet-close" onClick={onClose}>
            <IconX />
          </IconButton>
        )}
      </div>
    </div>
  );

  // Roll-input settings: a narrow bar pinned under the header.
  const rollbar = definition ? (
    <div className="sheet-rollbar" role="group" aria-label="Roll entry settings">
      <span className="sheet-settings-label">Rolls</span>
      {mayType && (
        <SegmentedControl
          size="sm"
          ariaLabel="Roll input mode"
          value={rollInput}
          onChange={(mode) => chooseRollInput(mode as "digital" | "manual")}
          options={[
            { value: "digital", label: "Digital" },
            { value: "manual", label: "Manual" }
          ]}
        />
      )}
      <label className="sheet-roll-visibility">
        <span className="sheet-settings-label">Visibility</span>
        <Select
          value={rolls.visibility}
          onChange={(event) => rolls.setVisibility(event.target.value as RollVisibility)}
        >
          {VISIBILITY_OPTIONS[role].map((value) => (
            <option key={value} value={value}>
              {ROLL_VISIBILITY_WORD[value]}
            </option>
          ))}
        </Select>
      </label>
      {/* Mid-fight only: whether an attack tapped here resolves inline or on the initiative view. */}
      {liveCombat?.active === true && actor.kind === "player-character" && onJumpToInitiative && (
        <>
          <span className="sheet-settings-label">Attacks</span>
          <SegmentedControl
            size="sm"
            ariaLabel="Where attacks tapped on the sheet resolve"
            value={sheetAttackMode}
            onChange={(mode) => chooseSheetAttackMode(mode as "jump" | "inline")}
            options={[
              { value: "inline", label: "On sheet" },
              { value: "jump", label: "In initiative" }
            ]}
          />
        </>
      )}
    </div>
  ) : null;

  // The sheet fills the panel; the dice log swaps in behind the Sheet/Dice toggle. Header and
  // rollbar stay pinned; the active pane scrolls.
  const buildWorkspace = (draggable: boolean) => (
    <div className={`sheet-workspace ${hasLog ? "has-log" : "no-log"} show-${mobilePane}${docked ? " docked" : ""}`}>
      {header(draggable)}
      {rollbar}
      {latestRoll && (
        <button
          type="button"
          className="sheet-last-roll"
          onClick={() => setMobilePane("log")}
          title="Open the dice log"
        >
          <span className="sheet-last-roll-label">{latestRoll.label ?? latestRoll.purpose}</span>
          <span className="sheet-last-roll-readout">
            <span className="sheet-last-roll-faces">
              {latestRoll.dice.map((die, index) => (
                <span key={index} className={die.kept ? "sheet-last-die" : "sheet-last-die out"}>
                  {die.face}
                </span>
              ))}
            </span>
            <span className="sheet-last-roll-formula">{latestRoll.formula}</span>
            <span aria-hidden="true">=</span>
            <strong className="sheet-last-roll-total">{latestRoll.total}</strong>
          </span>
        </button>
      )}
      {canReroll && (
        <div className="sheet-last-reroll">
          <Button size="sm" variant="secondary" disabled={rolls.rolling} onClick={() => void rolls.rerollCheck()}>
            {role === "gm" ? "Reroll" : "Reroll · Heroic Inspiration"}
          </Button>
        </div>
      )}
      <div className="sheet-workspace-cols">
        {/* The sheet's pane is the declared scroll region in all four presentations. */}
        <div className="sheet-workspace-pane sheet-pane scroll-y">{sheetScroll}</div>
        {hasLog && state && (
          <div className="sheet-workspace-pane log-pane scroll-y">
            <DicePanel role={role} state={state} mineActorId={actor.id} />
          </div>
        )}
      </div>
    </div>
  );

  // Embedded in the table's panel: fills its tab, with no modal chrome and no close. No state is passed, so no
  // dice log.
  if (embedded)
    return (
      <>
        <div className="sheet-embedded">{buildWorkspace(false)}</div>
        {rolls.dialog}
        {healDialog}
      </>
    );

  // Its own browser tab, or the SPA's `/characters/:id` layer: fills its box, and × closes or goes
  // back. Page-level doors use the frame's bottom row when supplied.
  if (standalone)
    return (
      <>
        <div className="sheet-standalone">
          {buildWorkspace(false)}
          {standaloneActions && <div className="sheet-standalone-actions">{standaloneActions}</div>}
        </div>
        {rolls.dialog}
        {healDialog}
      </>
    );

  if (presentation === "floating") {
    return (
      <>
        <div
          className={`sheet-float${hasLog ? " has-log" : ""}`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="dialog"
          aria-label={`${actor.name} character sheet`}
        >
          {buildWorkspace(true)}
          <div className="sheet-float-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
        </div>
        {rolls.dialog}
        {healDialog}
      </>
    );
  }
  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        className={`character-sheet${hasLog ? " has-log" : ""}${docked ? " docked" : ""}`}
        ariaLabel={`${actor.name} character sheet`}
      >
        {buildWorkspace(false)}
      </Modal>
      {rolls.dialog}
      {healDialog}
    </>
  );
}
