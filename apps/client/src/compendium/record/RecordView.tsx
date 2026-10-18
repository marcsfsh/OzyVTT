import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  IconButton,
  IconList,
  IconMore,
  IconWarning,
  IconX,
  Menu,
  MenuItem,
  SaveState,
  SegmentedControl,
  Tabs,
  cx,
  WhoSeesItSwitch
} from "@vtt/ui";
import { homebrewApi, type HomebrewRecordDocument, type HomebrewSrdRecord } from "../../homebrew/api";
import { closingSave } from "../../homebrew/closingSaves";
import { WIZARDS } from "../../homebrew/wizard";
import { REVIEW_STEP } from "../../homebrew/wizard/steps";
import { CompendiumCard, cardName, cardOfBody } from "../CompendiumCard";
import { useCompendium } from "../context";
import { useHomebrewList, useTable } from "../data";
import { KindIcon, kindLabel, phoneFacts, type Kind } from "../kinds";
import { PhoneHead, StateChip } from "../pieces";
import { RECORD_TABS, recordPath, tablePath, withTableQuery, type RecordTab } from "../routes";
import { useNames } from "../TablesView";
import { CardTab } from "./CardTab";
import { HistoryTab } from "./HistoryTab";
import { MergePanel } from "./Merge";
import { SharingTab, audienceLock, audienceWord } from "./SharingTab";
import { Studio, stepStates, useStudioPlan, type StudioMode } from "./Studio";
import { editorParts } from "./editorParts";
import { useHomebrewRecord, type HomebrewRecordState } from "./useHomebrewRecord";

const TAB_WORD: Readonly<Record<RecordTab, string>> = {
  card: "Card",
  edit: "Edit",
  sharing: "Sharing",
  history: "History"
};

/** Where a published record turns up for the table, for Review's last word. */
const WHERE_IT_APPEARS: Readonly<Record<Kind, string>> = {
  class: "The character builder offers it.",
  subclass: "It is offered when a character of its class reaches its level.",
  species: "The character builder offers it.",
  background: "The character builder offers it.",
  feat: "The character builder offers it where its category fits.",
  spell: "Casters whose spell lists include it can learn it.",
  "spell-list": "Classes that name it draw their spells from it.",
  equipment: "It is in the gear picker for every character's inventory.",
  monster: "It is in the bestiary, and you can add it to a fight from there."
};

export type RecordLayout = "dock" | "full" | "phone";

/**
 * One record of the Compendium at its own address, with Card, Edit, Sharing and History. An SRD record opens read
 * only with Make a homebrew copy; a homebrew record opens on its draft, held once so the tabs are views of it. On a
 * laptop it docks beside its table, and on Edit it takes the width, with the table folded into a flyout.
 */
export function RecordView({
  kind,
  id,
  tab,
  layout,
  onOpenTable
}: Readonly<{
  kind: Kind;
  id: string;
  tab: RecordTab;
  layout: RecordLayout;
  /** Opens the table folded beside the record; absent when it is docked in view. */
  onOpenTable?: () => void;
}>) {
  const { token } = useCompendium();
  const table = useTable(token, kind);
  const row = table.data?.find((entry) => entry.id === id) ?? null;
  // The table says where a row comes from; an id it lacks is read as homebrew, which answers not found if it is not.
  const source = row?.source ?? (table.data || table.error ? "homebrew" : null);
  if (source === null) return <p className="cp-hint cp-pad">Opening the record.</p>;
  return source === "srd" ? (
    <SrdRecord kind={kind} id={id} layout={layout} onOpenTable={onOpenTable} />
  ) : (
    <HomebrewRecordLoader kind={kind} id={id} tab={tab} layout={layout} onOpenTable={onOpenTable} />
  );
}

