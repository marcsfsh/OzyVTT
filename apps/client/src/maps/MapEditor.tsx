import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Combobox,
  Field,
  IconChevronLeft,
  IconList,
  IconMap,
  IconPlus,
  Input,
  Select,
  cx,
  useToast
} from "@vtt/ui";
import { navigate, pathForGmTab, useRoute } from "../router";
import { EncounterMap } from "../scene/EncounterMap";
import { useAuthorizedMapImage } from "../scene/mapImage";
import { useScenes } from "../scenes/context";
import { backPathOf, MAP_STEPS, pathForMap, SCENES_PATHS, type MapStep } from "../scenes/routes";
import { gridLine, gridStateOf } from "../scenes/sceneFacts";
import { folderNamesOf, useMapActions } from "./mapActions";
import { MAP_KIND_LABEL, MAP_KINDS } from "./map-lists";
import { uploadMap, type MapAsset, type MapKind } from "./map-catalog";
import { useCalibration } from "./useCalibration";
import { EditorFrame } from "../scenes/EditorFrame";
import "./calibration.css";
import "../scenes/scene-page.css";

const STEP_LABEL: Readonly<Record<MapStep, string>> = {
  upload: "Upload",
  grid: "Grid",
  check: "Check the alignment",
  use: "Name and use"
};
const STEP_SHORT: Readonly<Record<MapStep, string>> = { upload: "Upload", grid: "Grid", check: "Check", use: "Use" };
const STEP_ASK: Readonly<Record<MapStep, string>> = {
  upload: "Choose the image. Name it and file it now, or later.",
  grid: "Mark the printed grid, or a distance you know, so tokens snap and rulers measure.",
  check: "Check a far point against the grid, then save it.",
  use: "Name the map and file it. A battle map can start an encounter from here."
};

