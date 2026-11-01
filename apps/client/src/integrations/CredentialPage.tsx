import { useCallback, useEffect, useState } from "react";
import type { CredentialAuditEvent, IntegrationCredentialMetadata } from "@vtt/api-contract";
import { Alert, Button, Crumb, Group, Skeleton, Tag, TitleLine } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { SettingRow } from "../settings/SettingRow";
import { AUDIT_WORDS, STATE_WORDS, stateOf, useCredentialActions, when } from "./CredentialsTable";
import { publishCredentials } from "./credentialCount";
import "./integrations-panel.css";

const CREDENTIALS = "/api/v1/gm/integration-credentials";

/** Why a secret was refused, or what an event carried, in a few words; never a secret. */
function detailOf(event: CredentialAuditEvent): string {
  const detail = event.detail as Readonly<Record<string, unknown>>;
  const scope = typeof detail.requiredScope === "string" ? detail.requiredScope : null;
  switch (event.type) {
    case "created":
      return Array.isArray(detail.scopes) ? `With ${detail.scopes.join(", ")}` : "";
    case "used":
      return scope ? `For ${scope}` : "";
    case "verification_failed":
      return detail.reason === "revoked"
        ? "After it was revoked"
        : detail.reason === "expired"
          ? "After it expired"
          : detail.reason === "scope"
            ? `It needed ${scope ?? "another scope"}`
            : detail.reason === "route"
              ? "A route no credential reaches"
              : detail.reason === "game"
                ? "For another game"
                : "The secret did not match";
    case "rotated":
      return "The old secret stopped working";
    case "revoked":
      return "For good";
  }
}

/**
 * A credential's own page (I leftovers spec 2.5): Access as the crumb on the title's line and the name, one line of
 * its state, scopes, when it was made and when it expires, Rotate and Revoke as Settings' rows, then HISTORY · {N}
 * with what happened, its detail and when. Rotate shows the new secret once, as the table does; the history never
 * holds a secret.
 */
export function CredentialPage({
  gmToken,
  credentialId,
  onBack
}: Readonly<{ gmToken: string; credentialId: string; onBack: () => void }>) {
  const [credential, setCredential] = useState<IntegrationCredentialMetadata | null | undefined>(undefined);
  const [events, setEvents] = useState<readonly CredentialAuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiRequest<{ credentials: IntegrationCredentialMetadata[] }>(CREDENTIALS, { token: gmToken })
      .then((data) => {
        publishCredentials(data.credentials);
        setCredential(data.credentials.find((each) => each.id === credentialId) ?? null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't read the credential."));
    apiRequest<{ events: CredentialAuditEvent[] }>(`${CREDENTIALS}/${encodeURIComponent(credentialId)}/audit`, {
      token: gmToken
    })
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
  }, [gmToken, credentialId]);
  useEffect(load, [load]);
  const { rotate, revoke, dialogs } = useCredentialActions(gmToken, load);

  const title = (
    <TitleLine crumb={<Crumb label="Access" onClick={onBack} />}>
      <h2 className="credential-title">{credential?.name ?? "Credential"}</h2>
    </TitleLine>
  );
  if (error)
    return (
      <section className="credential-page">
        {title}
        <Alert tone="danger">{error}</Alert>
      </section>
    );
  if (credential === undefined)
    return (
      <section className="credential-page" aria-busy="true">
        {title}
        <Skeleton variant="text" />
      </section>
    );
  if (credential === null)
    return (
      <section className="credential-page">
        {title}
        <p className="settings-empty">This table has no credential with that address.</p>
        <Button variant="secondary" onClick={onBack}>
          Back to Access
        </Button>
      </section>
    );

  const state = stateOf(credential);
  const [stateWords, tone] = STATE_WORDS[state];
  const live = !credential.revokedAt;
  return (
    <section className="credential-page" aria-labelledby="credential-title">
      <TitleLine crumb={<Crumb label="Access" onClick={onBack} />}>
        <h2 id="credential-title" className="credential-title">
          {credential.name}
        </h2>
      </TitleLine>
      <p className="credential-line">
        <Tag tone={tone}>{stateWords}</Tag>
        <span className="credential-scopes">
          {credential.scopes.map((scope) => (
            <code key={scope}>{scope}</code>
          ))}
        </span>
        <span>Created {when(credential.createdAt)}</span>
        <span>{credential.expiresAt ? `Expires ${when(credential.expiresAt)}` : "Never expires"}</span>
      </p>
      <Group className="settings-panel credential-actions">
        <SettingRow
          setting={{
            id: "credentialRotate",
            section: "access",
            label: "Rotate",
            hint: "A new secret, shown once; the current one stops working now."
          }}
        >
          <Button variant="secondary" disabled={!live} onClick={() => void rotate(credential)}>
            Rotate
          </Button>
        </SettingRow>
        <SettingRow
          setting={{
            id: "credentialRevoke",
            section: "access",
            label: "Revoke",
            hint: "Every tool that uses it loses access now and for good."
          }}
        >
          <Button variant="destructive" disabled={!live} onClick={() => void revoke(credential)}>
            Revoke
          </Button>
        </SettingRow>
      </Group>
      <h3 className="credential-eyebrow">
        History <span className="credential-count">· {events?.length ?? 0}</span>
      </h3>
      {events === null ? (
        <Skeleton variant="text" />
      ) : events.length === 0 ? (
        <p className="settings-empty">Nothing has happened to this credential yet.</p>
      ) : (
        <ol className="credential-history" aria-label="History">
          {events.map((event) => (
            <li
              key={event.id}
              className={`credential-event${event.type === "verification_failed" ? " is-refused" : ""}`}
            >
              <span className="credential-event-text">
                <b>{AUDIT_WORDS[event.type]}</b>
                {detailOf(event) && <span>{detailOf(event)}</span>}
              </span>
              <span className="credential-event-when">{when(event.occurredAt)}</span>
            </li>
          ))}
        </ol>
      )}
      {dialogs}
    </section>
  );
}
