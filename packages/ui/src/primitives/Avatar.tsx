import { cx } from "./util";
import "./Avatar.css";

export type AvatarSize = "sm" | "md" | "lg";
export type AvatarPresence = "online" | "away" | "offline";

export interface AvatarProps {
  /** Full name — drives the monogram and the accessible label. */
  name: string;
  /** Optional portrait/token image; falls back to the monogram. */
  src?: string;
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

/** Circular identity chip: a two-letter monogram (magenta→cyan wash) or a
    portrait, with an optional presence dot. For rosters, token lists, and
    character/creature identity across the app. */
export function Avatar({ name, src, size = "md", presence, className }: AvatarProps) {
  return (
    <span className={cx("nh-avatar", `nh-avatar--${size}`, className)} role="img" aria-label={name}>
      {src
        ? <img className="nh-avatar-img" src={src} alt="" />
        : <span className="nh-avatar-initials" aria-hidden="true">{monogram(name)}</span>}
      {presence && <span className={cx("nh-avatar-presence", `nh-avatar-presence--${presence}`)} aria-hidden="true" />}
    </span>
  );
}
