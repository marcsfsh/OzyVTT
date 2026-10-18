import type { CodexSceneLink } from "@vtt/domain";
import type { CodexStore } from "../codex-store.js";

/**
 * Every table scene the Codex names, with the sessions that stage it (on the session itself or in its prep's
 * Encounters sections) and the atlas pins that link it. Scenes the Codex never names are left out, and an id the table
 * no longer has is kept, since the Codex keeps dangling scene links as they are.
 */
export function sceneLinks(store: CodexStore): CodexSceneLink[] {
  const links = new Map<string, CodexSceneLink>();
  const linkOf = (sceneId: string) => {
    let link = links.get(sceneId);
    if (!link) {
      link = { sceneId, sessions: [], pins: [] };
      links.set(sceneId, link);
    }
    return link;
  };
  for (const session of store.listSessions()) {
    const named = new Map<string, "session" | "prep">();
    for (const sceneId of session.sceneIds) named.set(sceneId, "session");
    for (const section of session.prep)
      if (section.type === "encounters")
        for (const sceneId of section.sceneIds) if (!named.has(sceneId)) named.set(sceneId, "prep");
    for (const [sceneId, via] of named)
      (linkOf(sceneId).sessions as CodexSceneLink["sessions"][number][]).push({
        id: session.id,
        sessionNumber: session.sessionNumber,
        status: session.status,
        via
      });
  }
  for (const map of store.listMaps())
    for (const marker of store.listMarkers(map.id))
      for (const sceneId of marker.sceneIds)
        (linkOf(sceneId).pins as CodexSceneLink["pins"][number][]).push({
          id: marker.id,
          label: marker.label,
          mapId: map.id,
          mapName: map.name
        });
  return [...links.values()];
}
