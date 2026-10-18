import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Combobox,
  Field,
  IconButton,
  IconMore,
  IconPlus,
  IconX,
  Input,
  Menu,
  MenuItem,
  Modal,
  Select,
  Textarea
} from "@vtt/ui";
import type { CodexEntityType, CodexQuestStatus } from "@vtt/domain";
import { newId } from "../../lib/ids";
import { codexApi, questApi } from "../api";
import { CodexEditor } from "../CodexEditor";
import { EntityIcon, CodexIcon } from "../icons";
import {
  CODEX_PREP_LIMITS,
  type CodexBlockRef,
  type CodexPrepChecklistItem,
  type CodexPrepLink,
  type CodexPrepScene,
  type CodexPrepSection,
  type CodexPrepSectionType
} from "../prep/contract";
import { SECTION_TYPES, emptySection, moveItem, sectionTypeLabel } from "../prep/sections";
import { PagePicker } from "../shared/PagePicker";
import "../templates/templates.css";

/** The records a session's prep can pick from, each with what a picker shows. */
export type PrepContext = Readonly<{
  token: string;
  pages: ReadonlyArray<
    Readonly<{ id: string; title: string; entityType: CodexEntityType; revealedToPlayers?: boolean }>
  >;
  quests: ReadonlyArray<Readonly<{ id: string; title: string; status: CodexQuestStatus }>>;
  /** Deadline records from the chronicle. */
  deadlines: ReadonlyArray<Readonly<{ id: string; text: string; inWorldLabel: string | null; fired: boolean }>>;
  /** The table's scenes, for Encounters. */
  scenes: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  /** Follows a `[[link]]` in a section's text: to the page of that title, or to create it. */
  onFollow?: (target: string) => void;
}>;

/** A section's contents, typed by its section. */
type Section = CodexPrepSection;

const blank = (id?: string) => id ?? newId();

/** What a link names, in words: "Ysolde Varn · The debt", or the record alone. */
export function linkLine(link: CodexPrepLink, context: PrepContext, blockTitle?: string | null): string {
  const record =
    link.recordKind === "page"
      ? context.pages.find((page) => page.id === link.recordId)?.title
      : context.quests.find((quest) => quest.id === link.recordId)?.title;
  const name = record ?? (link.recordKind === "page" ? "A deleted page" : "A deleted quest");
  if (!link.blockId) return name;
  return `${name} · ${blockTitle?.trim() || "hidden block"}`;
}

/**
 * The editors of a session's prep, one per section type, in the session's order. Each section keeps its title and
 * the prompt from its template; Add a section adds one by hand. A dangling id (a page or deadline since deleted)
 * stays and says so, as the server keeps it.
 */
