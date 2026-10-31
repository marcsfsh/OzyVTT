import { useRef, type ReactNode } from "react";
import { IconCheck, LifeBar, Roll, burst, canMove, comet, countUp, useOnChange } from "@vtt/ui";
import { command } from "../lib/command";
import { HpControls } from "./HitPoints";
import { RestMenu } from "./PlayTab";
import type { exactHp, SheetActor } from "./sheet-model";

type ExactHp = NonNullable<ReturnType<typeof exactHp>>;

/** The numbers the band reads, worked out once by the sheet. */
export type BandFigures = Readonly<{
  armorClass: number | null;
  armorSetByGm: boolean;
  initiative: string;
  speed: Readonly<{ now: number | null; base: number | null; lowered: boolean; modes: string | null }>;
  proficiency: string | null;
  inspired: boolean | undefined;
  hp: ExactHp | null;
  down: boolean;
  /** "5/7 d6", or null for a creature without Hit Point Dice. */
  hitDice: Readonly<{ remaining: number; maximum: number; dice: string }> | null;
}>;

/** What both bands share: who is acting, the rest's state, and where a change is reported. */
type BandBase = Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  figures: BandFigures;
  portrait: ReactNode;
  name: ReactNode;
  /** Rest is taken between fights, so it leaves while one runs. */
  canRest: boolean;
  restAsked: boolean;
  /** Opens the "Hit Points" dialog, which keeps the damage type and the GM's controls. */
  onOpenHp: () => void;
  /** What the Hit Points button says it opens. */
  hpWords: string;
  onFeedback: (text: string) => void;
}>;

/** A cell of the stats plate: its label over its value. */
function Cell({
  label,
  className,
  note,
  title,
  children
}: Readonly<{ label: ReactNode; className: string; note?: ReactNode; title?: string; children: ReactNode }>) {
  return (
    <div className={`cs-cell ${className}`} title={title}>
      <span className="cs-cell-k">{label}</span>
      <span className="cs-cell-v">{children}</span>
      {note && <span className="cs-cell-n">{note}</span>}
    </div>
  );
}

/** The current hit points, counting to a new value as the life bar's light runs (ADR-0045). */
function HpNow({ hp }: Readonly<{ hp: ExactHp }>) {
  const big = useRef<HTMLElement>(null);
  useOnChange(hp.current, (before, now) => {
    if (big.current) void countUp(big.current, before, now, { delay: 40, dur: 230 });
  });
  return (
    <strong ref={big} className="cs-hp-now">
      {hp.current}
    </strong>
  );
}

const hpName = (hp: ExactHp, down: boolean, words: string) =>
  `Hit Points ${hp.current} of ${hp.maximum}${down ? ", dying" : ""}. ${words}`;

/**
 * Heroic Inspiration as a square, lit cyan with a tick while held. The GM gives and takes it back here; a player reads
 * it. Gaining it runs a comet along the square's base with a burst at its end (ADR-0045).
 */
function InspirationCell({
  actor,
  role,
  inspired,
  onFeedback
}: Readonly<{ actor: SheetActor; role: "gm" | "player"; inspired: boolean; onFeedback: (text: string) => void }>) {
  const cell = useRef<HTMLDivElement>(null);
  useOnChange(inspired, (_was, now) => {
    const el = cell.current;
    if (!now || !el || !canMove()) return;
    const bottom = el.clientHeight - 1;
    comet(el, { from: 0, to: el.clientWidth, line: bottom, thick: 2, tone: "gold", delay: 0, dur: 300 });
    burst(el, { at: el.clientWidth, line: bottom, delay: 280, w: 70, tone: "gold" });
  });
  const square = (
    <span className={`cs-insp-box${inspired ? " is-on" : ""}`} aria-hidden="true">
      {inspired && <IconCheck />}
    </span>
  );
  const toggle = () =>
    void command("actor:set-heroic-inspiration", { actorId: actor.id, has: !inspired }).then((result) => {
      if (!result.ok) onFeedback(result.message ?? "Heroic Inspiration could not be changed.");
      else
        onFeedback(
          inspired ? `${actor.name} no longer has Heroic Inspiration.` : `${actor.name} has Heroic Inspiration.`
        );
    });
  return (
    <div ref={cell} className="cs-cell cs-cell-insp">
      <span className="cs-cell-k">Inspiration</span>
      {role === "gm" && actor.kind === "player-character" ? (
        <button
          type="button"
          className="cs-insp tap-target"
          aria-pressed={inspired}
          aria-label={inspired ? "Heroic Inspiration held. Take it back" : "No Heroic Inspiration. Give it"}
          onClick={toggle}
        >
          {square}
        </button>
      ) : (
        <span className="cs-insp" role="img" aria-label={`Heroic Inspiration ${inspired ? "held" : "not held"}`}>
          {square}
        </span>
      )}
    </div>
  );
}

