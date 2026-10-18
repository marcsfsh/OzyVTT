import { useCallback, useEffect, useState } from "react";
import {
  IntegrationScopeSchema,
  type CredentialAuditEvent,
  type IntegrationCredentialMetadata,
  type IntegrationScope
} from "@vtt/api-contract";
import { Badge, Button, IconPlug, Input, Menu, MenuItem, Modal, Switch, useToast, type BadgeTone } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { apiRequest } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import "./integrations-panel.css";

const SCOPES = IntegrationScopeSchema.options;
const CREDENTIALS = "/api/v1/gm/integration-credentials";
type Issued = Readonly<{ credential: IntegrationCredentialMetadata; token: string }>;

const AUDIT_WORDS: Readonly<Record<CredentialAuditEvent["type"], string>> = {
  created: "Created",
  used: "Used",
  verification_failed: "Refused a wrong secret",
  rotated: "Rotated",
  revoked: "Revoked"
};

export type CredentialState = "active" | "expired" | "revoked";
export const stateOf = (credential: IntegrationCredentialMetadata, now = new Date()): CredentialState =>
  credential.revokedAt
    ? "revoked"
    : credential.expiresAt && new Date(credential.expiresAt) <= now
      ? "expired"
      : "active";
const STATE_WORDS: Readonly<Record<CredentialState, [string, BadgeTone]>> = {
  active: ["Active", "info"],
  expired: ["Expired", "caution"],
  revoked: ["Revoked", "danger"]
};

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : "Never");

/**
 * The integration credentials as a table: name, scopes, state, last use and expiry, with Rotate, Revoke and History
 * on each row. New credential (the Access section's primary, placed by the caller) opens a dialog; a new or rotated
 * secret is shown once, in a dialog that keeps it until the GM has copied it or says it is saved. On a phone the
 * table is a list with the name and state, and the row's actions sit in a menu.
 */
