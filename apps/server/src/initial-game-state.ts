import { GameStateSchema, type GameState } from "@vtt/domain";

export const PLACEHOLDER_ACTOR_IDS = {
  guardian: "2b20e657-df27-4a8e-9a8d-a9c608763701",
  scout: "d91ad7e6-d334-4596-885e-47ac9c981702",
  arcanist: "b073fe5f-4394-4869-9e79-a0e3dc4e1703"
} as const;

export function createInitialGameState(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: PLACEHOLDER_ACTOR_IDS.guardian,
        name: "Borin Stoneguard",
        kind: "player-character",
        visibility: "public",
        hp: { current: 28, maximum: 28, temporary: 0 },
        armorClass: 18,
        initiative: 1,
        ownerSessionId: null,
        notes: "Starter guardian used to validate the join and character-claim workflow."
      },
      {
        id: PLACEHOLDER_ACTOR_IDS.scout,
        name: "Aria Quickstep",
        kind: "player-character",
        visibility: "public",
        hp: { current: 22, maximum: 22, temporary: 0 },
        armorClass: 15,
        initiative: 4,
        ownerSessionId: null,
        notes: "Starter scout used to validate the join and character-claim workflow."
      },
      {
        id: PLACEHOLDER_ACTOR_IDS.arcanist,
        name: "Lyra Emberwise",
        kind: "player-character",
        visibility: "public",
        hp: { current: 18, maximum: 18, temporary: 0 },
        armorClass: 13,
        initiative: 2,
        ownerSessionId: null,
        notes: "Starter arcanist used to validate the join and character-claim workflow."
      }
    ]
  });
}