/** The bar over a record: its name and state, the line that says what it is, Who sees it and the primary action. */
function RecordHeader({
  kind,
  name,
  line,
  chips,
  lead,
  who,
  primary,
  menu,
  extra,
  layout,
  onOpenTable,
  onClose
}: Readonly<{
  kind: Kind;
  name: string;
  line: string;
  chips: ReactNode;
  /** In place of the kind's mark: the readiness ring while editing. */
  lead?: ReactNode;
  who?: ReactNode;
  primary?: ReactNode;
  menu?: ReactNode;
  /** Edit's Steps and All questions. */
  extra?: ReactNode;
  layout: RecordLayout;
  onOpenTable?: () => void;
  onClose: () => void;
}>) {
  if (layout === "phone")
    return (
      <>
        <PhoneHead title={name} onBack={onClose} actions={menu} search={false} />
        <div className="cp-rec-chips">
          {chips}
          <span className="cp-grow" />
          {primary}
        </div>
      </>
    );
  return (
    <header className="cp-rec-head">
      <div className="cp-rec-titlerow">
        {onOpenTable && (
          <IconButton label="Open the table" size="sm" className="cp-tablebutton" onClick={onOpenTable}>
            <IconList />
          </IconButton>
        )}
        {lead ?? <KindIcon kind={kind} />}
        <h2 className="cp-rec-title" tabIndex={-1}>
          {name}
        </h2>
        {chips}
        <span className="cp-grow" />
        {extra}
        {menu}
        <IconButton label={`Close ${name}`} size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      <div className="cp-rec-linerow">
        <span className="cp-rec-line">{line}</span>
        {who}
        {primary}
      </div>
    </header>
  );
}

function RecordTabs({
  tab,
  tabs,
  onTab,
  id
}: Readonly<{ tab: RecordTab; tabs: readonly RecordTab[]; onTab: (tab: RecordTab) => void; id: string }>) {
  return (
    <Tabs
      className="cp-rec-tabs"
      ariaLabel="Record"
      idBase={`cp-rec-${id}`}
      tabs={tabs.map((entry) => ({ id: entry, label: TAB_WORD[entry] }))}
      activeId={tab}
      onChange={(next) => onTab(next as RecordTab)}
    />
  );
}

/** The record's line under its name: the facts its table shows, or how it began while it has none, and how many
    characters took it. A built character keeps its own copy, so the count is context and blocks nothing. */
function useRecordLine(kind: Kind, id: string, fallback: string): string {
  const { token } = useCompendium();
  const names = useNames(token);
  const row = useTable(token, kind).data?.find((entry) => entry.id === id);
  const facts = (row && phoneFacts(kind, row.columns, names)) || fallback;
  const used = row?.usageCount ?? 0;
  return used > 0 ? `${facts} · used by ${used} ${used === 1 ? "character" : "characters"}` : facts;
}

