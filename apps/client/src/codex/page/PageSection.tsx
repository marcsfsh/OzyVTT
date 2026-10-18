import { useCodexShell } from "../shell/context";
import { GmPage } from "./GmPage";
import { PagesIndex } from "./PagesIndex";
import { PlayerPage } from "./PlayerPage";

/** Pages for the GM: the index at `/codex/pages`, one page at `/codex/pages/:id`. */
export function GmPagesSection() {
  const { recordId } = useCodexShell();
  return recordId ? <GmPage key={recordId} id={recordId} /> : <PagesIndex />;
}

/** Pages for a player, every read on the player's own token. */
export function PlayerPagesSection() {
  const { recordId } = useCodexShell();
  return recordId ? <PlayerPage key={recordId} id={recordId} /> : <PagesIndex />;
}