/** The first step: the image and what to call it. Upload adds it to the library and opens its Grid step. */
function UploadStep({ onFile, file }: Readonly<{ onFile: (file: File | null) => void; file: File | null }>) {
  const { token, maps, reloadMaps, go } = useScenes();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MapKind>("battlemap");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const ids = { name: useId(), kind: useId(), folder: useId() };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { asset, duplicate } = await uploadMap(token, file, kind, { name, folder });
      await reloadMaps();
      if (duplicate) toast("That image is already in the library, so its own map opens.", { tone: "info" });
      void navigate(pathForMap(asset.id, "grid"), { replace: true });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sc-q">
      <div className="sc-q-actions">
        <Button onClick={() => input.current?.click()}>
          <IconPlus /> {file ? "Choose another image" : "Choose an image"}
        </Button>
        {file && <span className="sc-hint">{file.name}</span>}
      </div>
      <input
        ref={input}
        className="map-upload-input"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          onFile(next);
          if (next && !name) setName(next.name.replace(/\.[^.]+$/, ""));
        }}
      />
      <Field label="Map name" htmlFor={ids.name} help="Optional. A map with no name takes its file's name.">
        <Input
          id={ids.name}
          value={name}
          maxLength={120}
          placeholder="Ruined keep"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Map type" htmlFor={ids.kind}>
        <Select id={ids.kind} value={kind} onChange={(event) => setKind(event.target.value as MapKind)}>
          {MAP_KINDS.map((option) => (
            <option key={option} value={option}>
              {MAP_KIND_LABEL[option]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Folder" htmlFor={ids.folder} help="Optional. Pick a folder or type a new one.">
        <Combobox
          id={ids.folder}
          ariaLabel="Folder"
          placeholder="No folder"
          allowFreeText
          value={folder || null}
          onChange={(next) => setFolder((next ?? "").slice(0, 60))}
          options={folderNamesOf(maps ?? []).map((name) => ({ id: name, label: name }))}
        />
      </Field>
      <div className="sc-editor-inline-foot">
        <Button variant="secondary" onClick={() => go(SCENES_PATHS.maps)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!file || busy} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Upload map"}
        </Button>
      </div>
    </div>
  );
}

/** The last step: the map's name and folder, and where to go with it. */
function UseStep({ map }: Readonly<{ map: MapAsset }>) {
  const { token, maps, reloadMaps } = useScenes();
  const actions = useMapActions(token, reloadMaps);
  const folderId = useId();
  return (
    <div className="sc-q">
      <p className={cx("sc-facts-line", gridStateOf(map) === "none" && "sc-caution")}>
        {map.name} · {MAP_KIND_LABEL[map.kind]} · {gridLine(gridStateOf(map), map)}
      </p>
      <div className="sc-q-actions">
        <Button onClick={() => void actions.rename(map)}>Rename</Button>
      </div>
      <div className="sc-field-row">
        <label className="sc-field" htmlFor={folderId}>
          <span className="sc-label">Folder</span>
          <Select
            id={folderId}
            value={map.folder ?? ""}
            onChange={(event) => void actions.setFolder(map, event.target.value || null)}
          >
            <option value="">None</option>
            {folderNamesOf(maps ?? []).map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </Select>
        </label>
        <Button onClick={() => void actions.newFolder(map)}>New folder…</Button>
      </div>
      {actions.dialog}
    </div>
  );
}

const MAP_FRAME_STEPS = (map: MapAsset | null) => {
  const grid = map ? gridStateOf(map) : "none";
  const set = grid === "grid" || grid === "scale";
  return MAP_STEPS.map((candidate) => ({
    id: candidate,
    label: STEP_LABEL[candidate],
    short: STEP_SHORT[candidate],
    ...(map
      ? { state: candidate === "upload" || candidate === "use" || set ? ("done" as const) : ("incomplete" as const) }
      : { locked: candidate !== "upload" })
  }));
};

/** The head both map editors share: the way back, and the map's name. */
function MapEditorHead({ map }: Readonly<{ map: MapAsset | null }>) {
  const { go, narrow } = useScenes();
  return (
    <>
      {narrow ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={map ? `Back to ${map.name}` : "Back to the maps"}
          onClick={() => go(map ? pathForMap(map.id) : SCENES_PATHS.maps)}
        >
          <IconChevronLeft />
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => go(SCENES_PATHS.maps)}>
          <IconList /> Maps
        </Button>
      )}
      <h2 className="sc-scene-title">{map ? map.name : "Add a map"}</h2>
      <span className="sc-grow" />
      {map && !narrow && (
        <Button variant="ghost" size="sm" onClick={() => go(pathForMap(map.id))}>
          Open the map
        </Button>
      )}
    </>
  );
}

/** A new map's first step, before it is in the library. */
function NewMapEditor() {
  const { narrow } = useScenes();
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setFileUrl(null);
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <EditorFrame
      className="sc-map-editor"
      narrow={narrow}
      head={<MapEditorHead map={null} />}
      steps={MAP_FRAME_STEPS(null)}
      current="upload"
      onStep={() => {}}
      title={STEP_LABEL.upload}
      ask={STEP_ASK.upload}
      questions={<UploadStep file={file} onFile={setFile} />}
      foot={null}
      map={
        fileUrl ? (
          <img className="sc-upload-preview" src={fileUrl} alt={`The chosen image, ${file?.name ?? ""}`} />
        ) : (
          <p className="sc-preview-note">The image you choose shows here.</p>
        )
      }
      mapLabel="The chosen image"
      peek={{ icon: <IconMap />, name: file?.name ?? "No image yet", detail: "The image shows here once chosen." }}
    />
  );
}

