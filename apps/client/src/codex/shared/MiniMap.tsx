import { Skeleton, cx } from "@vtt/ui";
import { useAuthorizedMapImage } from "../../scene/mapImage";
import { iconChildren, pinSwatchVar } from "../icons";
import "./shared.css";

export type MiniMapPin = Readonly<{
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  isParty?: boolean;
}>;

/**
 * A still crop of a map around one pin: the page's place on the atlas, the party's position on Home, a page's
 * header on a phone. It never pans or takes a drag, so it needs no drag surface; pressing it is the caller's
 * button. The label stays at one size on screen, whatever the crop.
 */
export function MiniMap({
  token,
  assetId,
  pin,
  height,
  span = 700,
  className
}: Readonly<{
  token: string;
  assetId: string;
  pin: MiniMapPin;
  /** The crop's height on screen, in pixels; it fills the width it is given. */
  height: number;
  /** How many image pixels the crop's width covers. */
  span?: number;
  className?: string;
}>) {
  const image = useAuthorizedMapImage(assetId, token);
  if (image.status !== "ready")
    return (
      <div className={cx("cx-minimap", className)} style={{ height }}>
        {image.status === "loading" ? <Skeleton variant="block" /> : <p className="cx-hint">{image.message}</p>}
      </div>
    );
  const width = Math.min(span, image.width);
  const viewHeight = Math.min(image.height, width * 0.6);
  const left = Math.min(Math.max(0, pin.x - width / 2), image.width - width);
  const top = Math.min(Math.max(0, pin.y - viewHeight / 2), image.height - viewHeight);
  const scale = width / 360;
  return (
    <div className={cx("cx-minimap", className)} style={{ height }}>
      <svg
        viewBox={`${left} ${top} ${width} ${viewHeight}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={pin.label ? `${pin.label} on the map` : "The pin on the map"}
      >
        <image href={image.url} x={0} y={0} width={image.width} height={image.height} />
        <g transform={`translate(${pin.x} ${pin.y}) scale(${scale})`}>
          {pin.isParty && <circle r={18} className="cx-minimap-ring" />}
          <circle r={13} className="cx-minimap-disc" />
          <svg x={-9} y={-9} width={18} height={18} viewBox="0 0 24 24" style={{ color: pinSwatchVar(pin.iconColor) }}>
            <g fill="currentColor">{iconChildren(pin.iconId)}</g>
          </svg>
          {pin.label && (
            <text y={30} textAnchor="middle" className="cx-minimap-label">
              {pin.label}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
