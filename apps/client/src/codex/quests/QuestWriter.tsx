import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Eyebrow,
  Field,
  IconButton,
  IconChevron,
  IconTrash,
  Input,
  SaveState,
  Select,
  TagInput
} from "@vtt/ui";
import type { CodexQuestStatus } from "@vtt/domain";
import { questRecordApi } from "../api-records";
import type { CodexBlock, CodexQuest } from "@vtt/domain";
import { useCodexAutosave } from "../autosave";
import { EntityIcon } from "../icons";
import { QUEST_STATUS_LABEL, QUEST_STATUS_ORDER } from "../quests";
import { pagePath, pathForSection } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex } from "../shell/context";
import { PagePicker } from "../shared/PagePicker";
import { WhoSeesItMenu } from "../shared/WhoSeesIt";
import { EVERYONE, type Audience } from "../shared/audience";
import { DocEditor } from "../page/DocEditor";
import { draftDocument, nextDraftKey, saveShape, type DraftItem } from "../page/document";

type DraftObjective = Readonly<{ key: string; id: string | null; text: string; done: boolean; audience: Audience }>;
type QuestDraft = Readonly<{
  title: string;
  status: CodexQuestStatus;
  items: readonly DraftItem[];
  objectives: readonly DraftObjective[];
  entityIds: readonly string[];
  tags: readonly string[];
}>;

function draftOf(quest: CodexQuest): QuestDraft {
  return {
    title: quest.title,
    status: quest.status,
    items: draftDocument(quest.playerBody, quest.blocks),
    objectives: quest.objectives.map((objective) => ({
      key: objective.id,
      id: objective.id,
      text: objective.text,
      done: objective.done,
      audience: { audience: objective.audience, characterIds: objective.characterIds }
    })),
    entityIds: quest.entityIds,
    tags: quest.tags
  };
}

function serialize(draft: QuestDraft): string {
  const shape = saveShape(draft.items);
  return JSON.stringify({
    ...draft,
    items: undefined,
    body: shape.playerBody,
    blocks: shape.blocks.map((block) => [block.key, block.title.trim(), block.text.trim(), block.anchor]),
    objectives: draft.objectives.map((objective) => [objective.key, objective.text, objective.done])
  });
}

/**
 * A quest in writing: its title and status, the text with its hidden blocks in place, the objectives in order (a new
 * one says who sees it before it is saved, so a Hidden one is never shown), the linked pages and the tags.
 */