function SrdRecord({
  kind,
  id,
  layout,
  onOpenTable
}: Readonly<{ kind: Kind; id: string; layout: RecordLayout; onOpenTable?: () => void }>) {
  const { token, party, query, go, setQuery, openNew } = useCompendium();
  const names = useNames(token);
  const table = useTable(token, kind);
  const [record, setRecord] = useState<HomebrewSrdRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setRecord(null);
    homebrewApi.srdRecord(token, id).then(
      (answer) => {
        if (live) setRecord(answer);
      },
      (failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : "Couldn't open that record.");
      }
    );
    return () => {
      live = false;
    };
  }, [token, id]);
  const line = useRecordLine(kind, id, `SRD 5.2.1 ${kindLabel(kind)}`);
  const close = () => go(withTableQuery(tablePath(kind), query));
  if (error) return <RecordProblem text={error} onClose={close} />;
  if (!record) return <p className="cp-hint cp-pad">Opening the record.</p>;
  const card = cardOfBody(kind, record.record, id);
  const name = cardName(card);
  const copies = (table.data ?? []).filter((entry) => entry.basedOn?.id === id && !entry.archived);
  const copyButton = (
    <Button
      variant="primary"
      size="sm"
      className={cx(layout === "phone" && "cp-block")}
      onClick={() => openNew({ kind, from: { id, name } })}
    >
      Make a homebrew copy
    </Button>
  );
  return (
    <article className={cx("cp-record", `is-${layout}`)} aria-label={name}>
      <RecordHeader
        kind={kind}
        name={name}
        line={line}
        chips={<Badge tone="info">SRD 5.2.1</Badge>}
        primary={layout === "phone" ? null : copyButton}
        layout={layout}
        onOpenTable={onOpenTable}
        onClose={close}
      />
      <RecordTabs tab="card" tabs={["card"]} onTab={() => undefined} id={id} />
      <div className="cp-rec-body scroll-y" role="tabpanel" id={`cp-rec-${id}-panel-card`}>
        <p className="cp-hint">Read only. A homebrew copy keeps a link to it, for Compare.</p>
        <CardTab
          token={token}
          kind={kind}
          recordId={id}
          doc={null}
          gmCard={card}
          names={names}
          party={party}
          as={query.get("as")}
          onAs={(as) => setQuery((params) => (as ? params.set("as", as) : params.delete("as")))}
        />
        {copies.length > 0 && (
          <section className="cp-copies" aria-label="Your copies">
            <h4 className="cp-h">Your copies</h4>
            <ul className="cp-list">
              {copies.map((copy) => (
                <li key={copy.id} className="cp-mrow">
                  <KindIcon kind={kind} />
                  <span className="cp-grow">{copy.name}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => go(withTableQuery(recordPath(kind, copy.id), query, { tab: "history" }))}
                  >
                    Compare
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {layout === "phone" && copyButton}
      </div>
    </article>
  );
}

function RecordProblem({ text, onClose }: Readonly<{ text: string; onClose: () => void }>) {
  return (
    <div className="cp-empty">
      <p>{text}</p>
      <Button onClick={onClose}>Back to the table</Button>
    </div>
  );
}

function HomebrewRecordLoader({
  kind,
  id,
  tab,
  layout,
  onOpenTable
}: Readonly<{ kind: Kind; id: string; tab: RecordTab; layout: RecordLayout; onOpenTable?: () => void }>) {
  const { token, query, go } = useCompendium();
  const list = useHomebrewList(token);
  const [doc, setDoc] = useState<HomebrewRecordDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setDoc(null);
    setError(null);
    // The save the last editor of this record sent as it closed lands first, so the copy read here has it.
    closingSave(id)
      .then(() => homebrewApi.get(token, id))
      .then(
        (answer) => {
          if (live) setDoc(answer);
        },
        (failure: unknown) => {
          if (live) setError(failure instanceof Error ? failure.message : "Couldn't open that record.");
        }
      );
    return () => {
      live = false;
    };
  }, [token, id]);
  if (error) return <RecordProblem text={error} onClose={() => go(withTableQuery(tablePath(kind), query))} />;
  if (!doc || !list.data) return <p className="cp-hint cp-pad">Opening the record.</p>;
  return (
    <HomebrewRecord
      key={doc.id}
      initial={doc}
      records={list.data}
      tab={tab}
      layout={layout}
      onOpenTable={onOpenTable}
    />
  );
}

/** The readiness ring: how many of the record's steps are done. */
export function ReadinessRing({ done, total }: Readonly<{ done: number; total: number }>) {
  const share = total === 0 ? 0 : done / total;
  const around = 2 * Math.PI * 15;
  return (
    <span
      className={cx("cp-ring", done === total && "is-done")}
      role="img"
      aria-label={`${done} of ${total} steps done`}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="cp-ring-track" cx="18" cy="18" r="15" />
        <circle
          className="cp-ring-fill"
          cx="18"
          cy="18"
          r="15"
          strokeDasharray={`${share * around} ${around}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="cp-ring-text tabular">
        {done}/{total}
      </span>
    </span>
  );
}

function HomebrewRecord({
  initial,
  records,
  tab,
  layout,
  onOpenTable
}: Readonly<{
  initial: HomebrewRecordDocument;
  records: Parameters<typeof useHomebrewRecord>[0]["records"];
  tab: RecordTab;
  layout: RecordLayout;
  onOpenTable?: () => void;
}>) {
  const { token, party, query, go, setQuery, openNew, wide, phone } = useCompendium();
  const record = useHomebrewRecord({ token, initial, records });
  const { doc, draft } = record;
  const kind = doc.type;
  const names = useNames(token);
  const def = WIZARDS[kind];
  const { steps, placed } = useStudioPlan(def, draft, record.checklist);
  // A record opened to edit has been through every step; one just made walks them first.
  const seenAll = query.get("new") !== "1";
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const states = stepStates(steps, placed, visited, seenAll);
  const done = steps.filter((step) => step.id !== REVIEW_STEP && states.get(step.id) === "done").length;
  const stepId = query.get("step") ?? steps[0]!.id;
  const mode: StudioMode = query.get("view") === "all" ? "all" : "steps";
  const parts = useMemo(() => editorParts(kind, doc.id, record.spells), [kind, doc.id, record.spells]);
  const card = useMemo(() => cardOfBody(kind, draft, doc.id, record.spells), [kind, draft, doc.id, record.spells]);
  const name = (typeof draft.name === "string" && draft.name.trim()) || `Untitled ${kindLabel(kind)}`;
  const line = useRecordLine(
    kind,
    doc.id,
    `${kindLabel(kind).replace(/^./, (first) => first.toUpperCase())} · ${doc.basedOn ? `copied from ${doc.basedOn.name}` : "started blank"}`
  );
  const setKey = (key: string, value: string | null) =>
    setQuery((params) => (value ? params.set(key, value) : params.delete(key)));
  const toTab = (next: RecordTab) =>
    go(
      withTableQuery(recordPath(kind, doc.id), query, {
        tab: next === "card" ? null : next,
        step: query.get("step"),
        view: query.get("view"),
        new: query.get("new"),
        as: query.get("as")
      }),
      { replace: true }
    );
  const close = () => go(withTableQuery(tablePath(kind), query));
  const publishLabel = record.archived ? null : !record.published ? "Publish" : record.pending ? "Update" : null;
  const blocked = record.checklist.length > 0;

  const primary = publishLabel ? (
    <Button
      variant="primary"
      size="sm"
      onClick={() => void record.publish()}
      disabled={blocked || record.busy}
      title={blocked ? record.checklist[0]?.text : undefined}
    >
      {publishLabel}
    </Button>
  ) : null;

  const menu = (
    <Menu trigger={<IconMore />} label={`More actions for ${name}`} icon align="end" hideCaret>
      {record.pending && (
        <MenuItem onClick={() => void record.discard()} disabled={record.busy}>
          Discard the changes
        </MenuItem>
      )}
      {record.published && !record.archived && (
        <MenuItem onClick={() => void record.unpublish()} disabled={record.busy}>
          Unpublish
        </MenuItem>
      )}
      {phone && publishLabel && (
        <MenuItem onClick={() => void record.publish()} disabled={blocked || record.busy}>
          {publishLabel}
        </MenuItem>
      )}
      <MenuItem onClick={() => openNew({ kind, from: { id: doc.id, name } })}>Make a copy</MenuItem>
      {record.archived ? (
        <MenuItem onClick={() => void record.restore()} disabled={record.busy}>
          Restore
        </MenuItem>
      ) : (
        <MenuItem onClick={() => void record.archive()} disabled={record.busy}>
          Archive
        </MenuItem>
      )}
    </Menu>
  );

  const value = { audience: doc.audience, characterIds: doc.characterIds };
  const who =
    tab === "sharing" || record.archived ? null : (
      <WhoSeesItSwitch
        value={value}
        party={party}
        what={name}
        onChange={record.setAudience}
        word={audienceWord(doc, kind, party)}
        disabledReason={audienceLock(doc) ?? (record.busy ? "Saving." : null)}
        className="cp-rec-who"
      />
    );

  const chips = (
    <>
      {/* Published, and beside it the changes not live, as the record's two facts. */}
      <StateChip row={{ source: "homebrew", state: doc.state, archived: record.archived, pendingChanges: false }} />
      {record.pending && !record.archived && (
        <StateChip row={{ source: "homebrew", state: doc.state, archived: false, pendingChanges: true }} />
      )}
      {record.conflict && (
        <Badge tone="caution">
          <IconWarning /> Changed on two devices
        </Badge>
      )}
      {layout !== "phone" && <SaveState status={record.status} onRetry={record.retry} className="cp-savestate" />}
    </>
  );

  const extra =
    tab === "edit" && layout !== "phone" ? (
      <SegmentedControl
        size="sm"
        ariaLabel="Questions"
        value={mode}
        onChange={(next) => setKey("view", next === "all" ? "all" : null)}
        options={[
          { value: "steps", label: "Steps" },
          { value: "all", label: "All questions" }
        ]}
      />
    ) : null;

  const reviewPublished =
    record.published && !record.pending ? (
      <p className="cp-step-intro">
        Published. {WHERE_IT_APPEARS[kind]} {audienceWord(doc, kind, party)}.
      </p>
    ) : null;

  const body = (() => {
    switch (tab) {
      case "card":
        return (
          <CardTab
            token={token}
            kind={kind}
            recordId={doc.id}
            doc={doc}
            gmCard={card}
            names={names}
            party={party}
            as={query.get("as")}
            onAs={(as) => setKey("as", as)}
          />
        );
      case "edit":
        return record.archived ? (
          <Alert tone="info" title="Archived">
            <p>Restore it to edit it. Nothing was deleted.</p>
          </Alert>
        ) : (
          <Studio
            def={def}
            draft={draft}
            onDraft={record.setDraft}
            ctx={record.ctx}
            recordId={doc.id}
            spells={record.spells}
            checklist={record.checklist}
            warnings={doc.validity.warnings}
            stepId={stepId}
            onStep={(next) => setKey("step", next)}
            visited={visited}
            onVisited={(stepSeen) => setVisited((held) => (held.has(stepSeen) ? held : new Set([...held, stepSeen])))}
            seenAll={seenAll}
            mode={mode}
            custom={parts}
            publishLabel={publishLabel}
            onPublish={() => void record.publish()}
            busy={record.busy}
            published={reviewPublished}
            preview={<CompendiumCard card={card} names={names} />}
            previewLine={[name, line].join(" · ")}
            wide={wide}
            phone={phone}
            note={record.nameNote ? <p className="cp-hint">{record.nameNote}</p> : undefined}
          />
        );
      case "sharing":
        return (
          <SharingTab
            doc={doc}
            kind={kind}
            name={name}
            party={party}
            busy={record.busy}
            onAudience={record.setAudience}
          />
        );
      case "history":
        return (
          <HistoryTab
            token={token}
            doc={doc}
            kind={kind}
            draft={draft}
            busy={record.busy}
            phone={phone}
            onRestore={record.restoreVersion}
            onDiscard={() => void record.discard()}
            onOpenSource={(source) => go(withTableQuery(recordPath(kind, source.id), query))}
          />
        );
    }
  })();

  return (
    <article className={cx("cp-record", `is-${layout}`, tab === "edit" && "is-editing")} aria-label={name}>
      <RecordHeader
        kind={kind}
        name={name}
        line={line}
        chips={chips}
        lead={tab === "edit" && !record.archived ? <ReadinessRing done={done} total={steps.length - 1} /> : undefined}
        who={layout === "phone" ? null : who}
        primary={layout === "phone" ? null : primary}
        menu={menu}
        extra={extra}
        layout={layout}
        onOpenTable={onOpenTable}
        onClose={close}
      />
      <RecordTabs tab={tab} tabs={RECORD_TABS} onTab={toTab} id={doc.id} />
      <RecordNotices record={record} kind={kind} />
      <div
        className={cx("cp-rec-body", tab === "edit" && !record.archived ? "is-studio" : "scroll-y")}
        role="tabpanel"
        id={`cp-rec-${doc.id}-panel-${tab}`}
        aria-labelledby={`cp-rec-${doc.id}-tab-${tab}`}
      >
        {record.conflict ? (
          <MergePanel
            kind={kind}
            conflict={record.conflict}
            base={record.savedDraft()}
            local={draft}
            phone={phone}
            onResolve={record.resolve}
          />
        ) : (
          body
        )}
      </div>
      {record.dialog}
    </article>
  );
}

/** What a state change said: an archived record's Restore, and an action the server refused. */
function RecordNotices({ record, kind }: Readonly<{ record: HomebrewRecordState; kind: Kind }>) {
  if (!record.archived && !record.actionError) return null;
  return (
    <div className="cp-rec-notices">
      {record.archived && (
        <Alert tone="info">
          Archived: out of every picker{kind === "monster" ? " and the bestiary" : ""}. Nothing was deleted.{" "}
          <Button variant="secondary" size="sm" onClick={() => void record.restore()} disabled={record.busy}>
            Restore
          </Button>
        </Alert>
      )}
      {record.actionError && (
        <p className="cp-blocked" role="alert">
          {record.actionError}
        </p>
      )}
    </div>
  );
}
