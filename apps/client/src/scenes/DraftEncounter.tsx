import { useEffect, useState } from "react";
import { rosterActors } from "@vtt/domain";
import { Button, Crumb, Steps, TitleLine, useToast } from "@vtt/ui";
import { command } from "../lib/command";
import { MapPicker, type PickerMap } from "../maps/MapPicker";
import { navigate, useRoute } from "../router";
import { useAutoArrange } from "../settings/preferences";
import { useScenes } from "./context";
import { arrivingScenes, pathForMap, pathForScene, SCENES_PATHS } from "./routes";
import { StateChip } from "./pieces";
import "./scene-page.css";

const CHECKLIST = [
  { label: "Pick a map", detail: "Choose one of your battle maps, or upload one" },
  { label: "Add who is in it", detail: "The party, then the monsters" },
  { label: "Place the tokens", detail: "Drag them from the tray" },
  { label: "Make it live", detail: "When the table is ready" }
];

/**
 * A new encounter is a Draft page (Prep frame 2.3, ADR-0053): titled "Untitled encounter" with a Draft tag, and where
 * the map would be, the checklist "To make it ready" beside Pick a map. An encounter needs a battle map on the server,
 * so it is made when the map is picked; the page then becomes that encounter's workbench, and leaving before then
 * leaves nothing behind. A map uploaded here waits for Use this map, so its grid can be set first.
 */
export function DraftEncounter() {
  const { state, token, maps, reloadMaps, go, phone } = useScenes();
  const { toast } = useToast();
  const autoArrange = useAutoArrange();
  const [uploaded, setUploaded] = useState<PickerMap | null>(null);
  const [creating, setCreating] = useState(false);
  const wanted = useRoute().query.get("map");

  const create = (map: Pick<PickerMap, "id" | "name">) => {
    if (creating) return;
    const party = rosterActors(state.actors)
      .filter((actor) => actor.kind === "player-character" && !actor.archived)
      .map((actor) => actor.id);
    setCreating(true);
    void command("encounter:create", { name: map.name.slice(0, 120), mapAssetId: map.id, combatantIds: party }).then(
      (result) => {
        setCreating(false);
        if (!result.ok || !result.encounterId) {
          toast(result.message ?? "The encounter could not be made.", { tone: "error" });
          return;
        }
        arrivingScenes.add(result.encounterId);
        // Settings can keep a new encounter closed: it is then only listed, to arrange later.
        void navigate(autoArrange ? pathForScene(result.encounterId, "tokens") : SCENES_PATHS.list, { replace: true });
      }
    );
  };

  // "New encounter on this map" (and the way back from setting its grid) arrives with `?map=`, made once it is known.
  useEffect(() => {
    if (!wanted || creating) return;
    const map = maps?.find((candidate) => candidate.id === wanted);
    if (map) create(map);
    // `create` reads the latest state each time; the map arriving is what this waits for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, maps]);

  return (
    <div className="sc-scene-page sc-draft-page">
      <header className="sc-rec-head" aria-label="The encounter">
        <div className="sc-rec-main">
          <TitleLine crumb={<Crumb label="Encounters" onClick={() => go(SCENES_PATHS.list)} />}>
            <h2 className="sc-scene-title">Untitled encounter</h2>
            <StateChip tag="draft" />
          </TitleLine>
        </div>
      </header>
      <div className="sc-draft scroll-y">
        <section className="sc-draft-check" aria-labelledby="sc-draft-check-title">
          <h3 id="sc-draft-check-title" className="sc-draft-eyebrow">
            To make it ready
          </h3>
          <Steps
            ariaLabel="To make it ready"
            orientation="vertical"
            current={0}
            steps={CHECKLIST.map((step) => ({ label: step.label, shortLabel: step.label, detail: step.detail }))}
          />
          <p className="sc-hint">Light, sound and rules have the table's settings until you change them.</p>
        </section>
        <section className="sc-draft-maps" aria-label="Pick a map">
          {creating ? (
            <p className="sc-missing" role="status">
              Opening the encounter…
            </p>
          ) : (
            <>
              <MapPicker
                token={token}
                selectedId={uploaded?.id ?? null}
                onSelect={(map, meta) => (meta?.fromUpload ? setUploaded(map) : create(map))}
                onUploaded={() => void reloadMaps()}
                onSetGrid={(mapId) =>
                  go(pathForMap(mapId, "grid", `${SCENES_PATHS.newScene}?map=${encodeURIComponent(mapId)}`))
                }
              />
              {uploaded && (
                <div className="sc-draft-use">
                  <Button variant="primary" block={phone} onClick={() => create(uploaded)}>
                    Use this map
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