/** A lowered Speed names its base; the laptop's cell also names the other modes (swim 30 ft). */
const speedNote = (speed: BandFigures["speed"], modes = false) =>
  speed.lowered ? `of ${speed.base} ft` : modes ? speed.modes : null;

/**
 * The laptop's vitals band (ADR-0047): who the character is with their live states, one stats plate (AC, Hit Points
 * with Damage, Heal and Temp, Initiative, Speed, Proficiency and Heroic Inspiration), then Rest with the Hit Point
 * Dice under it, and the sheet's own controls.
 */
export function SheetBand({
  actor,
  role,
  figures,
  portrait,
  name,
  status,
  canRest,
  restAsked,
  onOpenHp,
  hpWords,
  onOpenHitDice,
  end,
  onFeedback
}: BandBase &
  Readonly<{
    /** The conditions, Concentration and effects with Add. */
    status: ReactNode;
    /** Opens the Hit Point Dice to spend, where the rules allow it. */
    onOpenHitDice: (() => void) | null;
    /** The GM tag, the menu, Close and the standalone page's theme switch. */
    end: ReactNode;
  }>) {
  const { hp, down } = figures;
  return (
    <header className="cs-band">
      <div className="cs-band-id">
        {portrait}
        <span className="cs-band-who">
          {name}
          {status}
        </span>
      </div>
      <div className="cs-plate cs-card" role="group" aria-label="Vitals">
        <Cell label="AC" className="cs-cell-ac" note={figures.armorSetByGm ? "Set by GM" : null}>
          {figures.armorClass ?? "None"}
        </Cell>
        {hp && (
          <div className={`cs-cell cs-cell-hp${down ? " is-down" : ""}`}>
            <span className="cs-cell-hp-head">
              <span className={`cs-cell-k${down ? " is-danger" : ""}`}>
                {down ? "Hit points · Dying" : "Hit points"}
              </span>
              <span className="cs-hp-temp">
                Temp <Roll value={String(hp.temporary)} />
              </span>
            </span>
            <span className="cs-cell-hp-row">
              <button type="button" className="cs-hp-open" aria-label={hpName(hp, down, hpWords)} onClick={onOpenHp}>
                <HpNow hp={hp} />
                <span className="cs-hp-max">/ {hp.maximum}</span>
              </button>
              <HpControls actor={actor} role={role} band onFeedback={onFeedback} />
            </span>
            <LifeBar hp={hp} showNumbers={false} className="cs-band-life" />
          </div>
        )}
        <Cell label="Initiative" className="cs-cell-init">
          {figures.initiative}
        </Cell>
        <Cell
          label="Speed"
          className={`cs-cell-speed${figures.speed.lowered ? " is-caution" : ""}`}
          note={speedNote(figures.speed, true)}
        >
          {figures.speed.now ?? "None"}
          {figures.speed.now !== null && <small className="cs-unit">ft</small>}
        </Cell>
        {figures.proficiency !== null && (
          <Cell label="Proficiency" className="cs-cell-prof">
            {figures.proficiency}
          </Cell>
        )}
        {figures.inspired !== undefined && (
          <InspirationCell actor={actor} role={role} inspired={figures.inspired} onFeedback={onFeedback} />
        )}
      </div>
      <div className="cs-band-end">
        <div className="cs-band-rest">
          {canRest && <RestMenu actorId={actor.id} role={role} asked={restAsked} onFeedback={onFeedback} />}
          {figures.hitDice && <HitDiceButton hitDice={figures.hitDice} onOpen={onOpenHitDice} />}
        </div>
        {end}
      </div>
    </header>
  );
}

