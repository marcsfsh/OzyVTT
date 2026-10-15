import { useEffect, useId, useState, type CSSProperties } from "react";

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export type TokenGlyphProps = Readonly<{
  sizePx: number;
  name: string;
  active?: boolean;
  /** Optional portrait; drawn clipped to the token circle. Missing or failed loads fall back to initials. */
  imageUrl?: string | null;
  turnClassName: string;
  bodyClassName: string;
  initialsClassName: string;
  nameClassName: string;
  nameY: number;
  initialsStyle?: CSSProperties;
  nameStyle?: CSSProperties;
}>;

/**
 * The drawing of a map token (turn ring, body, portrait-or-initials, name), shared by the encounter
 * canvas and the shared-screen viewer. Callers supply class names and sizing and wrap it in their own
 * `<g>` with whatever interaction they need.
 */
export function TokenGlyph({
  sizePx,
  name,
  active,
  imageUrl,
  turnClassName,
  bodyClassName,
  initialsClassName,
  nameClassName,
  nameY,
  initialsStyle,
  nameStyle
}: TokenGlyphProps) {
  const clipId = useId();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);
  const radius = sizePx / 2;
  const showImage = imageUrl != null && imageUrl !== "" && !failed;
  return (
    <>
      {active && <circle className={turnClassName} r={sizePx * 0.64} />}
      <circle className={bodyClassName} r={radius} />
      {showImage ? (
        // The portrait fills the body circle (cover-cropped) with the ring redrawn on top so the border stays
        // crisp; a broken or forbidden image falls back to initials via onError.
        <>
          <clipPath id={clipId}>
            <circle r={radius} />
          </clipPath>
          <image
            href={imageUrl ?? undefined}
            x={-radius}
            y={-radius}
            width={sizePx}
            height={sizePx}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
            onError={() => setFailed(true)}
          />
          <circle className={bodyClassName} r={radius} style={{ fill: "none" }} />
        </>
      ) : (
        <text className={initialsClassName} style={initialsStyle}>
          {initialsOf(name)}
        </text>
      )}
      <text className={nameClassName} y={nameY} style={nameStyle}>
        {name}
      </text>
    </>
  );
}

/**
 * Original 16×16 glyphs for the SRD conditions, so a token reads "poisoned, prone" rather than
 * "P, P". Unknown ids fall back to the initial letter. Single filled paths (evenodd carves cutouts).
 */
export const CONDITION_GLYPHS: Record<string, string> = {
  blinded:
    "M8 4.6C4.9 4.6 2.6 8 2.6 8s2.3 3.4 5.4 3.4S13.4 8 13.4 8 11.1 4.6 8 4.6zm0 1.9A1.5 1.5 0 1 1 8 9.5 1.5 1.5 0 0 1 8 6.5zM3.9 2.8l9.3 9.3-1.1 1.1L2.8 3.9z",
  charmed: "M8 13.4 3.4 8.8a3 3 0 0 1 4.2-4.2l.4.4.4-.4a3 3 0 0 1 4.2 4.2z",
  deafened: "M3 6.2v3.6h2.4L9 12.8V3.2L5.4 6.2H3zM12.1 3l1.1 1.1-8.2 8.2-1.1-1.1z",
  exhaustion: "M3.2 3.6h5.6v1.6L5.6 8.4h3.2V10H3.2V8.4l3.2-3.2H3.2zM9.4 9.4h4v1.3l-2.1 2.1h2.1V14h-4v-1.3l2.1-2.1H9.4z",
  frightened: "M6.9 2.6h2.2v6.8H6.9zM6.9 11h2.2v2.4H6.9z",
  grappled:
    "M5.4 4.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 1.7a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM10.6 4.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 1.7a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z",
  incapacitated:
    "M7.1 2.2h1.8v4l3.5-2 .9 1.5-3.5 2 3.5 2-.9 1.6-3.5-2v4H7.1v-4l-3.5 2-.9-1.6 3.5-2-3.5-2 .9-1.5 3.5 2z",
  invisible:
    "M8 2.8a4.2 4.2 0 0 0-4.2 4.2v6.2l1.7-1.4 1.25 1.4L8 11.8l1.25 1.4 1.25-1.4 1.7 1.4V7A4.2 4.2 0 0 0 8 2.8z",
  paralyzed: "M9.2 2 3.8 9h3l-1.2 5 5.6-7.2h-3z",
  petrified: "M5.2 3.2h5.6l2.8 4.8-2.8 4.8H5.2L2.4 8z",
  poisoned: "M8 2.2S4.2 7 4.2 9.8a3.8 3.8 0 0 0 7.6 0C11.8 7 8 2.2 8 2.2z",
  prone: "M2.2 9.4h8.6v2.6H2.2zM13 12.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z",
  restrained: "M3.2 3h1.8v10H3.2zM7.1 3h1.8v10H7.1zM11 3h1.8v10H11z",
  stunned: "M8 2.2l1.5 3.6 3.9.3-3 2.6.9 3.8L8 10.4l-3.3 2.1.9-3.8-3-2.6 3.9-.3z",
  unconscious: "M10.5 2.5A6 6 0 1 0 13.5 12 7 7 0 0 1 10.5 2.5z"
};

