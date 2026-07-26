import { useRef, useState } from "react";
import { Modal, Button, Input } from "@vtt/ui";
import { validateDraft, type ImportResult } from "@vtt/dndbeyond-pdf";
import { extractCharacterFromFile } from "../pdfImport/loadPdf";
import { socket } from "../socket";
import { newId } from "../lib/ids";
import "./pdf-import.css";

const ABIL = ["str", "dex", "con", "int", "wis", "cha"] as const;

type Props = { open: boolean; onClose: () => void; onImported?: (name: string) => void };

export function PdfImportModal({ open, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const reset = () => { setResult(null); setFileName(""); setError(""); setSaveMsg(""); };
  const close = () => { reset(); onClose(); };

  const pick = (file: File) => {
    setBusy(true); setError(""); setSaveMsg(""); setFileName(file.name);
    extractCharacterFromFile(file)
      .then(setResult)
      .catch((e: unknown) => setError(`Couldn't read that PDF (${e instanceof Error ? e.message : "unknown error"}). Make sure it's a D&D Beyond PDF export.`))
      .finally(() => setBusy(false));
  };

  const editField = (path: string[], value: unknown) => {
    if (!result) return;
    const draft = structuredClone(result.draft) as Record<string, unknown>;
    let node = draft as Record<string, unknown>;
    for (let i = 0; i < path.length - 1; i++) node = (node[path[i]] ??= {}) as Record<string, unknown>;
    node[path[path.length - 1]] = value;
    setResult(validateDraft(draft, result.warnings));
  };

  const confirmImport = () => {
    if (!result?.definition) return;
    const name = result.definition.name;
    setSaving(true); setSaveMsg("");
    socket.emit("actor:import-definition", { commandId: newId(), definition: result.definition }, (res: { ok: boolean; message?: string }) => {
      setSaving(false);
      if (res.ok) { onImported?.(name); close(); }
      else setSaveMsg(res.message ?? "The server rejected the import.");
    });
  };

  // Prefer validated data for display; fall back to the raw draft when a required field is missing.
  const view = (result?.definition ?? result?.draft) as Record<string, any> | undefined;
  const num = (v: string) => (v === "" ? undefined : Number(v));

  return <Modal open={open} onClose={close} size="lg" className="pdf-import" ariaLabel="Import from D&D Beyond PDF">
    <div className="pdf-import-head">
      <span className="eyebrow">IMPORT</span>
      <h2>Import from D&amp;D Beyond</h2>
      <p>Choose a character PDF exported from D&amp;D Beyond. It's read on your device — nothing is uploaded.</p>
    </div>

    <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden
      onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />

    {!result && <div className="pdf-import-drop">
      <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Reading…" : "Choose PDF file"}</Button>
      {busy && fileName && <p className="pdf-import-note">Reading {fileName}…</p>}
      {error && <p className="pdf-import-error">{error}</p>}
    </div>}

    {result && view && <div className="pdf-import-review">
      {result.warnings.length > 0 && <div className="pdf-import-warnings">
        <strong>Please review before saving</strong>
        <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>}
      {!result.valid && <div className="pdf-import-error">
        <strong>These need fixing before this character can be added:</strong>
        <ul>{result.issues.map((iss, i) => <li key={i}>{iss}</li>)}</ul>
      </div>}

      <div className="pdf-import-fields">
        <label>Name<Input value={view.name ?? ""} maxLength={120} onChange={(e) => editField(["name"], e.target.value)} /></label>
        <label>Armor Class<Input type="number" value={view.armorClass ?? ""} onChange={(e) => editField(["armorClass"], num(e.target.value))} /></label>
        <label>Max HP<Input type="number" value={view.hitPoints?.maximum ?? ""} onChange={(e) => editField(["hitPoints", "maximum"], num(e.target.value))} /></label>
        <label>Speed (ft)<Input type="number" value={view.speedFeet ?? ""} onChange={(e) => editField(["speedFeet"], num(e.target.value))} /></label>
      </div>

      <dl className="pdf-import-summary">
        <div><dt>Class &amp; level</dt><dd>{(view.character?.classes ?? []).map((c: any) => `${c.name} ${c.level}`).join(" / ") || "—"}</dd></div>
        <div><dt>Species · background</dt><dd>{[view.character?.race?.name, view.character?.background?.name].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div><dt>Abilities</dt><dd className="pdf-import-abilities">{ABIL.map((a) => <span key={a}>{a.toUpperCase()} {view.abilityScores?.[a] ?? "—"}</span>)}</dd></div>
        <div><dt>Proficiencies</dt><dd>{view.proficiencies?.saves?.length ?? 0} saves · {view.proficiencies?.skills?.length ?? 0} skills</dd></div>
        <div><dt>Spellcasting</dt><dd>{view.spellcasting ? `${String(view.spellcasting.ability).toUpperCase()} · save DC ${view.spellcasting.saveDc ?? "—"} · ${view.spellcasting.spells?.length ?? 0} spells` : "None"}</dd></div>
        <div><dt>Actions · inventory</dt><dd>{view.actions?.length ?? 0} actions · {view.startingInventory?.length ?? 0} items</dd></div>
      </dl>

      {saveMsg && <p className="pdf-import-error">{saveMsg}</p>}
      <div className="pdf-import-buttons">
        <Button variant="ghost" type="button" onClick={reset} disabled={saving}>Choose a different file</Button>
        <div className="pdf-import-buttons-right">
          <Button variant="secondary" type="button" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={confirmImport} disabled={!result.valid || saving}>{saving ? "Adding…" : "Add to roster"}</Button>
        </div>
      </div>
    </div>}
  </Modal>;
}
