import { useCallback, useState } from "react";
import { Alert, Button, Eyebrow, Field, Input, Select, cx, FieldAudienceToggle } from "@vtt/ui";
import type { CodexInWorldDate, CodexPageConnection, CodexRelationshipBegan } from "@vtt/domain";
import { calendarApi, codexApi, CONNECTION_LABEL_MAX } from "../api";
import { CONNECTION_LABEL_SUGGESTIONS, type EntityType } from "../entities";
import { dateDraftOf, dateOfDraft, InWorldDateFields, type DateDraft } from "../InWorldDateFields";
import { useCodexShell } from "../shell/context";
import { PagePicker } from "../shared/PagePicker";
import { useCodexQuery } from "../useCodexQuery";
import { relationshipGroups, type AnyPageConnection } from "./MetaPanel";

const LABEL_CHIPS = CONNECTION_LABEL_SUGGESTIONS.slice(0, 6);

type BeganWrite = Readonly<{ inWorldDate: CodexInWorldDate | null; beforeCampaign: boolean }> | null;
type BeganDraft = Readonly<{ mode: "none" | "before" | "date"; date: DateDraft }>;

const NO_START: BeganDraft = { mode: "none", date: dateDraftOf(null) };

function beganDraftOf(began: CodexRelationshipBegan | null): BeganDraft {
  if (!began) return NO_START;
  if (began.beforeCampaign) return { mode: "before", date: dateDraftOf(null) };
  return { mode: "date", date: dateDraftOf(began.inWorldDate) };
}

/** What the server takes: nothing, before the campaign, or a date. A date with no year yet sets nothing. */
function beganOfDraft(draft: BeganDraft): BeganWrite {
  if (draft.mode === "before") return { inWorldDate: null, beforeCampaign: true };
  const date = draft.mode === "date" ? dateOfDraft(draft.date) : null;
  return date ? { inWorldDate: date, beforeCampaign: false } : null;
}

export function beganLabel(began: CodexRelationshipBegan | null): string {
  if (!began) return "No start date";
  return began.beforeCampaign ? "Before the campaign" : (began.inWorldLabel ?? "A date in the campaign");
}

