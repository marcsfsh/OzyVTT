/**
 * The selected record's detail pane: identity, the state cluster, and a read-only
 * view of the authored body.
 *
 * **Scope.** The schema-driven editor is the next slice. What ships here is everything
 * that is *about the record* rather than *inside* it — the name, the draft/publish/
 * visibility machine, remove and restore, and the autosave that parks all of it. The
 * body is rendered read-only from whatever keys the record carries, so a duplicated
 * SRD class is legible the moment it lands rather than showing a blank pane; the
 * `SchemaForm` drops into the same slot without moving anything around it.
 *
 * **Why the name is editable here and nothing else is.** It is the identity the GM
 * sees in every picker and the only field common to all nine types, and autosave with
 * nothing to save is untestable. One field exercises the whole `expectedRev` path.
 *
 * **The six states are words, never colour alone** (design-language §2 — violet is
 * reserved for GM-only and `--caution` shares its hue family):
 *   Draft · Published + GM only · Published + Shown to players · invalid (a sentence
 *   at the Publish button) · Removed · in use (a count).
 * The vocabulary is fixed and must not gain synonyms — never "hidden" (ambiguous
 * between GM-only and removed), never "live", never "active".
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, Badge, Button, Field, Input, Menu, MenuItem, SaveState } from "@vtt/ui";
import { RevealSwitch } from "../codex/SecretMarkers";
import { useConfirm } from "../components/feedback";
import { HomebrewRequestError, homebrewApi, type HomebrewRecordDocument } from "./api";
import { useAutosave } from "./useAutosave";
import { typeLabel } from "./types";

type Body = Readonly<Record<string, unknown>>;

const nameOf = (record: Body): string => (typeof record.name === "string" ? record.name : "");

/** camelCase / kebab-case key to a sentence-case label. */
function humanise(key: string): string {
  const spaced = key.replace(/[-_]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A read-only rendering of one authored value. Structure is summarised rather than
    dumped: a class's twenty level rows are "20 entries", not a wall of JSON. */
function readValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (value.every((entry) => typeof entry === "string" || typeof entry === "number")) return value.join(", ");
    return `${value.length} ${value.length === 1 ? "entry" : "entries"}`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return keys.length === 0 ? "Not set" : `${keys.length} ${keys.length === 1 ? "field" : "fields"}`;
  }
  return String(value);
}

/** Never shown: `name` has its own field, and ids/source/type are the system's problem. */
const HIDDEN_KEYS = new Set(["name", "id", "source", "type"]);