export type TokenConditionBadge = Readonly<{ id: string | null; label: string }>;

/** Coarse band -> fill fraction (healthy full, bloodied ~half, down a sliver); the single source for token bars/rings, the viewer and the initiative bar. */
export function bandFraction(band: "healthy" | "bloodied" | "down"): number {
  return band === "healthy" ? 1 : band === "bloodied" ? 0.45 : 0.06;
}

/** Fill fraction for a token health bar/ring: exact when the audience holds exact HP (the GM, or a player's own character), else the coarse band fraction, so nobody else's exact HP is implied. React-only, so the viewer can share it without the socket. */
export function hpFillFraction(
  hp:
    | { current: number; maximum: number; temporary: number }
    | { kind: "exact"; current: number; maximum: number; temporary: number }
    | { kind: "band"; band: "healthy" | "bloodied" | "down" }
): number {
  if ("kind" in hp && hp.kind === "band") return bandFraction(hp.band);
  const exact = hp as { current: number; maximum: number };
  return exact.maximum > 0 ? Math.max(0, Math.min(1, exact.current / exact.maximum)) : 0;
}

/** Band class for token health fill/stroke/stop-color: cyan healthy (>50%), magenta bloodied
    (25-50%), danger below. A class rather than a hex so it follows the theme tokens. */
export function healthFillClass(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  if (clamped > 0.5) return "hp-fill-healthy"; // --cyan
  if (clamped > 0.25) return "hp-fill-bloodied"; // --magenta
  return "hp-fill-down"; // --danger
}

/**
 * A soft glow coloured by the health fraction, hugging the token's edge and fading outward. Rendered
 * under the token (before TokenGlyph), so the body and active-turn ring paint over it. SVG space.
 */
export function TokenHealthAura({ sizePx, fraction }: Readonly<{ sizePx: number; fraction: number }>) {
  const gradientId = useId();
  const clamped = Math.max(0, Math.min(1, fraction));
  const bandClass = healthFillClass(clamped);
  // A thin band from the body edge (0.5) out to 0.86, peaking at the edge; the inner half is hidden
  // behind the opaque body.
  const outer = sizePx * 0.86;
  const edge = Math.round(((sizePx * 0.5) / outer) * 100);
  return (
    <g className="token-health-aura">
      <title>{`${Math.round(clamped * 100)}% health`}</title>
      <defs>
        <radialGradient id={gradientId}>
          <stop className={bandClass} offset="0%" stopOpacity="0.5" />
          <stop className={bandClass} offset={`${edge}%`} stopOpacity="0.5" />
          <stop className={bandClass} offset="100%" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r={outer} fill={`url(#${gradientId})`} />
    </g>
  );
}

/**
 * A token health indicator shown instead of the band dot when the GM opts in: a thin HP bar under
 * the token, or a ring around it (the aura renders separately, behind the token). The fraction is
 * always audience-safe: the server only sends this style when allowed, and non-owners get a
 * band-derived fraction.
 */
