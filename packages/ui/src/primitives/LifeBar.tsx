import { useRef, useState, type CSSProperties } from "react";
import { useOnChange } from "../motion/hooks";
import { burst, canMove, comet, countUp, EASE, fadeIn, fill, px, rel } from "../motion/lightRail";
import { cx } from "./util";
import "./LifeBar.css";

/** Exact hit points, as the viewer's projection holds them. */
export type ExactHp = Readonly<{ current: number; maximum: number; temporary?: number }>;
/** A health band (Healthy, Bloodied, Down) for a viewer the projection gives no numbers. */
export type HpBand = Readonly<{ label: string; band: "healthy" | "bloodied" | "down" }>;

const segmentsFor = (maximum: number) => Math.min(22, Math.max(1, Math.ceil(maximum / 2)));
const BAND_RANK = { down: 0, bloodied: 1, healthy: 2 } as const;
/** The segments sit 2px inside the well's edge. */
const INSET = 2;
/** The temporary hit points line is never shorter than this (LifeBar.css), so a few points still read as a line. */
const TEMP_MIN = 40;

/**
 * The life bar: every hit point readout. Exact hit points draw a segmented bar with a fill clipped to current over
 * maximum, the VT323 number and one accessible label. A band draws the band's word and its plain indicator, never
 * numbers or segments, so the bar never looks more exact than what the viewer was sent.
 */
export function LifeBar({
  hp,
  band,
  showNumbers = true,
  className
}: Readonly<{ hp?: ExactHp; band?: HpBand; showNumbers?: boolean; className?: string }>) {
  if (!hp) {
    if (!band) return null;
    return <BandLifeBar band={band} className={className} />;
  }
  return <ExactLifeBar hp={hp} showNumbers={showNumbers} className={className} />;
}

function BandLifeBar({ band, className }: Readonly<{ band: HpBand; className?: string }>) {
  const bar = useRef<HTMLDivElement>(null);
  // A band moving runs light the length of its line, left as it worsens and right as it mends, with no number.
  useOnChange(band.band, (before, now) => {
    const el = bar.current;
    const line = el?.querySelector<HTMLElement>(".nh-lifebar-indicator");
    if (!el || !line || !canMove()) return;
    const box = rel(line, el);
    const worse = BAND_RANK[now] < BAND_RANK[before];
    const [from, to] = worse ? [box.r, box.x] : [box.x, box.r];
    comet(el, { from, to, line: box.cy, thick: 3, tone: worse ? "red" : "gold", delay: 40, dur: 230 });
    burst(el, { at: to, line: box.cy, w: 70, tone: worse ? "red" : "gold", delay: 250 });
    const word = el.querySelector(".nh-lifebar-band");
    if (word) fadeIn(word, { delay: 60, dur: 160 });
  });
  return (
    <div ref={bar} className={cx("nh-lifebar", "nh-lifebar--band", `nh-lifebar--${band.band}`, className)}>
      <span className="nh-lifebar-head">
        <span className="nh-lifebar-hp">HP</span>
        <span className="nh-lifebar-band">{band.label}</span>
      </span>
      <span className="nh-lifebar-indicator" aria-hidden="true" />
    </div>
  );
}

function ExactLifeBar({
  hp,
  showNumbers,
  className
}: Readonly<{ hp: ExactHp; showNumbers: boolean; className?: string }>) {
  const maximum = Math.max(0, hp.maximum);
  const current = Math.max(0, Math.min(hp.current, maximum));
  const temporary = Math.max(0, hp.temporary ?? 0);
  const segments = segmentsFor(maximum);
  const share = maximum === 0 ? 0 : current / maximum;
  const tempShare = maximum === 0 ? 1 : Math.min(1, temporary / maximum);
  const label = `${current} of ${maximum} hit points${temporary > 0 ? `, ${temporary} temporary` : ""}`;
  const hit = useDamageFlash(current);
  const bar = useRef<HTMLDivElement>(null);
  useOnChange(current, (before, now) => {
    const el = bar.current;
    if (el) hitPointsMove(el, before, now, maximum);
  });
  useOnChange(temporary, (before, now) => {
    const el = bar.current;
    if (el) temporaryMove(el, before, now, maximum);
  });
  return (
    <div ref={bar} className={cx("nh-lifebar", hit && "is-hit", className)} role="img" aria-label={label}>
      {showNumbers && (
        <span className="nh-lifebar-head" aria-hidden="true">
          <span className="nh-lifebar-hp">HP</span>
          <span className="nh-lifebar-number">
            <span className="nh-lifebar-now">{current}</span>
            <span className="nh-lifebar-max">/{maximum}</span>
            {temporary > 0 && <span className="nh-lifebar-temp"> +{temporary}</span>}
          </span>
        </span>
      )}
      <span className="nh-lifebar-well" aria-hidden="true" style={{ "--nh-segments": segments } as CSSProperties}>
        <span className="nh-lifebar-segments nh-lifebar-lost" />
        <span className="nh-lifebar-segments nh-lifebar-left" style={{ clipPath: clipFor(share) }} />
        <span
          className={cx("nh-lifebar-templine", temporary > 0 && "is-on")}
          style={{ "--nh-temp": tempShare } as CSSProperties}
        />
      </span>
    </div>
  );
}