export function CredentialsTable({
  gmToken,
  creating,
  onCreatingChange
}: Readonly<{ gmToken: string; creating: boolean; onCreatingChange: (open: boolean) => void }>) {
  const [credentials, setCredentials] = useState<readonly IntegrationCredentialMetadata[] | null>(null);
  const [issued, setIssued] = useState<{ name: string; token: string; rotated: boolean } | null>(null);
  const [history, setHistory] = useState<{
    credential: IntegrationCredentialMetadata;
    events: readonly CredentialAuditEvent[];
  } | null>(null);
  const phone = useMediaQuery("(max-width: 650px)");
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const fail = useCallback((error: unknown) => toast((error as Error).message, { tone: "error" }), [toast]);

  const load = useCallback(() => {
    apiRequest<{ credentials: IntegrationCredentialMetadata[] }>(CREDENTIALS, { token: gmToken })
      .then((data) => setCredentials(data.credentials))
      .catch(fail);
  }, [gmToken, fail]);
  useEffect(load, [load]);

  const rotate = async (credential: IntegrationCredentialMetadata) => {
    const ok = await confirm({
      title: `Rotate ${credential.name}?`,
      body: "The current secret stops working now. Every tool that uses it needs the new one.",
      confirmLabel: "Rotate",
      danger: true
    });
    if (!ok) return;
    try {
      const data = await apiRequest<Issued>(`${CREDENTIALS}/${credential.id}/rotate`, { token: gmToken, body: {} });
      setIssued({ name: credential.name, token: data.token, rotated: true });
      load();
    } catch (error) {
      fail(error);
    }
  };

  const revoke = async (credential: IntegrationCredentialMetadata) => {
    const ok = await confirm({
      title: `Revoke ${credential.name}?`,
      body: "Every tool that uses it loses access now, and a revoked credential can't be used again. Create a new one if a tool needs access later.",
      confirmLabel: "Revoke",
      danger: true
    });
    if (!ok) return;
    try {
      await apiRequest(`${CREDENTIALS}/${credential.id}/revoke`, { token: gmToken, method: "POST" });
      toast(`${credential.name} is revoked.`, { tone: "success" });
      load();
    } catch (error) {
      fail(error);
    }
  };

  const showHistory = async (credential: IntegrationCredentialMetadata) => {
    try {
      const data = await apiRequest<{ events: CredentialAuditEvent[] }>(`${CREDENTIALS}/${credential.id}/audit`, {
        token: gmToken
      });
      setHistory({ credential, events: data.events });
    } catch (error) {
      fail(error);
    }
  };

  const stateBadge = (credential: IntegrationCredentialMetadata) => {
    const [words, tone] = STATE_WORDS[stateOf(credential)];
    return <Badge tone={tone}>{words}</Badge>;
  };
  const rowActions = (credential: IntegrationCredentialMetadata) => {
    const live = !credential.revokedAt;
    return phone ? (
      <Menu align="end" trigger="Actions" label={`Actions for ${credential.name}`}>
        <MenuItem disabled={!live} onClick={() => void rotate(credential)}>
          Rotate
        </MenuItem>
        <MenuItem disabled={!live} tone="danger" onClick={() => void revoke(credential)}>
          Revoke
        </MenuItem>
        <MenuItem onClick={() => void showHistory(credential)}>History</MenuItem>
      </Menu>
    ) : (
      <>
        <Button size="sm" variant="secondary" disabled={!live} onClick={() => void rotate(credential)}>
          Rotate
        </Button>
        <Button size="sm" variant="destructive" disabled={!live} onClick={() => void revoke(credential)}>
          Revoke
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void showHistory(credential)}>
          History
        </Button>
      </>
    );
  };

  return (
    <div className="credentials">
      {credentials === null ? null : credentials.length === 0 ? (
        <div className="nh-empty credentials-empty">
          <span className="nh-empty-icon" aria-hidden="true">
            <IconPlug />
          </span>
          <span className="nh-empty-title">No credentials yet</span>
          <span className="nh-empty-text">
            Use New credential to name one and pick what it may reach. Its secret is shown once, when you create it.
          </span>
        </div>
      ) : phone ? (
        <ul className="settings-list" aria-label="Integration credentials">
          {credentials.map((credential) => (
            <li key={credential.id} className="settings-list-row">
              <span className="settings-list-text">
                <b>{credential.name}</b>
                <span>
                  {STATE_WORDS[stateOf(credential)][0]} · Last used {when(credential.lastUsedAt).toLowerCase()}
                </span>
              </span>
              {rowActions(credential)}
            </li>
          ))}
        </ul>
      ) : (
        <table className="settings-table credentials-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Scopes</th>
              <th scope="col">State</th>
              <th scope="col">Last used</th>
              <th scope="col">Expires</th>
              <th scope="col">
                <span className="nh-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr key={credential.id}>
                <td>
                  <b>{credential.name}</b>
                </td>
                <td className="credentials-scopes">
                  {credential.scopes.map((scope) => (
                    <code key={scope}>{scope}</code>
                  ))}
                </td>
                <td>{stateBadge(credential)}</td>
                <td className="tabular">{when(credential.lastUsedAt)}</td>
                <td className="tabular">{when(credential.expiresAt)}</td>
                <td className="settings-cell-actions">{rowActions(credential)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <NewCredentialDialog
          gmToken={gmToken}
          onClose={() => onCreatingChange(false)}
          onCreated={(data) => {
            onCreatingChange(false);
            setIssued({ name: data.credential.name, token: data.token, rotated: false });
            load();
          }}
        />
      )}
      {issued && <SecretDialog issued={issued} onDone={() => setIssued(null)} />}
      {history && (
        <Modal
          open
          size="md"
          title={`${history.credential.name} · History`}
          ariaLabel={`History of ${history.credential.name}`}
          onClose={() => setHistory(null)}
        >
          <dl className="credentials-facts">
            <div>
              <dt>Created</dt>
              <dd className="tabular">{when(history.credential.createdAt)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd className="tabular">{when(history.credential.expiresAt)}</dd>
            </div>
            <div>
              <dt>Revoked</dt>
              <dd className="tabular">{when(history.credential.revokedAt)}</dd>
            </div>
          </dl>
          {history.events.length === 0 ? (
            <p className="settings-empty">Nothing has happened to this credential yet.</p>
          ) : (
            <table className="settings-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {history.events.map((event) => (
                  <tr key={event.id}>
                    <td className="tabular">{when(event.occurredAt)}</td>
                    <td>{AUDIT_WORDS[event.type]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
      {dialog}
    </div>
  );
}

/** Naming a credential, picking its scopes and an optional expiry. */
function NewCredentialDialog({
  gmToken,
  onClose,
  onCreated
}: Readonly<{ gmToken: string; onClose: () => void; onCreated: (issued: Issued) => void }>) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<IntegrationScope>>(new Set());
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const ready = name.trim().length > 0 && scopes.size > 0;
  const toggle = (scope: IntegrationScope, on: boolean) =>
    setScopes((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      // No gameId: nothing verifies game-bound credentials yet, so binding one would make it permanently unusable.
      const data = await apiRequest<Issued>(CREDENTIALS, {
        token: gmToken,
        body: {
          name: name.trim(),
          scopes: [...scopes],
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
        }
      });
      onCreated(data);
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      size="md"
      title="New credential"
      ariaLabel="New credential"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || saving} onClick={() => void submit()}>
            {saving ? "Creating…" : "Create credential"}
          </Button>
        </>
      }
    >
      <form
        className="credentials-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Name
          <Input
            value={name}
            maxLength={100}
            placeholder="Stream overlay"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>What it may reach</legend>
          <p className="settings-note">Pick the fewest scopes the tool needs. Pick at least one.</p>
          <div className="credentials-scope-grid">
            {SCOPES.map((scope) => (
              <Switch key={scope} checked={scopes.has(scope)} onChange={(on) => toggle(scope, on)} label={scope} />
            ))}
          </div>
        </fieldset>
        <label>
          Expires (leave empty for never)
          <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
        {/* Enter submits from the name field. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** A new or rotated secret, shown this once, with a warning until it has been copied. */
function SecretDialog({
  issued,
  onDone
}: Readonly<{ issued: { name: string; token: string; rotated: boolean }; onDone: () => void }>) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      toast("The browser blocked the copy. Select the secret and copy it yourself.", { tone: "error" });
    }
  };
  return (
    <Modal
      open
      size="md"
      accent="cyan"
      title={issued.rotated ? `New secret for ${issued.name}` : `Secret for ${issued.name}`}
      ariaLabel={issued.rotated ? `New secret for ${issued.name}` : `Secret for ${issued.name}`}
      onClose={onDone}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            {copied ? "Done" : "I saved it elsewhere"}
          </Button>
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy secret"}
          </Button>
        </>
      }
    >
      <p>This is the only time the secret is shown. The server keeps only a salted hash of it.</p>
      <code className="integration-token">{issued.token}</code>
      {!copied && (
        <p className="integration-secret-warning" role="note">
          Copy it now. Once this closes, the secret is gone for good.
        </p>
      )}
    </Modal>
  );
}
