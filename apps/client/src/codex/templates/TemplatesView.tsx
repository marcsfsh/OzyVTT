import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Field,
  IconChevronRight,
  IconMore,
  IconPlus,
  Input,
  Menu,
  MenuItem,
  Select,
  Skeleton,
  useToast
} from "@vtt/ui";
import { CODEX_PREP_LIMITS, type CodexAutosaveSettings, type CodexPrepTemplate, type CodexSession } from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { nextSessionNumber } from "../creates";
import { CodexIcon } from "../icons";
import { prepSessionApi, templateApi } from "../prep/api";
import { sectionTypeLabel } from "../prep/sections";
import { sessionTitle } from "../sessions";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexQuery } from "../useCodexQuery";
import { TemplateEditor } from "./TemplateEditor";
import "./templates.css";

/** Below this width templates are read and used, not edited: editing a template is a laptop task. */
export const TEMPLATES_PHONE_QUERY = "(max-width: 760px)";

const sectionCount = (template: CodexPrepTemplate) =>
  `${template.sections.length} ${template.sections.length === 1 ? "section" : "sections"}`;

/**
 * Prep templates, from the GM menu: the library of reusable session prep, one template's editor, a new session made
 * from it, and the sessions made from it with Re-apply. A phone lists the templates read-only and can still start a
 * session from one. Templates and prep are GM-only and reach no player.
 */
