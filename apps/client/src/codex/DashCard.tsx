import type { ReactNode } from "react";
import { Alert, Badge, Button, Skeleton } from "@vtt/ui";
import { CodexIcon } from "./icons";

/**
 * The dashboard card chassis: heading, bounded body, empty state and a link to the full section.
 * Role-blind: no prop can carry a GM body or reveal flag.
 */
export type DashCardProps = Readonly<{
  title: string;
  iconId: string;
  /** Shown beside the heading when bounded ("5 of 12"). */
  count?: Readonly<{ shown: number; total: number }>;
  /** The way to the full section. Omitted when this card is the full list. */
  seeAll?: Readonly<{ label: string; onClick: () => void }>;
  loading?: boolean;
  error?: string | null;
  /**
   * The empty state. Prefer naming the next step ("Place one from any map's pin inspector"); a card with no
   * real action gets the default no-action line rather than an invented one.
   */
  empty?: ReactNode;
  children?: ReactNode;
}>;

export function DashCard({
  title,
  iconId,
  count,
  seeAll,
  loading = false,
  error = null,
  empty,
  children
}: DashCardProps) {
  const isEmpty = children === null || children === undefined || (Array.isArray(children) && children.length === 0);
  return (
    <section className="codex-dashcard">
      <div className="codex-dashcard-head">
        <CodexIcon iconId={iconId} className="codex-ent-icon codex-dashcard-glyph" />
        <h3 className="codex-dashcard-title">{title}</h3>
        {count && count.total > count.shown && (
          <Badge>
            {count.shown} of {count.total}
          </Badge>
        )}
      </div>
      <div className="codex-dashcard-body">
        {error ? (
          <Alert tone="danger">{error}</Alert>
        ) : loading && isEmpty ? (
          <div className="codex-list-loading">
            {[0, 1].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </div>
        ) : isEmpty ? (
          /* The default says emptiness is the normal resting state. */
          <p className="codex-dashcard-empty">{empty ?? "Nothing here yet. It fills in as the campaign runs."}</p>
        ) : (
          children
        )}
      </div>
      {seeAll && (
        /* Last in the card, so the small button's ::after has nothing below to overhang. */
        <div className="codex-dashcard-foot">
          <Button variant="ghost" size="sm" onClick={seeAll.onClick}>
            {seeAll.label}
          </Button>
        </div>
      )}
    </section>
  );
}
