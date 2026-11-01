import { needsOf, readinessOf, type Readiness, type SceneFacts } from "./sceneFacts";
import type { MapAsset } from "../maps/map-catalog";

/**
 * An encounter's one state tag (Prep rule 3.3), worked out from today's facts with nothing stored: Live, Encounter
 * parked and Replay as today; Ended when its fight has ended; Prepared when it is ready to go; Draft otherwise.
 */
export type StateTag = "live" | "parked" | "replay" | "ended" | "prepared" | "draft";

export const STATE_TAG_LABEL: Readonly<Record<StateTag, string>> = {
  live: "Live",
  parked: "Encounter parked",
  replay: "Replay",
  ended: "Ended",
  prepared: "Prepared",
  draft: "Draft"
};

export function stateTagOf(facts: SceneFacts, readiness: Readiness): StateTag {
  if (facts.live) return "live";
  if (facts.state === "parked") return "parked";
  if (facts.state === "replay") return "replay";
  if (facts.progress === "completed") return "ended";
  return readiness === "ready" ? "prepared" : "draft";
}

/** The state chips over the shelf, in order; Live and Parked join only while such an encounter exists. */
export const SHELF_CHIPS: readonly StateTag[] = ["draft", "prepared", "ended"];

/**
 * Ready in one set of words (Prep rule 3.2): "Ready to go", or the first thing missing, short enough for a card. The
 * longer sentences stay on the encounter's own page.
 */
export function readyLineOf(
  facts: SceneFacts,
  maps: readonly MapAsset[] | null
): Readonly<{ ready: boolean; text: string }> {
  const readiness = readinessOf(facts, maps);
  if (readiness === "live") return { ready: true, text: "Live" };
  if (readiness === "needs-map") return { ready: false, text: "Needs a map" };
  if (readiness === "loading-map") return { ready: false, text: "Loading map" };
  if (readiness === "map-unavailable") return { ready: false, text: "Map not in the library" };
  if (facts.progress === "completed") return { ready: false, text: "Ended" };
  const need = needsOf(facts)[0];
  if (!need) return { ready: true, text: "Ready to go" };
  switch (need.id) {
    case "grid":
      return { ready: false, text: "No grid yet" };
    case "nobody":
      return { ready: false, text: "Nobody in it yet" };
    case "waiting":
      return {
        ready: false,
        text: `${facts.waiting} ${facts.waiting === 1 ? "token waits" : "tokens wait"} in the tray`
      };
    case "walls":
      return { ready: false, text: "No walls drawn" };
    case "archived":
      return { ready: false, text: "Archived characters staged" };
  }
}
