/**
 * The selected record's detail pane: the state cluster (draft/publish/visibility, remove and
 * restore, autosave) in the head, and below it either the full editor (`SchemaForm` with the
 * bespoke components) or the step-by-step wizard. Both views edit the one draft held here, with one
 * autosave and one publish checklist, so switching between them is instant and loses nothing.
 *
 * Type is fixed at creation, with no type switcher: switching would drop field values the new
 * type's schema lacks. States are always shown as words as well as colour.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, IconChevron, Menu, MenuItem, RevealSwitch, SaveState } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import {
  homebrewApi,
  invalidIssuesOf,
  listAllHomebrew,
  type HomebrewDependent,
  type HomebrewRecordDocument,
  type HomebrewRecordSummary
} from "./api";
import { ApiError } from "../lib/api";
import { FeatureEditor } from "./FeatureEditor";
import { LevelTableEditor } from "./LevelTableEditor";
import { ITEM_RIDERS, RiderEditor } from "./RiderEditor";
import { SchemaForm, sectionDomId } from "./SchemaForm";
import { SpellListContents } from "./SpellListContents";
import { forStorage, withDefaults } from "./defaults";
import { SCHEMAS, fieldAt, sectionTitle } from "./schemas";
import { keepLocalEdits, useAutosave } from "./useAutosave";
import { trackClosingSave } from "./closingSaves";
import { useSchemaContext } from "./useSchemaContext";
import { duplicateNameNote, issueReason, publishIssues, type BlockedReason } from "./validate";
import type { CustomRenderer } from "./FieldRenderer";
import { typeLabel, type HomebrewType } from "./types";
import { WIZARDS } from "./wizard";
import { REVIEW_STEP, WizardView } from "./wizard/WizardView";
import { withArticle } from "@vtt/domain";

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
          <Button
            variant="secondary"
            size="sm"
            className="tap-target hb-blocked-jump"
            onClick={() => onJump(reason.sectionId!)}
          >
            {section}
            <span className="hb-blocked-jump-icon" aria-hidden="true">
              <IconChevron />
            </span>
          </Button>
        </>
      )}
    </>
  );
}

export type DetailMode = "wizard" | "editor";

export function RecordDetail({
  gmToken,
  record: initial,
  records,
  usageCount,
  onChanged,
  onSelect,
  mode = "editor",
  onMode
}: Readonly<{
  gmToken: string;
  record: HomebrewRecordDocument;
  records: readonly HomebrewRecordSummary[];
  usageCount: number;
  onChanged: (record: HomebrewRecordDocument) => void;
  /** Opens another record, from the jump controls in the removal warning. */
  onSelect?: (id: string) => void;
  /** Step by step, or every field at once. The panel owns it, so a new record opens in the wizard. */
  mode?: DetailMode;
  onMode?: (mode: DetailMode) => void;
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
  const { ctx, spells } = useSchemaContext(
    initial.id,
    initial.type,
    records,
    (doc as { references?: Readonly<Record<string, { name: string }>> }).references
  );
  const schema = SCHEMAS[initial.type];
  const wizard = WIZARDS[initial.type];
  const inWizard = mode === "wizard" && !!wizard && !initial.deletedAt;
  // Where the wizard is, kept here so a trip to the full editor and back returns to the same step.
  const [wizardStep, setWizardStep] = useState(() => wizard?.steps[0]?.id ?? REVIEW_STEP);
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  /** The editor section to open at, when the wizard hands over to the full editor. */
  const openAt = useRef<string | null>(null);

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
    isConflict: (error) => error instanceof ApiError && error.isConflict,
    onUnmountFlush: (pending) => trackClosingSave(initial.id, pending)
  });

  /** Conflict reload: the server's copy, with what was changed here since the last save kept on top of it. The
      changes then save against the server's revision. */
  const reload = async () => {
    try {
      const next = await homebrewApi.get(gmToken, docRef.current.id);
      adopt(next);
      const filled = withDefaults(next.type, next.record);
      const merged = keepLocalEdits(autosave.savedDraft(), draftRef.current, filled);
      autosave.markSaved(next.rev, filled);
      setDraft(merged);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't reload that record.");
    }
  };

  /** Everything outstanding before publish, listed in one place beneath the button. Drafts show no
      per-field errors because a draft may be incomplete. `publishIssues` runs the record's server
      schema, so the list is complete and no looser than the store. */
  const issues = useMemo(() => publishIssues(doc.type, draft, ctx, doc.id), [doc.type, doc.id, draft, ctx]);
  /** The server's issues for what the shared schema cannot check: identity and cross-record
      references. Shown only once the local list is empty, because until then the stored verdict
      describes an outdated body. */
  const serverIssues = useMemo(
    () =>
      issues.length > 0 || doc.validity.valid
        ? []
        : doc.validity.issues
            .map((issue) => issueReason(doc.type, issue, (path) => fieldAt(doc.type, path)))
            .filter((reason) => reason !== null),
    [issues.length, doc.type, doc.validity]
  );
  const checklist = issues.length > 0 ? issues : serverIssues;
  const blockedReason = checklist[0]?.text ?? null;

  /** Scroll to and focus the section a reason names. */
  const jumpToSection = (sectionId: string) => {
    const element = document.getElementById(sectionDomId(doc.type, sectionId));
    if (!element) return;
    element.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    (element as HTMLElement).focus?.();
  };

  const nameNote = duplicateNameNote(doc.type, nameOf(draft), ctx);

  // Arriving in the full editor from a wizard step opens at that step's section.
  useEffect(() => {
    if (mode !== "editor" || !openAt.current) return;
    const section = openAt.current;
    openAt.current = null;
    jumpToSection(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const openEditor = (sectionId: string | null) => {
    openAt.current = sectionId ?? wizard?.steps.find((step) => step.id === wizardStep)?.sections[0] ?? null;
    onMode?.("editor");
  };

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
        // A monster attack needs a flat `bonus` where a feature names an ability, so scope is three-way
        // like `enabled` above.
        scope={doc.type === "equipment" ? "item" : doc.type === "monster" ? "statblock" : "feature"}
        ctx={ctx}
        idPrefix={`hb-${doc.type}`}
      />
    ),
    spellListContents: () => (
      <SpellListContents draft={draft} onDraft={setDraft} ctx={ctx} listId={doc.id} spells={spells} />
    )
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
      if (error instanceof ApiError) {
        // A refused publish is a 409 carrying every blocking issue; it shares the local
        // reason's message slot.
        setActionError(invalidIssuesOf(error)[0]?.message ?? error.message);
      } else {
        setActionError(error instanceof Error ? error.message : "That didn't work.");
      }
    } finally {
      setBusy(false);
    }
  };

  /** The published records an action would break, asked of the server first. Best-effort: a failed read
      never blocks the action itself. */
  const dependentsFor = async (which: "ifRemoved" | "ifUpdated"): Promise<readonly HomebrewDependent[]> => {
    try {
      await autosave.flush();
      return (await homebrewApi.usages(gmToken, docRef.current.id)).dependents[which];
    } catch {
      return [];
    }
  };

  const publish = async () => {
    if (docRef.current.state === "published" && docRef.current.pendingChanges) {
      const breaks = await dependentsFor("ifUpdated");
      if (
        breaks.length > 0 &&
        !(await confirm({
          title: "Put these changes live?",
          body: `${dependentNames(breaks)} ${breaks.length === 1 ? "depends" : "depend"} on this as it is now and would stop working.`,
          confirmLabel: "Update anyway",
          danger: true
        }))
      )
        return;
    }
    await runStateChange(() => homebrewApi.publish(gmToken, docRef.current.id, docRef.current.rev));
  };
  const discard = async () => {
    const confirmed = await confirm({
      title: "Discard these changes?",
      body: "The published version stays as it is, and the editor goes back to it.",
      confirmLabel: "Discard",
      danger: true
    });
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      // Flushed first, so a save still in flight cannot land after the discard and re-create the changes.
      await autosave.flush();
      const next = await homebrewApi.discard(gmToken, docRef.current.id, docRef.current.rev);
      adopt(next);
      // The editor goes back to the live body, which is now the saved baseline.
      const filled = withDefaults(next.type, next.record);
      setDraft(filled);
      autosave.markSaved(next.rev, filled);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't discard those changes.");
    } finally {
      setBusy(false);
    }
  };
  const unpublish = async () => {
    const breaks = await dependentsFor("ifRemoved");
    if (
      breaks.length > 0 &&
      !(await confirm({
        title: "Unpublish this?",
        body: `${dependentNames(breaks)} ${breaks.length === 1 ? "depends" : "depend"} on it and would stop working until it is published again.`,
        confirmLabel: "Unpublish anyway",
        danger: true
      }))
    )
      return;
    await runStateChange(() => homebrewApi.unpublish(gmToken, docRef.current.id, docRef.current.rev));
  };
  const setVisible = (visible: boolean) =>
    void runStateChange(() => homebrewApi.setVisibility(gmToken, docRef.current.id, visible, docRef.current.rev));
  const restore = () => runStateChange(() => homebrewApi.restore(gmToken, docRef.current.id));

  /**
   * Removing a record can invalidate another (e.g. a published class losing its only subclass).
   * To report this when it happens, re-list after the delete and diff the server-computed `valid`
   * against what was published-and-valid before.
   */
  const remove = async () => {
    const name = nameOf(draft).trim() || `this ${typeLabel(doc.type)}`;
    const breaks = await dependentsFor("ifRemoved");
    const breaksLine =
      breaks.length > 0
        ? ` ${dependentNames(breaks)} ${breaks.length === 1 ? "depends" : "depend"} on it and would stop working.`
        : "";
    // `danger` only when a published record would break; otherwise archiving is a reversible caution.
    const confirmed = await confirm({
      title: "Archive this?",
      body: `"${name}" stops appearing in the character builder, the monster pickers and inventory lists. Characters already built from it are unaffected. You can restore it later.${breaksLine}`,
      confirmLabel: "Archive",
      danger: breaks.length > 0
    });
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    setBrokeOthers([]);
    const wereFine = new Set(
      records
        .filter((row) => row.state === "published" && row.valid && !row.deletedAt && row.id !== docRef.current.id)
        .map((row) => row.id)
    );
    try {
      await autosave.flush();
      await homebrewApi.remove(gmToken, docRef.current.id);
      // Best-effort: a failed re-list must not turn a successful removal into an error.
      try {
        const rows = await listAllHomebrew(gmToken);
        setBrokeOthers(
          rows.filter((row) => wereFine.has(row.id) && row.state === "published" && !row.valid && !row.deletedAt)
        );
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
  // A published record's edits wait for Update, so players never lose it mid-edit.
  const pending = published && doc.pendingChanges;

  return (
    <article className={inWizard ? "hb-detail hb-detail--wizard" : "hb-detail scroll-y"}>
      <header className="hb-detail-head">
        <h2 className="hb-detail-title" tabIndex={-1} ref={titleRef}>
          {nameOf(draft).trim() || `Untitled ${typeLabel(doc.type)}`}
        </h2>

        <div className="hb-state">
          {removed ? (
            <Badge tone="neutral">Archived</Badge>
          ) : published ? (
            <>
              <Badge tone="neutral">Published</Badge>
              {pending && <Badge tone="caution">Changes not live</Badge>}
            </>
          ) : (
            <Badge tone="caution">Draft</Badge>
          )}
          {/* No `GmOnlyTag` here: the `RevealSwitch` beside it already says "GM only". */}
          <SaveState status={autosave.status} onReload={() => void reload()} onRetry={autosave.retry} />

          <div className="hb-state-actions">
            {/* The wizard's review step holds Publish, so a view never shows two primary buttons. */}
            {inWizard && (
              <Button variant="secondary" onClick={() => openEditor(null)}>
                Full editor
              </Button>
            )}
            {!inWizard && wizard && !removed && onMode && (
              <Button variant="secondary" onClick={() => onMode("wizard")}>
                Step by step
              </Button>
            )}
            {!inWizard && !removed && (!published || pending) && (
              <Button
                variant="primary"
                onClick={() => void publish()}
                disabled={checklist.length > 0 || busy}
                aria-describedby={blockedReason || actionError ? reasonId : undefined}
              >
                {pending ? "Update" : "Publish"}
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
                {pending && (
                  <MenuItem onClick={() => void discard()} disabled={busy}>
                    Discard changes
                  </MenuItem>
                )}
                {published && (
                  <MenuItem onClick={() => void unpublish()} disabled={busy}>
                    Unpublish
                  </MenuItem>
                )}
                <MenuItem onClick={() => void remove()} disabled={busy}>
                  Remove
                </MenuItem>
              </Menu>
            )}
          </div>
        </div>

        {/* One region shared by the checklist and an action's error. Each line's section control
            is the only place the section is named. A single requirement renders as a bare
            sentence; two or more become a capped list. */}
        {actionError && !removed && !inWizard && (
          <p className="hb-blocked" id={reasonId} role="alert">
            {actionError}
          </p>
        )}
        {!actionError && checklist.length > 0 && !removed && !inWizard && (
          <div className="hb-blocked" id={reasonId}>
            {checklist.length === 1 ? (
              <p className="hb-blocked-line">
                <ChecklistLine reason={checklist[0]} type={doc.type} onJump={jumpToSection} />
              </p>
            ) : (
              <>
                {/* A published record's edits are held until Update, so outstanding issues never take it
                    away from the players. */}
                <p className="hb-blocked-count">
                  {published
                    ? `${checklist.length} things need fixing before these changes can go live. Players keep the published version.`
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

        {/* Never blocking: the server names an open slug the SRD does not know, which is legal but often a typo. */}
        {doc.validity.warnings.length > 0 && !removed && !inWizard && (
          <ul className="hb-warnings" aria-label="Worth checking">
            {doc.validity.warnings.map((warning, index) => (
              <li key={`${warning.path.join(".")}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        )}

        {/* "In use" is a count and no badge: it is a fact about other records. */}
        {usageCount > 0 && !removed && (
          <p className="hb-usage">
            Used by {usageCount} {usageCount === 1 ? "character" : "characters"}.
          </p>
        )}
      </header>

      {removed && (
        <Alert tone="info">
          Removed from pickers. Nothing was deleted.{" "}
          <Button variant="secondary" size="sm" className="tap-target" onClick={() => void restore()} disabled={busy}>
            Restore
          </Button>
        </Alert>
      )}

      {/* The removal's consequence for other records. `warning`: nothing failed,
          and Restore undoes it. */}
      {brokeOthers.length > 0 && (
        <Alert
          tone="warning"
          title={brokeOthers.length === 1 ? "This broke another record" : "This broke other records"}
        >
          <p>
            {brokeOthers.length === 1
              ? "It's still published, but it names something that's gone, so it won't work as it stands"
              : "They're still published, but they name something that's gone, so they won't work as they stand"}
            . Restore this one, or fix {brokeOthers.length === 1 ? "it" : "them"}.
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
                <span className="hb-blocked-jump-icon" aria-hidden="true">
                  <IconChevron />
                </span>
              </Button>
            ))}
          </div>
        </Alert>
      )}

      {inWizard && wizard ? (
        <>
          {nameNote && <p className="hb-name-note">{nameNote}</p>}
          <WizardView
            def={wizard}
            draft={draft}
            onDraft={setDraft}
            ctx={ctx}
            recordId={doc.id}
            spells={spells}
            checklist={checklist}
            warnings={doc.validity.warnings}
            stepId={wizardStep}
            onStep={setWizardStep}
            visited={visited}
            onVisited={(id) => setVisited((held) => (held.has(id) ? held : new Set([...held, id])))}
            publishLabel={!published ? "Publish" : pending ? "Update" : null}
            onPublish={() => void publish()}
            busy={busy}
            actionError={actionError}
            published={
              published && !pending ? (
                <p className="hb-wiz-intro">
                  Published. {WHERE_IT_APPEARS[doc.type]}{" "}
                  {doc.visibleToPlayers
                    ? "Players can see it."
                    : "Players can't see it until you show it to them with the switch above."}
                </p>
              ) : null
            }
            onOpenEditor={openEditor}
          />
        </>
      ) : (
        <div className="hb-detail-body">
          {/* A duplicate name is annotated, never blocked. */}
          {nameNote && <p className="hb-name-note">{nameNote}</p>}

          {schema ? (
            <SchemaForm schema={schema} draft={draft} onDraft={setDraft} ctx={ctx} custom={custom} disabled={removed} />
          ) : (
            <Alert tone="warning" title="No editor for this kind yet">
              <p>
                Nothing here knows how to author {withArticle(typeLabel(doc.type))}. Your record is safe. It can't be
                edited from this screen.
              </p>
            </Alert>
          )}
        </div>
      )}

      {dialog}
    </article>
  );
}

/** Where a published record turns up, for the wizard's last word. */
const WHERE_IT_APPEARS: Readonly<Record<HomebrewType, string>> = {
  class: "It is offered in the character builder.",
  subclass: "It is offered when a character of its class reaches its level.",
  species: "It is offered in the character builder.",
  background: "It is offered in the character builder.",
  feat: "The character builder offers it where its category fits.",
  spell: "Casters whose spell lists include it can learn it.",
  "spell-list": "Classes that name it draw their spells from it.",
  equipment: "It is in the equipment picker for any character's inventory.",
  monster: "It is in the bestiary, and you can add it to a fight from there."
};

/** "Hemomancy", "Hemomancy and Bloodline" or "Hemomancy, Bloodline and 2 more", quoted. */
function dependentNames(dependents: readonly HomebrewDependent[]): string {
  const quoted = dependents.map((dependent) => `"${dependent.name}"`);
  if (quoted.length === 1) return quoted[0];
  if (quoted.length <= 3) return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  return `${quoted.slice(0, 2).join(", ")} and ${quoted.length - 2} more`;
}
