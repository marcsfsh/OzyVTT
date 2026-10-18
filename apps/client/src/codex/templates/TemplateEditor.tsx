import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button, IconDrag, IconMore, IconPlus, Input, Menu, MenuItem, SaveState, Switch } from "@vtt/ui";
import type { CodexAutosaveSettings } from "@vtt/domain";
import { newId } from "../../lib/ids";
import { useCodexAutosave } from "../autosave";
import { templateApi } from "../prep/api";
import { CODEX_PREP_LIMITS, type CodexPrepSectionType, type CodexPrepTemplate } from "@vtt/domain";
import { useReorder } from "../prep/reorder";
import { SECTION_TYPES, sectionTypeLabel } from "../prep/sections";

type SectionDraft = Readonly<{ id: string; title: string; prompt: string; type: CodexPrepSectionType }>;
type TemplateDraft = Readonly<{ name: string; sections: readonly SectionDraft[] }>;

const draftOf = (template: CodexPrepTemplate): TemplateDraft => ({
  name: template.name,
  sections: template.sections.map((section) => ({
    id: section.id,
    title: section.title,
    prompt: section.prompt ?? "",
    type: section.type
  }))
});

/** The words a new section starts with: its type's name, made unique in this template. */
function freshTitle(type: CodexPrepSectionType, sections: readonly SectionDraft[]): string {
  const base = sectionTypeLabel(type);
  const taken = new Set(sections.map((section) => section.title.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let count = 2; ; count += 1) if (!taken.has(`${base} ${count}`.toLowerCase())) return `${base} ${count}`;
}

/**
 * One template's editor: its name, whether new sessions start from it, and its typed sections in order. A section is
 * a title, a prompt shown while writing, and a type. Sections reorder by a handle or by Alt and an arrow key. The
 * starting template is read-only; Duplicate makes a copy to edit. Edits follow the autosave setting, and a stale
 * `rev` is a conflict, never an overwrite.
 */
export function TemplateEditor({
  gmToken,
  template,
  autosave,
  builtInIsDefault,
  nameRef,
  onSaved,
  onDuplicate,
  onSetDefault
}: Readonly<{
  gmToken: string;
  template: CodexPrepTemplate;
  autosave: CodexAutosaveSettings;
  /** Turning the default off hands it back to the starting template. */
  builtInIsDefault: boolean;
  /** Rename in the library's menu focuses this box. */
  nameRef?: React.Ref<HTMLInputElement>;
  onSaved: (template: CodexPrepTemplate) => void;
  onDuplicate: () => void;
  onSetDefault: (isDefault: boolean) => void;
}>) {
  const [draft, setDraft] = useState<TemplateDraft>(() => draftOf(template));
  const revRef = useRef(template.rev);
  const markSavedRef = useRef<((draft: TemplateDraft) => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = template.builtIn;

  const save = useCallback(
    async (next: TemplateDraft) => {
      const saved = await templateApi.update(gmToken, template.id, {
        name: next.name.trim() || template.name,
        sections: next.sections.map((section) => ({
          id: section.id,
          title: section.title.trim() || sectionTypeLabel(section.type),
          prompt: section.prompt.trim() || null,
          type: section.type
        })),
        expectedRev: revRef.current
      });
      revRef.current = saved.rev;
      setError(null);
      onSaved(saved);
    },
    [gmToken, template.id, template.name, onSaved]
  );
  const saving = useCodexAutosave<TemplateDraft>({
    settings: autosave,
    draft,
    save,
    disabled: readOnly,
    // Another device saved first: show its version, which is what a session made now would copy.
    onConflict: async () => {
      const fresh = (await templateApi.list(gmToken)).templates.find((each) => each.id === template.id);
      if (!fresh) return;
      revRef.current = fresh.rev;
      const next = draftOf(fresh);
      setDraft(next);
      markSavedRef.current?.(next);
      onSaved(fresh);
      setError("This template changed on another device, so it now shows that version.");
    }
  });
  markSavedRef.current = saving.markSaved;

  const setSections = (sections: readonly SectionDraft[]) => setDraft((prev) => ({ ...prev, sections }));
  const patchSection = (id: string, patch: Partial<SectionDraft>) =>
    setSections(draft.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  const addSection = (type: CodexPrepSectionType) =>
    setSections([...draft.sections, { id: newId(), title: freshTitle(type, draft.sections), prompt: "", type }]);
  const removeSection = (id: string) => setSections(draft.sections.filter((section) => section.id !== id));

  const reorder = useReorder(
    draft.sections,
    (next) => setSections(next),
    (section) => section.title || sectionTypeLabel(section.type)
  );
  const full = draft.sections.length >= CODEX_PREP_LIMITS.templateSections;
  const hintId = `template-reorder-${template.id}`;
  const sectionCount = useMemo(() => draft.sections.length, [draft.sections]);

  return (
    <section className="tpl-editor" aria-label={`Template: ${template.name}`}>
      <div className="tpl-editor-head">
        <Input
          ref={nameRef}
          aria-label="Template name"
          className="tpl-name"
          value={draft.name}
          maxLength={CODEX_PREP_LIMITS.templateName}
          readOnly={readOnly}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
        />
        <Switch
          checked={template.isDefault}
          disabled={template.builtIn && builtInIsDefault}
          onChange={onSetDefault}
          label="Default for new sessions"
        />
        <span className="tpl-grow" />
        {!readOnly && (
          <Menu
            className="tpl-addmenu"
            align="end"
            trigger={
              <span className="tpl-addtrigger">
                <IconPlus /> Add a section
              </span>
            }
          >
            {SECTION_TYPES.map((entry) => (
              <MenuItem key={entry.type} disabled={full} onClick={() => addSection(entry.type)}>
                <span className="tpl-typeoption">
                  <span className="tpl-typeoption-name">{entry.label}</span>
                  <span className="tpl-typeoption-holds">{entry.holds}</span>
                </span>
              </MenuItem>
            ))}
          </Menu>
        )}
        <Button variant="secondary" size="sm" onClick={onDuplicate}>
          Duplicate
        </Button>
        {!readOnly && <SaveState status={saving.status} onRetry={() => void saving.flush()} />}
        {!readOnly && !autosave.enabled && (
          <Button variant="secondary" size="sm" disabled={!saving.dirty} onClick={() => void saving.flush()}>
            Save template
          </Button>
        )}
      </div>
      {error && <Alert tone="warning">{error}</Alert>}
      {readOnly ? (
        <p className="tpl-hint">The starting template can't be changed. Duplicate it to make your own.</p>
      ) : (
        <p className="tpl-hint" id={hintId}>
          Drag a section by its handle, or press Alt and an arrow key, to change the order.
          {full ? ` A template holds at most ${CODEX_PREP_LIMITS.templateSections} sections.` : ""}
        </p>
      )}
      <ol className="tpl-sections" ref={(element) => void (reorder.listRef.current = element)} aria-label="Sections">
        {reorder.shown.map((section, index) => (
          <li
            key={section.id}
            data-reorder-row
            className={`tpl-section${reorder.draggingIndex === index ? " is-dragging" : ""}`}
            onKeyDown={readOnly ? undefined : reorder.onRowKeyDown(index)}
          >
            {!readOnly && (
              <button
                type="button"
                className="tpl-handle"
                aria-label={`Move ${section.title || sectionTypeLabel(section.type)}`}
                aria-describedby={hintId}
                {...reorder.handleProps(index)}
              >
                <IconDrag />
              </button>
            )}
            <div className="tpl-section-text">
              {readOnly ? (
                <>
                  <span className="tpl-section-title">{section.title}</span>
                  {section.prompt && <span className="tpl-section-prompt">{section.prompt}</span>}
                </>
              ) : (
                <>
                  <Input
                    aria-label={`Section ${index + 1} title`}
                    className="tpl-section-titleinput"
                    value={section.title}
                    maxLength={CODEX_PREP_LIMITS.sectionTitle}
                    onChange={(event) => patchSection(section.id, { title: event.target.value })}
                  />
                  <Input
                    aria-label={`Section ${index + 1} prompt`}
                    className="tpl-section-promptinput"
                    placeholder="A prompt shown while you write"
                    value={section.prompt}
                    maxLength={CODEX_PREP_LIMITS.prompt}
                    onChange={(event) => patchSection(section.id, { prompt: event.target.value })}
                  />
                </>
              )}
            </div>
            <span className="tpl-typechip">{sectionTypeLabel(section.type)}</span>
            {!readOnly && (
              <Menu
                icon
                align="end"
                label={`${section.title || sectionTypeLabel(section.type)} options`}
                trigger={<IconMore />}
              >
                <MenuItem disabled={index === 0} onClick={() => reorder.move(index, index - 1)}>
                  Move up
                </MenuItem>
                <MenuItem disabled={index === sectionCount - 1} onClick={() => reorder.move(index, index + 1)}>
                  Move down
                </MenuItem>
                <MenuItem tone="danger" onClick={() => removeSection(section.id)}>
                  Remove
                </MenuItem>
              </Menu>
            )}
          </li>
        ))}
      </ol>
      {draft.sections.length === 0 && (
        <p className="tpl-hint">This template has no sections yet. Add a section to start.</p>
      )}
      <p className="nh-sr-only" role="status">
        {reorder.announcement}
      </p>
    </section>
  );
}
