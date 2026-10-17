import { useState } from "react";
import type { GmView } from "@vtt/domain";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { command } from "../lib/command";
import { useSelectedToken } from "../scene/selectedToken";
import { TokenControls } from "../scene/TokenContextMenu";
import { TokenLibrary } from "../tokens/TokenLibrary";

/**
 * The GM's Token tab: the token last pressed on the map, with the same controls as its menu on the map. Press a token
 * to bring it here.
 */
export function TokenTab({ state, token }: Readonly<{ state: GmView; token: string | null }>) {
  const selectedId = useSelectedToken();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const actor = selectedId ? state.actors.find((candidate) => candidate.id === selectedId) : undefined;
  const placement = actor ? state.combat.tokens.find((entry) => entry.actorId === actor.id) : undefined;
  if (!actor || !placement)
    return <p className="table-panel-empty">Press a token on the map to see what you can do with it here.</p>;
  return (
    <section className="token-tab" aria-label={`Token · ${actor.name}`}>
      <h2 className="token-tab-name">{actor.name}</h2>
      <TokenControls
        actor={actor}
        role="gm"
        gmToken={token}
        reactionUsed={state.combat.reactionsUsed.includes(actor.id)}
        placed={placement.position !== null}
        onOpenSheet={() => setSheetOpen(true)}
        onReturnToTray={() => void command("token:move", { actorId: actor.id, position: null })}
        onPickImage={() => setLibrary(true)}
      />
      {sheetOpen && <CharacterSheet actor={actor} role="gm" state={state} onClose={() => setSheetOpen(false)} />}
      {library && token && (
        <TokenLibrary
          actorId={actor.id}
          actorName={actor.name}
          definitionId={actor.definitionId ?? null}
          currentAssetId={actor.tokenAssetId ?? null}
          gmToken={token}
          onClose={() => setLibrary(false)}
        />
      )}
    </section>
  );
}