export function TemplatesView({
  gmToken,
  autosave,
  sessions,
  templateId,
  onSelectTemplate,
  onOpenSession,
  onSessionsChanged,
  onBack,
  onOpenMenu
}: Readonly<{
  gmToken: string;
  autosave: CodexAutosaveSettings;
  /** The shell's session feed. */
  sessions: readonly CodexSession[];
  /** From the address; null shows the default template. */
  templateId: string | null;
  onSelectTemplate: (templateId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onSessionsChanged: () => void | Promise<void>;
  /** A phone's Back, to Sessions. */
  onBack?: () => void;
  /** The crumb back to the GM menu. */
  onOpenMenu?: () => void;
}>) {
  const phone = useMediaQuery(TEMPLATES_PHONE_QUERY);
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const library = useCodexQuery(
    useCallback(() => templateApi.list(gmToken), [gmToken]),
    { failure: "Couldn't load the prep templates." }
  );
  const templates = library.data?.templates ?? [];
  const defaultId = library.data?.defaultTemplateId ?? null;
  const selected =
    templates.find((template) => template.id === templateId) ??
    templates.find((template) => template.id === defaultId) ??
    templates[0] ??
    null;
  const builtIn = templates.find((template) => template.builtIn) ?? null;
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const replace = useCallback(
    (template: CodexPrepTemplate) =>
      library.setData(
        (prev) =>
          prev && { ...prev, templates: prev.templates.map((each) => (each.id === template.id ? template : each)) }
      ),
    [library]
  );
  const act = async (run: () => Promise<unknown>, failure: string) => {
    setError(null);
    try {
      await run();
      await library.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    }
  };
  const create = () =>
    act(async () => {
      const made = await templateApi.create(gmToken, { name: "New template", sections: [] });
      onSelectTemplate(made.id);
    }, "Couldn't make the template.");
  const duplicate = (template: CodexPrepTemplate) =>
    act(async () => {
      const copy = await templateApi.duplicate(gmToken, template.id);
      onSelectTemplate(copy.id);
      toast(`Made ${copy.name}.`, { tone: "success" });
    }, "Couldn't duplicate the template.");
  const setDefault = (template: CodexPrepTemplate, isDefault: boolean) =>
    act(
      () => templateApi.setDefault(gmToken, isDefault || !builtIn ? template.id : builtIn.id),
      "Couldn't change the default template."
    );
  const remove = async (template: CodexPrepTemplate) => {
    const used = sessions.filter((session) => session.prepTemplateId === template.id).length;
    if (
      !(await confirm({
        title: "Delete template",
        body: `Delete ${template.name}?${used > 0 ? " Sessions made from it keep their prep." : ""}${template.isDefault ? " The starting template becomes the default." : ""}`,
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return;
    await act(() => templateApi.remove(gmToken, template.id), "Couldn't delete the template.");
  };

  const cards = (
    <ul className={`tpl-library${phone ? " is-phone" : ""}`} aria-label="Prep templates">
      {templates.map((template) => {
        const on = template.id === selected?.id;
        return (
          <li key={template.id} className={`tpl-card${on ? " is-selected" : ""}`}>
            <button
              type="button"
              className="tpl-card-open"
              aria-current={on ? "true" : undefined}
              onClick={() => onSelectTemplate(template.id)}
            >
              <CodexIcon iconId="scroll" className="tpl-card-icon" />
              <span className="tpl-card-text">
                <span className="tpl-card-name">{template.name}</span>
                <span className="tpl-card-meta">
                  {template.builtIn ? `Built in · ${sectionCount(template)}` : sectionCount(template)}
                </span>
              </span>
              {template.isDefault && <span className="tpl-default">Default</span>}
              {phone && <IconChevronRight className="tpl-card-chevron" />}
            </button>
            {!phone && (
              <Menu icon align="end" label={`${template.name} options`} trigger={<IconMore />}>
                <MenuItem
                  disabled={template.builtIn}
                  onClick={() => {
                    onSelectTemplate(template.id);
                    requestAnimationFrame(() => nameRef.current?.focus());
                  }}
                >
                  Rename
                </MenuItem>
                <MenuItem onClick={() => void duplicate(template)}>Duplicate</MenuItem>
                <MenuItem disabled={template.isDefault} onClick={() => void setDefault(template, true)}>
                  Set as default
                </MenuItem>
                <MenuItem tone="danger" disabled={template.builtIn} onClick={() => void remove(template)}>
                  Delete
                </MenuItem>
              </Menu>
            )}
          </li>
        );
      })}
      {!phone && (
        <li className="tpl-card tpl-card-new">
          <button
            type="button"
            className="tpl-card-open"
            disabled={templates.filter((each) => !each.builtIn).length >= CODEX_PREP_LIMITS.templates}
            onClick={() => void create()}
          >
            <IconPlus /> New template
          </button>
        </li>
      )}
    </ul>
  );

  if (library.loading && !library.data)
    return (
      <div className="tpl-view">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" />
        ))}
      </div>
    );

  if (phone)
    return (
      <div className="tpl-view is-phone">
        <CodexPhoneBar title="Prep templates" onBack={onBack} />
        <p className="tpl-hint">Templates are edited on a laptop. A new session here can use any of them.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        {library.error && <Alert tone="danger">{library.error}</Alert>}
        {cards}
        {selected && (
          <section className="tpl-readonly" aria-label={`${selected.name} sections`}>
            <h3 className="tpl-eyebrow">{selected.name} · read only</h3>
            <ul className="tpl-readonly-list">
              {selected.sections.map((section) => (
                <li key={section.id} className="tpl-readonly-row">
                  <span className="tpl-section-title">{section.title}</span>
                  <span className="tpl-typechip">{sectionTypeLabel(section.type)}</span>
                </li>
              ))}
            </ul>
            <NewSessionFromTemplate
              compact
              gmToken={gmToken}
              template={selected}
              templates={templates}
              sessions={sessions}
              onCreated={async (sessionId) => {
                await onSessionsChanged();
                onOpenSession(sessionId);
              }}
            />
          </section>
        )}
        {confirmDialog}
      </div>
    );

  return (
    <div className="tpl-view">
      <div className="tpl-toolbar">
        <nav className="tpl-crumbs" aria-label="Where you are">
          {onOpenMenu ? (
            <button type="button" className="tpl-crumb" onClick={onOpenMenu}>
              GM menu
            </button>
          ) : (
            <span className="tpl-crumb">GM menu</span>
          )}
          <IconChevronRight className="tpl-crumbsep" />
          <span className="tpl-crumb is-current" aria-current="page">
            Prep templates
          </span>
        </nav>
        <Button variant="secondary" size="sm" onClick={() => void create()}>
          <IconPlus /> New template
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {library.error && <Alert tone="danger">{library.error}</Alert>}
      {cards}
      {selected && (
        <div className="tpl-work">
          <TemplateEditor
            key={selected.id}
            gmToken={gmToken}
            template={selected}
            autosave={autosave}
            builtInIsDefault={builtIn?.isDefault ?? false}
            nameRef={nameRef}
            onSaved={replace}
            onDuplicate={() => void duplicate(selected)}
            onSetDefault={(isDefault) => void setDefault(selected, isDefault)}
          />
          <div className="tpl-side">
            <NewSessionFromTemplate
              key={selected.id}
              gmToken={gmToken}
              template={selected}
              templates={templates}
              sessions={sessions}
              onCreated={async (sessionId) => {
                await onSessionsChanged();
                onOpenSession(sessionId);
              }}
            />
            <MadeFromTemplate
              gmToken={gmToken}
              template={selected}
              sessions={sessions}
              onOpenSession={onOpenSession}
              onChanged={onSessionsChanged}
            />
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

/** A new session, its prep copied from the chosen template's sections. */
function NewSessionFromTemplate({
  gmToken,
  template,
  templates,
  sessions,
  compact = false,
  onCreated
}: Readonly<{
  gmToken: string;
  template: CodexPrepTemplate;
  templates: readonly CodexPrepTemplate[];
  sessions: readonly CodexSession[];
  /** A phone's one button: the next number, this template, nothing else to fill in. */
  compact?: boolean;
  onCreated: (sessionId: string) => void | Promise<void>;
}>) {
  const suggested = nextSessionNumber(sessions);
  const [number, setNumber] = useState(String(suggested));
  const [playedOn, setPlayedOn] = useState("");
  const [chosenId, setChosenId] = useState(template.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = templates.find((each) => each.id === chosenId) ?? template;
  const parsed = number.trim() === "" ? null : Math.trunc(Number(number));
  const numberLabel = parsed === null || !Number.isFinite(parsed) ? "" : ` ${parsed}`;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await prepSessionApi.create(gmToken, {
        sessionNumber: compact ? suggested : parsed !== null && Number.isFinite(parsed) ? parsed : null,
        realDate: compact ? null : playedOn.trim() || null,
        templateId: chosen.id
      });
      await onCreated(session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't make the session.");
    } finally {
      setBusy(false);
    }
  };

  if (compact)
    return (
      <>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button variant="secondary" block disabled={busy} onClick={() => void create()}>
          <IconPlus /> New session from this template
        </Button>
      </>
    );

  return (
    <section className="tpl-card-panel" aria-label="New session from this template">
      <h3 className="tpl-panel-title">New session from this template</h3>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="tpl-form">
        <Field label="Session" htmlFor="tpl-new-number">
          <Input
            id="tpl-new-number"
            type="number"
            inputMode="numeric"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </Field>
        <Field label="Played on" htmlFor="tpl-new-date">
          <Input
            id="tpl-new-date"
            placeholder="2026-10-31"
            value={playedOn}
            onChange={(event) => setPlayedOn(event.target.value)}
          />
        </Field>
        <Field label="Template" htmlFor="tpl-new-template">
          <Select id="tpl-new-template" value={chosen.id} onChange={(event) => setChosenId(event.target.value)}>
            {templates.map((each) => (
              <option key={each.id} value={each.id}>
                {each.isDefault ? `${each.name} (default)` : each.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <h4 className="tpl-eyebrow">Copies these sections</h4>
      {chosen.sections.length === 0 ? (
        <p className="tpl-hint">This template has no sections, so the session starts empty.</p>
      ) : (
        <ul className="tpl-chips" aria-label="Sections it copies">
          {chosen.sections.map((section) => (
            <li key={section.id} className="tpl-chip">
              {section.title}
            </li>
          ))}
        </ul>
      )}
      <Button variant="primary" block disabled={busy} onClick={() => void create()}>
        Create session{numberLabel}
      </Button>
    </section>
  );
}

/** The sessions whose prep was copied from this template, each with Re-apply. */
function MadeFromTemplate({
  gmToken,
  template,
  sessions,
  onOpenSession,
  onChanged
}: Readonly<{
  gmToken: string;
  template: CodexPrepTemplate;
  sessions: readonly CodexSession[];
  onOpenSession: (sessionId: string) => void;
  onChanged: () => void | Promise<void>;
}>) {
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const made = useMemo(
    () =>
      sessions
        .filter((session) => session.prepTemplateId === template.id)
        .sort((a, b) => (b.sessionNumber ?? 0) - (a.sessionNumber ?? 0)),
    [sessions, template.id]
  );
  const reapply = async (session: CodexSession) => {
    setError(null);
    try {
      await prepSessionApi.applyTemplate(gmToken, session.id, template.id, session.rev);
      await onChanged();
      toast(`${sessionTitle(session)} has this template's sections again, with what was written kept.`, {
        tone: "success"
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't re-apply the template.");
    }
  };
  return (
    <section className="tpl-card-panel" aria-label="Made from this template">
      <h3 className="tpl-panel-title">Made from this template</h3>
      {error && <Alert tone="danger">{error}</Alert>}
      {made.length === 0 ? (
        <p className="tpl-hint">No session has been made from this template yet.</p>
      ) : (
        <ul className="tpl-made">
          {made.map((session) => (
            <li key={session.id} className="tpl-made-row">
              <button type="button" className="tpl-made-open" onClick={() => onOpenSession(session.id)}>
                <CodexIcon iconId="sessions" className="tpl-card-icon" />
                <span className="tpl-card-text">
                  <span className="tpl-card-name">{sessionTitle(session)}</span>
                  <span className="tpl-card-meta">
                    {[session.realDate, session.status === "played" ? "played" : "planned"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
              <Button variant="ghost" size="sm" onClick={() => void reapply(session)}>
                Re-apply
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="tpl-hint">
        Editing the template never changes these sessions. Re-apply adds any new sections and keeps what was written.
      </p>
    </section>
  );
}