export function QuestWriter({
  quest,
  onSaved,
  onReload,
  onDone,
  onRevealBlock
}: Readonly<{
  quest: CodexQuest;
  onSaved: (quest: CodexQuest) => void;
  onReload: () => Promise<void>;
  onDone: () => void;
  onRevealBlock: (block: CodexBlock) => void;
}>) {
  const { token, phone, go } = useCodexShell();
  const gm = useGmCodex();
  const { party, feeds } = gm;
  const [draft, setDraft] = useState<QuestDraft>(() => draftOf(quest));
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(quest);
  latest.current = quest.rev >= latest.current.rev ? quest : latest.current;
  const created = useRef(new Map<string, string>());

  const save = useCallback(
    async (next: QuestDraft) => {
      const shape = saveShape(next.items);
      let current = latest.current;
      const idOf = (block: (typeof shape.blocks)[number]) => block.id ?? created.current.get(block.key) ?? null;
      const keep = new Set(shape.blocks.map(idOf).filter((id): id is string => id !== null));
      for (const block of current.blocks)
        if (!keep.has(block.id)) current = await questRecordApi.blocks.remove(token, quest.id, block.id);
      for (const block of shape.blocks) {
        const id = idOf(block);
        const title = block.title.trim() || null;
        if (!id) {
          const added = await questRecordApi.blocks.add(token, quest.id, {
            anchor: block.anchor,
            title,
            text: block.text,
            expectedRev: current.rev
          });
          current = added.record;
          created.current.set(block.key, added.blockId);
          continue;
        }
        const server = current.blocks.find((candidate) => candidate.id === id);
        if (server && ((server.title ?? null) !== title || server.text !== block.text))
          current = await questRecordApi.blocks.update(token, quest.id, id, {
            title,
            text: block.text,
            expectedRev: current.rev
          });
      }
      // An objective made in an earlier save of this sitting is sent with the id the server gave it.
      const known = new Map(current.objectives.map((objective) => [objective.id, objective]));
      current = await questRecordApi.update(token, quest.id, {
        title: next.title.trim() || "Untitled quest",
        status: next.status,
        playerBody: shape.playerBody,
        layout: shape.blocks.map((block) => ({ id: idOf(block) ?? "", anchor: block.anchor })),
        objectives: next.objectives
          .filter((objective) => objective.text.trim() !== "")
          .map((objective) => {
            const id = objective.id ?? created.current.get(objective.key) ?? null;
            return id && known.has(id)
              ? { id, text: objective.text.trim(), done: objective.done }
              : {
                  text: objective.text.trim(),
                  done: objective.done,
                  audience: objective.audience.audience,
                  ...(objective.audience.audience === "characters"
                    ? { characterIds: objective.audience.characterIds }
                    : {})
                };
          }),
        entityIds: next.entityIds,
        tags: next.tags,
        expectedRev: current.rev
      });
      // New objectives come back in order after the kept ones; remember their ids by key.
      const fresh = current.objectives.filter((objective) => !known.has(objective.id));
      next.objectives
        .filter((objective) => !(objective.id ?? created.current.get(objective.key)) && objective.text.trim())
        .forEach((objective, index) => {
          if (fresh[index]) created.current.set(objective.key, fresh[index].id);
        });
      latest.current = current;
      setError(null);
      onSaved(current);
    },
    [token, quest.id, onSaved]
  );
  const autosave = useCodexAutosave<QuestDraft>({
    settings: gm.autosave,
    draft,
    serialize,
    save,
    onConflict: async () => {
      await onReload();
      setError("Someone else changed this quest. Your text is kept; it saves again with your next change.");
    }
  });

  const pages = useMemo(
    () => feeds.pages.map((page) => ({ id: page.id, title: page.title, entityType: page.entityType })),
    [feeds.pages]
  );
  const tagSuggestions = useMemo(() => [...new Set(feeds.pages.flatMap((page) => page.tags))].sort(), [feeds.pages]);
  const serverBlocks = useMemo(() => new Map(quest.blocks.map((block) => [block.id, block])), [quest.blocks]);
  const setObjective = (key: string, patch: Partial<DraftObjective>) =>
    setDraft((prev) => ({
      ...prev,
      objectives: prev.objectives.map((objective) => (objective.key === key ? { ...objective, ...patch } : objective))
    }));
  const moveObjective = (index: number, direction: -1 | 1) =>
    setDraft((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.objectives.length) return prev;
      const objectives = [...prev.objectives];
      [objectives[index], objectives[target]] = [objectives[target], objectives[index]];
      return { ...prev, objectives };
    });
  const setAudience = async (objective: DraftObjective, next: Audience) => {
    const id = objective.id ?? created.current.get(objective.key);
    if (!id) {
      setObjective(objective.key, { audience: next });
      return;
    }
    try {
      onSaved(
        await questRecordApi.setObjectiveAudience(token, quest.id, id, {
          audience: next.audience,
          ...(next.audience === "characters" ? { characterIds: next.characterIds } : {})
        })
      );
      setObjective(objective.key, { audience: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change who sees that objective.");
    }
  };
  const setBlockAudience = async (block: CodexBlock, next: Audience) => {
    try {
      onSaved(
        await questRecordApi.blocks.setAudience(token, quest.id, block.id, {
          audience: next.audience,
          ...(next.audience === "characters" ? { characterIds: next.characterIds } : {})
        })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change who sees that block.");
    }
  };

  const controls = (
    <>
      <SaveState status={autosave.status} onRetry={() => void autosave.flush()} onReload={() => void onReload()} />
      {!gm.autosave.enabled && (
        <Button size="sm" disabled={!autosave.dirty} onClick={() => void autosave.flush()}>
          Save
        </Button>
      )}
      <Button
        variant="primary"
        size="sm"
        onClick={() =>
          void autosave.flush().then(() => {
            onDone();
            void onReload();
          })
        }
      >
        Done
      </Button>
    </>
  );

  const body = (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Status" htmlFor="cx-quest-status">
        <Select
          id="cx-quest-status"
          value={draft.status}
          onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as CodexQuestStatus }))}
        >
          {QUEST_STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {QUEST_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
      </Field>
      <DocEditor
        items={draft.items}
        onChange={(items) => setDraft((prev) => ({ ...prev, items }))}
        serverBlocks={serverBlocks}
        party={party}
        phone={phone}
        pages={pages}
        excludePageId=""
        busy={false}
        onCreatePage={(title) => gm.quickCreate({ title, stay: true })}
        onReveal={onRevealBlock}
        onAudience={(block, next) => void setBlockAudience(block, next)}
      />
      <section className="cx-objectives" aria-label="Objectives">
        <Eyebrow>Objectives</Eyebrow>
        <ul className="cx-objlist">
          {draft.objectives.map((objective, index) => (
            <li key={objective.key} className="cx-obj is-writing">
              <label className="cx-obj-check">
                <input
                  type="checkbox"
                  checked={objective.done}
                  onChange={(event) => setObjective(objective.key, { done: event.target.checked })}
                />
                <span className="nh-sr-only">Done</span>
              </label>
              <Input
                aria-label={`Objective ${index + 1}`}
                value={objective.text}
                maxLength={120}
                onChange={(event) => setObjective(objective.key, { text: event.target.value })}
              />
              <WhoSeesItMenu
                value={objective.audience}
                party={party}
                what={objective.text || `objective ${index + 1}`}
                onChange={(next) => void setAudience(objective, next)}
              />
              <IconButton label={`Move objective ${index + 1} up`} size="sm" onClick={() => moveObjective(index, -1)}>
                <IconChevron className="cx-flip" />
              </IconButton>
              <IconButton
                label={`Remove objective ${index + 1}`}
                size="sm"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    objectives: prev.objectives.filter((row) => row.key !== objective.key)
                  }))
                }
              >
                <IconTrash />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          disabled={draft.objectives.length >= 24}
          onClick={() =>
            setDraft((prev) => ({
              ...prev,
              objectives: [
                ...prev.objectives,
                { key: nextDraftKey(), id: null, text: "", done: false, audience: EVERYONE }
              ]
            }))
          }
        >
          Add an objective
        </Button>
      </section>
      <section className="cx-meta-section" aria-label="Linked pages">
        <Eyebrow>Linked pages</Eyebrow>
        {draft.entityIds.map((id) => {
          const page = pages.find((candidate) => candidate.id === id);
          return (
            <div key={id} className="cx-writerel-row">
              <button type="button" className="cx-meta-link" onClick={() => go(pagePath(id))}>
                {page && <EntityIcon type={page.entityType} />}
                <span className="cx-meta-link-title">{page?.title ?? "A page that no longer exists"}</span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Unlink ${page?.title ?? "this page"}`}
                onClick={() =>
                  setDraft((prev) => ({ ...prev, entityIds: prev.entityIds.filter((entity) => entity !== id) }))
                }
              >
                Remove
              </Button>
            </div>
          );
        })}
        {draft.entityIds.length < 24 && (
          <PagePicker
            label="Link a page"
            placeholder="Choose one"
            pages={pages.filter((page) => !draft.entityIds.includes(page.id))}
            value={null}
            onChange={(id) => setDraft((prev) => ({ ...prev, entityIds: [...prev.entityIds, id] }))}
          />
        )}
      </section>
      <Field label="Tags" htmlFor="cx-quest-tags">
        <TagInput
          id="cx-quest-tags"
          ariaLabel="Tags"
          placeholder="rescue, college"
          values={draft.tags}
          onChange={(next: readonly string[]) => setDraft((prev) => ({ ...prev, tags: next }))}
          max={24}
          maxReachedReason="A quest may carry at most 24 tags."
          suggestions={tagSuggestions}
        />
      </Field>
    </>
  );

  const title = (
    <Input
      variant="title"
      className="cx-write-title"
      aria-label="Quest title"
      value={draft.title}
      placeholder="Untitled quest"
      onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
    />
  );

  if (phone)
    return (
      <div className="cx-page is-phone is-writing scroll-y">
        <CodexPhoneBar title={draft.title || "Untitled quest"} actions={controls} />
        <div className="cx-page-phonebody">
          {title}
          {body}
        </div>
      </div>
    );
  return (
    <div className="cx-page is-writing">
      <header className="cx-page-head">
        <div className="cx-page-headmain">
          <nav className="cx-crumbs" aria-label="Where this quest sits">
            <button type="button" className="cx-crumb" onClick={() => go(pathForSection("quests"))}>
              Quests
            </button>
          </nav>
          {title}
        </div>
        <div className="cx-page-actions">{controls}</div>
      </header>
      <div className="cx-page-docscroll scroll-y">
        <div className="cx-doc">{body}</div>
      </div>
    </div>
  );
}
