import { useRef, useState } from "react";
import { rosterActors, type ActorDefinition, type GmActor, type GmView, type PendingImport } from "@vtt/domain";
import {
  Badge,
  Button,
  EmptyState,
  Eyebrow,
  IconButton,
  IconDie,
  IconPage,
  IconPlus,
  Menu,
  MenuItem,
  Modal,
  useToast
} from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useConfirm } from "../components/feedback";
import { levelPath, navigate } from "../router";
import { PrepBarSlot } from "../shell/AppBar";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { PdfImportModal } from "./PdfImportModal";
import { RandomCharacterModal } from "../builder/RandomCharacter";
import { identityOf, ledgerOf } from "../builder/level-ledger";
import { classLine } from "./actor-display";
import { command } from "../lib/command";
import { useForceRelease } from "./useForceRelease";
import { setPlayedAtTable } from "./playedAtTable";
import "./party-roster.css";
import { RosterBand } from "./RosterBand";
import { BarPrimary } from "../shell/SectionBar";

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
  const phone = useMediaQuery("(max-width: 760px)");
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
      body: `${actor.name}'s sheet and token go too, and this cannot be undone.`,
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

  const band = (actor: GmActor, isArchived: boolean) => (
    <RosterBand
      key={actor.id}
      actor={actor}
      definition={definitionOf(actor)}
      token={token}
      definitions={definitions}
      archived={isArchived}
      levelable={levelable(actor)}
      busy={busy}
      neverPlayed={neverPlayed(actor)}
      onOpen={() => setSheetActorId(actor.id)}
      onLevel={() => navigate(levelPath(actor.id))}
      onAtTable={(on) => void markAtTable(actor, on)}
      onRelease={() => void forceRelease.release(actor)}
      onArchive={(next) => void setArchived(actor, next)}
      onDelete={() => void remove(actor)}
      onSheetPreview={(next) => void setSheetPreview(actor, next)}
    />
  );

  /* Heading and actions stay fixed; the queue, gallery and archived drawer share one region below. */
  return (
    <section className="party-roster pane-frame pane-scene frame-col anim-view">
      {/* A list has no title row: Prep's bar names the page and holds its primary (theme spec 2.2). */}
      {/* One Cup in Prep's bar (characters rule 1): New character. */}
      {onCreateCharacter && (
        <PrepBarSlot>
          {phone ? (
            <IconButton label="New character" onClick={onCreateCharacter}>
              <IconPlus />
            </IconButton>
          ) : (
            <BarPrimary label="New character" onClick={onCreateCharacter} />
          )}
        </PrepBarSlot>
      )}

      <div className="party-roster-body scroll-y frame-fill">
        {/* Samples are a line (characters rule 3), with Remove sample characters on a Base line. */}
        {samples.some((actor) => !actor.archived) && (
          <div className="party-samples" role="note">
            <p>
              {namesList(
                samples.filter((actor) => !actor.archived).map((actor) => actor.name.split(" ")[0] ?? actor.name)
              )}{" "}
              are sample characters to try the table with.
            </p>
            <Button disabled={busy} onClick={() => void removeSamples()}>
              Remove sample characters
            </Button>
          </div>
        )}
        {pcs.length > 0 && (
          <div className="party-toolbar">
            <span className="party-count" role="status">
              {active.length} {active.length === 1 ? "character" : "characters"}
            </span>
            <span className="party-toolbar-actions">
              <Button onClick={() => setRandomOpen(true)}>
                <IconDie /> Roll a random character
              </Button>
              <Menu
                trigger={
                  <>
                    <IconPage /> Import
                  </>
                }
                align="end"
              >
                <MenuItem onClick={() => setPdfImportOpen(true)}>From a D&amp;D Beyond PDF</MenuItem>
                <MenuItem onClick={() => importFileRef.current?.click()}>From a JSON file</MenuItem>
              </Menu>
            </span>
          </div>
        )}
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
        {pendingImports.length > 0 && (
          <section className="party-queue" aria-labelledby="party-queue-title">
            <h3 id="party-queue-title" className="party-section-head">
              Waiting for approval · {pendingImports.length}
            </h3>
            <ul className="party-queue-list">
              {pendingImports.map((pending) => (
                <li key={pending.id} className="party-queue-row">
                  <span className="party-queue-name">{pending.name}</span>
                  <Badge tone="info">from a player</Badge>
                  <span className="party-queue-actions">
                    <Button disabled={busy} onClick={() => setPreviewImportId(pending.id)}>
                      Preview
                    </Button>
                    <Button disabled={busy} onClick={() => resolveImport(pending, true)}>
                      Approve
                    </Button>
                    <Button disabled={busy} onClick={() => resolveImport(pending, false)}>
                      Turn away
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pcs.length === 0 ? (
          <EmptyState action={<Button onClick={() => setRandomOpen(true)}>Roll a random character</Button>}>
            Nobody is on the table yet. Make one with New character, or roll one.
          </EmptyState>
        ) : (
          <>
            <ul className="roster-bands">{active.map((actor) => band(actor, false))}</ul>
            {archived.length > 0 && (
              <details className="party-archived">
                <summary>Archived · {archived.length}</summary>
                <p className="party-archived-note">
                  Archived characters are hidden from players and never appear in encounter prep.
                </p>
                <ul className="roster-bands">{archived.map((actor) => band(actor, true))}</ul>
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
          onLevel={(direction) => {
            setSheetActorId(null);
            navigate(levelPath(sheetActor.id, direction));
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
              <Button disabled={busy} onClick={() => resolveImport(previewImport, false)}>
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

/** "Borin, Mirena and Lyra": names in a sentence. */
function namesList(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
