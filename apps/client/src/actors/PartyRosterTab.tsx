import { useRef, useState } from "react";
import type { ActorDefinition, GmActor, GmView, PendingImport } from "@vtt/domain";
import { Avatar, Badge, Button, Eyebrow, Modal, RevealSwitch, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { PdfImportModal } from "./PdfImportModal";
import { CLAIM_WORD, claimStateOf, classLine, presenceDot } from "./actor-display";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * **The Roster tab — the management home for characters (D15–D17).**
 *
 * Every character on the table in one gallery: create, import, approve, archive, restore, delete. It
 * is the ONLY roster surface now. The app shell used to paint a second, full-size roster above every
 * tab — including this one, so the Roster tab showed two rosters — and the pieces that lived only in
 * that shell copy (the PDF approval queue, JSON import, "Create a character") would have been orphaned
 * by deleting it. They are here instead.
 *
 * Archived characters are hidden from players by projection; the per-character reveal switch is the one
 * exception D16 allows — a read-only keepsake sheet, off by default.
 */
export function PartyRosterTab({ state, onCreateCharacter }: Readonly<{ state: GmView; onCreateCharacter?: () => void }>) {
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [previewImportId, setPreviewImportId] = useState<string | null>(null);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const pcs = state.actors.filter((actor) => actor.kind === "player-character");
  const active = pcs.filter((actor) => !actor.archived);
  const archived = pcs.filter((actor) => actor.archived);
  const sheetActor = sheetActorId ? pcs.find((actor) => actor.id === sheetActorId) ?? null : null;
  /**
   * Read defensively. The FIRST `state:updated` a signing-in GM receives can still be the
   * player-shaped projection — the socket pushes state before `session:join` lands — and that shape
   * carries neither `pendingImports` nor `definitions`. main.tsx guards its scene strip on the field
   * for exactly this reason; the crash it prevents is a whole-app error boundary, not a blank panel.
   */
  const pendingImports = state.pendingImports ?? [];
  const definitions = state.definitions ?? [];
  const previewImport = previewImportId ? pendingImports.find((entry) => entry.id === previewImportId) ?? null : null;
  const definitionOf = (actor: GmActor): ActorDefinition | undefined =>
    definitions.find((entry) => entry.id === actor.definitionId)?.definition;

  const setArchived = (actor: GmActor, next: boolean) => {
    setBusy(true);
    socket.emit("actor:set-archived", { commandId: newId(), actorId: actor.id, archived: next }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) { toast(result.message ?? "That change was rejected.", { tone: "error" }); return; }
      toast(next ? `Archived. ${actor.name} is hidden from players — find them under Archived below.` : `${actor.name} is back on the table.`, { tone: "success" });
    });
  };

  const setSheetPreview = (actor: GmActor, enabled: boolean) => {
    socket.emit("actor:set-sheet-preview", { commandId: newId(), actorId: actor.id, enabled }, (result: { ok: boolean; message?: string }) => {
      if (!result.ok) toast(result.message ?? "That change was rejected.", { tone: "error" });
    });
  };

  const forceRelease = (actor: GmActor) => {
    socket.emit("character:force-release", { commandId: newId(), actorId: actor.id, expectedRevision: state.revision }, (result: { ok: boolean; message?: string }) => {
      toast(result.ok ? `${actor.name} is available again.` : result.message ?? "The player claim could not be released.", { tone: result.ok ? "success" : "error" });
    });
  };

  /** Triad Delete: permanent, confirmed, and it says so. Archive is the reversible verb next to it. */
  const remove = async (actor: GmActor) => {
    const ok = await confirm({
      title: `Delete ${actor.name}?`,
      body: `Their sheet, claim history, and token are gone. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    socket.emit("actor:remove", { commandId: newId(), actorId: actor.id }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      toast(result.ok ? `${actor.name} was deleted.` : result.message ?? "That character could not be deleted.", { tone: result.ok ? "success" : "error" });
    });
  };

  const resolveImport = async (pending: PendingImport, approve: boolean) => {
    if (!approve && !(await confirm({ title: "Turn away this import?", body: "The player keeps their PDF.", confirmLabel: "Turn away" }))) return;
    setBusy(true);
    socket.emit("character:resolve-import", { commandId: newId(), importId: pending.id, approve }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) { toast(result.message ?? "Couldn't resolve the import.", { tone: "error" }); return; }
      toast(approve ? `${pending.name} joined the roster — ready to claim.` : `Turned away ${pending.name}.`, { tone: "success" });
      setPreviewImportId(null);
    });
  };

  const importSheet = (file: File) => {
    file.text().then((text) => {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { toast("That file is not valid JSON.", { tone: "error" }); return; }
      socket.emit("actor:import-definition", { commandId: newId(), definition: parsed }, (result) => {
        const name = typeof parsed === "object" && parsed !== null && "name" in parsed ? String((parsed as { name: unknown }).name) : file.name;
        toast(result.ok ? `${name} joined the roster — ready to claim.` : result.message ?? "The sheet could not be imported.", { tone: result.ok ? "success" : "error" });
      });
    }).catch(() => toast("The file could not be read.", { tone: "error" }));
  };

  const card = (actor: GmActor, isArchived: boolean) => {
    const claim = claimStateOf(actor);
    const line = classLine(definitionOf(actor));
    return <li key={actor.id} className={`nh-card party-card${isArchived ? " is-archived" : ""}`}>
      <div className="nh-card-thumb party-card-thumb"><Avatar name={actor.name} size="lg" presence={actor.presence ? presenceDot(actor.presence) : undefined} /></div>
      {isArchived && <span className="nh-card-status"><Badge>Archived</Badge></span>}
      <div className="nh-card-body">
        <h3 className="nh-card-title">{actor.name}</h3>
        {line && <span className="nh-card-meta">{line}</span>}
        <span className="nh-card-meta">{CLAIM_WORD[claim]} · HP {actor.hp.current}/{actor.hp.maximum} · AC {actor.armorClass ?? "—"}</span>
      </div>
      {isArchived && <div className="party-card-preview">
        <span className="party-card-preview-label">Sheet:</span>
        <RevealSwitch revealed={actor.sheetPreview} ariaLabel={`Show ${actor.name}'s sheet to players`} onChange={(next) => setSheetPreview(actor, next)} />
      </div>}
      <div className="nh-card-actions">
        <Button variant="secondary" disabled={busy} onClick={() => setSheetActorId(actor.id)}>View sheet</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setArchived(actor, !isArchived)}>{isArchived ? "Restore" : "Archive"}</Button>
        {!isArchived && claim === "claimed" && <Button variant="secondary" disabled={busy} onClick={() => forceRelease(actor)}>Force release claim</Button>}
        {isArchived && <Button variant="destructive" disabled={busy} onClick={() => remove(actor)}>Delete</Button>}
      </div>
    </li>;
  };

  /* THE FRAME (§7): the heading and its actions never move; the queue, the gallery and the
     archived drawer share one declared region below them. The surface stands on the scene
     sky (§9) — it is a browse-and-pick page, not the table. */
  return <section className="party-roster pane-frame pane-scene scanlines frame-col anim-view">
    <div className="party-heading">
      <h2>The party</h2>
      <p>Every character on the table — create, import, approve, archive.</p>
      <div className="party-heading-actions">
        {onCreateCharacter && <Button variant="primary" onClick={onCreateCharacter}>Create a character</Button>}
        <Button onClick={() => setPdfImportOpen(true)}>Import from D&amp;D Beyond (PDF)</Button>
        <input ref={importFileRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importSheet(file); event.target.value = ""; }} />
        <Button variant="secondary" onClick={() => importFileRef.current?.click()}>Import JSON</Button>
      </div>
    </div>

    <div className="party-roster-body scroll-y frame-fill">
    {/* The approval queue (B6.3). It lived inside the shell roster and nowhere else; this is its home. */}
    {pendingImports.length > 0 && <div className="party-queue">
      <h3 className="party-section-head">Waiting for approval</h3>
      <ul className="party-queue-list">{pendingImports.map((pending) => <li key={pending.id} className="party-queue-row">
        <span className="party-queue-name">{pending.name}</span>
        <Badge tone="info">from a player</Badge>
        <span className="party-queue-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setPreviewImportId(pending.id)}>Preview</Button>
          <Button variant="primary" disabled={busy} onClick={() => resolveImport(pending, true)}>Approve</Button>
          <Button variant="ghost" disabled={busy} onClick={() => resolveImport(pending, false)}>Turn away</Button>
        </span>
      </li>)}</ul>
    </div>}

    {pcs.length === 0
      /* An empty roster is a scene moment (§9): one line, one door. The import routes are still
         one tap away in the heading row above — this is the first thing to do, not the only one. */
      ? <div className="scene-empty">
          <p>Nobody is on the table yet.</p>
          {onCreateCharacter && <Button variant="primary" arrow onClick={onCreateCharacter}>Create a character</Button>}
        </div>
      : <>
        <ul className="nh-gallery party-gallery">{active.map((actor) => card(actor, false))}</ul>
        {archived.length > 0 && <details className="party-archived">
          <summary>Archived ({archived.length})</summary>
          <p className="party-archived-note">Archived characters are hidden from players and never appear in fight prep.</p>
          <ul className="nh-gallery party-gallery">{archived.map((actor) => card(actor, true))}</ul>
        </details>}
      </>}
    </div>

    {sheetActor && <CharacterSheet actor={sheetActor} role="gm" state={state} onClose={() => setSheetActorId(null)} />}
    {previewImport && <Modal open onClose={() => setPreviewImportId(null)} size="md" title={previewImport.name} ariaLabel={`Preview ${previewImport.name}`}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={() => resolveImport(previewImport, false)}>Turn away</Button>
        <Button variant="primary" disabled={busy} onClick={() => resolveImport(previewImport, true)}>Approve</Button>
      </>}>
      <ImportPreview definition={previewImport.definition} />
    </Modal>}
    <PdfImportModal open={pdfImportOpen} role="gm" onClose={() => setPdfImportOpen(false)} onImported={(name) => toast(`${name} joined the roster — ready to claim.`, { tone: "success" })} />
    {dialog}
  </section>;
}

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

/**
 * A read-only look at what a player actually sent, before the GM decides. Read off the submitted
 * definition rather than a live actor, because there is no actor yet — approving is what creates one.
 */
function ImportPreview({ definition }: Readonly<{ definition: ActorDefinition }>) {
  return <dl className="import-preview">
    <div><dt>Class &amp; level</dt><dd>{classLine(definition) ?? "—"}</dd></div>
    <div><dt>Species · background</dt><dd>{[definition.character?.race?.name, definition.character?.background?.name].filter(Boolean).join(" · ") || "—"}</dd></div>
    <div><dt>Hit points · AC</dt><dd>{definition.hitPoints.maximum} · {definition.armorClass}</dd></div>
    <div><dt>Abilities</dt><dd className="import-preview-abilities">{ABILITIES.map((ability) => <span key={ability}><Eyebrow>{ability}</Eyebrow> {definition.abilityScores[ability]}</span>)}</dd></div>
    <div><dt>Actions · items</dt><dd>{definition.actions.length} actions · {definition.startingInventory?.length ?? 0} items</dd></div>
    <div><dt>Source</dt><dd>{definition.source.name}</dd></div>
  </dl>;
}