export function RecordDetail({
  gmToken,
  record: initial,
  usageCount,
  onChanged,
  onRemoved
}: Readonly<{
  gmToken: string;
  record: HomebrewRecordDocument;
  usageCount: number;
  onChanged: (record: HomebrewRecordDocument) => void;
  onRemoved: () => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const [doc, setDoc] = useState(initial);
  const [draft, setDraft] = useState<Body>(initial.record);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const reasonId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // `docRef` shadows `doc` because publish/visibility read the revision immediately
  // after `await flush()`, in the same closure — React has not re-rendered yet.
  const docRef = useRef(doc);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const adopt = useCallback(
    (next: HomebrewRecordDocument) => {
      docRef.current = next;
      setDoc(next);
      onChanged(next);
    },
    [onChanged]
  );

  // The pane mounts with `key={record.id}`, so selecting a record lands focus on its
  // name — the keyboard and screen-reader equivalent of the pane having appeared.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const autosave = useAutosave<Body>({
    draft,
    rev: initial.rev,
    save: async (body, expectedRev) => {
      const next = await homebrewApi.update(gmToken, docRef.current.id, body, expectedRev);
      adopt(next);
      return next.rev;
    },
    resync: async () => (await homebrewApi.get(gmToken, docRef.current.id)).rev,
    isConflict: (error) => error instanceof HomebrewRequestError && error.isConflict
  });

  /** "Changed elsewhere" → take the server's copy. The draft is replaced wholesale,
      which is the only honest answer: we cannot merge two authored bodies. */
  const reload = async () => {
    try {
      const next = await homebrewApi.get(gmToken, docRef.current.id);
      adopt(next);
      setDraft(next.record);
      autosave.markSaved(next.rev, next.record);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't reload that record.");
    }
  };

  /**
   * Why publishing is blocked, as ONE sentence, in ONE place, beneath the button it
   * blocks. Never a red asterisk, never a checklist, never per-field errors: drafts
   * are allowed to be invalid, so "this requirement is not met yet" is a different
   * thing from "this field is wrong now" and must not look like it.
   *
   * Two sources, one slot: the name check is the only one this slice can make locally
   * (it owns the only editable field); everything else is the server's validity
   * report, which already carries a machine-addressable path per issue. The full
   * client-side `publishBlockedReason` — "{Imperative} — it's under {Section}." —
   * arrives with the schemas, and replaces the second branch, not the slot.
   */
  const blockedReason =
    nameOf(draft).trim() === ""
      ? `Give this ${typeLabel(doc.type)} a name.`
      : doc.validity.valid
        ? null
        : (doc.validity.issues[0]?.message ?? "This record isn't ready to publish yet.");

  /** Every state change bumps the revision server-side, so each one re-baselines the
      autosave. Without that the very next keystroke would 409 against a revision the
      row left behind. */
  const runStateChange = async (action: () => Promise<HomebrewRecordDocument>) => {
    setBusy(true);
    setActionError(null);
    try {
      // Flush first, so revealing never briefly publishes the pre-edit body.
      await autosave.flush();
      const next = await action();
      adopt(next);
      autosave.markSaved(next.rev, draftRef.current);
    } catch (error) {
      if (error instanceof HomebrewRequestError) {
        // A publish the stored state refuses arrives as a 409 carrying every blocking
        // issue. It renders in the SAME sentence slot as the local reason — one message
        // surface, two sources, never a second error region.
        setActionError(error.invalidIssues[0]?.message ?? error.message);
      } else {
        setActionError(error instanceof Error ? error.message : "That didn't work.");
      }
    } finally {
      setBusy(false);
    }
  };

  const publish = () => runStateChange(() => homebrewApi.publish(gmToken, docRef.current.id, docRef.current.rev));
  const unpublish = () => runStateChange(() => homebrewApi.unpublish(gmToken, docRef.current.id, docRef.current.rev));
  const setVisible = (visible: boolean) => void runStateChange(() => homebrewApi.setVisibility(gmToken, docRef.current.id, visible, docRef.current.rev));
  const restore = () => runStateChange(() => homebrewApi.restore(gmToken, docRef.current.id));

  const remove = async () => {
    const name = nameOf(draft).trim() || `this ${typeLabel(doc.type)}`;
    // `danger: false` on purpose: nothing is lost, so this is caution, not danger.
    // Rose-red is reserved for actual destruction.
    const confirmed = await confirm({
      title: "Remove from pickers",
      body: `"${name}" stops appearing in the character builder, the encounter picker and inventory lists. Characters already built from it are unaffected. You can restore it later.`,
      confirmLabel: "Remove",
      danger: false
    });
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      await autosave.flush();
      await homebrewApi.remove(gmToken, docRef.current.id);
      const next = await homebrewApi.get(gmToken, docRef.current.id);
      adopt(next);
      autosave.markSaved(next.rev, draftRef.current);
      onRemoved();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't remove that record.");
    } finally {
      setBusy(false);
    }
  };

  const removed = !!doc.deletedAt;
  const published = doc.state === "published";
  const bodyKeys = Object.keys(draft).filter((key) => !HIDDEN_KEYS.has(key));

  return (
    <article className="hb-detail">
      <header className="hb-detail-head">
        <h2 className="hb-detail-title" tabIndex={-1} ref={titleRef}>
          {nameOf(draft).trim() || `Untitled ${typeLabel(doc.type)}`}
        </h2>

        <div className="hb-state">
          {removed ? <Badge tone="neutral">Removed</Badge> : published ? <Badge tone="neutral">Published</Badge> : <Badge tone="caution">Draft</Badge>}
          {/* No `GmOnlyTag` here, deliberately: the `RevealSwitch` a few inches to the
              right already renders the literal words "GM only", and stamping the pill
              beside it puts the same constraint on one line twice (readiness rule 4).
              The tag belongs in the RAIL row, where there is no switch to say it. */}
          <SaveState status={autosave.status} onReload={() => void reload()} onRetry={autosave.retry} />

          <div className="hb-state-actions">
            {!removed && !published && (
              <Button
                variant="primary"
                onClick={() => void publish()}
                disabled={!!blockedReason || busy}
                aria-describedby={blockedReason || actionError ? reasonId : undefined}
              >
                Publish
              </Button>
            )}
            {!removed && published && (
              <RevealSwitch
                revealed={doc.visibleToPlayers}
                onChange={setVisible}
                ariaLabel={`Show this ${typeLabel(doc.type)} to players`}
              />
            )}
            {!removed && (
              <Menu trigger="⋯" label={`More actions for this ${typeLabel(doc.type)}`} icon align="end">
                {published && <MenuItem onClick={() => void unpublish()} disabled={busy}>Unpublish</MenuItem>}
                <MenuItem onClick={() => void remove()} disabled={busy}>Remove</MenuItem>
              </Menu>
            )}
          </div>
        </div>

        {/* ONE sentence slot, shared by the local blocker and the server's rejection. */}
        {(blockedReason || actionError) && !removed && (
          <p className="hb-blocked" id={reasonId} role={actionError ? "alert" : undefined}>{actionError ?? blockedReason}</p>
        )}

        {/* "In use" is the sixth state and it is a count, not a badge — a badge would
            claim a status where this is a fact about other records. */}
        {usageCount > 0 && !removed && (
          <p className="hb-usage">Used by {usageCount} {usageCount === 1 ? "character" : "characters"}.</p>
        )}
      </header>

      {removed && (
        <Alert tone="info">
          Removed from pickers. Nothing was deleted.{" "}
          <Button variant="secondary" size="sm" className="tap-target" onClick={() => void restore()} disabled={busy}>Restore</Button>
        </Alert>
      )}

      <div className="hb-detail-body">
        <Field label="Name" htmlFor={nameId} help="One line for the pick list — this is what you'll see everywhere it's offered.">
          <Input
            id={nameId}
            value={nameOf(draft)}
            disabled={removed}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </Field>

        {bodyKeys.length > 0 && (
          <dl className="hb-readonly">
            {bodyKeys.map((key) => (
              <div key={key} className="hb-readonly-row">
                <dt>{humanise(key)}</dt>
                <dd>{readValue(draft[key])}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {dialog}
    </article>
  );
}
