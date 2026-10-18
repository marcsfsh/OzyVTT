import { render } from "@testing-library/react";
import { ToastProvider } from "@vtt/ui";
import { CodexShell } from "../src/codex/CodexShell";
import { PlayerCodex } from "../src/codex/PlayerCodex";
import { ACTORS } from "./codex-fakes";
import { goTo } from "./route";

/**
 * The two Codex screens at an address, the way a browser opens them. Import this after the `vi.mock` lines that wire
 * `codex-fakes`, so both shells read the fakes.
 */
export function renderGmCodex(at: string) {
  goTo(at);
  return render(
    <ToastProvider>
      <CodexShell gmToken="gm" actors={ACTORS as never} />
    </ToastProvider>
  );
}

export function renderPlayerCodex(at: string) {
  goTo(at);
  return render(
    <ToastProvider>
      <PlayerCodex token="player" />
    </ToastProvider>
  );
}
