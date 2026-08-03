/**
 * The selected record's detail pane: identity, the state cluster, and the editor.
 *
 * Two halves that never mix. Everything *about* the record — the draft/publish/
 * visibility machine, remove and restore, the autosave — lives in the head here.
 * Everything *inside* it is `SchemaForm` over one of nine data schemas, with four
 * bespoke components wired in below. There is no per-type branch in this file beyond
 * choosing which of those four to mount.
 *
 * **No type switcher, ever.** The Codex's `PageEditor` silently drops field values not
 * in the new type's schema when the entity type changes. Type is chosen at creation and
 * fixed thereafter, so that bug cannot arise — and no one may add a switcher without
 * solving it first.
 *
 * **The six states are words, never colour alone** (design-language §2 — violet is
 * reserved for GM-only and `--caution` shares its hue family):
 *   Draft · Published + GM only · Published + Shown to players · invalid (a sentence
 *   at the Publish button) · Removed · in use (a count).
 * The vocabulary is fixed and must not gain synonyms — never "hidden" (ambiguous
 * between GM-only and removed), never "live", never "active".
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

/** How many checklist lines are printed before the tail collapses into a count. Six fills the
    region without pushing the form off a phone screen, and a record with more than six outstanding
    requirements is one whose next fix will re-shorten the list anyway. */
const CHECKLIST_SHOWN = 6;