/** A map in the library, from its Grid step on: the calibration placed beside its steps, then Name and use. */
function MapStepsEditor({ map, step }: Readonly<{ map: MapAsset; step: MapStep }>) {
  const { token, reloadMaps, go, narrow } = useScenes();
  const { toast } = useToast();
  const back = backPathOf(useRoute().query);
  const image = useAuthorizedMapImage(map.id, token);
  const current: MapStep = step === "upload" ? "grid" : step;
  const stepPath = (next: MapStep) => pathForMap(map.id, next, back);
  const calibration = useCalibration({
    map,
    previewUrl: image.status === "ready" ? image.url : null,
    gmToken: token,
    onSaved: () => reloadMaps(),
    // The calibration's Looks right moves it to its check; the map's steps follow.
    onStep: (next) => {
      if (next === 3 && current !== "check") go(stepPath("check"));
    },
    // The calibration's own note goes with its step, so the saved grid is said in a toast on the way to Use.
    onFinished: (message) => {
      toast(message, { tone: "success" });
      go(stepPath("use"));
    }
  });
  // A link or the step list can open Check before anything is marked; it then says to mark the grid first.
  const { goToStep, step: calibrationStep, maxStep } = calibration;
  useEffect(() => {
    if (current === "check" && calibrationStep < 3 && maxStep >= 3) goToStep(3);
    if (current === "grid" && calibrationStep === 3) goToStep(2);
  }, [current, calibrationStep, maxStep, goToStep]);
  const calibrating = current === "grid" || current === "check";
  const checkReady = current !== "check" || maxStep >= 3;
  const grid = gridStateOf(map);
  const doneLabel = back === "/table" ? "Back to the table" : back ? "Back to the encounter" : null;

  const questions: ReactNode = calibrating ? (
    <div className="sc-q">
      {calibration.note}
      {checkReady ? (
        <div className="map-step-body-inline">{calibration.body}</div>
      ) : (
        <>
          <p className="sc-hint">Mark the grid first, then check it here.</p>
          <Button onClick={() => go(stepPath("grid"))}>Go to Grid</Button>
        </>
      )}
    </div>
  ) : (
    <UseStep map={map} />
  );
  const foot: ReactNode = calibrating ? (
    checkReady ? (
      <>
        {calibration.actions.secondary}
        {calibration.actions.primary}
      </>
    ) : null
  ) : (
    <>
      <Button variant="secondary" onClick={() => go(stepPath("check"))}>
        Back
      </Button>
      {doneLabel ? (
        <Button variant="primary" onClick={() => go(back === "/table" ? pathForGmTab("table") : back!)}>
          {doneLabel}
        </Button>
      ) : map.kind === "battlemap" ? (
        <Button variant="primary" onClick={() => go(`${SCENES_PATHS.newScene}?map=${map.id}`)}>
          New encounter on this map
        </Button>
      ) : (
        <Button variant="primary" onClick={() => go(pathForMap(map.id))}>
          Done
        </Button>
      )}
    </>
  );
  const preview = calibrating ? (
    calibration.canvas
  ) : (
    <EncounterMap
      assetId={map.id}
      token={token}
      altText={map.name}
      role="gm"
      actors={[]}
      tokens={[]}
      annotations={[]}
      revision={0}
      activeActorId={null}
      readOnly
      showGrid
    />
  );
  return (
    <EditorFrame
      className={cx("sc-map-editor", calibrating && "is-calibrating")}
      narrow={narrow}
      head={<MapEditorHead map={map} />}
      steps={MAP_FRAME_STEPS(map)}
      current={current}
      onStep={(id) => go(stepPath(id as MapStep))}
      title={STEP_LABEL[current]}
      ask={STEP_ASK[current]}
      questions={questions}
      foot={foot}
      map={preview}
      mapLabel={calibrating ? `${map.name}, to mark its grid` : `${map.name}, as the table draws it`}
      inlineMap={calibrating}
      peek={{ icon: <IconMap />, name: map.name, detail: gridLine(grid, map) }}
    />
  );
}

/**
 * Adding a map, or setting its grid again, as steps: Upload, Grid, Check the alignment, Name and use. The steps run
 * down the left; the questions fill the middle; the map is pinned on the right, where the grid is marked and checked.
 * On a phone the steps are a strip across the top, and the map sits above the questions while its grid is marked.
 */
export function MapEditor({ mapId, step }: Readonly<{ mapId: string | null; step: MapStep }>) {
  const { maps, go } = useScenes();
  if (!mapId) return <NewMapEditor />;
  const map = maps?.find((candidate) => candidate.id === mapId) ?? null;
  if (maps === null) return <p className="sc-missing">Reading the map library…</p>;
  if (!map)
    return (
      <div className="sc-missing">
        <p role="status">That map is not in the library.</p>
        <Button onClick={() => go(SCENES_PATHS.maps)}>All maps</Button>
      </div>
    );
  return <MapStepsEditor key={map.id} map={map} step={step} />;
}
