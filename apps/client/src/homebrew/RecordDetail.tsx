/**
 * The selected record's detail pane: the state cluster (draft/publish/visibility, remove and
 * restore, autosave) in the head, and `SchemaForm` with the bespoke components below.
 *
 * Type is fixed at creation, with no type switcher: switching would drop field values the new
 * type's schema lacks. States are always shown as words, not colour.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, IconChevron, Menu, MenuItem, RevealSwitch, SaveState } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { HomebrewRequestError, homebrewApi, listAllHomebrew, type HomebrewRecordDocument, type HomebrewRecordSummary } from "./api";
import { FeatureEditor } from "./FeatureEditor";
import { LevelTableEditor } from "./LevelTableEditor";
import { ITEM_RIDERS, RiderEditor } from "./RiderEditor";
import { SchemaForm, sectionDomId } from "./SchemaForm";
import { SpellListContents } from "./SpellListContents";
import { forStorage, withDefaults } from "./defaults";
import { SCHEMAS, fieldAt, sectionTitle } from "./schemas";
import { useAutosave } from "./useAutosave";
import { useSchemaContext } from "./useSchemaContext";
import { duplicateNameNote, issueReason, publishIssues, type BlockedReason } from "./validate";
import type { CustomRenderer } from "./FieldRenderer";
import { typeLabel, type HomebrewType } from "./types";

type Body = Readonly<Record<string, unknown>>;

const nameOf = (record: Body): string => (typeof record.name === "string" ? record.name : "");

/** Checklist lines shown before the rest collapse into a count. */
const CHECKLIST_SHOWN = 6;

/** One requirement: the sentence, then its section as a jump control. The sentence never names
    the section (see `validate.ts`). */
function ChecklistLine({
  reason,
  type,
  onJump
}: Readonly<{ reason: BlockedReason; type: HomebrewType; onJump: (sectionId: string) => void }>) {
  const section = reason.sectionId ? sectionTitle(type, reason.sectionId) : null;
  return (
    <>
      {reason.text}
      {section && reason.sectionId && (
        <>
          {" "}
          <Button variant="secondary" size="sm" className="tap-target hb-blocked-jump" onClick={() => onJump(reason.sectionId!)}>
            {section}
            <span className="hb-blocked-jump-icon" aria-hidden="true"><IconChevron /></span>
          </Button>
        </>
      )}
    </>
  );
}

