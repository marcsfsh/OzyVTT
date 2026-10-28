import { useRef, useState, type CSSProperties } from "react";
import { avatarUrl, type AvatarId } from "../avatars";
import { useOnChange } from "../motion/hooks";
import { canMove, EASE } from "../motion/lightRail";
import { cx } from "./util";
import "./Portrait.css";

/**
 * Where a picture comes from: the creature's own authorized art when it has some, over its default avatar. The
 * default shows until the art has loaded and stays when the art fails, so nothing ever draws a broken image.
 */
export type PictureSource = Readonly<{ src?: string | null; fallback: AvatarId }>;

/** The picture alone, filling its box. Both images are decoration; the caller names the creature. */
export function Picture({ picture, className }: Readonly<{ picture: PictureSource; className?: string }>) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const art = picture.src && picture.src !== failed ? picture.src : null;
  const showArt = art !== null && loaded === art;
  return (
    <span className={cx("nh-picture", className)} aria-hidden="true">
      {!showArt && <img className="nh-picture-img" src={avatarUrl(picture.fallback)} alt="" draggable={false} />}
      {art && (
        <img
          className={cx("nh-picture-img", "nh-picture-art", showArt && "is-loaded")}
          src={art}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(art)}
          onError={() => setFailed(art)}
        />
      )}
    </span>
  );
}

/** Whose side a portrait's edge shows: the party, an enemy, or hidden from players (dashed violet, GM only). */
export type PortraitFrame = "party" | "hostile" | "hidden" | "neutral";

const SIZES = { xs: 28, sm: 32, md: 48, lg: 60, xl: 112 } as const;

/**
 * A creature's picture in its frame. `now` puts it in the sun frame, which means it is acting. A `badge` (initials)
 * tells apart two visible creatures that share a picture. `dim` fades the decoration of one that has acted. `down`
 * greys and fades a creature at 0 hit points, and it dims as the creature drops (ADR-0045).
 */
export function Portrait({
  picture,
  name,
  frame = "neutral",
  now = false,
  size = "md",
  shape = "square",
  badge,
  dim = false,
  down = false,
  className
}: Readonly<{
  picture: PictureSource;
  /** When given, the portrait is an image with this name; leave it out where the name is printed beside it. */
  name?: string;
  frame?: PortraitFrame;
  now?: boolean;
  size?: keyof typeof SIZES;
  shape?: "square" | "round";
  badge?: string;
  dim?: boolean;
  down?: boolean;
  className?: string;
}>) {
  const self = useRef<HTMLSpanElement>(null);
  useOnChange(down, (_was, now) => {
    const el = self.current;
    if (!now || !el || !canMove()) return;
    // Only a start keyframe: each runs to what the stylesheet paints a portrait that is down with.
    const timing = { duration: 260, delay: 140, easing: EASE.settle, fill: "backwards" as const };
    el.animate([{ offset: 0, opacity: 1 }], timing);
    el.querySelector(".nh-picture")?.animate([{ offset: 0, filter: "grayscale(0)" }], timing);
  });
  return (
    <span
      ref={self}
      className={cx(
        "nh-portrait",
        `nh-portrait--${frame}`,
        shape === "round" && "nh-portrait--round",
        now && "is-now",
        dim && "is-dim",
        down && "is-down",
        className
      )}
      style={{ "--nh-portrait": `${SIZES[size]}px` } as CSSProperties}
      {...(name ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
    >
      <Picture picture={picture} className="nh-portrait-picture" />
      {badge && (
        <span className="nh-portrait-badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </span>
  );
}
