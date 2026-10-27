import { useRef, useState } from "react";
import { rosterActors, type ActorDefinition, type GmActor, type GmView, type PendingImport } from "@vtt/domain";
import { Badge, Button, Eyebrow, Modal, RevealSwitch, Switch, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { JoinAddress } from "../components/JoinAddress";
import { navigate } from "../router";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { PdfImportModal } from "./PdfImportModal";
import { RandomCharacterModal } from "../builder/RandomCharacter";
import { identityOf, ledgerOf } from "../builder/level-ledger";
import { CLAIM_WORD, claimStateOf, classLine, presenceDot } from "./actor-display";
import { command } from "../lib/command";
import { useForceRelease } from "./useForceRelease";
import { atTableBlocked, setPlayedAtTable } from "./playedAtTable";
import "./party-roster.css";
import { ActorAvatar } from "./ActorAvatar";

/** Never claimed and never in a fight: a character the GM made and can take back without archiving it first. */
export const neverPlayed = (actor: GmActor) =>
  actor.firstClaimedAt === undefined && actor.lastUsedAt === undefined && actor.ownerSessionId === null;

/**
 * The GM's Roster tab: create, import, approve, archive, restore and delete characters.
 * Archived characters are hidden from players by projection, except through the per-character
 * read-only reveal switch (off by default).
 */
export function PartyRosterTab({
  state,
  token,
  onCreateCharacter
}: Readonly<{ state: GmView; token: string; onCreateCharacter?: () => void }>) {
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [previewImportId, setPreviewImportId] = useState<string | null>(null);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const forceRelease = useForceRelease();
  const { toast } = useToast();
  // `rosterActors` drops a launched replay's clones, which the server deletes when the replay ends.
  const pcs = rosterActors(state.actors).filter((actor) => actor.kind === "player-character");
  const active = pcs.filter((actor) => !actor.archived);
  const archived = pcs.filter((actor) => actor.archived);
  const samples = pcs.filter((actor) => actor.sample);
  const sheetActor = sheetActorId ? (pcs.find((actor) => actor.id === sheetActorId) ?? null) : null;
  /**
   * Read defensively: the first `state:updated` a signing-in GM receives can still be the
   * player-shaped projection (state is pushed before `session:join` lands), which lacks these fields.
   */
  const pendingImports = state.pendingImports ?? [];
  const definitions = state.definitions ?? [];
  const previewImport = previewImportId ? (pendingImports.find((entry) => entry.id === previewImportId) ?? null) : null;
  const definitionOf = (actor: GmActor): ActorDefinition | undefined =>
    definitions.find((entry) => entry.id === actor.definitionId)?.definition;
  /** Built here, so the Level flow can read it back; an imported or hand-made sheet is edited instead. */
  const levelable = (actor: GmActor) => {
    const definition = definitionOf(actor);
    return identityOf(definition) !== null && ledgerOf(definition) !== null;
  };

  const setArchived = async (actor: GmActor, next: boolean) => {
    setBusy(true);
    const result = await command("actor:set-archived", { actorId: actor.id, archived: next });
    setBusy(false);
    if (!result.ok) {
      toast(result.message ?? "That change was rejected.", { tone: "error" });
      return;
    }
    toast(
      next
        ? `Archived. ${actor.name} is hidden from players and listed under Archived below.`
        : `${actor.name} is back on the table.`,
      { tone: "success" }
    );
  };

  /** Its player keeps a printed sheet and tells the GM what they do, so nobody claims it and the GM answers for it. */
  const markAtTable = async (actor: GmActor, on: boolean) => {
    const refused = await setPlayedAtTable(actor.id, on);
    if (refused) toast(refused, { tone: "error" });
  };

  const setSheetPreview = async (actor: GmActor, enabled: boolean) => {
    const result = await command("actor:set-sheet-preview", { actorId: actor.id, enabled });
    if (!result.ok) toast(result.message ?? "That change was rejected.", { tone: "error" });
  };

  /** Permanent and confirmed; Archive is the reversible alternative for a character who has been played. */
  const remove = async (actor: GmActor) => {
    const ok = await confirm({
      title: `Delete ${actor.name}?`,
      body: `${actor.name}'s sheet and token go for good. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    const result = await command("actor:remove", { actorId: actor.id });
    setBusy(false);
    toast(result.ok ? `${actor.name} was deleted.` : (result.message ?? "That character could not be deleted."), {
      tone: result.ok ? "success" : "error"
    });
  };

  /** One command: the server removes each sample it may, and names any a player holds or a fight uses. */
  const removeSamples = async () => {
    const ok = await confirm({
      title: "Remove the sample characters?",
      body: `${samples.map((actor) => actor.name).join(", ")} go for good, sheets included. Characters you made stay.`,
      confirmLabel: "Remove samples",
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    const result = await command("actor:remove-samples", {});
    setBusy(false);
    const kept = result.kept ?? [];
    if (!result.ok) toast(result.message ?? "The sample characters could not be removed.", { tone: "error" });
    else if (kept.length === 0) toast("The sample characters are gone.", { tone: "success" });
    else
      toast(`Some samples stayed. ${kept.map((entry) => `${entry.name}: ${entry.reason}`).join(" ")}`, {
        tone: "error"
      });
  };

  const resolveImport = async (pending: PendingImport, approve: boolean) => {
    if (
      !approve &&
      !(await confirm({
        title: "Turn away this import?",
        body: "The player keeps their PDF.",
        confirmLabel: "Turn away"
      }))
    )
      return;
    setBusy(true);
    const result = await command("character:resolve-import", { importId: pending.id, approve });
    setBusy(false);
    if (!result.ok) {
      toast(result.message ?? "Couldn't resolve the import.", { tone: "error" });
      return;
    }
    toast(
      approve ? `${pending.name} joined the roster, ready for a player to claim.` : `Turned away ${pending.name}.`,
      {
        tone: "success"
      }
    );
    setPreviewImportId(null);
  };

  const importSheet = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast("The file could not be read.", { tone: "error" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast("That file is not valid JSON.", { tone: "error" });
      return;
    }
    const result = await command("actor:import-definition", { definition: parsed });
    const name =
      typeof parsed === "object" && parsed !== null && "name" in parsed
        ? String((parsed as { name: unknown }).name)
        : file.name;
    toast(
      result.ok
        ? `${name} joined the roster, ready for a player to claim.`
        : (result.message ?? "The sheet could not be imported."),
      {
        tone: result.ok ? "success" : "error"
      }
    );
  };

  const card = (actor: GmActor, isArchived: boolean) => {
    const claim = claimStateOf(actor);
    const playedWord = actor.playedAtTable ? "At the table" : CLAIM_WORD[claim];
    const line = classLine(definitionOf(actor));
    return (
      <li key={actor.id} className={`nh-card party-card${isArchived ? " is-archived" : ""}`}>
        <div className="nh-card-thumb party-card-thumb">
          <ActorAvatar
            actor={actor}
            token={token}
            definitions={definitions}
            name={actor.name}
            size="lg"
            presence={actor.presence ? presenceDot(actor.presence) : undefined}
          />
        </div>
        {(isArchived || actor.sample) && (
          <span className="nh-card-status">
            {isArchived ? <Badge>Archived</Badge> : <Badge tone="info">Sample</Badge>}
          </span>
        )}
        <div className="nh-card-body">
          <h3 className="nh-card-title">{actor.name}</h3>
          {line && <span className="nh-card-meta">{line}</span>}
          <span className="nh-card-meta">
            {playedWord} · HP {actor.hp.current}/{actor.hp.maximum} · AC {actor.armorClass ?? "None"}
          </span>
        </div>
        {!isArchived && (
          <div className="party-card-preview">
            <Switch
              label="Played at the table"
              checked={actor.playedAtTable === true}
              disabled={busy || atTableBlocked(actor) !== null}
              onChange={(next) => void markAtTable(actor, next)}
            />
          </div>
        )}
        {isArchived && (
          <div className="party-card-preview">
            <span className="party-card-preview-label">Sheet:</span>
            <RevealSwitch
              revealed={actor.sheetPreview}
              ariaLabel={`Show ${actor.name}'s sheet to players`}
              onChange={(next) => setSheetPreview(actor, next)}
            />
          </div>
        )}
        <div className="nh-card-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setSheetActorId(actor.id)}>
            View sheet
          </Button>
          {!isArchived && levelable(actor) && (
            <Button variant="secondary" disabled={busy} onClick={() => navigate(`/characters/${actor.id}/level`)}>
              Level up or down
            </Button>
          )}
          {/* A character never played is deleted outright; one that has been is archived first. */}
          {!isArchived && !neverPlayed(actor) && (
            <Button variant="secondary" disabled={busy} onClick={() => setArchived(actor, true)}>
              Archive
            </Button>
          )}
          {isArchived && (
            <Button variant="secondary" disabled={busy} onClick={() => setArchived(actor, false)}>
              Restore
            </Button>
          )}
          {!isArchived && claim === "claimed" && (
            <Button variant="secondary" disabled={busy} onClick={() => void forceRelease.release(actor)}>
              Force release claim
            </Button>
          )}
          {(isArchived || neverPlayed(actor)) && (
            <Button variant="destructive" disabled={busy} onClick={() => remove(actor)}>
              Delete
            </Button>
          )}
        </div>
      </li>
    );
  };

  /* Heading and actions stay fixed; the queue, gallery and archived drawer share one region below. */
  return (
    <section className="party-roster pane-frame pane-scene frame-col anim-view">
      <div className="party-heading neon-beam">
        <h2>Roster</h2>
        <div className="party-heading-actions">
          {onCreateCharacter && (
            <Button variant="primary" onClick={onCreateCharacter}>
              Create a character
            </Button>
          )}
          <Button onClick={() => setRandomOpen(true)}>Roll a random character</Button>
          <Button onClick={() => setPdfImportOpen(true)}>Import from D&amp;D Beyond (PDF)</Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importSheet(file);
              event.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => importFileRef.current?.click()}>
            Import JSON
          </Button>
        </div>
      </div>

      <div className="party-roster-body scroll-y frame-fill">
        <JoinAddress token={token} />
        {samples.some((actor) => !actor.archived) && (
          <div className="party-samples" role="note">
            <p>
              {samples.map((actor) => actor.name).join(", ")} are sample characters to try the table with. Remove them
              once your own party is ready.
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => void removeSamples()}>
              Remove sample characters
            </Button>
          </div>
        )}
        {pendingImports.length > 0 && (
          <div className="party-queue">
            <h3 className="party-section-head">Waiting for approval</h3>
            <ul className="party-queue-list">
              {pendingImports.map((pending) => (
                <li key={pending.id} className="party-queue-row">
                  <span className="party-queue-name">{pending.name}</span>
                  <Badge tone="info">from a player</Badge>
                  <span className="party-queue-actions">
                    <Button variant="secondary" disabled={busy} onClick={() => setPreviewImportId(pending.id)}>
                      Preview
                    </Button>
                    <Button variant="primary" disabled={busy} onClick={() => resolveImport(pending, true)}>
                      Approve
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => resolveImport(pending, false)}>
                      Turn away
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {pcs.length === 0 ? (
          <div className="scene-empty">
            <p>Nobody is on the table yet.</p>
            {onCreateCharacter && (
              <Button variant="primary" arrow onClick={onCreateCharacter}>
                Create a character
              </Button>
            )}
            <Button variant="secondary" onClick={() => setRandomOpen(true)}>
              Roll a random character
            </Button>
          </div>
        ) : (
          <>
            <ul className="nh-gallery party-gallery">{active.map((actor) => card(actor, false))}</ul>
            {archived.length > 0 && (
              <details className="party-archived">
                <summary>Archived ({archived.length})</summary>
                <p className="party-archived-note">
                  Archived characters are hidden from players and never appear in encounter prep.
                </p>
                <ul className="nh-gallery party-gallery">{archived.map((actor) => card(actor, true))}</ul>
              </details>
            )}
          </>
        )}
      </div>

      <RandomCharacterModal
        open={randomOpen}
        maxLevel={state.builderPolicy?.maxLevel ?? 20}
        onClose={() => setRandomOpen(false)}
        onRolled={(actorId) =>
          toast(`${state.actors.find((actor) => actor.id === actorId)?.name ?? "A new character"} joined the roster.`, {
            tone: "success"
          })
        }
      />
      {sheetActor && (
        <CharacterSheet
          actor={sheetActor}
          role="gm"
          state={state}
          onClose={() => setSheetActorId(null)}
          onLevel={() => {
            setSheetActorId(null);
            navigate(`/characters/${sheetActor.id}/level`);
          }}
        />
      )}
      {previewImport && (
        <Modal
          open
          onClose={() => setPreviewImportId(null)}
          size="md"
          title={previewImport.name}
          ariaLabel={`Preview ${previewImport.name}`}
          footer={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => resolveImport(previewImport, false)}>
                Turn away
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => resolveImport(previewImport, true)}>
                Approve
              </Button>
            </>
          }
        >
          <ImportPreview definition={previewImport.definition} />
        </Modal>
      )}
      <PdfImportModal
        open={pdfImportOpen}
        role="gm"
        onClose={() => setPdfImportOpen(false)}
        onImported={(name) => toast(`${name} joined the roster, ready for a player to claim.`, { tone: "success" })}
      />
      {dialog}
      {forceRelease.dialog}
    </section>
  );
}

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** Read-only preview of a submitted definition; no actor exists until the GM approves it. */
function ImportPreview({ definition }: Readonly<{ definition: ActorDefinition }>) {
  return (
    <dl className="import-preview">
      <div>
        <dt>Class &amp; level</dt>
        <dd>{classLine(definition) ?? "None"}</dd>
      </div>
      <div>
        <dt>Species · background</dt>
        <dd>
          {[definition.character?.race?.name, definition.character?.background?.name].filter(Boolean).join(" · ") ||
            "None"}
        </dd>
      </div>
      <div>
        <dt>Hit points · AC</dt>
        <dd>
          {definition.hitPoints.maximum} · {definition.armorClass}
        </dd>
      </div>
      <div>
        <dt>Abilities</dt>
        <dd className="import-preview-abilities">
          {ABILITIES.map((ability) => (
            <span key={ability}>
              <Eyebrow>{ability}</Eyebrow> {definition.abilityScores[ability]}
            </span>
          ))}
        </dd>
      </div>
      <div>
        <dt>Actions · items</dt>
        <dd>
          {definition.actions.length} actions · {definition.startingInventory?.length ?? 0} items
        </dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>{definition.source.name}</dd>
      </div>
    </dl>
  );
}