export function RecordDetail({
  gmToken,
  record: initial,
  records,
  usageCount,
  onChanged,
  onSelect
}: Readonly<{
  gmToken: string;
  record: HomebrewRecordDocument;
  records: readonly HomebrewRecordSummary[];
  usageCount: number;
  onChanged: (record: HomebrewRecordDocument) => void;
  /** Opens another record, from the jump controls in the removal warning. */
  onSelect?: (id: string) => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const [doc, setDoc] = useState(initial);
  // Missing keys are filled from `defaults.ts`, so older, duplicated and imported records arrive complete.
  const [draft, setDraft] = useState<Body>(() => withDefaults(initial.type, initial.record));
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Other records this removal just invalidated. See `remove()`. */
  const [brokeOthers, setBrokeOthers] = useState<readonly HomebrewRecordSummary[]>([]);
  const reasonId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { ctx, spells } = useSchemaContext(initial.id, initial.type, records);
  const schema = SCHEMAS[initial.type];

  // `docRef` shadows `doc` because publish/visibility read the revision right after
  // `await flush()`, before React re-renders.
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

  // The pane is keyed by record id, so focusing the title on mount announces the new record.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const autosave = useAutosave<Body>({
    draft,
    rev: initial.rev,
    // What the server holds, so filled-in defaults count as unsaved and reach the store.
    baseline: initial.record,
    save: async (body, expectedRev) => {
      // `forStorage` drops editor-only row ids; the `.strict()` rider unions would reject them.
      const next = await homebrewApi.update(gmToken, docRef.current.id, forStorage(body), expectedRev);
      adopt(next);
      return next.rev;
    },
    resync: async () => (await homebrewApi.get(gmToken, docRef.current.id)).rev,
    isConflict: (error) => error instanceof HomebrewRequestError && error.isConflict
  });

  /** Conflict reload: replace the draft with the server copy wholesale, since two authored bodies
      cannot be merged. */
  const reload = async () => {
    try {
      const next = await homebrewApi.get(gmToken, docRef.current.id);
      adopt(next);
      const filled = withDefaults(next.type, next.record);
      setDraft(filled);
      autosave.markSaved(next.rev, filled);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't reload that record.");
    }
  };

  /** Everything outstanding before publish, listed in one place beneath the button. Drafts show no
      per-field errors because a draft may be incomplete. `publishIssues` runs the record's server
      schema, so the list is complete and no looser than the store. */
  const issues = useMemo(
    () => publishIssues(doc.type, draft, ctx, doc.id),
    [doc.type, doc.id, draft, ctx]
  );
  /** The server's issues for what the shared schema cannot check: identity and cross-record
      references. Shown only once the local list is empty, because until then the stored verdict
      describes an outdated body. */
  const serverIssues = useMemo(
    () =>
      issues.length > 0 || doc.validity.valid
        ? []
        : doc.validity.issues.map((issue) => issueReason(doc.type, issue, (path) => fieldAt(doc.type, path))).filter((reason) => reason !== null),
    [issues.length, doc.type, doc.validity]
  );
  const checklist = issues.length > 0 ? issues : serverIssues;
  const blockedReason = checklist[0]?.text ?? null;

  /** Scroll to and focus the section a reason names. */
  const jumpToSection = (sectionId: string) => {
    const element = document.getElementById(sectionDomId(doc.type, sectionId));
    if (!element) return;
    element.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    (element as HTMLElement).focus?.();
  };

  const nameNote = duplicateNameNote(doc.type, nameOf(draft), ctx);

  /* The bespoke components; everything else is schema data. */
  const custom: Readonly<Record<string, CustomRenderer>> = {
    levelTable: () => <LevelTableEditor draft={draft} onDraft={setDraft} classId={doc.id} />,
    features: ({ field }) => (
      <FeatureEditor
        draft={draft}
        onDraft={setDraft}
        ctx={ctx}
        featuresKey={field.key}
        // Only class and subclass place a feature at a level.
        levelAware={doc.type === "class" || doc.type === "subclass"}
        // A feat is one `FeatureRecord` under a singular `feature` key.
        single={doc.type === "feat"}
        singular={doc.type === "species" ? "trait" : "feature"}
        idPrefix={`hb-${doc.type}`}
      />
    ),
    riders: () => (
      <RiderEditor
        value={draft}
        onChange={setDraft}
        // An item gets every rider except `choice` (items never prompt at character creation).
        // Item grants are layered over the sheet and removed when the item comes off.
        enabled={doc.type === "equipment" ? ITEM_RIDERS : doc.type === "monster" ? ["actions", "tags"] : undefined}
        // A monster attack needs a flat `bonus` rather than an ability, so scope is three-way
        // like `enabled` above.
        scope={doc.type === "equipment" ? "item" : doc.type === "monster" ? "statblock" : "feature"}
        ctx={ctx}
        idPrefix={`hb-${doc.type}`}
      />
    ),
    spellListContents: () => <SpellListContents draft={draft} onDraft={setDraft} ctx={ctx} listId={doc.id} spells={spells} />
  };

  /** Every state change bumps the revision server-side, so each re-baselines the autosave. */
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
        // A refused publish is a 409 carrying every blocking issue; it shares the local
        // reason's message slot.
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

  /**
   * Removing a record can invalidate another (e.g. a published class losing its only subclass),
   * which the server then demotes to Draft on its next write. To report this when it happens,
   * re-list after the delete and diff the server-computed `valid` against what was
   * published-and-valid before.
   */
  const remove = async () => {
    const name = nameOf(draft).trim() || `this ${typeLabel(doc.type)}`;
    // `danger: false`: archiving is reversible, so it is a caution, not destruction.
    const confirmed = await confirm({
      title: "Archive this?",
      body: `"${name}" stops appearing in the character builder, the monster pickers and inventory lists. Characters already built from it are unaffected. You can restore it later.`,
      confirmLabel: "Archive",
      danger: false
    });
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    setBrokeOthers([]);
    const wereFine = new Set(
      records.filter((row) => row.state === "published" && row.valid && !row.deletedAt && row.id !== docRef.current.id).map((row) => row.id)
    );
    try {
      await autosave.flush();
      await homebrewApi.remove(gmToken, docRef.current.id);
      // Best-effort: a failed re-list must not turn a successful removal into an error.
      try {
        const rows = await listAllHomebrew(gmToken);
        setBrokeOthers(rows.filter((row) => wereFine.has(row.id) && row.state === "published" && !row.valid && !row.deletedAt));
      } catch {
        setBrokeOthers([]);
      }
      const next = await homebrewApi.get(gmToken, docRef.current.id);
      // `adopt` patches the rail row in place; the status filter is left alone so the rest of
      // the library stays in view.
      adopt(next);
      autosave.markSaved(next.rev, draftRef.current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't remove that record.");
    } finally {
      setBusy(false);
    }
  };

  const removed = !!doc.deletedAt;
  const published = doc.state === "published";

  return (
    <article className="hb-detail scroll-y">
      <header className="hb-detail-head">
        <h2 className="hb-detail-title" tabIndex={-1} ref={titleRef}>
          {nameOf(draft).trim() || `Untitled ${typeLabel(doc.type)}`}
        </h2>

        <div className="hb-state">
          {removed ? <Badge tone="neutral">Archived</Badge> : published ? <Badge tone="neutral">Published</Badge> : <Badge tone="caution">Draft</Badge>}
          {/* No `GmOnlyTag` here: the `RevealSwitch` beside it already says "GM only". */}
          <SaveState status={autosave.status} onReload={() => void reload()} onRetry={autosave.retry} />

          <div className="hb-state-actions">
            {!removed && !published && (
              <Button
                variant="primary"
                onClick={() => void publish()}
                disabled={checklist.length > 0 || busy}
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

        {/* One region shared by the checklist and an action's error. Each line's section control
            is the only place the section is named. A single requirement renders as a bare
            sentence; two or more become a capped list. */}
        {actionError && !removed && (
          <p className="hb-blocked" id={reasonId} role="alert">
            {actionError}
          </p>
        )}
        {!actionError && checklist.length > 0 && !removed && (
          <div className="hb-blocked" id={reasonId}>
            {checklist.length === 1 ? (
              <p className="hb-blocked-line">
                <ChecklistLine reason={checklist[0]} type={doc.type} onJump={jumpToSection} />
              </p>
            ) : (
              <>
                {/* A published record with outstanding issues is still live, and the store demotes
                    it to Draft on the next re-validating write. */}
                <p className="hb-blocked-count">
                  {published
                    ? `${checklist.length} things need fixing, or the next edit puts this back to Draft.`
                    : `${checklist.length} things left before this can be published.`}
                </p>
                <ul className="hb-blocked-list">
                  {checklist.slice(0, CHECKLIST_SHOWN).map((reason, index) => (
                    <li key={`${reason.path ?? reason.sectionId ?? ""}-${index}`} className="hb-blocked-line">
                      <ChecklistLine reason={reason} type={doc.type} onJump={jumpToSection} />
                    </li>
                  ))}
                </ul>
                {checklist.length > CHECKLIST_SHOWN && (
                  <p className="hb-blocked-count">…and {checklist.length - CHECKLIST_SHOWN} more.</p>
                )}
              </>
            )}
          </div>
        )}

        {/* "In use" is a count, not a badge: it is a fact about other records. */}
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

      {/* The removal's consequence for other records. `warning`, not `error`: nothing failed,
          and Restore undoes it. */}
      {brokeOthers.length > 0 && (
        <Alert tone="warning" title={brokeOthers.length === 1 ? "This broke another record" : "This broke other records"}>
          <p>
            {brokeOthers.length === 1 ? "It's still published, but it can't be published as it stands" : "They're still published, but they can't be published as they stand"}
            , so the next edit to {brokeOthers.length === 1 ? "it" : "them"} puts {brokeOthers.length === 1 ? "it" : "them"} back to Draft.
            Restore this one, or fix {brokeOthers.length === 1 ? "it" : "them"}.
          </p>
          <div className="hb-broke-list">
            {brokeOthers.map((row) => (
              <Button
                key={row.id}
                variant="secondary"
                size="sm"
                className="tap-target"
                disabled={!onSelect}
                onClick={() => onSelect?.(row.id)}
              >
                {row.name || `Untitled ${typeLabel(row.type)}`}
                <span className="hb-blocked-jump-icon" aria-hidden="true"><IconChevron /></span>
              </Button>
            ))}
          </div>
        </Alert>
      )}

      <div className="hb-detail-body">
        {/* A duplicate name is annotated, never blocked. */}
        {nameNote && <p className="hb-name-note">{nameNote}</p>}

        {schema ? (
          <SchemaForm schema={schema} draft={draft} onDraft={setDraft} ctx={ctx} custom={custom} disabled={removed} />
        ) : (
          <Alert tone="warning" title="No editor for this kind yet">
            <p>Nothing here knows how to author a {typeLabel(doc.type)}. Your record is safe — it just can&rsquo;t be edited from this screen.</p>
          </Alert>
        )}
      </div>

      {dialog}
    </article>
  );
}
