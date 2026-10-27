import { useState } from "react";
import { Button, IconCheck, IconWarning, Switch, useToast } from "@vtt/ui";
import { EncounterMeter } from "../encounter/EncounterMeter";
import { command } from "../lib/command";
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

/**
 * Fight settings: how this scene's fight starts. Start the fight opens with these and can still change them for one
 * fight (ADR-0039). Shown as Start the fight would open, so a scene with none reads the table's usual choices.
 */
export function FightSettings({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { state } = useScenes();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const defaults = facts.scene.initiativeDefaults;
  const playersRoll = defaults?.playersRollInitiative ?? false;
  const groupMonsters = defaults?.groupMonsters ?? true;
  const save = async (next: Readonly<{ playersRollInitiative: boolean; groupMonsters: boolean }>) => {
    setBusy(true);
    try {
      const result = await command("encounter:set-initiative-defaults", {
        encounterId: facts.scene.id,
        initiativeDefaults: next,
        expectedRevision: state.revision
      });
      if (!result.ok) toast(result.message ?? "The encounter settings weren't saved.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sc-encounter-section" aria-labelledby="sc-fight-settings-title">
      <h3 id="sc-fight-settings-title" className="sc-encounter-label">
        Encounter settings
      </h3>
      <Switch
        label="Players roll their own initiative"
        checked={playersRoll}
        disabled={busy}
        onChange={(on) => void save({ playersRollInitiative: on, groupMonsters })}
      />
      <Switch
        label="One roll for each group of identical monsters"
        checked={groupMonsters}
        disabled={busy}
        onChange={(on) => void save({ playersRollInitiative: playersRoll, groupMonsters: on })}
      />
      <p className="sc-encounter-hint">Start the encounter opens with these. Surprise is chosen when it starts.</p>
    </section>
  );
}

/** The scene panel's Fight tab: the monsters and the difficulty meter, the fight's settings, then Ready to go. */
export function SceneEncounterTab({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { state, token, maps, go } = useScenes();
  const checks = readyChecks(facts, maps);
  return (
    <div className="sc-encounter">
      <section className="sc-encounter-section" aria-labelledby="sc-encounter-title">
        <h3 id="sc-encounter-title" className="sc-encounter-label">
          Who they face
        </h3>
        <EncounterMeter state={state} token={token} staged={facts.combat.initiative.map((entry) => entry.actorId)} />
      </section>
      {!facts.scene.replayOf && <FightSettings facts={facts} />}
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