export function PrepEditor({
  sections,
  context,
  onChange,
  filter
}: Readonly<{
  sections: readonly Section[];
  context: PrepContext;
  onChange: (next: Section[]) => void;
  /** Which sections to show (a phone splits Cast and places from the rest); all of them by default. */
  filter?: (section: Section) => boolean;
}>) {
  const put = (id: string, next: Section) => onChange(sections.map((section) => (section.id === id ? next : section)));
  const remove = (id: string) => onChange(sections.filter((section) => section.id !== id));
  const move = (index: number, to: number) => onChange(moveItem(sections, index, to));
  const add = (type: CodexPrepSectionType) => {
    const input = emptySection(type, sectionTypeLabel(type));
    onChange([...sections, { ...input, id: newId(), templateSectionId: null, prompt: null } as Section]);
  };
  const shown = sections.filter((section) => !filter || filter(section));
  return (
    <div className="prep-sections">
      {shown.length === 0 && <p className="story-hint">This session has no prep here yet.</p>}
      {shown.map((section) => {
        const index = sections.indexOf(section);
        return (
          <section key={section.id} className="prep-section" aria-label={section.title}>
            <header className="prep-section-head">
              <h3 className="story-eyebrow">{section.title}</h3>
              <span className="tpl-typechip">{sectionTypeLabel(section.type)}</span>
              <span className="story-grow" />
              <Menu icon align="end" label={`${section.title} options`} trigger={<IconMore />}>
                <MenuItem disabled={index === 0} onClick={() => move(index, index - 1)}>
                  Move up
                </MenuItem>
                <MenuItem disabled={index === sections.length - 1} onClick={() => move(index, index + 1)}>
                  Move down
                </MenuItem>
                <MenuItem tone="danger" onClick={() => remove(section.id)}>
                  Remove section
                </MenuItem>
              </Menu>
            </header>
            {section.prompt && <p className="story-hint">{section.prompt}</p>}
            <SectionBody section={section} context={context} onChange={(next) => put(section.id, next)} />
          </section>
        );
      })}
      {!filter && (
        <Menu
          className="prep-addmenu"
          trigger={
            <span className="tpl-addtrigger">
              <IconPlus /> Add a section
            </span>
          }
        >
          {SECTION_TYPES.map((entry) => (
            <MenuItem
              key={entry.type}
              disabled={sections.length >= CODEX_PREP_LIMITS.sessionSections}
              onClick={() => add(entry.type)}
            >
              <span className="tpl-typeoption">
                <span className="tpl-typeoption-name">{entry.label}</span>
                <span className="tpl-typeoption-holds">{entry.holds}</span>
              </span>
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

function SectionBody({
  section,
  context,
  onChange
}: Readonly<{ section: Section; context: PrepContext; onChange: (next: Section) => void }>) {
  switch (section.type) {
    case "text":
      return (
        <CodexEditor
          id={`prep-${section.id}`}
          token={context.token}
          value={section.text}
          onChange={(text) => onChange({ ...section, text })}
          ariaLabel={section.title}
          placeholder={section.prompt ?? "Write here"}
          pages={context.pages}
          onNavigate={context.onFollow ?? (() => undefined)}
          onCreatePage={context.onFollow}
          gmLayer
          rows={4}
        />
      );
    case "checklist":
      return <ChecklistBody section={section} context={context} onChange={onChange} />;
    case "pages":
      return (
        <IdList
          ids={section.pageIds}
          limit={CODEX_PREP_LIMITS.pages}
          describe={(id) => {
            const page = context.pages.find((each) => each.id === id);
            return page
              ? { title: page.title, icon: <EntityIcon type={page.entityType} /> }
              : { title: "A deleted page", icon: null };
          }}
          onChange={(pageIds) => onChange({ ...section, pageIds })}
          adder={(add) => (
            <PagePicker
              label="Add"
              placeholder="a page"
              pages={context.pages.filter((page) => !section.pageIds.includes(page.id))}
              value={null}
              onChange={add}
            />
          )}
        />
      );
    case "scenes":
      return <ScenesBody section={section} context={context} onChange={onChange} />;
    case "clocks":
      return (
        <IdList
          ids={section.deadlineIds}
          limit={CODEX_PREP_LIMITS.deadlines}
          describe={(id) => {
            const clock = context.deadlines.find((each) => each.id === id);
            return clock
              ? {
                  title: clock.text,
                  line: [clock.inWorldLabel, clock.fired ? "Passed" : null].filter(Boolean).join(" · "),
                  icon: <CodexIcon iconId="hourglass" className="prep-icon" />
                }
              : { title: "A deleted deadline", icon: null };
          }}
          onChange={(deadlineIds) => onChange({ ...section, deadlineIds })}
          adder={(add) => (
            <AddSelect
              label="Add a clock"
              options={context.deadlines
                .filter((each) => !section.deadlineIds.includes(each.id))
                .map((each) => ({
                  id: each.id,
                  label: each.inWorldLabel ? `${each.text} · ${each.inWorldLabel}` : each.text
                }))}
              onAdd={add}
            />
          )}
        />
      );
    case "quests":
      return (
        <IdList
          ids={section.questIds}
          limit={CODEX_PREP_LIMITS.quests}
          describe={(id) => {
            const quest = context.quests.find((each) => each.id === id);
            return quest
              ? { title: quest.title, icon: <CodexIcon iconId="quest" className="prep-icon" /> }
              : { title: "A deleted quest", icon: null };
          }}
          onChange={(questIds) => onChange({ ...section, questIds })}
          adder={(add) => (
            <AddSelect
              label="Add a quest"
              options={context.quests
                .filter((each) => !section.questIds.includes(each.id))
                .map((each) => ({ id: each.id, label: each.title }))}
              onAdd={add}
            />
          )}
        />
      );
    case "encounters":
      return (
        <IdList
          ids={section.sceneIds}
          limit={CODEX_PREP_LIMITS.encounters}
          describe={(id) => {
            const scene = context.scenes.find((each) => each.id === id);
            return scene
              ? { title: scene.name, icon: <CodexIcon iconId="battle" className="prep-icon" /> }
              : { title: "A deleted scene", icon: null };
          }}
          onChange={(sceneIds) => onChange({ ...section, sceneIds })}
          adder={(add) => (
            <AddSelect
              label="Add an encounter"
              options={context.scenes
                .filter((each) => !section.sceneIds.includes(each.id))
                .map((each) => ({ id: each.id, label: each.name }))}
              onAdd={add}
            />
          )}
        />
      );
  }
}

/** A list of picked records, each with Remove, and the caller's way to add one. */
function IdList({
  ids,
  limit,
  describe,
  onChange,
  adder
}: Readonly<{
  ids: readonly string[];
  limit: number;
  describe: (id: string) => Readonly<{ title: string; line?: string; icon: ReactNode }>;
  onChange: (ids: string[]) => void;
  adder: (add: (id: string) => void) => ReactNode;
}>) {
  return (
    <div className="prep-idlist">
      {ids.length > 0 && (
        <ul className="prep-rows">
          {ids.map((id) => {
            const shown = describe(id);
            return (
              <li key={id} className="prep-row">
                {shown.icon}
                <span className="prep-row-text">
                  <span className="prep-row-title">{shown.title}</span>
                  {shown.line && <span className="prep-row-line">{shown.line}</span>}
                </span>
                <IconButton
                  label={`Remove ${shown.title}`}
                  size="sm"
                  onClick={() => onChange(ids.filter((each) => each !== id))}
                >
                  <IconX />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {ids.length < limit && adder((id) => onChange([...ids, id]))}
    </div>
  );
}

function AddSelect({
  label,
  options,
  onAdd
}: Readonly<{
  label: string;
  options: ReadonlyArray<Readonly<{ id: string; label: string }>>;
  onAdd: (id: string) => void;
}>) {
  if (options.length === 0) return null;
  return (
    <Select aria-label={label} value="" onChange={(event) => event.target.value && onAdd(event.target.value)}>
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

// ----- Checklist -----

function ChecklistBody({
  section,
  context,
  onChange
}: Readonly<{
  section: Extract<Section, { type: "checklist" }>;
  context: PrepContext;
  onChange: (next: Section) => void;
}>) {
  const [draft, setDraft] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const items = section.items;
  const setItems = (next: CodexPrepChecklistItem[]) => onChange({ ...section, items: next });
  const putItem = (id: string, patch: Partial<CodexPrepChecklistItem>) =>
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setItems([
      ...items,
      { id: blank(), text: text.slice(0, CODEX_PREP_LIMITS.itemText), done: false, doneAt: null, link: null }
    ]);
    setDraft("");
  };
  const linkingItem = items.find((item) => item.id === linking) ?? null;
  return (
    <div className="prep-checklist">
      {items.length > 0 && (
        <ul className="prep-rows">
          {items.map((item) => (
            <li key={item.id} className={`prep-clue${item.done ? " is-done" : ""}`}>
              <input
                type="checkbox"
                className="prep-check"
                checked={item.done}
                aria-label={`Done: ${item.text || "this item"}`}
                onChange={(event) => putItem(item.id, { done: event.target.checked })}
              />
              <span className="prep-row-text">
                <Input
                  aria-label="Item"
                  value={item.text}
                  maxLength={CODEX_PREP_LIMITS.itemText}
                  onChange={(event) => putItem(item.id, { text: event.target.value })}
                />
                <button type="button" className="story-linkbutton prep-linkline" onClick={() => setLinking(item.id)}>
                  {item.link ? linkLine(item.link, context) : "Link a page or a hidden block"}
                </button>
              </span>
              <IconButton
                label={`Remove ${item.text || "this item"}`}
                size="sm"
                onClick={() => setItems(items.filter((each) => each.id !== item.id))}
              >
                <IconX />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {items.length < CODEX_PREP_LIMITS.items && (
        <div className="prep-addrow">
          <Input
            aria-label={`Add to ${section.title}`}
            placeholder="A fact the players could learn"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button variant="secondary" size="sm" disabled={!draft.trim()} onClick={add}>
            Add
          </Button>
        </div>
      )}
      {linkingItem && (
        <LinkDialog
          context={context}
          link={linkingItem.link}
          onClose={() => setLinking(null)}
          onSave={(link) => {
            putItem(linkingItem.id, { link });
            setLinking(null);
          }}
        />
      )}
    </div>
  );
}

/** Choose what a clue links: a page or a quest, and one of its hidden blocks or the whole record. */
function LinkDialog({
  context,
  link,
  onClose,
  onSave
}: Readonly<{
  context: PrepContext;
  link: CodexPrepLink | null;
  onClose: () => void;
  onSave: (link: CodexPrepLink | null) => void;
}>) {
  const [recordKey, setRecordKey] = useState<string | null>(link ? `${link.recordKind}:${link.recordId}` : null);
  const [blockId, setBlockId] = useState<string | null>(link?.blockId ?? null);
  const [blocks, setBlocks] = useState<readonly CodexBlockRef[]>([]);
  const [kind, id] = recordKey ? (recordKey.split(":") as ["page" | "quest", string]) : [null, null];
  const readBlocks = useCallback(async () => {
    if (!kind || !id) return [];
    const record =
      kind === "page" ? (await codexApi.getPage(context.token, id)).page : await questApi.get(context.token, id);
    // The model's blocks; a record without any links only as a whole.
    return ((record as { blocks?: readonly CodexBlockRef[] }).blocks ?? []).filter(
      (block) => block.audience === "hidden"
    );
  }, [kind, id, context.token]);
  useEffect(() => {
    let live = true;
    void readBlocks()
      .then((found) => live && setBlocks(found))
      .catch(() => live && setBlocks([]));
    return () => {
      live = false;
    };
  }, [readBlocks]);
  const options = [
    ...context.pages.map((page) => ({
      id: `page:${page.id}`,
      label: page.title,
      icon: <EntityIcon type={page.entityType} />
    })),
    ...context.quests.map((quest) => ({
      id: `quest:${quest.id}`,
      label: quest.title,
      icon: <CodexIcon iconId="quest" className="prep-icon" />
    }))
  ];
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Link this clue"
      footer={
        <>
          {link && (
            <Button variant="ghost" onClick={() => onSave(null)}>
              Remove the link
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!kind || !id}
            onClick={() => kind && id && onSave({ recordKind: kind, recordId: id, blockId })}
          >
            Link
          </Button>
        </>
      }
    >
      <Field label="Page or quest" htmlFor="prep-link-record">
        <Combobox
          id="prep-link-record"
          options={options}
          value={recordKey}
          onChange={(next) => {
            setRecordKey(next);
            setBlockId(null);
          }}
          ariaLabel="Page or quest"
          placeholder="Find a page or a quest"
        />
      </Field>
      {kind && (
        <fieldset className="prep-blockchoice">
          <legend className="story-eyebrow">What it reveals</legend>
          <label className="prep-blockoption">
            <input type="radio" name="prep-block" checked={blockId === null} onChange={() => setBlockId(null)} />
            The whole {kind}
          </label>
          {blocks.map((block) => (
            <label key={block.id} className="prep-blockoption">
              <input
                type="radio"
                name="prep-block"
                checked={blockId === block.id}
                onChange={() => setBlockId(block.id)}
              />
              {block.title?.trim() || block.text.trim().split("\n")[0]}
            </label>
          ))}
          {blocks.length === 0 && <p className="story-hint">It has no hidden block to link.</p>}
        </fieldset>
      )}
    </Modal>
  );
}

// ----- Scenes -----

function ScenesBody({
  section,
  context,
  onChange
}: Readonly<{
  section: Extract<Section, { type: "scenes" }>;
  context: PrepContext;
  onChange: (next: Section) => void;
}>) {
  const scenes = section.scenes;
  const set = (next: CodexPrepScene[]) => onChange({ ...section, scenes: next });
  const put = (id: string, patch: Partial<CodexPrepScene>) =>
    set(scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)));
  const places = context.pages.filter((page) => page.entityType === "location");
  return (
    <div className="prep-scenes">
      <ol className="prep-scenelist">
        {scenes.map((scene, index) => (
          <li key={scene.id} className="prep-scene">
            <div className="prep-scene-head">
              <span className="story-eyebrow">Scene {index + 1}</span>
              <span className="story-grow" />
              <Menu icon align="end" label={`Scene ${index + 1} options`} trigger={<IconMore />}>
                <MenuItem disabled={index === 0} onClick={() => set(moveItem(scenes, index, index - 1))}>
                  Move up
                </MenuItem>
                <MenuItem
                  disabled={index === scenes.length - 1}
                  onClick={() => set(moveItem(scenes, index, index + 1))}
                >
                  Move down
                </MenuItem>
                <MenuItem tone="danger" onClick={() => set(scenes.filter((each) => each.id !== scene.id))}>
                  Remove scene
                </MenuItem>
              </Menu>
            </div>
            <Input
              aria-label={`Scene ${index + 1} title`}
              placeholder="The tower at night"
              value={scene.title}
              maxLength={CODEX_PREP_LIMITS.sceneTitle}
              onChange={(event) => put(scene.id, { title: event.target.value })}
            />
            <PagePicker
              label="Place"
              placeholder="None"
              pages={places}
              value={scene.placePageId}
              onChange={(placePageId) => put(scene.id, { placePageId })}
            />
            <Textarea
              aria-label={`Scene ${index + 1} notes`}
              placeholder="What happens here"
              rows={2}
              value={scene.notes}
              maxLength={CODEX_PREP_LIMITS.sceneNotes}
              onChange={(event) => put(scene.id, { notes: event.target.value })}
            />
          </li>
        ))}
      </ol>
      {scenes.length < CODEX_PREP_LIMITS.scenes && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => set([...scenes, { id: blank(), title: "", placePageId: null, notes: "" }])}
        >
          <IconPlus /> Add a scene
        </Button>
      )}
    </div>
  );
}
