import type { Annotation, AnnotationVisibility, PlayerAnnotation } from "@vtt/domain";
import { Button, Switch } from "@vtt/ui";
import { annotationCenter } from "./annotationGlyph";
import { drawingAudienceOptions } from "./mapTools";
import type { MapCommands } from "./useMapCommands";
import "./shape-editor.css";

/** The short reveal words, for the read-only line a shape shows to someone who cannot manage it. */
const VISIBILITY_SHORT: Record<AnnotationVisibility, string> = {
  public: "Shown to players",
  "gm-only": "GM only",
  "owner-only": "Only me",
  "owner-gm": "Only me and the GM",
  "gm-actor": "GM and one character"
};

/** The selected shape's card: its size and place, and (for whoever may manage it) colour, audience, move rights and delete. */
export function ShapeEditor({
  selected,
  role,
  manage,
  characters,
  commands,
  onDeleted
}: Readonly<{
  /** A shape annotation; measurements and pings have no editor. */
  selected: Annotation | PlayerAnnotation;
  role: "gm" | "player";
  manage: boolean;
  characters: ReadonlyArray<{ id: string; name: string }>;
  commands: MapCommands;
  onDeleted: () => void;
}>) {
  const center = annotationCenter({
    kind: "shape",
    shape: selected.shape,
    origin: selected.geometry.origin,
    target: selected.geometry.target,
    sizeFeet: selected.geometry.sizeFeet
  });
  const busy = commands.annotationBusy === selected.id;
  const visibilityOptions = drawingAudienceOptions(role);
  const { setColor, setVisibility, setMovable, removeAnnotation } = commands;
  return (
    <div className="encounter-shape-editor" role="group" aria-label="Selected shape">
      <div className="encounter-shape-editor-head">
        <strong>
          {selected.geometry.sizeFeet}ft {selected.shape}
        </strong>
        {center && (
          <span>
            at {Math.round(center.x)}, {Math.round(center.y)}
          </span>
        )}
      </div>
      {manage ? (
        <>
          <label className="encounter-shape-editor-color">
            Color
            <input
              type="color"
              value={selected.color}
              disabled={busy}
              onChange={(event) => setColor(selected.id, event.target.value)}
            />
          </label>
          <label>
            Who sees this
            <select
              value={selected.visibility}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value as AnnotationVisibility;
                setVisibility(
                  selected.id,
                  value,
                  value === "gm-actor" ? (selected.visibleToActorId ?? characters[0]?.id ?? null) : null
                );
              }}
            >
              {visibilityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {selected.visibility === "gm-actor" && (
            <label>
              Character
              <select
                value={selected.visibleToActorId ?? ""}
                disabled={busy}
                onChange={(event) => setVisibility(selected.id, "gm-actor", event.target.value || null)}
              >
                <option value="">Choose…</option>
                {characters.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Switch
            className="encounter-shape-editor-check"
            label="Others can move this"
            checked={selected.movableByOthers}
            disabled={busy}
            onChange={(checked) => setMovable(selected.id, checked)}
          />
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              onDeleted();
              void removeAnnotation(selected.id);
            }}
          >
            Delete shape
          </Button>
        </>
      ) : (
        <p className="encounter-shape-editor-note">
          {VISIBILITY_SHORT[selected.visibility]}
          {selected.movableByOthers ? " · anyone can move it" : ""}
        </p>
      )}
    </div>
  );
}