function TokenHealthBar({
  sizePx,
  style,
  fraction
}: Readonly<{ sizePx: number; style: "bar" | "ring"; fraction: number }>) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const bandClass = healthFillClass(clamped);
  const title = `${Math.round(clamped * 100)}% health`;
  if (style === "ring") {
    const r = sizePx * 0.5 + Math.max(2, sizePx * 0.06);
    const circumference = 2 * Math.PI * r;
    const strokeWidth = Math.max(2, sizePx * 0.09);
    // rotate -90 so the arc grows clockwise from the top of the token.
    return (
      <g className="token-health-ring" transform="rotate(-90)">
        <title>{title}</title>
        <circle className="token-health-ring-track" r={r} fill="none" strokeWidth={strokeWidth} />
        <circle
          className={`token-health-ring-fill ${bandClass}`}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
        />
      </g>
    );
  }
  const width = sizePx * 0.92;
  const height = Math.max(3, sizePx * 0.12);
  const y = sizePx * 0.52;
  return (
    <g className="token-health-bar">
      <title>{title}</title>
      <rect className="token-health-bar-track" x={-width / 2} y={y} width={width} height={height} rx={height / 2} />
      <rect
        className={`token-health-bar-fill ${bandClass}`}
        x={-width / 2}
        y={y}
        width={width * clamped}
        height={height}
        rx={height / 2}
      />
    </g>
  );
}

/**
 * Health/condition badges over a token: a bloodied/down dot at the top-right (or the GM's opted-in
 * bar or ring instead) and up to three condition glyphs beneath the body (+N overflow). Shared by the
 * table client and the viewer.
 */
export function TokenStatusBadges({
  sizePx,
  health,
  conditions,
  healthBar
}: Readonly<{
  sizePx: number;
  health: "healthy" | "bloodied" | "down";
  conditions: readonly TokenConditionBadge[];
  healthBar?: Readonly<{ style: "bar" | "ring"; fraction: number }>;
}>) {
  const radius = Math.max(4, sizePx * 0.11);
  const shown = conditions.slice(0, 3);
  const overflow = conditions.length - shown.length;
  const badgeY = sizePx * 0.5 + radius * 1.15;
  const startX = -(shown.length + (overflow > 0 ? 1 : 0) - 1) * radius * 1.1;
  const names = conditions.map((condition) => condition.label).join(", ");
  return (
    <>
      {healthBar ? (
        <TokenHealthBar sizePx={sizePx} style={healthBar.style} fraction={healthBar.fraction} />
      ) : (
        health !== "healthy" && (
          <circle className={`token-health token-health-${health}`} cx={sizePx * 0.38} cy={-sizePx * 0.38} r={radius}>
            <title>{health === "down" ? "Down" : "Bloodied"}</title>
          </circle>
        )
      )}
      {shown.map((condition, index) => {
        const glyph = condition.id !== null ? CONDITION_GLYPHS[condition.id] : undefined;
        return (
          <g
            key={condition.label}
            className="token-condition"
            transform={`translate(${startX + index * radius * 2.2} ${badgeY})`}
          >
            <title>{names}</title>
            <circle r={radius} />
            {glyph ? (
              // The 16×16 glyph box scales onto the badge's inscribed square, centered on the circle.
              <path
                className="token-condition-glyph"
                d={glyph}
                fillRule="evenodd"
                transform={`translate(${-radius * 0.82} ${-radius * 0.82}) scale(${(radius * 1.64) / 16})`}
              />
            ) : (
              <text style={{ fontSize: radius * 1.25 }}>{condition.label[0]?.toUpperCase() ?? "?"}</text>
            )}
          </g>
        );
      })}
      {overflow > 0 && (
        <g
          className="token-condition token-condition-more"
          transform={`translate(${startX + shown.length * radius * 2.2} ${badgeY})`}
        >
          <title>{names}</title>
          <circle r={radius} />
          <text style={{ fontSize: radius * 1.1 }}>+{overflow}</text>
        </g>
      )}
    </>
  );
}
