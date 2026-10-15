import { useCallback, useEffect, useRef, useState } from "react";
import {
  IntegrationScopeSchema,
  type CredentialAuditEvent,
  type IntegrationCredentialMetadata,
  type IntegrationScope
} from "@vtt/api-contract";
import { Button, Eyebrow, IconPlug, Input, useToast } from "@vtt/ui";
import { ApiReference } from "./ApiReference";
import { useConfirm } from "../components/feedback";
import { apiRequest } from "../lib/api";
import "./integrations-panel.css";

const SCOPES = IntegrationScopeSchema.options;
const CREDENTIALS = "/api/v1/gm/integration-credentials";
type Issued = Readonly<{ credential: IntegrationCredentialMetadata; token: string }>;

function formatTimestamp(value: string | null) {
  return <span className="tabular">{value ? new Date(value).toLocaleString() : "-"}</span>;
}

export function IntegrationsPanel({ gmToken }: { gmToken: string }) {
  const [credentials, setCredentials] = useState<IntegrationCredentialMetadata[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<IntegrationScope>>(new Set());
  const [expiresAt, setExpiresAt] = useState("");
  const [issued, setIssued] = useState<{ name: string; token: string; rotated: boolean } | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<CredentialAuditEvent[]>([]);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const fail = useCallback((error: unknown) => toast((error as Error).message, { tone: "error" }), [toast]);
  /* The empty state's door focuses the name field on this screen (via a ref: `scrollIntoView` alone
     leaves no caret). */
  const nameField = useRef<HTMLInputElement>(null);
  const startCredential = () => {
    nameField.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    nameField.current?.focus();
  };

  const loadCredentials = useCallback(() => {
    apiRequest<{ credentials: IntegrationCredentialMetadata[] }>(CREDENTIALS, { token: gmToken })
      .then((data) => setCredentials(data.credentials))
      .catch(fail);
  }, [gmToken, fail]);
  useEffect(loadCredentials, [loadCredentials]);

  const toggleScope = (scope: IntegrationScope) => {
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const createCredential = async (event: React.FormEvent) => {
    event.preventDefault();
    if (scopes.size === 0) return toast("Select at least one scope.", { tone: "error" });
    try {
      const data = await apiRequest<Issued>(CREDENTIALS, {
        token: gmToken,
        // No gameId: nothing verifies game-bound credentials yet, so binding one would make it permanently
        // unusable. The field stays out of the UI until that exists.
        body: {
          name,
          scopes: [...scopes],
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
        }
      });
      setIssued({ name: data.credential.name, token: data.token, rotated: false });
      setCopyConfirmed(false);
      setName("");
      setScopes(new Set());
      setExpiresAt("");
      loadCredentials();
    } catch (error) {
      fail(error);
    }
  };

  const rotate = async (credential: IntegrationCredentialMetadata) => {
    if (
      !(await confirm({
        title: "Rotate credential?",
        body: `Rotate "${credential.name}"? The current secret stops working immediately, and every integration using it must switch to the new one.`,
        confirmLabel: "Rotate",
        danger: true
      }))
    )
      return;
    try {
      const data = await apiRequest<Issued>(`${CREDENTIALS}/${credential.id}/rotate`, { token: gmToken, body: {} });
      setIssued({ name: credential.name, token: data.token, rotated: true });
      setCopyConfirmed(false);
      loadCredentials();
    } catch (error) {
      fail(error);
    }
  };

  const revoke = async (credential: IntegrationCredentialMetadata) => {
    if (
      !(await confirm({
        title: "Revoke credential?",
        body: `Revoke "${credential.name}"? Access is denied immediately and cannot be undone; issue a new credential if it is needed again.`,
        confirmLabel: "Revoke",
        danger: true
      }))
    )
      return;
    try {
      await apiRequest(`${CREDENTIALS}/${credential.id}/revoke`, { token: gmToken, method: "POST" });
      toast(`"${credential.name}" revoked.`, { tone: "success" });
      loadCredentials();
    } catch (error) {
      fail(error);
    }
  };

  const viewAudit = async (credential: IntegrationCredentialMetadata) => {
    if (auditFor === credential.id) {
      setAuditFor(null);
      return;
    }
    try {
      const data = await apiRequest<{ events: CredentialAuditEvent[] }>(`${CREDENTIALS}/${credential.id}/audit`, {
        token: gmToken
      });
      setAuditEvents(data.events);
      setAuditFor(credential.id);
    } catch (error) {
      fail(error);
    }
  };

  const copyToken = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopyConfirmed(true);
    } catch {
      toast("Could not copy automatically; select and copy the secret manually.", { tone: "error" });
    }
  };

  const dismissIssued = () => {
    setIssued(null);
    setCopyConfirmed(false);
  };

  return (
    <section className="integrations" aria-labelledby="integrations-heading">
      <div className="roster-heading">
        <div>
          <Eyebrow>GM INTEGRATIONS</Eyebrow>
          <h2 id="integrations-heading">Scoped API credentials.</h2>
        </div>
        <p>
          Issue least-privilege credentials for bots, overlays, and external tools. Secrets are shown once and stored
          only as a salted hash.
        </p>
      </div>
      {issued && (
        <div className="notice integration-secret" role="alertdialog" aria-labelledby="integration-secret-heading">
          <strong id="integration-secret-heading">
            {issued.rotated ? `New secret for "${issued.name}"` : `Secret for "${issued.name}"`}
          </strong>
          <p>This is the only time this secret will be shown. Copy it now - the server cannot redisplay it.</p>
          <code className="integration-token">{issued.token}</code>
          <div className="integration-secret-actions">
            <Button variant="primary" onClick={copyToken}>
              {copyConfirmed ? "Copied" : "Copy secret"}
            </Button>
            <Button variant="secondary" onClick={dismissIssued}>
              {copyConfirmed ? "Done" : "I have saved it elsewhere - dismiss"}
            </Button>
          </div>
          {!copyConfirmed && (
            <p className="integration-secret-warning">
              You have not confirmed a copy yet. Dismissing without saving this secret means it is lost for good.
            </p>
          )}
        </div>
      )}
      <form className="integration-form" onSubmit={createCredential}>
        <label>
          Name
          <Input
            ref={nameField}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Stream overlay"
            required
            maxLength={100}
          />
        </label>
        <fieldset>
          <legend>Scopes</legend>
          {SCOPES.map((scope) => (
            <label key={scope} className="integration-scope">
              <input type="checkbox" checked={scopes.has(scope)} onChange={() => toggleScope(scope)} />
              {scope}
            </label>
          ))}
        </fieldset>
        <label>
          Expires (optional)
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
        <Button type="submit" variant="primary">
          Create credential
        </Button>
      </form>
      {/* The empty state names the next thing to do and offers the door to it. */}
      {credentials.length === 0 ? (
        <div className="nh-empty">
          <span className="nh-empty-icon" aria-hidden="true">
            <IconPlug />
          </span>
          <span className="nh-empty-title">Issue your first credential</span>
          <span className="nh-empty-text">
            A scoped credential lets a stream overlay or another tool read from this game. Name it, pick what it may
            reach, and create it — the secret is shown once.
          </span>
          <Button variant="primary" onClick={startCredential}>
            Name a credential
          </Button>
        </div>
      ) : (
        <ul className="integration-list">
          {credentials.map((credential) => (
            <li key={credential.id} className="integration-row">
              <div className="integration-row-heading">
                <strong>{credential.name}</strong>
                <span>
                  {credential.revokedAt
                    ? "Revoked"
                    : credential.expiresAt && new Date(credential.expiresAt) <= new Date()
                      ? "Expired"
                      : "Active"}
                </span>
              </div>
              <p className="integration-scopes">
                {credential.scopes.join(", ")}
                {credential.gameId && ` · game ${credential.gameId}`}
              </p>
              <dl className="integration-meta">
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(credential.createdAt)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{formatTimestamp(credential.expiresAt)}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{formatTimestamp(credential.lastUsedAt)}</dd>
                </div>
                <div>
                  <dt>Revoked</dt>
                  <dd>{formatTimestamp(credential.revokedAt)}</dd>
                </div>
              </dl>
              <div className="integration-row-actions">
                <Button variant="secondary" disabled={!!credential.revokedAt} onClick={() => rotate(credential)}>
                  Rotate
                </Button>
                <Button variant="destructive" disabled={!!credential.revokedAt} onClick={() => revoke(credential)}>
                  Revoke
                </Button>
                <Button variant="ghost" onClick={() => viewAudit(credential)}>
                  {auditFor === credential.id ? "Hide audit history" : "View audit history"}
                </Button>
              </div>
              {auditFor === credential.id && (
                <ul className="integration-audit">
                  {auditEvents.map((event) => (
                    <li key={event.id}>
                      {formatTimestamp(event.occurredAt)} - {event.type}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <ApiReference gmToken={gmToken} />
      {dialog}
    </section>
  );
}
