import { useCallback, useState } from "react";
import { Alert, Button, Chip, Field, Input, Skeleton } from "@vtt/ui";
import type { CodexSession } from "@vtt/domain";
import { nextSessionNumber } from "../creates";
import { prepSessionApi, templateApi } from "../prep/api";
import { useCodexQuery } from "../useCodexQuery";
import "./templates.css";

/**
 * PLAN SESSION {n} on the story's Sessions tab (F time spec 2.3): the template it is made from as chips with the
 * default chosen, the sections that template copies, the date it is played on, and Create session {n}, which is
 * today's create with that template. GM-only, like all prep.
 */
export function PlanSession({
  gmToken,
  sessions,
  onCreated
}: Readonly<{
  gmToken: string;
  sessions: readonly CodexSession[];
  onCreated: (sessionId: string) => void | Promise<void>;
}>) {
  const library = useCodexQuery(
    useCallback(() => templateApi.list(gmToken), [gmToken]),
    { failure: "Couldn't load the prep templates." }
  );
  const templates = library.data?.templates ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen =
    templates.find((each) => each.id === chosenId) ??
    templates.find((each) => each.id === library.data?.defaultTemplateId) ??
    templates[0] ??
    null;
  const [playedOn, setPlayedOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const number = nextSessionNumber(sessions);

  const create = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const session = await prepSessionApi.create(gmToken, {
        sessionNumber: number,
        realDate: playedOn.trim() || null,
        templateId: chosen.id
      });
      await onCreated(session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't make the session.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="plan-session" aria-label={`Plan session ${number}`}>
      <h3 className="plan-session-eyebrow">Plan session {number}</h3>
      {library.error && <Alert tone="danger">{library.error}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {library.loading && !library.data ? (
        <Skeleton variant="text" />
      ) : (
        <>
          <span className="plan-session-label" id="plan-session-from">
            Made from
          </span>
          <div className="plan-session-chips" role="group" aria-labelledby="plan-session-from">
            {templates.map((template) => (
              <Chip key={template.id} pressed={template.id === chosen?.id} onClick={() => setChosenId(template.id)}>
                {template.name}
              </Chip>
            ))}
          </div>
          <h4 className="plan-session-eyebrow">Copies these sections</h4>
          {chosen && chosen.sections.length > 0 ? (
            <ul className="plan-session-copies" aria-label="Sections it copies">
              {chosen.sections.map((section) => (
                <li key={section.id} className="plan-session-copy">
                  {section.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="plan-session-hint">This template has no sections, so the session starts empty.</p>
          )}
          <Field label="Played on" htmlFor="plan-session-date">
            <Input
              id="plan-session-date"
              placeholder="2026-11-08"
              value={playedOn}
              onChange={(event) => setPlayedOn(event.target.value)}
            />
          </Field>
          <Button variant="primary" block disabled={busy || !chosen} onClick={() => void create()}>
            Create session {number}
          </Button>
        </>
      )}
    </section>
  );
}
