import { Picture, type PictureSource } from "./Portrait";
import { cx } from "./util";
import "./Avatar.css";

type AvatarSize = "sm" | "md" | "lg";
export type AvatarPresence = "online" | "away" | "offline";

interface AvatarProps {
  /** Full name: drives the monogram and the accessible label. */
  name: string;
  /** Optional portrait/token image; falls back to the monogram. */
  src?: string;
  /** The creature's picture: its art over its default avatar. Wins over `src` and the monogram. */
  picture?: PictureSource;
  size?: AvatarSize;
  /** Optional presence dot (online / away / offline). */
  presence?: AvatarPresence;
  className?: string;
}

function monogram(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Circular identity chip: a creature's picture (its art or default avatar), an image, or a two-letter monogram, with
    an optional presence dot. For rosters, token lists, and character/creature identity across the app. */
export function Avatar({ name, src, picture, size = "md", presence, className }: AvatarProps) {
  return (
    <span
      className={cx("nh-avatar", `nh-avatar--${size}`, picture && "nh-avatar--picture", className)}
      role="img"
      aria-label={name}
    >
      {picture ? (
        <Picture picture={picture} className="nh-avatar-img" />
      ) : src ? (
        <img className="nh-avatar-img" src={src} alt="" />
      ) : (
        <span className="nh-avatar-initials" aria-hidden="true">
          {monogram(name)}
        </span>
      )}
      {presence && <span className={cx("nh-avatar-presence", `nh-avatar-presence--${presence}`)} aria-hidden="true" />}
    </span>
  );
}
