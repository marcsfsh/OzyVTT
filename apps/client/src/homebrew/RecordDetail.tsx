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
import { Alert, Badge, Button, IconChevron, Menu, MenuItem, SaveState } from "@vtt/ui";
import { RevealSwitch } from "../codex/SecretMarkers";
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
import { duplicateNameNote, publishBlockedReason, serverBlockedReason } from "./validate";
import type { CustomRenderer } from "./FieldRenderer";
import { typeLabel } from "./types";

type Body = Readonly<Record<string, unknown>>;

const nameOf = (record: Body): string => (typeof record.name === "string" ? record.name : "");

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
   * Why publishing is blocked, as ONE sentence, in ONE place, beneath the button it
   * blocks. Never a red asterisk, never a checklist, never per-field errors: **drafts
   * show no errors at all** — a draft is allowed to be invalid, so "this requirement is
   * not met yet" is a different thing from "this field is wrong now" and must not look
   * like it. (The second thing — a malformed dice formula — still shows inline, on its
   * own field, because that IS wrong now.)
   *
   * Two sources, one slot: the client's own `publishBlockedReason` disables the button
   * before the call, so the server's 409 is the rare server-wins case and renders in the
   * same sentence. Never a second error region.
   */
  const blocked = useMemo(() => {
    const local = publishBlockedReason(doc.type, draft, ctx);
    if (local) return local;
    if (doc.validity.valid) return null;
    return serverBlockedReason(doc.type, doc.validity.issues[0], (path) => fieldAt(doc.type, path));
  }, [doc.type, doc.validity, draft, ctx]);
  const blockedReason = blocked?.text ?? null;
  const blockedSection = blocked?.sectionId ? sectionTitle(doc.type, blocked.sectionId) : null;

  /** Scroll to the section the reason names and focus it — one control, no restatement,
      and it removes the hunt. */
  const jumpToSection = () => {
    if (!blocked?.sectionId) return;
    const element = document.getElementById(sectionDomId(doc.type, blocked.sectionId));
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
        // `grants` is deliberately absent for an item: there is no model for an item
        // conferring a proficiency, and authoring one would produce records the server
        // silently ignores. See the table at the top of RiderEditor.tsx.
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

        {/* ONE sentence slot, shared by the local blocker and the server's rejection.
            `{Section}` is a CONTROL and the only place the section is named — the sentence
            no longer repeats it (`validate.ts`, "one copy template"). It is `secondary`
            with the system's own jump chevron, not a `ghost`: a ghost at `--text-dim`
            beside a `--caution-hi` sentence was dimmer than the words it followed and did
            not read as a button at all. `.tap-target` because `.nh-btn--sm` paints 32px
            (design-language §4, route 2) and the only things it can steal taps from here
            are the words either side of it. */}
        {(blockedReason || actionError) && !removed && (
          <p className="hb-blocked" id={reasonId} role={actionError ? "alert" : undefined}>
            {actionError ?? blockedReason}
            {!actionError && blockedSection && (
              <>
                {" "}
                <Button variant="secondary" size="sm" className="tap-target hb-blocked-jump" onClick={jumpToSection}>
                  {blockedSection}
                  <span className="hb-blocked-jump-icon" aria-hidden="true"><IconChevron /></span>
                </Button>
              </>
            )}
          </p>
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