const clipFor = (share: number) => `inset(0 ${(1 - share) * 100}% 0 0)`;

/**
 * Hit points moving (ADR-0045, group 5): light runs along the bar's top edge from the old value to the new, red as
 * they fall and gold as they rise, with the fill and the number following it.
 */
function hitPointsMove(bar: HTMLElement, from: number, to: number, maximum: number) {
  const well = bar.querySelector<HTMLElement>(".nh-lifebar-well");
  if (!well || !canMove() || maximum <= 0) return;
  const inner = well.clientWidth - INSET * 2;
  const at = (value: number) => INSET + inner * (value / maximum);
  const tone = to < from ? "red" : "gold";
  // Dropping to 0 drains a little slower, so the bar reads as emptying.
  const dur = to === 0 ? 300 : 230;
  const delay = 40;
  well
    .querySelector(".nh-lifebar-left")
    ?.animate([{ clipPath: clipFor(from / maximum) }, { clipPath: clipFor(to / maximum) }], {
      duration: dur,
      delay,
      easing: EASE.travel,
      fill: "backwards"
    });
  comet(well, { from: at(from), to: at(to), line: 0, tone, delay, dur });
  burst(well, { at: at(to), line: 0, tone, delay: delay + dur - 20 });
  const number = bar.querySelector(".nh-lifebar-now");
  if (number) void countUp(number, from, to, { delay, dur });
}

/**
 * Temporary hit points: arriving, a cyan line draws along the top of the bar behind its own comet and the readout
 * appears. Spent, the line shortens behind a red comet.
 */
function temporaryMove(bar: HTMLElement, from: number, to: number, maximum: number) {
  const well = bar.querySelector<HTMLElement>(".nh-lifebar-well");
  const line = well?.querySelector<HTMLElement>(".nh-lifebar-templine");
  if (!well || !line || !canMove()) return;
  const inner = well.clientWidth - INSET * 2;
  const length = (value: number) =>
    value <= 0 ? 0 : Math.min(inner, Math.max(TEMP_MIN, inner * (maximum > 0 ? value / maximum : 1)));
  const top = line.offsetTop + line.offsetHeight / 2;
  if (from === 0) {
    fill(line, { origin: "0%", delay: 40, dur: 230 });
    comet(well, { from: INSET, to: INSET + length(to), line: top, thick: 3, tone: "cyan", delay: 40, dur: 230 });
    burst(well, { at: INSET + length(to), line: top, w: 70, tone: "cyan", delay: 240 });
    const readout = bar.querySelector(".nh-lifebar-temp");
    if (readout) fadeIn(readout, { delay: 200, dur: 160 });
    return;
  }
  line.animate([{ width: px(length(from)) }, { width: px(length(to)) }], {
    duration: 230,
    delay: 40,
    easing: EASE.travel,
    fill: "backwards"
  });
  comet(well, {
    from: INSET + length(from),
    to: INSET + length(to),
    line: top,
    thick: 3,
    tone: to < from ? "red" : "cyan",
    delay: 40,
    dur: 230
  });
}

/** True for two frames after current hit points fall, so the lost segments flash white once. */
function useDamageFlash(current: number): boolean {
  const [hit, setHit] = useState(false);
  useOnChange(current, (before, now) => {
    if (now >= before) return;
    setHit(true);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setHit(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });
  return hit;
}
