import type { ReactNode } from "react";
import { Alert, Badge, Button, Skeleton } from "@vtt/ui";
import { CodexIcon } from "./icons";

/**
 * D18 — the ONE card chassis. Every dashboard card is this component.
 *
 * Before the recut each section wrote its own heading, its own emptiness and its own bounds: the
 * standing card listed every faction while the ones beside it sliced to five, and only some of them
 * offered a way to the full list. One chassis makes "bounded, with a way to see all of it" structural
 * rather than a thing each card remembers.
 *
 * Presentational and **role-blind**, like `CampaignHome` itself: it takes a heading and children, and
 * has no prop that could carry a GM body or a reveal flag.
 */
export type DashCardProps = Readonly<{
  title: string;
  iconId: string;
  /** Shown beside the heading when the list is bounded — "5 of 12", so the bound is never a surprise. */
  count?: Readonly<{ shown: number; total: number }>;
  /** The way to the full section. Omitted when this card IS the full list (Faction standing). */
  seeAll?: Readonly<{ label: string; onClick: () => void }>;
  loading?: boolean;
  error?: string | null;
  /**
   * What the card says when there is genuinely nothing — never a skeleton, never a silent gap.
   *
   * **Ruling 55's shape for a card-sized empty state.** The ruling asks every empty surface for one
   * door saying the single next thing to do, and a dashboard card usually has that door already: it
   * is `seeAll`, which renders whether or not the card has content, so an empty *Deadlines* card
   * still offers "See all deadlines". Where a card has neither content nor a `seeAll`, this line is
   * the whole surface, so it says the next thing in a sentence ("Place one from any map's pin
   * inspector") instead of reporting an absence. **Do not invent a door that lies** — a card whose
   * subject genuinely has no action gets the deliberate no-action line, which is the default below.
   */
  empty?: ReactNode;
  children?: ReactNode;
}>;

export function DashCard({ title, iconId, count, seeAll, loading = false, error = null, empty, children }: DashCardProps) {
  const isEmpty = children === null || children === undefined || (Array.isArray(children) && children.length === 0);
  return (
    <section className="codex-dashcard">
      <div className="codex-dashcard-head">
        <CodexIcon iconId={iconId} className="codex-ent-icon codex-dashcard-glyph" />
        <h3 className="codex-dashcard-title">{title}</h3>
        {count && count.total > count.shown && <Badge>{count.shown} of {count.total}</Badge>}
      </div>
      <div className="codex-dashcard-body">
        {error
          ? <Alert tone="danger">{error}</Alert>
          : loading && isEmpty
          ? <div className="codex-list-loading">{[0, 1].map((row) => <Skeleton key={row} variant="text" />)}</div>
          : isEmpty
          /* RULING 55 retires "Nothing here yet." BY NAME, so it cannot be the fallback every card
             that forgets to say something lands on. The replacement is the deliberate no-action
             line: it says the section is empty *and* that emptiness is the normal resting state,
             which is the honest thing to say when there is no action to offer. A card that does have
             a next step passes `empty` and says it. */
          ? <p className="codex-dashcard-empty">{empty ?? "Nothing to show — this fills itself as the campaign runs."}</p>
          : children}
      </div>
      {seeAll && (
        /* §4 route 2: `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px floor itself
           (`.nh-btn--sm` + `.tap-target`), and it is the last thing in the card so nothing sits below it
           for its `::after` box to overhang into. */
        <div className="codex-dashcard-foot">
          <Button variant="ghost" size="sm" onClick={seeAll.onClick}>{seeAll.label}</Button>
        </div>
      )}
    </section>
  );
}
