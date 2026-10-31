import { render } from "@testing-library/react";
import { ToastProvider } from "@vtt/ui";
import { CodexShell } from "../src/codex/CodexShell";
import { PlayerCodex } from "../src/codex/PlayerCodex";
import { SearchDialog } from "../src/shell/SearchDialog";
import { closeSearch } from "../src/shell/search-store";
import { ACTORS } from "./codex-fakes";
import { goTo } from "./route";

/**
 * The two Codex screens at an address, the way a browser opens them. Import this after the `vi.mock` lines that wire
 * `codex-fakes`, so both shells read the fakes. The app's one search is mounted beside each, as the app mounts it.
 */
export function renderGmCodex(at: string) {
  goTo(at);
  closeSearch();
  return render(
    <ToastProvider>
      <CodexShell gmToken="gm" actors={ACTORS as never} />
      <SearchDialog role="gm" token="gm" sections={[]} />
    </ToastProvider>
  );
}

export function renderPlayerCodex(at: string) {
  goTo(at);
  closeSearch();
  return render(
    <ToastProvider>
      <PlayerCodex token="player" />
      <SearchDialog role="player" token="player" sections={[]} />
    </ToastProvider>
  );
}