/** When a tie began: not set, before the campaign, or a date on the campaign's calendar. */
function BeganFields({
  idPrefix,
  draft,
  onChange
}: Readonly<{ idPrefix: string; draft: BeganDraft; onChange: (next: BeganDraft) => void }>) {
  const { token } = useCodexShell();
  const readCalendar = useCallback(() => calendarApi.get(token), [token]);
  const calendar = useCodexQuery(draft.mode === "date" ? readCalendar : null, { live: false }).data ?? null;
  return (
    <div className="cx-began">
      <Field label="When it began" htmlFor={`${idPrefix}-mode`}>
        <Select
          id={`${idPrefix}-mode`}
          value={draft.mode}
          onChange={(event) => onChange({ ...draft, mode: event.target.value as BeganDraft["mode"] })}
        >
          <option value="none">Not set</option>
          <option value="before">Before the campaign</option>
          <option value="date">On a date</option>
        </Select>
      </Field>
      {draft.mode === "date" && (
        <div className="cx-began-date">
          <InWorldDateFields
            idPrefix={idPrefix}
            draft={draft.date}
            months={calendar?.months ?? []}
            onChange={(patch) => onChange({ ...draft, date: { ...draft.date, ...patch } })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A page's relationships in writing: each declared one with its own Everyone or Hidden switch, when it began, and
 * Remove, and Add a relationship with a label, a page, when it began and who sees it. A mention is written in the
 * text, so it is changed there.
 */
export function RelationshipEditor({
  pageId,
  pageTitle,
  connections,
  pages,
  onChanged,
  onOpen
}: Readonly<{
  pageId: string;
  pageTitle: string;
  connections: readonly CodexPageConnection[];
  pages: ReadonlyArray<Readonly<{ id: string; title: string; entityType: EntityType }>>;
  onChanged: () => void;
  onOpen: (kind: AnyPageConnection["otherKind"], id: string) => void;
}>) {
  const { token } = useCodexShell();
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [began, setBegan] = useState<BeganDraft>(NO_START);
  const [dating, setDating] = useState<Readonly<{ id: string; draft: BeganDraft }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = relationshipGroups(connections, pageTitle);

  const run = async (write: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await write();
      onChanged();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    target &&
    void run(async () => {
      await codexApi.addConnection(token, pageId, {
        toPageId: target,
        label: label.trim() || null,
        layer: hidden ? "gm" : "player",
        began: beganOfDraft(began)
      });
      setTarget(null);
      setLabel("");
      setHidden(false);
      setBegan(NO_START);
    }, "Couldn't add that relationship.");

  return (
    <section className="cx-writerel" aria-label="Relationships">
      <Eyebrow>Relationships</Eyebrow>
      {groups.map((group) => (
        <div key={group.heading} className="cx-meta-group">
          <span className="cx-meta-key">{group.heading}</span>
          {group.rows.map((row) => {
            const connection = row as CodexPageConnection;
            const id = connection.id;
            const name = `${group.heading} ${row.otherTitle}`;
            return (
              <div key={`${row.otherId}:${row.direction}`} className="cx-writerel-item">
                <div className="cx-writerel-row">
                  <button type="button" className="cx-meta-link" onClick={() => onOpen(row.otherKind, row.otherId)}>
                    <span className="cx-meta-link-title">{row.otherTitle}</span>
                  </button>
                  {id && (
                    <>
                      <FieldAudienceToggle
                        field={name}
                        hidden={connection.layer === "gm"}
                        disabled={busy}
                        onChange={(next) =>
                          void run(
                            () => codexApi.updateConnection(token, id, { layer: next ? "gm" : "player" }),
                            "Couldn't change who sees that relationship."
                          )
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          void run(() => codexApi.removeConnection(token, id), "Couldn't remove that relationship.")
                        }
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
                {id &&
                  (dating?.id === id ? (
                    <form
                      className="cx-began-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(
                          () => codexApi.updateConnection(token, id, { began: beganOfDraft(dating.draft) }),
                          "Couldn't change when that relationship began."
                        ).then((ok) => ok && setDating(null));
                      }}
                    >
                      <BeganFields
                        idPrefix={`cx-began-${id}`}
                        draft={dating.draft}
                        onChange={(draft) => setDating({ id, draft })}
                      />
                      <div className="cx-card-row">
                        <Button size="sm" type="submit" disabled={busy}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDating(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="cx-began-chip"
                      aria-label={`When ${name} began: ${beganLabel(connection.began)}`}
                      onClick={() => setDating({ id, draft: beganDraftOf(connection.began) })}
                    >
                      Began: {beganLabel(connection.began)}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      ))}
      <div className="cx-writerel-add">
        <Eyebrow>Add a relationship</Eyebrow>
        <div className="nh-filterchips" role="group" aria-label="Label">
          {LABEL_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className={cx("nh-filterchip", "interactive", label === chip && "is-on")}
              aria-pressed={label === chip}
              onClick={() => setLabel(label === chip ? "" : chip)}
            >
              {chip}
            </button>
          ))}
        </div>
        <Input
          aria-label="Label"
          placeholder="Or write a label"
          value={label}
          maxLength={CONNECTION_LABEL_MAX}
          onChange={(event) => setLabel(event.target.value)}
        />
        <div className="cx-writerel-target">
          <PagePicker
            label="To"
            pages={pages.filter((candidate) => candidate.id !== pageId)}
            value={target}
            onChange={setTarget}
          />
          <FieldAudienceToggle field="the new relationship" hidden={hidden} onChange={setHidden} />
        </div>
        <BeganFields idPrefix="cx-began-new" draft={began} onChange={setBegan} />
        <Button size="sm" disabled={!target || busy} onClick={add}>
          Add
        </Button>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </section>
  );
}