/** "Hit Point Dice 5/7 d6": a button that opens them to spend, or the count alone where nothing opens. */
function HitDiceButton({
  hitDice,
  onOpen
}: Readonly<{ hitDice: NonNullable<BandFigures["hitDice"]>; onOpen: (() => void) | null }>) {
  const words = (
    <>
      Hit Point Dice{" "}
      <strong className="cs-hd-count">
        {hitDice.remaining}/{hitDice.maximum}
      </strong>{" "}
      {hitDice.dice}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="cs-hd-open tap-target"
      aria-label={`Hit Point Dice ${hitDice.remaining} of ${hitDice.maximum} ${hitDice.dice}. Open`}
      onClick={onOpen}
    >
      {words}
    </button>
  ) : (
    <span className="cs-hd-open">{words}</span>
  );
}

/**
 * The phone's and the Table panel's band (ADR-0047): the same cells in the same order, compact. The first row names the
 * character with the level box, Rest and the menu; the second holds AC, Hit Points (one button that opens the "Hit
 * Points" dialog), Initiative and Speed.
 */
export function SheetBandCompact({
  actor,
  role,
  figures,
  portrait,
  name,
  canRest,
  restAsked,
  onOpenHp,
  hpWords,
  levelBox,
  end,
  onFeedback
}: BandBase & Readonly<{ levelBox: ReactNode; end: ReactNode }>) {
  const { hp, down } = figures;
  return (
    <header className="cs-band-c">
      <div className="cs-band-c-id">
        {portrait}
        {name}
        {levelBox}
        {canRest && <RestMenu actorId={actor.id} role={role} asked={restAsked} onFeedback={onFeedback} />}
        {end}
      </div>
      <div className="cs-plate cs-plate-c cs-card" role="group" aria-label="Vitals">
        {/* The compact cells have no room for a note: the "Hit Points" dialog names a lowered Speed's base. */}
        <Cell label="AC" className="cs-cell-ac" title={figures.armorSetByGm ? "Set by GM" : undefined}>
          {figures.armorClass ?? "None"}
        </Cell>
        <button
          type="button"
          className={`cs-cell cs-cell-hp${down ? " is-down" : ""}`}
          aria-label={hp ? hpName(hp, down, hpWords) : "Hit Points and the other vitals"}
          onClick={onOpenHp}
        >
          <span className="cs-cell-hp-head">
            <span className={`cs-cell-k${down ? " is-danger" : ""}`}>{down ? "Dying" : "Hit points"}</span>
            <span className="cs-hp-change">Change</span>
          </span>
          <span className="cs-cell-hp-row">
            {hp ? (
              <>
                <span className="cs-hp-pair">
                  <HpNow hp={hp} />
                  <span className="cs-hp-max">/ {hp.maximum}</span>
                </span>
                <span className="cs-hp-temp">{`+${hp.temporary}`}</span>
              </>
            ) : (
              <strong className="cs-hp-now">None</strong>
            )}
          </span>
          {hp && <LifeBar hp={hp} showNumbers={false} className="cs-band-life" />}
        </button>
        <Cell label="Init" className="cs-cell-init">
          {figures.initiative}
        </Cell>
        <Cell
          label="Speed"
          className={`cs-cell-speed${figures.speed.lowered ? " is-caution" : ""}`}
          title={speedNote(figures.speed) ?? undefined}
        >
          {figures.speed.now ?? "None"}
        </Cell>
      </div>
    </header>
  );
}
