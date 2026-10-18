import { useEffect, useState } from "react";
import type { CodexSession } from "@vtt/domain";
import { CODEX_PATHS } from "@vtt/api-contract";
import { Button, IconFog, IconMap, IconWall, IconSparkle, SegmentedControl, Select, Switch, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { command } from "../lib/command";
import { armPlacement, openMapToolGroup } from "../scene/tableGeometry";
import { SceneSoundRow } from "../sound/SceneSounds";
import { useSoundBoard, useSoundCommand } from "../sound/sound-data";
import { pathForGmTab } from "../router";
import { useScenes } from "./context";
import { ScenePrepPanel } from "./ScenePrepPanel";
import { pathForMap } from "./routes";
import { drawnLine, gridLine, whenLabel, type SceneFacts } from "./sceneFacts";
import { MapThumb } from "./pieces";

/**
 * A scene's questions, one component per part, shared by its page (the metadata panel and the Tokens tab) and its
 * steps, so the GM learns one set. Each change is one command that names this scene, or none for the live one, whose
 * copy is the table's.
 */

const sceneTarget = (facts: SceneFacts) => (facts.live ? {} : { sceneId: facts.scene.id });

/** Who is in the scene: the tray with each token's Place and reveal, the two Add buttons, Recent and the XP. */
export function SceneTokens({
  facts,
  onPlace
}: Readonly<{
  facts: SceneFacts;
  /** Places a staged token: arms the map, and on a phone opens it. */
  onPlace?: (actorId: string) => void;
}>) {
  const { state, go } = useScenes();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const staged = facts.combat.initiative.map((entry) => entry.actorId);
  const placedIds = new Set(
    facts.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId)
  );
  if (facts.live)
    return (
      <div className="sc-q">
        <p className="sc-hint">This scene is live. Who is in it changes from the fight on the table.</p>
        <ul className="sc-names">
          {staged.map((actorId) => {
            const actor = state.actors.find((candidate) => candidate.id === actorId);
            return actor ? (
              <li key={actorId}>
                <strong>{actor.name}</strong> · {placedIds.has(actorId) ? "On the map" : "In the tray"}
              </li>
            ) : null;
          })}
        </ul>
        <Button onClick={() => go(pathForGmTab("table"))}>Go to the table</Button>
      </div>
    );
  const send = (ids: readonly string[], failure: string) => {
    setBusy(true);
    void command("scene:set-combatants", { sceneId: facts.scene.id, combatantIds: [...ids] }).then((result) => {
      setBusy(false);
      if (!result.ok) toast(result.message ?? failure, { tone: "error" });
    });
  };
  return (
    <ScenePrepPanel
      actors={state.actors}
      staged={staged}
      placedIds={placedIds}
      onAdd={(actorId) => {
        if (!staged.includes(actorId)) send([...staged, actorId], "The scene's list could not be updated.");
      }}
      onRemove={(actorId) =>
        send(
          staged.filter((id) => id !== actorId),
          "The scene's list could not be updated."
        )
      }
      mapName={facts.map?.name ?? null}
      mapLocked
      hideMap
      selectedMapId={facts.scene.mapAssetId}
      stagingRevealed={(state.stagingDefaults?.visibility ?? "public") !== "gm-only"}
      combatActive={false}
      busy={busy}
      emptyNote="Nobody is in this scene yet. Add the party or monsters below."
      onPlace={onPlace ?? ((actorId) => armPlacement(actorId))}
    />
  );
}

/**
 * The scene's light and sight: dynamic vision and how bright it is, the fog, and how much is drawn. Walls and lights
 * are drawn with the map's own tools, which the two buttons open.
 */
export function SceneLight({
  facts,
  onOpenTools
}: Readonly<{ facts: SceneFacts; onOpenTools?: (group: "walls" | "light" | "fog") => void }>) {
  const { toast } = useToast();
  const vision = facts.combat.vision;
  const report = (failure: string) => (result: { ok: boolean; message?: string }) => {
    if (!result.ok) toast(result.message ?? failure, { tone: "error" });
  };
  const open = (group: "walls" | "light" | "fog") => (onOpenTools ? onOpenTools(group) : openMapToolGroup(group));
  return (
    <div className="sc-q">
      <Switch
        checked={vision.enabled}
        label="Dynamic vision"
        onChange={(enabled) =>
          void command("vision:set-enabled", { enabled, ...sceneTarget(facts) }).then(
            report("Vision could not be changed.")
          )
        }
      />
      <p className="sc-hint">
        {vision.enabled
          ? "Each player sees only what their characters see. Walls, closed doors and windows also block movement."
          : "Everyone sees the whole map, apart from any fog."}
      </p>
      <div className="sc-field">
        <span className="sc-label">Light</span>
        <SegmentedControl
          ariaLabel="Ambient light"
          value={vision.ambient}
          onChange={(ambient) =>
            void command("vision:set-ambient", {
              ambient: ambient as "bright" | "dim" | "dark",
              ...sceneTarget(facts)
            }).then(report("The light could not be changed."))
          }
          options={[
            { value: "bright", label: "Bright" },
            { value: "dim", label: "Dim" },
            { value: "dark", label: "Dark" }
          ]}
        />
      </div>
      <Switch
        checked={facts.combat.fog.enabled}
        label="Fog of war"
        onChange={(enabled) =>
          void command("fog:set-enabled", { enabled, ...sceneTarget(facts) }).then(
            report("The fog could not be changed.")
          )
        }
      />
      <p className="sc-facts-line">{drawnLine(facts)}</p>
      <div className="sc-q-actions">
        <Button onClick={() => open("walls")}>
          <IconWall /> Draw walls
        </Button>
        <Button onClick={() => open("light")}>
          <IconSparkle /> Place lights
        </Button>
        <Button onClick={() => open("fog")}>
          <IconFog /> Paint fog
        </Button>
      </div>
    </div>
  );
}

