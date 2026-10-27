import { Button, IconCheck, IconWarning } from "@vtt/ui";
import { EncounterMeter } from "../encounter/EncounterMeter";
import { useScenes } from "./context";
import { pathForScene } from "./routes";
import { count, needsOf, readinessOf, READINESS_LABEL, type SceneFacts } from "./sceneFacts";
import "./scene-encounter.css";

type Check = Readonly<{ id: string; ok: boolean; text: string; step?: Parameters<typeof pathForScene>[1] }>;

/**
 * Ready to go: what the scene's facts say about going live, one row each. Only what applies is listed (walls only when
 * vision is on), so a scene is never held to checks it has no use for. The warnings are the scene's needs, with the
 * step that answers each; going live stays possible either way.
 */
export function readyChecks(facts: SceneFacts, maps: Parameters<typeof readinessOf>[1]): readonly Check[] {
  const readiness = readinessOf(facts, maps);
  const needs = needsOf(facts);
  const map: Check =
    readiness === "needs-map" || readiness === "loading-map" || readiness === "map-unavailable"
      ? { id: "map", ok: false, text: READINESS_LABEL[readiness], step: "map" }
      : facts.grid === "none"
        ? { id: "map", ok: false, text: needs.find((need) => need.id === "grid")!.text, step: "map" }
        : { id: "map", ok: true, text: `${facts.map?.name ?? "The map"} is set, with its grid.` };
  const who = needs.find((need) => need.id === "nobody" || need.id === "waiting");
  const checks: Check[] = [
    map,
    who
      ? { id: "who", ok: false, text: who.text, step: who.step }
      : { id: "who", ok: true, text: `${count(facts.placed, "token")} on the map.` }
  ];
  if (facts.combat.vision.enabled) {
    const walls = needs.find((need) => need.id === "walls");
    checks.push(
      walls
        ? { id: "walls", ok: false, text: walls.text, step: walls.step }
        : {
            id: "walls",
            ok: true,
            text: `Vision is on with ${count(facts.walls + facts.doors, "wall or door", "walls and doors")} drawn.`
          }
    );
  }
  const archived = needs.find((need) => need.id === "archived");
  if (archived) checks.push({ id: "archived", ok: false, text: archived.text, step: archived.step });
  return checks;
}

/** The scene panel's Fight tab: the monsters and the difficulty meter, then Ready to go. */
export function SceneEncounterTab({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { state, token, maps, go } = useScenes();
  const checks = readyChecks(facts, maps);
  return (
    <div className="sc-encounter">
      <section className="sc-encounter-section" aria-labelledby="sc-encounter-title">
        <h3 id="sc-encounter-title" className="sc-encounter-label">
          Who you fight
        </h3>
        <EncounterMeter state={state} token={token} staged={facts.combat.initiative.map((entry) => entry.actorId)} />
      </section>
      <section className="sc-encounter-section" aria-labelledby="sc-ready-title">
        <h3 id="sc-ready-title" className="sc-encounter-label">
          Ready to go
        </h3>
        <ul className="sc-ready">
          {checks.map((check) => (
            <li key={check.id} className={check.ok ? "is-ok" : "is-warn"}>
              <span className="sc-ready-mark" aria-hidden="true">
                {check.ok ? <IconCheck /> : <IconWarning />}
              </span>
              <span className="sc-ready-text">{check.text}</span>
              {!check.ok && check.step && (
                <Button size="sm" variant="secondary" onClick={() => go(pathForScene(facts.scene.id, check.step))}>
                  Go to it
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
