/**
 * Why "Launch from here" was refused, classified from the server's messages, so the GM can be routed
 * to the scene gallery when the fix is there. Its own module so the node mirror test can import it.
 */
export type LaunchRefusal = "scene-room" | "history-review" | "other";

export function launchRefusalOf(message: string | undefined): LaunchRefusal {
  if (!message) return "other";
  if (/remove a prepared scene/i.test(message)) return "scene-room";
  if (/reviewing the combat history/i.test(message)) return "history-review";
  return "other";
}