/** One requirement: the sentence, then its section as a control. The section is NEVER in the
    words — see the "one copy template" note in `validate.ts`. */
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
  /** Opens another record — the jump control on the removal consequence below. */
  onSelect?: (id: string) => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const [doc, setDoc] = useState(initial);
  // Filled in from `defaults.ts` on the way in, so the renderer never writes `?? []` at
  // every call site — and so a record created before this schema existed, duplicated
  // from an SRD record, or imported from a pack all arrive complete.
  const [draft, setDraft] = useState<Body>(() => withDefaults(initial.type, initial.record));
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** What removing this record just did to OTHER records. See `remove()`. */
  const [brokeOthers, setBrokeOthers] = useState<readonly HomebrewRecordSummary[]>([]);
  const reasonId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { ctx, spells } = useSchemaContext(initial.id, initial.type, records);
  const schema = SCHEMAS[initial.type];

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
    // What the SERVER holds, not what the form shows: the defaults `withDefaults` filled
    // in above have to be dirty, or they never reach the store.
    baseline: initial.record,
    save: async (body, expectedRev) => {
      // `forStorage` drops the row ids the editor mints for `RowEditor`. They are UI identity, and
      // the rider unions are `.strict()`, so shipping one fails the whole record to parse.
      const next = await homebrewApi.update(gmToken, docRef.current.id, forStorage(body), expectedRev);
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
      const filled = withDefaults(next.type, next.record);
      setDraft(filled);
      autosave.markSaved(next.rev, filled);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't reload that record.");
    }
  };

  /**
   * What is left before this can be published — **everything outstanding, in one place, beneath
   * the button it blocks.** Still never a red asterisk, never a red border, never a per-field
   * message: **drafts show no errors at all**, because a draft is allowed to be invalid and "this
   * requirement is not met yet" is a different thing from "this field is wrong now". (The second
   * thing — a malformed dice formula — still shows inline, on its own field, because that IS
   * wrong now.)
   *
   * It is a LIST rather than one sentence, and that is the D19 repair. One sentence turned a
   * half-filled item into a serial dead-end: fix "Fill in range", get "Fill in long range", get
   * another, with no way to see how deep it went — the shape of the "items cannot be published"
   * report. `publishIssues` runs the record's own server schema, so the list is complete and
   * cannot be looser than the store.
   *
   * Two sources, one region: this list, plus the server's 409 for the tiers a schema cannot
   * express (identity, cross-references). Never a second error region.
   */
  const issues = useMemo(
    () => publishIssues(doc.type, draft, ctx, doc.id),
    [doc.type, doc.id, draft, ctx]
  );
  /**
   * The server's own outstanding issues, for the tiers the shared schema does NOT cover: identity
   * (tier 2) and cross-record references (tiers 3-4, "no subclass names this class yet"). Shown
   * only once the local list is empty — while the body still fails its own schema, the stored
   * record's cross-reference verdict is about a body that has already moved on.
   */
  const serverIssues = useMemo(
    () =>
      issues.length > 0 || doc.validity.valid
        ? []
        : doc.validity.issues.map((issue) => issueReason(doc.type, issue, (path) => fieldAt(doc.type, path))).filter((reason) => reason !== null),
    [issues.length, doc.type, doc.validity]
  );
  const checklist = issues.length > 0 ? issues : serverIssues;
  const blockedReason = checklist[0]?.text ?? null;

  /** Scroll to the section a reason names and focus it — one control per line, no restatement,
      and it removes the hunt. */
  const jumpToSection = (sectionId: string) => {
    const element = document.getElementById(sectionDomId(doc.type, sectionId));
    if (!element) return;
    element.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    (element as HTMLElement).focus?.();
  };

  const nameNote = duplicateNameNote(doc.type, nameOf(draft), ctx);

  /* The four bespoke components. Everything else on all nine types is data. */
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
        // A feat IS one `FeatureRecord` under a singular `feature` key, not a list.
        single={doc.type === "feat"}
        singular={doc.type === "species" ? "trait" : "feature"}
        idPrefix={`hb-${doc.type}`}
      />
    ),
    riders: () => (
      <RiderEditor
        value={draft}
        onChange={setDraft}
        // An item gets everything except `choice` — it never asks a question at character
        // creation, and there is no code path from an item to the wizard. `grants` IS included:
        // an item's grants are layered over the sheet and removed when the item comes off.
        // (This comment used to say `grants` was deliberately absent, which `ITEM_RIDERS` one
        // import away had already contradicted. See the table at the top of RiderEditor.tsx.)
        enabled={doc.type === "equipment" ? ITEM_RIDERS : doc.type === "monster" ? ["actions", "tags"] : undefined}
        scope={doc.type === "equipment" ? "item" : "feature"}
        ctx={ctx}
        idPrefix={`hb-${doc.type}`}
      />
    ),
    spellListContents: () => <SpellListContents draft={draft} onDraft={setDraft} ctx={ctx} listId={doc.id} spells={spells} />
  };

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

  /**
   * **Removing one record can invalidate another, and the demotion that follows used to be
   * silent.** A published class whose only subclass is removed stays published and becomes
   * invalid on the spot; the next unrelated write to it hits `stillPublishable`, fails, and
   * the class quietly drops to Draft — surfacing minutes later, on a record the GM was not
   * looking at, as a state change nothing on screen explains. The demotion is right. The
   * silence is the defect.
   *
   * So the consequence is reported at the moment it is caused, from the SERVER's own
   * answer rather than a client guess: every list row carries a freshly computed `valid`,
   * so re-listing after the delete and diffing against what was published-and-valid a
   * moment ago names exactly the records this removal broke — for any relation, not just
   * subclass-to-class, and without the client re-implementing half the validator
   * (CLAUDE.md rule 2). One extra request, on the rarest path in the feature.
   */
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
    setBrokeOthers([]);
    const wereFine = new Set(
      records.filter((row) => row.state === "published" && row.valid && !row.deletedAt && row.id !== docRef.current.id).map((row) => row.id)
    );
    try {
      await autosave.flush();
      await homebrewApi.remove(gmToken, docRef.current.id);
      // Best-effort: a failed re-list must not turn a successful removal into an error.
      // Losing the warning is a smaller harm than claiming the removal did not happen.
      try {
        const rows = await listAllHomebrew(gmToken);
        setBrokeOthers(rows.filter((row) => wereFine.has(row.id) && row.state === "published" && !row.valid && !row.deletedAt));
      } catch {
        setBrokeOthers([]);
      }
      const next = await homebrewApi.get(gmToken, docRef.current.id);
      // `adopt` patches the rail row in place, so the row picks up its Removed state and
      // leaves the default view — and NOTHING ELSE MOVES. Removing one record used to
      // flip the library's status filter to "Removed", which hid the other ten behind a
      // count line that still read "10 records" above a list of one. The GM did not ask
      // to change the view. The feedback is already here and already sufficient: this
      // pane keeps the record selected, shows the Removed badge and offers Restore, and
      // the rail foots with "N removed records are hidden. Show them" — a filter change
      // the GM makes, which is the difference that matters.
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

        {/* ONE region, shared by the checklist and by an action's error. Each line owns its
            `{Section}` CONTROL, which is the only place the section is named — the sentence never
            repeats it (`validate.ts`, "one copy template"). `secondary` with the system's own jump
            chevron, not a `ghost`: a ghost at `--text-dim` beside a `--caution-hi` sentence was
            dimmer than the words it followed and did not read as a button at all. `.tap-target`
            because `.nh-btn--sm` paints 32px (design-language §4, route 2) and the only things it
            can steal taps from here are the words either side of it.

            A single outstanding requirement renders as the bare sentence it always did — a
            one-item bulleted list would be ceremony around one line. Two or more become a list,
            capped, because at some point a raw imported record has thirty and a wall of them is
            no more actionable than one at a time was. */}
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
                {/* A PUBLISHED record with outstanding issues is a different sentence and a more
                    urgent one: it is still live and still visible, and the store demotes it to an
                    invisible draft on the next write that re-validates. Saying "before this can be
                    published" there would be flatly wrong — it already is. */}
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

      {/* The consequence this removal had somewhere else, stated where and when it
          happened. `warning`, not `error`: nothing failed, and Restore above undoes it.
          The record is NAMED BY THE CONTROL and not by the sentence, which is the same
          rule the publish blocker keeps — say the thing once. */}
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
        {/* Annotated, never blocked: the name is the identity the GM sees, and ids are
            the system's problem. No error tone, no block. */}
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
