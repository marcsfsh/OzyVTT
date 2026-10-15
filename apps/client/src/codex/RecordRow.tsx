import type { ReactNode } from "react";
import { VisibilityBadge } from "@vtt/ui";
import type { EntityType } from "./entities";
import { CodexIcon, EntityIcon } from "./icons";

/**
 * One record in a summary list (the dashboard, a tag's records, a calendar day): its glyph and name, then
 * any badges, its reveal state when the reader is the GM, and when it happened. The whole row opens it.
 */
export function RecordRow({
  iconId,
  entityType,
  title,
  revealed,
  when,
  whenClassName = "codex-campaign-recentwhen",
  className,
  onClick,
  children
}: Readonly<{
  /** A Codex glyph, or the page's own kind glyph via `entityType`. */
  iconId?: string;
  entityType?: EntityType;
  title: ReactNode;
  /** Undefined renders no badge, which is what a player's rows pass. */
  revealed?: boolean;
  when?: string | null;
  whenClassName?: string;
  className?: string;
  onClick: () => void;
  /** Badges between the name and the reveal state. */
  children?: ReactNode;
}>) {
  return (
    <button type="button" className={`codex-campaign-recentitem${className ? ` ${className}` : ""}`} onClick={onClick}>
      {entityType ? (
        <EntityIcon type={entityType} className="codex-campaign-recentglyph" />
      ) : (
        <CodexIcon iconId={iconId ?? "scroll"} className="codex-ent-icon codex-campaign-recentglyph" />
      )}
      <span className="codex-list-title">{title}</span>
      {children}
      {revealed !== undefined && <VisibilityBadge revealed={revealed} />}
      {when && <span className={whenClassName}>{when}</span>}
    </button>
  );
}
