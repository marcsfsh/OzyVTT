import type { GameState, PlayerView, ScenePreviewReply } from "@vtt/domain";
import { activateScene } from "./scenes.js";
import { projectViewerEncounter } from "./viewer-encounter.js";
import { rememberExplored } from "./vision/audience.js";
import type { SightContent } from "./vision/senses.js";
import { GameNotFoundError } from "./commands/failures.js";

/** The session a previewed character is claimed by in the copy: it names no real seat, and the copy is dropped. */
const PREVIEW_SESSION = "00000000-0000-4000-8000-00000000c0de";

/**
 * The state as it would stand once `encounterId` went live, built on a copy: the same park and resume as `encounter.activate`,
 * then what the party sees remembered, as the store does after every command. Nothing here reaches the real state.
 */
function asIfLive(state: GameState, encounterId: string, content: SightContent): GameState {
  if (state.combat.activeEncounterId === encounterId) return state;
  const copy = structuredClone(state) as GameState;
  // A rewound timeline refuses a real switch; the preview only looks.
  copy.combat.historyCursor = null;
  activateScene(copy, encounterId, "00000000-0000-4000-8000-000000000000");
  rememberExplored(copy, content);
  return copy;
}

/**
 * What one audience would receive of a scene if it were live now: the shared screen (its encounter and turn order)
 * or, with `actorId`, the player who holds that party character (the combat slice of their projection and the
 * creatures it names). Built by the projections that build the real feeds, over the copy from `asIfLive`.
 */
export function previewScene(
  state: GameState,
  input: Readonly<{ encounterId: string; actorId?: string }>,
  deps: Readonly<{
    content: SightContent;
    playerView: (state: GameState, sessionId: string) => PlayerView;
    now?: number;
  }>
): ScenePreviewReply {
  const scene = state.combat.encounters.find((candidate) => candidate.id === input.encounterId);
  if (!scene) throw new GameNotFoundError("That encounter no longer exists.");
  const live = state.combat.activeEncounterId === scene.id;
  const reply = { encounterId: scene.id, live, mapAssetId: scene.mapAssetId, actorId: input.actorId ?? null };
  if (input.actorId === undefined) {
    const { encounter, initiative } = projectViewerEncounter(
      asIfLive(state, scene.id, deps.content),
      deps.now,
      deps.content
    );
    return { ...reply, screen: { encounter, initiative }, player: null };
  }
  const character = state.actors.find((actor) => actor.id === input.actorId);
  if (!character || character.kind !== "player-character" || character.archived)
    throw new GameNotFoundError("Choose a character in the party.");
  const future = asIfLive(state, scene.id, deps.content);
  // The previewed character is claimed by the preview's own session alone, so the projection sees through its eyes.
  const claimed = structuredClone(future) as GameState;
  claimed.actors = claimed.actors.map((actor) =>
    actor.id === character.id
      ? { ...actor, ownerSessionId: PREVIEW_SESSION }
      : actor.ownerSessionId === PREVIEW_SESSION
        ? { ...actor, ownerSessionId: null }
        : actor
  );
  const view = deps.playerView(claimed, PREVIEW_SESSION);
  const named = new Set(view.combat.tokens.map((token) => token.actorId));
  return {
    ...reply,
    screen: null,
    player: { combat: view.combat, actors: view.actors.filter((actor) => named.has(actor.id)) }
  };
}
