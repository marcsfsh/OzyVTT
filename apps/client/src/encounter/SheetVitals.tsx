import { armorClassInPlay, type ActorDefinition, type GmActor, type PlayerActor } from "@vtt/domain";
import { Meter } from "@vtt/ui";
import { HpAdjust } from "./HpAdjust";
import { signed } from "./format";
import type { SrdExtension } from "./sheet-extension";

/** HP with its tracker, AC, initiative and speeds, the numbers read most often mid-fight. */
export function SheetVitals({
  actor,
  role,
  definition,
  extension,
  onFeedback
}: Readonly<{
  actor: GmActor | PlayerActor;
  role: "gm" | "player";
  definition: ActorDefinition | null;
  extension: SrdExtension;
  onFeedback: (text: string) => void;
}>) {
  const hp = actor.hp;
  const exactHp = "kind" in hp ? (hp.kind === "exact" ? hp : null) : hp;
  const speeds = extension.speeds
    ? (["walk", "swim", "fly", "climb", "burrow"] as const)
        .flatMap((mode) => {
          const feet = extension.speeds?.[mode];
          return feet
            ? [
                `${mode === "walk" ? "" : `${mode} `}${feet} ft.${mode === "fly" && extension.speeds?.hover ? " (hover)" : ""}`
              ]
            : [];
        })
        .join(", ")
    : definition
      ? `${definition.speedFeet} ft.`
      : null;
  return (
    <div className="sheet-vitals">
      <div className="sheet-vital sheet-vital-hp">
        <div className="sheet-vital-top">
          <span>HP</span>
          <strong>
            {exactHp
              ? `${exactHp.current}/${exactHp.maximum}${exactHp.temporary > 0 ? ` +${exactHp.temporary}` : ""}`
              : "-"}
          </strong>
        </div>
        {exactHp && <Meter className="sheet-hp-meter" tone="health" value={exactHp.current} max={exactHp.maximum} />}
        <HpAdjust
          actor={actor}
          controls={role === "gm" ? ["damage", "heal", "temp", "set"] : ["damage", "heal", "temp"]}
          onFeedback={onFeedback}
        />
      </div>
      <div className="sheet-vital" title={extension.armorDetail ?? undefined}>
        <span>AC</span>
        {/* A Shield up shows in the number, since that is what attacks meet. */}
        <strong>{armorClassInPlay(actor) ?? "-"}</strong>
      </div>
      <div className="sheet-vital">
        <span>Init</span>
        <strong>{actor.initiative !== undefined ? signed(actor.initiative) : "-"}</strong>
      </div>
      {speeds && (
        <div className="sheet-vital">
          <span>Speed</span>
          <strong>{speeds}</strong>
        </div>
      )}
    </div>
  );
}
