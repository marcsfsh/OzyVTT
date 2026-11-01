import { useEffect, type ReactNode } from "react";
import { Button, IconChevronLeft, cx } from "@vtt/ui";
import { TagView } from "../TagView";
import { useCodexShell, useGmCodex, usePlayerCodex } from "../shell/context";

/**
 * The page's side column takes one part at a time in place of the facts (F finding rule 3.3): a tag, a reveal or the
 * versions, each under this head with Back to the facts. The text beside it stays where it is.
 */
export function SideHead({
  title,
  tone,
  onBack
}: Readonly<{ title?: ReactNode; tone?: "hidden"; onBack: () => void }>) {
  return (
    <div className="cx-side-head">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <IconChevronLeft /> Back
      </Button>
      {title != null && <h2 className={cx("cx-side-title", tone === "hidden" && "is-hidden")}>{title}</h2>}
    </div>
  );
}

/** Escape closes the open part, unless a dialog or menu above the page takes it first. */
export function useEscapeToFacts(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest?.("[role='dialog'], [role='menu'], input, textarea")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
}

/** A tag in the GM's side column: everything that carries it, from the GM's feeds. */
export function GmTagColumn({ tag }: Readonly<{ tag: string }>) {
  const { token, go } = useCodexShell();
  const { feeds } = useGmCodex();
  return (
    <TagView
      gmToken={token}
      tag={tag}
      pages={feeds.pages}
      maps={feeds.campaign.maps}
      records={feeds.campaign.records}
      sessions={feeds.sessions}
      quests={feeds.quests}
      onNavigate={go}
    />
  );
}

/** A tag in a player's side column: only what the player's own feeds carry, so a hidden page never lists. */
export function PlayerTagColumn({ tag }: Readonly<{ tag: string }>) {
  const { token, go } = useCodexShell();
  const { feeds } = usePlayerCodex();
  return (
    <TagView
      gmToken={token}
      player
      tag={tag}
      pages={feeds.pages}
      maps={feeds.maps}
      records={feeds.timeline}
      sessions={feeds.sessions}
      quests={feeds.quests}
      onNavigate={go}
    />
  );
}
