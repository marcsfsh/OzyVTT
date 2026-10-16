import { useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Button, useToast } from "@vtt/ui";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { navigate, pathForGmTab, type AddressLayer } from "../router";
import { TokenLibrary } from "../tokens/TokenLibrary";
import type { Connection } from "./useSession";

const CharacterBuilder = lazySurface(() => import("../builder/CharacterBuilder").then((m) => m.CharacterBuilder));
const LevelFlow = lazySurface(() => import("../builder/LevelFlow").then((m) => m.LevelFlow));
const ReplayViewer = lazySurface(() => import("../replay/ReplayViewer").then((m) => m.ReplayViewer));

/** The layers that take the whole pane: one at each address, so a refresh keeps them and Back closes them. */
export type FullPageLayer = Extract<AddressLayer, { kind: "builder" | "level" | "replay" | "sheet" }>;

export const isFullPageLayer = (layer: AddressLayer | null): layer is FullPageLayer =>
  layer !== null && layer.kind !== "maps" && layer.kind !== "scene-prep";

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
          onCreated={(name) => toast(`${name} joined the roster — ready to claim.`, { tone: "success" })}
        />
      ) : (
        /* The builder is closed to players at this table: one line and one door back. */
        <div className="anim-view builder-gate pane-frame pane-scene scanlines frame-col">
          <div className="pane-sky" aria-hidden="true" />
          <div className="scene-empty frame-fill">
            <p>
              Your GM builds the characters at this table. Ask them to make you one, or claim one that&rsquo;s already
              on the table.
            </p>
            <Button variant="primary" onClick={() => navigate("/table")}>
              Back to the table
            </Button>
          </div>
        </div>
      );
    case "level":
      return (
        <LevelFlow
          state={state}
          role={role}
          actorId={layer.actorId}
          connection={connection}
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
  /** The token picker for this character. The server decides who may set which token. */
  const [pickingToken, setPickingToken] = useState(false);
  const actor = state.actors.find((entry) => entry.id === actorId);
  if (!actor) return <NotFoundPage role={role} />;
  /* The sheet is its own frame. The two page-level doors ride inside it as the bottom row; they are
     passed only from here because they navigate to app addresses and `sheet.html` has no router. */
  return (
    <div className="anim-view sheet-page frame-col">
      <CharacterSheet
        actor={actor}
        role={role}
        state={state}
        standalone
        onClose={onClose}
        standaloneActions={
          <>
            <Button variant="secondary" onClick={() => navigate(`/characters/${actorId}/level`)}>
              Level up or down…
            </Button>
            <Button variant="secondary" onClick={() => setPickingToken(true)}>
              Set token image…
            </Button>
          </>
        }
      />
      {pickingToken && (
        <TokenLibrary
          actorId={actor.id}
          actorName={actor.name}
          definitionId={actor.definitionId ?? null}
          currentAssetId={actor.tokenAssetId ?? null}
          token={token}
          role={role}
          onClose={() => setPickingToken(false)}
        />
      )}
    </div>
  );
}
