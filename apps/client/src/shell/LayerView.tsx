import type { GmView, PlayerView } from "@vtt/domain";
import { Button, useToast, EmptyState } from "@vtt/ui";
import { useReleaseCharacter } from "../actors/MyCharacter";
import { RestPrompt } from "../rest/RestPrompt";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { levelPath, navigate, pathForGmTab, type AddressLayer } from "../router";
import type { Connection } from "./useSession";

const CharacterBuilder = lazySurface(
  () => import("../builder/CharacterBuilder").then((m) => m.CharacterBuilder),
  "character builder"
);
const LevelFlow = lazySurface(() => import("../builder/LevelFlow").then((m) => m.LevelFlow), "level-up steps");
const ReplayViewer = lazySurface(() => import("../replay/ReplayViewer").then((m) => m.ReplayViewer), "replay");

/** The layers that take the whole pane: one at each address, so a refresh keeps them and Back closes them. */
export type FullPageLayer = Extract<AddressLayer, { kind: "builder" | "level" | "replay" | "sheet" }>;

export const isFullPageLayer = (layer: AddressLayer | null): layer is FullPageLayer =>
  layer !== null && layer.kind !== "scenes";

/**
 * A full-page layer for either role: the builder (or its policy gate), the level flow, a replay, or a
 * character sheet. They render inside the pane (the tab bar stays up) and own their scrolling.
 */
export function LayerView({
  layer,
  role,
  state,
  token,
  connection
}: Readonly<{
  layer: FullPageLayer;
  role: "gm" | "player";
  state: GmView | PlayerView;
  token: string;
  connection: Connection;
}>) {
  const { toast } = useToast();
  const home = role === "gm" ? pathForGmTab("roster") : "/table";
  switch (layer.kind) {
    case "builder":
      return role === "gm" || state.builderPolicy.playerBuilder === "open" ? (
        <CharacterBuilder
          state={state}
          /* The wizard gates its last step on this prop: a disabled Create beats a banner to notice. */
          connection={connection}
          onClose={() => navigate(home)}
          onCreated={(name) => toast(`${name} joined the roster, ready for a player to claim.`, { tone: "success" })}
        />
      ) : (
        /* The builder is closed to players at this table: T rule 3's empty state, one line and one door back. */
        <div className="anim-view builder-gate pane-frame pane-scene frame-col">
          <EmptyState action={<Button onClick={() => navigate("/table")}>Back to the table</Button>}>
            Your GM builds the characters at this table. Ask them to make you one, or claim one that's already on the
            table.
          </EmptyState>
        </div>
      );
    case "level":
      return (
        <LevelFlow
          state={state}
          role={role}
          actorId={layer.actorId}
          connection={connection}
          startDown={new URLSearchParams(window.location.search).get("to") === "down"}
          /* The level dialog opens over the sheet, which stays behind it (characters spec 2.3). */
          behind={
            <SheetLayer
              actorId={layer.actorId}
              role={role}
              state={state}
              token={token}
              onClose={() => navigate(home)}
            />
          }
          onClose={() => navigate(`/characters/${layer.actorId}`)}
          onDone={() => navigate(`/characters/${layer.actorId}`)}
        />
      );
    case "replay":
      /* The replay viewer owns its frame, so it takes the pane directly. */
      return (
        <ReplayViewer
          role={role}
          token={token}
          archiveId={layer.archiveId}
          onBack={() => navigate("/replays")}
          onLaunched={() => navigate("/table")}
        />
      );
    case "sheet":
      return (
        <SheetLayer actorId={layer.actorId} role={role} state={state} token={token} onClose={() => navigate(home)} />
      );
  }
}

/**
 * A character sheet at its own address. A player asking for someone else's sheet gets the not-found
 * view: their projection does not carry it, so "no such character" is both true and indistinguishable.
 * A player's own sheet here is the one on My character, with the same menu.
 */
function SheetLayer({
  actorId,
  role,
  state,
  token,
  onClose
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  state: GmView | PlayerView;
  token: string;
  onClose: () => void;
}>) {
  const actor = state.actors.find((entry) => entry.id === actorId);
  if (!actor) return <NotFoundPage role={role} />;
  if (role === "player")
    return <PlayerSheetPage state={state as PlayerView} actorId={actorId} token={token} onClose={onClose} />;
  return (
    <div className="anim-view cs-page frame-col">
      <CharacterSheet
        actor={actor}
        role={role}
        state={state}
        presentation="page"
        token={token}
        onLevel={(direction) => navigate(levelPath(actorId, direction))}
        onClose={onClose}
      />
    </div>
  );
}

/** A player's own sheet at its address: the release verb and the party's Short Rest, as on My character. */
function PlayerSheetPage({
  state,
  actorId,
  token,
  onClose
}: Readonly<{ state: PlayerView; actorId: string; token: string; onClose: () => void }>) {
  const { release, releasing, dialog } = useReleaseCharacter(state);
  const actor = state.actors.find((entry) => entry.id === actorId)!;
  const mine = actor.claimStatus === "mine";
  return (
    <div className="anim-view cs-page frame-col">
      <CharacterSheet
        actor={actor}
        role="player"
        state={state}
        presentation="page"
        token={token}
        top={<RestPrompt state={state} />}
        {...(state.builderPolicy.playerBuilder === "open"
          ? { onLevel: (direction) => navigate(levelPath(actorId, direction)) }
          : {})}
        {...(mine && !releasing
          ? { doors: { release: { name: actor.name, onSelect: () => void release(actor.name) } } }
          : {})}
        onClose={onClose}
      />
      {dialog}
    </div>
  );
}
