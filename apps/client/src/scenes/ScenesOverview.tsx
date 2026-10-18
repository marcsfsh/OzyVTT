import type { ReactNode } from "react";
import { Button, IconMap, IconPlay, IconPlus, IconScene, IconWarning } from "@vtt/ui";
import { pathForGmTab } from "../router";
import { useScenes } from "./context";
import { WhoSees } from "./pieces";
import { SCENES_PATHS, pathForMap, pathForScene } from "./routes";
import { count, factsOf, gridStateOf, modifiedAt, needsOf, whenLabel } from "./sceneFacts";

type NeedRow = Readonly<{ key: string; icon: ReactNode; text: ReactNode; actions: ReactNode; live?: boolean }>;
type ChangeRow = Readonly<{
  key: string;
  name: string;
  kind: "Scene" | "Map";
  change: string;
  shown: boolean;
  at: number;
  path: string;
}>;

/**
 * The Scenes tab's front page: what needs the GM first (the live scene, a scene or map without a grid, tokens still
 * in a tray, vision with no walls), each with its action, then recent changes with who sees each, then a way to start
 * each kind of thing.
 */
export function ScenesOverview() {
  const { state, maps, go, phone } = useScenes();
  const scenes = state.combat.scenes;
  const facts = scenes.map((scene) => factsOf(state, scene, maps));
  const live = facts.find((entry) => entry.live) ?? null;
  const usedMaps = new Set(scenes.map((scene) => scene.mapAssetId));

  const needs: NeedRow[] = [];
  if (live)
    needs.push({
      key: "live",
      live: true,
      icon: <IconPlay />,
      text: (
        <>
          <strong>{live.scene.name}</strong> is live.{" "}
          {state.combat.active
            ? `A fight is on, round ${state.combat.round}.`
            : `${count(live.placed, "token")} on the map and no fight yet.`}
        </>
      ),
      actions: (
        <>
          <Button size="sm" onClick={() => go(pathForGmTab("table"))}>
            Go to the table
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go(pathForScene(live.scene.id))}>
            Open
          </Button>
        </>
      )
    });
  for (const entry of facts)
    for (const need of needsOf(entry))
      needs.push({
        key: `${entry.scene.id}:${need.id}`,
        icon: <IconWarning />,
        text: (
          <>
            <strong>{entry.scene.name}</strong> · {need.text}
          </>
        ),
        actions:
          need.id === "grid" && entry.map ? (
            <Button size="sm" onClick={() => go(pathForMap(entry.map!.id, "grid"))}>
              Set the grid
            </Button>
          ) : (
            <Button size="sm" onClick={() => go(pathForScene(entry.scene.id, need.step))}>
              Go to it
            </Button>
          )
      });
  for (const map of maps ?? [])
    if (!usedMaps.has(map.id) && gridStateOf(map) === "none")
      needs.push({
        key: `map:${map.id}`,
        icon: <IconMap />,
        text: (
          <>
            <strong>{map.name}</strong> has no grid yet.
          </>
        ),
        actions: (
          <Button size="sm" onClick={() => go(pathForMap(map.id, "grid"))}>
            Set the grid
          </Button>
        )
      });

  const changes: ChangeRow[] = [
    ...scenes.flatMap((scene) => {
      const at = modifiedAt(scene);
      if (at === null) return [];
      const change =
        scene.liveAt !== undefined && scene.liveAt === at
          ? "Made live"
          : scene.createdAt !== undefined && scene.createdAt === scene.updatedAt
            ? "Prepared"
            : "Changed";
      return [
        {
          key: `scene:${scene.id}`,
          name: scene.name,
          kind: "Scene" as const,
          change,
          shown: scene.id === state.combat.activeSceneId,
          at,
          path: pathForScene(scene.id)
        }
      ];
    }),
    ...(maps ?? []).map((map) => ({
      key: `map:${map.id}`,
      name: map.name,
      kind: "Map" as const,
      change: map.updatedAt === map.importedAt ? "Uploaded" : map.calibration ? "Grid set" : "Changed",
      shown: map.id === state.combat.mapAssetId,
      at: Date.parse(map.updatedAt),
      path: pathForMap(map.id)
    }))
  ]
    .sort((left, right) => right.at - left.at)
    .slice(0, 8);

  return (
    <div className="sc-overview scroll-y">
      {phone && <h2 className="sc-phone-title">Scenes</h2>}
      <p className="sc-overview-counts">
        {count(scenes.length, "scene")}
        {live ? " · 1 live" : " · none live"} · {count(maps?.length ?? 0, "map")}
      </p>
      <section className="sc-card" aria-labelledby="sc-needs-title">
        <h3 id="sc-needs-title" className="sc-card-title">
          Needs you{needs.length > 0 ? ` · ${needs.length}` : ""}
        </h3>
        {needs.length === 0 ? (
          <p className="sc-hint">Nothing needs you. Every scene has its grid, and its tokens are on the map.</p>
        ) : (
          <ul className="sc-needs">
            {needs.map((need) => (
              <li key={need.key} className={need.live ? "is-live" : undefined}>
                <span className="sc-needs-icon" aria-hidden="true">
                  {need.icon}
                </span>
                <span className="sc-needs-text">{need.text}</span>
                <span className="sc-needs-actions">{need.actions}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sc-card" aria-labelledby="sc-recent-title">
        <h3 id="sc-recent-title" className="sc-card-title">
          Recent changes
        </h3>
        {changes.length === 0 ? (
          <p className="sc-hint">Nothing yet. Add a map or prepare a scene, and it shows here.</p>
        ) : phone ? (
          <ul className="sc-rows">
            {changes.map((row) => (
              <li key={row.key}>
                <button type="button" className="sc-row" onClick={() => go(row.path)}>
                  <span className="sc-row-main">
                    <strong>{row.name}</strong>
                    <small>
                      {row.kind} · {row.change} · {whenLabel(row.at)}
                    </small>
                  </span>
                  <WhoSees shown={row.shown} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <table className="sc-table">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Change</th>
                <th scope="col">Who sees it</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((row) => (
                <tr key={row.key}>
                  <td>
                    <button type="button" className="sc-rowlink" onClick={() => go(row.path)}>
                      {row.kind === "Scene" ? <IconScene /> : <IconMap />}
                      <b>{row.name}</b>
                    </button>
                  </td>
                  <td>{row.change}</td>
                  <td>
                    <WhoSees shown={row.shown} />
                  </td>
                  <td className="sc-col-date">{whenLabel(row.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sc-card" aria-labelledby="sc-start-title">
        <h3 id="sc-start-title" className="sc-card-title">
          Start something
        </h3>
        <div className="sc-start">
          <button type="button" className="sc-start-item" onClick={() => go(SCENES_PATHS.newScene)}>
            <IconPlus />
            <span>
              <strong>New scene</strong>
              <small>Choose a map, then place the party and the monsters on it.</small>
            </span>
          </button>
          <button type="button" className="sc-start-item" onClick={() => go(SCENES_PATHS.newMap)}>
            <IconMap />
            <span>
              <strong>Add a map</strong>
              <small>Upload an image and set its grid.</small>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