/** The scene's own sound, saved from what the sound board plays now, started when the scene goes live. */
export function SceneSound({ facts }: Readonly<{ facts: SceneFacts }>) {
  const board = useSoundBoard();
  const send = useSoundCommand();
  const { go } = useScenes();
  return (
    <div className="sc-q">
      <p className="sc-hint">
        Set up the music and ambience on the sound board, then save it here. It plays on the table screen when the scene
        goes live.
      </p>
      {board ? (
        <div className="sound-row sound-scene sc-sound-row">
          <SceneSoundRow board={board.board} scene={facts.scene} live={facts.live} send={send} />
        </div>
      ) : (
        <p className="sc-hint">Loading the sound board…</p>
      )}
      <Button variant="ghost" onClick={() => go("/viewer-controls/sound")}>
        Open the sound board
      </Button>
    </div>
  );
}

/** The scene's map: its art, its grid and the way to its own page. A scene keeps its map for life. */
export function SceneMapFacts({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { go } = useScenes();
  return (
    <div className="sc-q sc-mapfacts">
      <MapThumb mapAssetId={facts.scene.mapAssetId} className="sc-thumb-lg" />
      <div className="sc-mapfacts-text">
        <strong>{facts.map?.name ?? "Map not in the library"}</strong>
        <span className={facts.grid === "none" ? "sc-caution" : undefined}>{gridLine(facts.grid, facts.map)}</span>
      </div>
      <div className="sc-q-actions">
        {facts.grid === "none" && facts.map && (
          <Button size="sm" onClick={() => go(pathForMap(facts.map!.id, "grid"))}>
            Set the grid
          </Button>
        )}
        {facts.map && (
          <Button size="sm" variant="ghost" onClick={() => go(pathForMap(facts.map!.id))}>
            <IconMap /> Open the map
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Where the Codex names the scene: the sessions that stage it and the pins that link it. The GM can stage it for a
 * session from here; a prep's Encounters section and a pin are changed in the Codex.
 */
export function SceneCodex({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { token, links, reloadLinks } = useScenes();
  const { toast } = useToast();
  const link = links.get(facts.scene.id);
  const [sessions, setSessions] = useState<readonly CodexSession[] | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<{ sessions: CodexSession[] }>(CODEX_PATHS.sessions, { token })
      .then((data) => {
        if (active) setSessions(data.sessions);
      })
      .catch(() => {
        if (active) setSessions([]);
      });
    return () => {
      active = false;
    };
  }, [token, links]);
  const sessionName = (number: number | null) => (number === null ? "A session with no number" : `Session ${number}`);
  const setStaged = (session: CodexSession, sceneIds: readonly string[]) =>
    apiRequest(CODEX_PATHS.sessionById.replace("{id}", session.id), {
      token,
      method: "PATCH",
      body: { sceneIds, expectedRev: session.rev }
    })
      .then(reloadLinks)
      .catch((error: Error) => toast(error.message, { tone: "error" }));
  const free = (sessions ?? []).filter((session) => !session.sceneIds.includes(facts.scene.id));
  return (
    <div className="sc-q">
      {!link || link.sessions.length + link.pins.length === 0 ? (
        <p className="sc-hint">No session or pin names this scene yet.</p>
      ) : (
        <ul className="sc-links">
          {link.sessions.map((entry) => {
            const session = sessions?.find((candidate) => candidate.id === entry.id);
            return (
              <li key={`session:${entry.id}`}>
                <span>
                  <strong>{sessionName(entry.sessionNumber)}</strong> ·{" "}
                  {entry.via === "session" ? "staged for it" : "in its prep's Encounters"}
                  {entry.status === "played" ? " · played" : ""}
                </span>
                {entry.via === "session" && session && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void setStaged(
                        session,
                        session.sceneIds.filter((id) => id !== facts.scene.id)
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
          {link.pins.map((pin) => (
            <li key={`pin:${pin.id}`}>
              <span>
                <strong>{pin.label ?? "A pin with no label"}</strong> · a pin on {pin.mapName}
              </span>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <Select
          aria-label="Stage this scene for a session"
          value=""
          onChange={(event) => {
            const session = free.find((candidate) => candidate.id === event.target.value);
            if (session) void setStaged(session, [...session.sceneIds, facts.scene.id]);
          }}
        >
          <option value="">Stage it for a session…</option>
          {free.map((session) => (
            <option key={session.id} value={session.id}>
              {sessionName(session.sessionNumber)}
              {session.status === "played" ? " · played" : ""}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

/** When the scene was prepared, last changed and last live. */
export function SceneHistory({ facts }: Readonly<{ facts: SceneFacts }>) {
  const { scene } = facts;
  return (
    <dl className="sc-dl">
      <div>
        <dt>Prepared</dt>
        <dd>{whenLabel(scene.createdAt ?? null)}</dd>
      </div>
      <div>
        <dt>Last changed</dt>
        <dd>{whenLabel(scene.updatedAt ?? null)}</dd>
      </div>
      <div>
        <dt>Last live</dt>
        <dd>{facts.live ? "Live now" : whenLabel(scene.liveAt ?? null)}</dd>
      </div>
    </dl>
  );
}
