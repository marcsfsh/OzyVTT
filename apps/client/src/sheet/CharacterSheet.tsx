import { useCallback, useEffect, useId, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { GmActor, GmView, PlayerActor } from "@vtt/domain";
import {
  Avatar,
  Button,
  Chip,
  GmOnlyTag,
  IconButton,
  IconSkull,
  IconX,
  Meter,
  Modal,
  ToastOutlet,
  useToast
} from "@vtt/ui";
import { abilityModifier } from "@vtt/rules-5e";
import { DicePanel } from "../dice/DicePanel";
import { useRollPreference } from "../dice/roll-preference";
import { signed } from "../encounter/format";
import { PlayerActionRunner } from "../encounter/PlayerActionRunner";
import type { SrdExtension } from "../encounter/sheet-extension";
import { setTargetingResult, useTargeting } from "../encounter/targeting";
import { useMediaQuery } from "../lib/useMediaQuery";
import { TokenLibrary } from "../tokens/TokenLibrary";
import { ChecksTab } from "./ChecksTab";
import { FeaturesTab, NextLevel } from "./FeaturesTab";
import { GearTab } from "./GearTab";
import { GmTools } from "./GmTools";
import { HitPointDice } from "./HitPointDice";
import { HpCard } from "./HitPoints";
import { IdentityEditor } from "./IdentityEditor";
import { LatestRoll, useSessionRoll } from "./LatestRoll";
import { LevelBox } from "./LevelBox";
import { NotesTab } from "./NotesTab";
import { PlayFight } from "./PlayFight";
import { DeathSavesCard, PlayCalm, StatTile } from "./PlayTab";
import {
  armorClassOf,
  characterLevel,
  exactHp,
  heroicInspirationOf,
  identityLine,
  isDown,
  levelUpTarget,
  mayLevel,
  soleClassName,
  speedOf,
  type SheetState
} from "./sheet-model";
import { type DetailPlace } from "./SheetDetail";
import { RollSettings, SheetMenu, type SheetMenuItems } from "./SheetMenu";
import { SheetTabBar, SheetTabStrip, sheetTabs, tabIds, type SheetTabId } from "./SheetTabs";
import { SpellsTab } from "./SpellsTab";
import { StatusStrip } from "./StatusStrip";
import { useSheetController, type SheetCombat } from "./useSheetController";
import { useSheetDefinition } from "./useSheetDefinition";
import { useSheetEdit } from "./useSheetEdit";
import { useSheetRolls } from "./useSheetRolls";
import { poolsOf } from "./Uses";
import { useRememberedTab } from "../table/TablePanel";
import "./sheet.css";

/** Where the sheet sits: a page of its own (My character, `/characters/<id>`, `sheet.html`), a dialog over the page
 *  it was opened from, or the table's panel. */
export type SheetPresentation = "page" | "dialog" | "panel";

/** A laptop's sheet has three columns from this width; below it a phone's narrow sheet with its tabs under the thumb. */
const WIDE_QUERY = "(min-width: 980px)";

/** What the caller offers the menu: the player's extras on My character, and the doors only some callers have. */
export type SheetDoors = Pick<SheetMenuItems, "party" | "createCharacter" | "release">;

/**
 * The character sheet (ADR-0030). A pinned header holds the numbers read most and every live state; tabs hold the rest:
 * Play, Checks, Spells, Gear, Features and Notes. A phone puts the tabs under the thumb; a laptop gives the checks and
 * the Hit Points columns of their own; the table's panel shows one compact row and the tabs as a strip. The server
 * decides every roll and change; the sheet shows what it reports and sends commands.
 */
export function CharacterSheet({
  actor,
  role,
  state,
  presentation = "dialog",
  phone = false,
  hidePlay = false,
  combat,
  onJumpToInitiative,
  top,
  end,
  doors,
  token,
  onLevel,
  onClose
}: Readonly<{
  actor: GmActor | PlayerActor;
  role: "gm" | "player";
  state?: SheetState;
  presentation?: SheetPresentation;
  /** The table's panel is in its phone layout. */
  phone?: boolean;
  /** The table's Sheet tab in a fight, where its Turn tab already shows Play. */
  hidePlay?: boolean;
  /** The fight a player's own sheet acts in, passed by the table's panel. */
  combat?: SheetCombat;
  /** In "jump" mode an attack tapped on the table's sheet is aimed on its Turn tab. */
  onJumpToInitiative?: () => void;
  /** A band above the tab body: the party's Short Rest on My character. */
  top?: ReactNode;
  /** What closes the tab body: the shared replays under the table's own sheet. */
  end?: ReactNode;
  doors?: SheetDoors;
  /** The caller's bearer, which the token image picker needs. */
  token?: string;
  /** Opens the level page for this character. */
  onLevel?: () => void;
  onClose: () => void;
}>) {
  const { toast } = useToast();
  // What the sheet did or refused is a toast. Stable, since the stat block's fetch depends on it.
  const say = useCallback(
    (text: string) => {
      if (text) toast(text);
    },
    [toast]
  );
  const [unloaded, setUnloaded] = useState(false);
  const sayUnloaded = useCallback(
    (text: string) => {
      setUnloaded(true);
      toast(text, { tone: "error" });
    },
    [toast]
  );
  // The GM's state carries every stored sheet, which stays current when the sheet is rebuilt.
  const liveDefinition =
    role === "gm" && state && "definitions" in state && "definitionId" in actor
      ? (state as GmView).definitions.find((entry) => entry.id === actor.definitionId)?.definition
      : undefined;
  const { definitionId, definition, serverActions, facts, derived, rechoices, spellChoices, showEdited } =
    useSheetDefinition(actor, role, sayUnloaded, liveDefinition);
  const { busy, edit } = useSheetEdit(say);
  // With the roll history the latest-roll line shows each result, so only a refusal is a toast.
  const rolls = useSheetRolls(actor.id, say, state !== undefined);
  const { sheetAttackMode } = useRollPreference();
  // Only the table's own sheet can send an attack to its Turn tab and back.
  const attackMode = onJumpToInitiative ? sheetAttackMode : "inline";
  const controller = useSheetController({
    actor,
    role,
    state,
    combat,
    definition,
    serverActions,
    attackMode,
    ...(onJumpToInitiative ? { onJumpToInitiative } : {})
  });

  // Placement.
  const wideScreen = useMediaQuery(WIDE_QUERY);
  const [floating, setFloating] = useState(false);
  const layout: "narrow" | "wide" | "panel" =
    presentation === "panel" ? "panel" : wideScreen && !floating ? "wide" : "narrow";
  // A player's phone: B's Vitals, C's turn card and cast card, B's spell list and Level box.
  const phoneViews = role === "player" && (layout === "narrow" || (layout === "panel" && phone));
  const [docked, setDocked] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [hpOpen, setHpOpen] = useState(false);
  const [editingNames, setEditingNames] = useState(false);
  const [rollSettings, setRollSettings] = useState(false);
  const [pickingToken, setPickingToken] = useState(false);
  const [detailHost, setDetailHost] = useState<HTMLElement | null>(null);
  // A cast, an item or a copy opens in the right column on a laptop, in a drawer over the GM's narrow sheet, and in
  // place on a player's phone.
  const place: DetailPlace =
    layout === "wide"
      ? { kind: "column", host: detailHost }
      : layout === "narrow" && role === "gm"
        ? { kind: "drawer" }
        : { kind: "inline" };

  const extension = (definition?.extensions["open5e.srd-2024"] ?? {}) as SrdExtension;
  const hasSpells = Boolean(definition?.spellcasting && definition.spellcasting.spells.length > 0);
  const tabs = sheetTabs({ layout, role, hasSpells, hidePlay });
  const down = isDown(actor);
  const [remembered, setTab] = useRememberedTab(`vtt.sheet.tab.${layout}`, tabs, tabs[0] ?? "play", down);
  const tab = remembered as SheetTabId;
  const idBase = `cs-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  // An attack or a cast aimed from a tab other than Play (or from the table's Sheet tab) is picked and rolled at the
  // top of that tab; the Play tab's own list holds its own.
  const aim = useTargeting();
  const [aimedHere, setAimedHere] = useState(false);
  const aimingElsewhere = attackMode === "inline" && (tab !== "play" || hidePlay);
  useEffect(() => {
    if (aim?.attackerId === actor.id && aimingElsewhere) setAimedHere(true);
  }, [aim?.attackerId, aim?.action.id, actor.id, aimingElsewhere]);

  const level = characterLevel(definition);
  const canLevel = mayLevel(role, state, actor) && onLevel !== undefined && level !== null;
  const levelUpTo = levelUpTarget(level, state);
  const inspired = heroicInspirationOf(actor);
  const speed = speedOf(actor, definition, extension, derived?.speedFeet ?? null);
  const hp = exactHp(actor);
  const pools = poolsOf(serverActions);
  const restAsked = state?.rest?.requests.includes(actor.id) ?? false;
  const session = useSessionRoll(state, actor.id);
  const canReroll =
    rolls.lastCheck !== null &&
    (state === undefined || rolls.lastCheck.rollId === session?.id) &&
    (role === "gm" || inspired === true);
  const hitDice = "hitDice" in actor ? actor.hitDice : null;
  const constitution = definition ? abilityModifier(definition.abilityScores.con) : null;

  const menuItems: SheetMenuItems = {
    ...(canLevel && !phoneViews && levelUpTo !== null ? { levelUp: { to: levelUpTo, onSelect: onLevel! } } : {}),
    ...(canLevel && !phoneViews && level! > 1 ? { levelDown: { to: level! - 1, onSelect: onLevel! } } : {}),
    ...(actor.kind === "player-character" && definition ? { editNames: () => setEditingNames(true) } : {}),
    ...(token ? { tokenImage: () => setPickingToken(true) } : {}),
    ...(layout === "wide" && state ? { dockDice: { docked, onToggle: () => setDocked((current) => !current) } } : {}),
    ...(presentation === "dialog" && wideScreen
      ? { popOut: { floating, onToggle: () => setFloating((current) => !current) } }
      : {}),
    ...(presentation === "dialog" && wideScreen && role === "player"
      ? {
          newTab: () => window.open(`/sheet.html?actor=${encodeURIComponent(actor.id)}`, `vtt-sheet-${actor.id}`)
        }
      : {}),
    ...(doors ?? {})
  };
  const menu = <SheetMenu name={actor.name} items={menuItems} onRollSettings={() => setRollSettings(true)} />;
  const levelBox =
    phoneViews && level !== null ? (
      <LevelBox
        level={level}
        className={soleClassName(definition)}
        levelUpTo={levelUpTo}
        {...(canLevel ? { onLevelUp: onLevel!, onLevelDown: onLevel! } : {})}
      />
    ) : null;
  const close =
    presentation === "dialog" ? (
      <IconButton label="Close" size="sm" className="cs-close" onClick={onClose}>
        <IconX />
      </IconButton>
    ) : null;
  const openLog = state ? () => (layout === "wide" ? setDocked(true) : setDiceOpen(true)) : null;
  const lastRoll = session ? (
    <LatestRoll roll={session} role={role} rolls={rolls} canReroll={canReroll} onOpenLog={openLog} />
  ) : canReroll ? (
    // Without the roll history (a sheet with no state) the server judges the reroll.
    <LatestRollReroll role={role} rolls={rolls} />
  ) : null;

  // The tab bodies.
  const deathCard =
    actor.deathSaves && down ? (
      <DeathSavesCard
        actor={actor}
        deathSaves={actor.deathSaves}
        myTurn={controller.liveCombat?.myTurn === true}
        canRoll={
          role === "player" &&
          (!controller.inFight || (controller.liveCombat?.myTurn === true && presentation !== "panel"))
        }
        role={role}
        onFeedback={say}
      />
    ) : null;
  const playBody = controller.inFight ? (
    <PlayFight
      actor={actor}
      role={role}
      state={state}
      definition={definition}
      serverActions={serverActions}
      facts={facts}
      place={place}
      controller={controller}
      showEconomy={presentation !== "panel"}
      card={phoneViews}
      death={deathCard}
      onFeedback={say}
    />
  ) : (
    <PlayCalm
      actor={actor}
      role={role}
      definition={definition}
      extension={extension}
      derived={derived}
      rolls={rolls}
      pools={pools}
      phoneViews={phoneViews}
      showHitDice={layout !== "wide"}
      restAsked={restAsked}
      inFight={controller.inFight}
      savesOwed={controller.savesOwed}
      death={deathCard}
      onFeedback={say}
    />
  );
  const checksBody = definition ? (
    <ChecksTab
      actor={actor}
      definition={definition}
      extension={extension}
      derived={derived}
      rolls={rolls}
      quarry={controller.quarry}
      busy={busy}
      edit={edit}
      onEdited={showEdited}
    />
  ) : null;
  const spellsBody = definition ? (
    <SpellsTab
      actor={actor}
      definition={definition}
      role={role}
      look={phoneViews ? "list" : "book"}
      place={place}
      busy={busy}
      edit={edit}
      rolls={rolls}
      onFeedback={say}
      serverActions={serverActions}
      aimed={controller.structuredAttacks}
      spellSaveDcBonus={derived?.spellSaveDcBonus ?? 0}
      policeSlots={controller.slotsPoliced}
      canPrepare={role === "gm" || Boolean(actor.preparation)}
      rechoices={rechoices}
      spellChoices={spellChoices}
      readiedActionId={
        actor.effects.flatMap((effect) => (effect.readiedSpell ? [effect.readiedSpell.actionId] : []))[0] ?? null
      }
      castSpellAction={controller.castSpellAction}
      routeSpell={(spell) => {
        const note = controller.hitExtraNote(spell.actionId);
        if (note) {
          say(note);
          return true;
        }
        const structured = controller.structuredAttacks
          ? controller.structuredActionFor({ actionId: spell.actionId ?? undefined, name: spell.name })
          : null;
        if (structured) controller.routeAttack(structured);
        return structured !== null;
      }}
    />
  ) : null;
  const gearBody =
    actor.kind === "player-character" ? (
      <GearTab
        actor={actor}
        role={role}
        busy={busy}
        edit={edit}
        place={place}
        serverActions={serverActions}
        facts={facts}
        attunementSlots={derived?.attunementSlots ?? 3}
        inFight={controller.inFight}
        actionBlocked={controller.itemBlocked}
        onUseAction={controller.itemAction}
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
    ) : (
      <p className="cs-note">{actor.name} carries nothing the sheet tracks.</p>
    );
  const featuresBody = definition ? (
    <FeaturesTab
      actor={actor}
      role={role}
      definition={definition}
      extension={extension}
      derived={derived}
      pools={pools}
      serverActions={serverActions}
      onUse={(actionId) => controller.sendThroughServer(actionId)}
      next={canLevel && levelUpTo !== null ? <NextLevel level={levelUpTo} lines={[]} onLevelUp={onLevel!} /> : null}
    />
  ) : null;
  const notesBody = (
    <NotesTab actor={actor} role={role} definition={definition} extension={extension} derived={derived} />
  );
  const gmBody = (
    <div className="cs-gm-tab">
      <GmTools actor={actor} state={state} onFeedback={say} />
      {notesBody}
    </div>
  );
  const bodyOf = (id: SheetTabId): ReactNode => {
    switch (id) {
      case "play":
        return playBody;
      case "checks":
        return checksBody;
      case "spells":
        return spellsBody;
      case "gear":
        return gearBody;
      case "features":
        return featuresBody;
      case "notes":
        return notesBody;
      case "gm":
        return gmBody;
    }
  };
  const status = <StatusStrip actor={actor} role={role} inFight={controller.inFight} onFeedback={say} />;
  const missing =
    !definition && role === "gm" && definitionId && !unloaded ? (
      <p className="cs-note">Loading the stat block.</p>
    ) : actor.kind === "player-character" && !definitionId ? (
      <p className="cs-note">No sheet yet. The GM can import this character's sheet from the Roster.</p>
    ) : null;
  const body = (
    <div
      className="cs-body scroll-y"
      role="tabpanel"
      id={tabIds(idBase, tab).panel}
      aria-labelledby={tabIds(idBase, tab).tab}
      tabIndex={0}
    >
      {missing}
      {aimedHere && definition && controller.liveCombat && role === "player" && (
        <PlayerActionRunner
          actorId={actor.id}
          definition={definition}
          revision={controller.liveCombat.revision}
          inspired={inspired === true}
          playerDamageMode={controller.liveCombat.playerDamageMode}
          targets={controller.liveCombat.targets}
          actor={actor}
          pickOnly={{
            onDone: () => {
              setAimedHere(false);
              setTargetingResult(null);
            }
          }}
        />
      )}
      {definition || tab === "play" || tab === "notes" || tab === "gm" ? bodyOf(tab) : null}
      {end}
      <p className="cs-attribution">
        Includes material from the SRD 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.
      </p>
    </div>
  );
  const toastRow = presentation === "dialog" ? <ToastOutlet className="cs-toast" /> : null;
  // On a phone's Play tab between fights the Vitals hold the numbers and live states, so the header shows only who.
  const vitalsShow = layout === "narrow" && phoneViews && tab === "play" && !controller.inFight;

  const name = (
    <span className="cs-id-text">
      <h2 className="cs-name">{actor.name}</h2>
      <span className="cs-idline">{identityLine(actor, definition, extension)}</span>
    </span>
  );
  let frame: ReactNode;
  if (layout === "wide") {
    frame = (
      <section className={`cs cs--wide${role === "gm" ? " is-gm" : ""}`} aria-label={`${actor.name} character sheet`}>
        <header className="cs-band">
          <Avatar name={actor.name} size="lg" />
          {name}
          <div className="cs-band-stats">
            <StatTile
              label="AC"
              value={armorClassOf(actor) ?? "None"}
              note={actor.armorClassOverride !== undefined ? "Set by GM" : null}
            />
            <StatTile label="Init" value={actor.initiative !== undefined ? signed(actor.initiative) : "None"} />
            <StatTile
              label="Speed"
              value={speed.now ?? "None"}
              note={speed.lowered ? `of ${speed.base} ft` : speed.modes}
              caution={speed.lowered}
            />
            {definition && (
              <StatTile label="Proficiency" value={signed(derived?.proficiencyBonus ?? definition.proficiencyBonus)} />
            )}
            {(derived?.passivePerception ?? extension.passivePerception) != null && (
              <StatTile label="Passive Perception" value={derived?.passivePerception ?? extension.passivePerception} />
            )}
            {inspired !== undefined && <StatTile label="Heroic Inspiration" value={inspired ? "Held" : "None"} />}
          </div>
          <span className="cs-grow" />
          {role === "gm" && <GmOnlyTag />}
          {menu}
          {close}
        </header>
        {status}
        {toastRow}
        {lastRoll}
        {top}
        <div className={`cs-cols${docked && state ? " has-dice" : ""}`}>
          <div className="cs-col cs-col-left scroll-y" aria-label="Checks">
            {checksBody}
          </div>
          <div className="cs-col cs-col-mid">
            <SheetTabStrip tabs={tabs} active={tab} onChange={setTab} idBase={idBase} />
            {body}
          </div>
          <div className="cs-col cs-col-right scroll-y" aria-label="Hit Points and details">
            <HpCard actor={actor} role={role} onFeedback={say} />
            {hitDice && hitDice.entries.length > 0 && actor.kind === "player-character" && (
              <HitPointDice actorId={actor.id} hitDice={hitDice} constitution={constitution} onFeedback={say} />
            )}
            {role === "gm" && <GmTools actor={actor} state={state} onFeedback={say} />}
            <div ref={setDetailHost} className="cs-detail-host" />
          </div>
          {docked && state && (
            <div className="cs-col cs-col-dice scroll-y" aria-label="Dice log">
              <DicePanel role={role} state={state} mineActorId={actor.id} />
            </div>
          )}
        </div>
      </section>
    );
  } else if (layout === "panel") {
    frame = (
      <section className="cs cs--panel" aria-label={`${actor.name} character sheet`}>
        <div className="cs-compact">
          <StatusStrip
            actor={actor}
            role={role}
            inFight={controller.inFight}
            onFeedback={say}
            leading={
              <>
                {hp && (
                  <Chip
                    className="cs-chip-hp"
                    aria-label={`Hit Points ${hp.current} of ${hp.maximum}. Change Hit Points`}
                    onClick={() => setHpOpen(true)}
                  >
                    HP {hp.current}/{hp.maximum}
                  </Chip>
                )}
                <Chip className="cs-chip-static">AC {armorClassOf(actor) ?? "None"}</Chip>
                <Chip className="cs-chip-static">
                  Init {actor.initiative !== undefined ? signed(actor.initiative) : "None"}
                </Chip>
                {down && (
                  <Chip tone="harmful" icon={<IconSkull />} className="cs-chip-static">
                    Dying
                  </Chip>
                )}
              </>
            }
          />
          {levelBox}
          {menu}
        </div>
        <SheetTabStrip tabs={tabs} active={tab} onChange={setTab} idBase={idBase} strip />
        {lastRoll}
        {top}
        {body}
      </section>
    );
  } else {
    frame = (
      <section className={`cs cs--narrow${role === "gm" ? " is-gm" : ""}`} aria-label={`${actor.name} character sheet`}>
        <header className="cs-head">
          <div className="cs-id">
            <Avatar name={actor.name} size="md" />
            {name}
            {levelBox}
            {menu}
            {close}
          </div>
          {!vitalsShow && (
            <div className="cs-tiles">
              <button
                type="button"
                className={`cs-tile-hp${down ? " is-down" : ""}`}
                aria-label={
                  hp
                    ? `Hit Points ${hp.current} of ${hp.maximum}${down ? ", dying" : ""}. Change Hit Points`
                    : "Hit Points"
                }
                onClick={() => setHpOpen(true)}
              >
                <span className="cs-stat-k">{down ? "Hit Points · Dying" : "Hit Points"}</span>
                <span className="cs-tile-hp-row">
                  <strong className="cs-stat-v">{hp ? hp.current : "None"}</strong>
                  {hp && (
                    <span className="cs-stat-n">
                      of {hp.maximum}
                      {hp.temporary > 0 ? ` · ${hp.temporary} temp` : ""}
                    </span>
                  )}
                </span>
                {hp && <Meter tone="health" value={hp.current} max={hp.maximum} />}
              </button>
              <StatTile
                label="AC"
                value={armorClassOf(actor) ?? "None"}
                note={actor.armorClassOverride !== undefined ? "Set by GM" : null}
              />
              <StatTile
                label="Speed"
                value={speed.now ?? "None"}
                note={speed.lowered ? `of ${speed.base} ft` : null}
                caution={speed.lowered}
              />
              <StatTile label="Init" value={actor.initiative !== undefined ? signed(actor.initiative) : "None"} />
            </div>
          )}
        </header>
        {!vitalsShow && status}
        {toastRow}
        {lastRoll}
        {top}
        {body}
        <SheetTabBar tabs={tabs} active={tab} onChange={setTab} idBase={idBase} />
      </section>
    );
  }

  const overlays = (
    <>
      {rolls.dialog}
      {controller.healDialog}
      {hpOpen && (
        <Modal open onClose={() => setHpOpen(false)} align="bottom" title="Hit Points">
          <HpCard actor={actor} role={role} onFeedback={say} />
        </Modal>
      )}
      {diceOpen && state && (
        <Modal open onClose={() => setDiceOpen(false)} align="bottom" title="Dice log">
          <DicePanel role={role} state={state} mineActorId={actor.id} />
        </Modal>
      )}
      {editingNames && definition && (
        <IdentityEditor
          actorId={actor.id}
          definition={definition}
          role={role}
          busy={busy}
          edit={edit}
          onEdited={showEdited}
          onDone={() => setEditingNames(false)}
        />
      )}
      {rollSettings && (
        <RollSettings
          role={role}
          visibility={rolls.visibility}
          onVisibility={rolls.setVisibility}
          attackModeChoice={onJumpToInitiative !== undefined && actor.kind === "player-character"}
          onClose={() => setRollSettings(false)}
        />
      )}
      {pickingToken && token && (
        <TokenLibrary
          actorId={actor.id}
          actorName={actor.name}
          definitionId={"definitionId" in actor ? (actor.definitionId ?? null) : null}
          currentAssetId={actor.tokenAssetId ?? null}
          token={token}
          role={role}
          onClose={() => setPickingToken(false)}
        />
      )}
    </>
  );

  if (presentation === "dialog" && floating)
    return (
      <>
        <FloatingSheet name={actor.name}>{frame}</FloatingSheet>
        {overlays}
      </>
    );
  if (presentation === "dialog")
    return (
      <>
        <Modal
          open
          onClose={onClose}
          size="full"
          accent={role === "gm" ? "violet" : "magenta"}
          className={`cs-dialog${layout === "wide" ? " is-wide" : ""}`}
          ariaLabel={`${actor.name} character sheet`}
        >
          {frame}
        </Modal>
        {overlays}
      </>
    );
  return (
    <>
      {frame}
      {overlays}
    </>
  );
}

/** Reroll without the roll history (a sheet given no state): the server judges whether the check is the latest. */
function LatestRollReroll({
  role,
  rolls
}: Readonly<{ role: "gm" | "player"; rolls: ReturnType<typeof useSheetRolls> }>) {
  return (
    <div className="cs-lastroll">
      <span className="cs-lastroll-open">
        <span className="cs-lastroll-text">
          <strong className="cs-lastroll-label">{rolls.lastCheck?.label}</strong>
        </span>
        <strong className="cs-lastroll-total">{rolls.lastCheck?.total}</strong>
      </span>
      <Button size="sm" disabled={rolls.rolling} onClick={() => void rolls.rerollCheck()}>
        {role === "gm" ? "Reroll" : "Reroll · Heroic Inspiration"}
      </Button>
    </div>
  );
}

/** The GM's sheet popped out of its dialog into a panel that moves and resizes over the page. */
function FloatingSheet({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  const [rect, setRect] = useState({ x: 48, y: 48, width: 760, height: 620 });
  const [drag, setDrag] = useState<null | {
    mode: "move" | "resize";
    grabX: number;
    grabY: number;
    start: typeof rect;
  }>(null);
  const begin = (mode: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    // Controls inside the grip still click.
    if ((event.target as Element).closest("button, summary, a, input, select")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode, grabX: event.clientX, grabY: event.clientY, start: rect });
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.grabX;
    const dy = event.clientY - drag.grabY;
    if (drag.mode === "move")
      setRect({ ...drag.start, x: Math.max(0, drag.start.x + dx), y: Math.max(0, drag.start.y + dy) });
    else
      setRect({
        ...drag.start,
        width: Math.max(360, drag.start.width + dx),
        height: Math.max(420, drag.start.height + dy)
      });
  };
  return (
    <div
      className="cs-float"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      role="dialog"
      aria-label={`${name} character sheet`}
    >
      <div className="cs-float-grip" onPointerDown={begin("move")} aria-hidden="true" />
      {children}
      <div className="cs-float-resize" aria-hidden="true" onPointerDown={begin("resize")} />
    </div>
  );
}
