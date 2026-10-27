import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cx } from "./util";
import "./LifeBar.css";

/** Exact hit points, as the viewer's projection holds them. */
export type ExactHp = Readonly<{ current: number; maximum: number; temporary?: number }>;
/** A health band (Healthy, Bloodied, Down) for a viewer the projection gives no numbers. */
export type HpBand = Readonly<{ label: string; band: "healthy" | "bloodied" | "down" }>;

const segmentsFor = (maximum: number) => Math.min(22, Math.max(1, Math.ceil(maximum / 2)));

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
    return (
      <div className={cx("nh-lifebar", "nh-lifebar--band", `nh-lifebar--${band.band}`, className)}>
        <span className="nh-lifebar-head">
          <span className="nh-lifebar-hp">HP</span>
          <span className="nh-lifebar-band">{band.label}</span>
        </span>
        <span className="nh-lifebar-indicator" aria-hidden="true" />
      </div>
    );
  }
  return <ExactLifeBar hp={hp} showNumbers={showNumbers} className={className} />;
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
  const label = `${current} of ${maximum} hit points${temporary > 0 ? `, ${temporary} temporary` : ""}`;
  const hit = useDamageFlash(current);
  return (
    <div className={cx("nh-lifebar", hit && "is-hit", className)} role="img" aria-label={label}>
      {showNumbers && (
        <span className="nh-lifebar-head" aria-hidden="true">
          <span className="nh-lifebar-hp">HP</span>
          <span className="nh-lifebar-number">
            {current}
            <span className="nh-lifebar-max">/{maximum}</span>
            {temporary > 0 && <span className="nh-lifebar-temp"> +{temporary}</span>}
          </span>
        </span>
      )}
      <span className="nh-lifebar-well" aria-hidden="true" style={{ "--nh-segments": segments } as CSSProperties}>
        <span className="nh-lifebar-segments nh-lifebar-lost" />
        <span
          className="nh-lifebar-segments nh-lifebar-left"
          style={{ clipPath: `inset(0 ${(1 - share) * 100}% 0 0)` }}
        />
      </span>
    </div>
  );
}

/** True for two frames after current hit points fall, so the lost segments flash white once. */
function useDamageFlash(current: number): boolean {
  const previous = useRef(current);
  const [hit, setHit] = useState(false);
  useEffect(() => {
    const fell = current < previous.current;
    previous.current = current;
    if (!fell) return;
    setHit(true);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setHit(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [current]);
  return hit;
}
