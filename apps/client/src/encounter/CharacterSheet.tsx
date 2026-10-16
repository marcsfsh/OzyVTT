import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  ActorDefinition,
  GmActor,
  GmView,
  PendingSave,
  PlayerActor,
  PlayerPendingSave,
  PlayerView
} from "@vtt/domain";
import { Button, IconButton, Modal, SegmentedControl, IconX, useToast } from "@vtt/ui";
import { ConditionEditor } from "./conditions";
import { SavePrompt } from "./SavePrompt";
import { RichText } from "./RichText";
import { DicePanel } from "../dice/DicePanel";
import { useRollPreference } from "../dice/roll-preference";
import { summaryOfOwnAction } from "./PlayerActionRunner";
import { beginTargeting, setTargetingResult, useTargeting } from "./targeting";
import { formatChallenge, titleCase } from "./format";
import type { SrdExtension } from "./sheet-extension";
import { sameName } from "./sheet-names";
import { initialsOf } from "../scene/tokenGlyph";
import { SheetAbilities } from "./SheetAbilities";
import { SheetActions } from "./SheetActions";
import { SheetIdentityEditor } from "./SheetIdentityEditor";
import { SheetInventory } from "./SheetInventory";
import { SheetProficiencies } from "./SheetProficiencies";
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
  onClose: () => void;
}>) {
  const [feedback, setFeedback] = useState("");
  const { toast } = useToast();
  const { definitionId, definition, serverActions, derived, showEdited } = useSheetDefinition(actor, role, setFeedback);
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
  const savesOwed: ReadonlyArray<PendingSave | PlayerPendingSave> = (state?.combat.pendingSaves ?? []).filter(
    (save) => save.targetActorId === actor.id
  );
  const structuredAttacks =
    liveCombat?.active === true &&
    liveCombat.myTurn === true &&
    actor.kind === "player-character" &&
    definition !== null;
  // Outside the fight an item's action goes to the server's loose route, which rolls it and spends its charges.
  const inFight = state
    ? state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id)
    : liveCombat?.active === true;
  const onLooseUse = inFight
    ? null
    : (actionId: string) =>
        void command("action:use", { actorId: actor.id, actionId }).then((response) => {
          if (!response.ok) toast(response.message ?? "That could not be used.", { tone: "error" });
        });
  const { busy, edit } = useSheetEdit(setFeedback);
  const rolls = useSheetRolls(actor.id, setFeedback);
  const [editMode, setEditMode] = useState<null | "prof" | "identity">(null);
  // The shared per-browser dice-input preference: digital vs manual entry, and whether a typed d20
  // gets its bonus added.
  const {
    rollInput,
    bonusMode,
    sheetAttackMode,
    setRollInput: chooseRollInput,
    setBonusMode: chooseBonusMode,
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
  // The latest roll from this character, shown under the rolls bar (hidden when the log is visible).
  const latestRoll = state ? ([...state.rolls].reverse().find((roll) => roll.actorId === actor.id) ?? null) : null;
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
    beginTargeting(summaryOfOwnAction(action), actor.id, slotLevel);
    if (effectiveAttackMode === "jump") onJumpToInitiative?.();
  };
  // A leveled spell's cast: on your turn it goes through targeting with its slot; otherwise the server routes it,
  // spending the slot and rolling its dice outside a fight, or refusing off turn.
  const castSpellAction = (actionId: string, slotLevel?: number) => {
    const structured = structuredAttacks ? definition?.actions.find((action) => action.id === actionId) : undefined;
    if (structured) {
      routeAttack(structured, slotLevel);
      return;
    }
    void command("action:use", {
      actorId: actor.id,
      actionId,
      includeDamage: true,
      ...(slotLevel !== undefined ? { slotLevel } : {})
    }).then((response) => {
      if (!response.ok) toast(response.message ?? "The spell could not be cast.", { tone: "error" });
    });
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
      <SheetVitals actor={actor} role={role} definition={definition} extension={extension} onFeedback={setFeedback} />
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
            />
          ))}
        </div>
      )}
      {actor.kind === "player-character" && (
        <div className="sheet-rest-block">
          <span className="sheet-section-label">Rest</span>
          <SheetRest actorId={actor.id} hitDice={"hitDice" in actor ? actor.hitDice : null} onFeedback={setFeedback} />
        </div>
      )}

      {definition && (
        <>
          <SheetAbilities definition={definition} extension={extension} derived={derived} rolls={rolls} />
          <SheetProficiencies
            actor={actor}
            definition={definition}
            derived={derived}
            rolls={rolls}
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
            castSpellAction={castSpellAction}
            routeSpell={(spell) => {
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
        <IconButton
          label={embedded ? "Back to initiative" : "Close"}
          size="sm"
          className="sheet-close"
          onClick={onClose}
        >
          <IconX />
        </IconButton>
      </div>
    </div>
  );

  // Roll-input settings: a narrow bar pinned under the header.
  const rollbar = definition ? (
    <div className="sheet-rollbar" role="group" aria-label="Roll entry settings">
      <span className="sheet-settings-label">Rolls</span>
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
      {rollInput === "manual" && (
        <SegmentedControl
          size="sm"
          ariaLabel="Typed bonus handling"
          value={bonusMode}
          onChange={(mode) => chooseBonusMode(mode as "auto" | "total")}
          options={[
            { value: "auto", label: "Auto-add bonus" },
            { value: "total", label: "Final total" }
          ]}
        />
      )}
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

  // Embedded (e.g. the player's initiative panel): fills its container, no modal chrome, and × goes
  // back to the initiative view. No state is passed, so no dice log.
  if (embedded)
    return (
      <>
        <div className="sheet-embedded">{buildWorkspace(false)}</div>
        {rolls.dialog}
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
    </>
  );
}
