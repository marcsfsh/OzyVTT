import { useState } from "react";
import { Button, Input, Modal, Switch, useToast } from "@vtt/ui";
import { CredentialsTable } from "../integrations/CredentialsTable";
import { SETTING } from "./sections";
import { SettingRow, SettingsPrimary, SettingsSection } from "./SettingRow";

/**
 * Access: who can sign in as the GM and which tools can reach the table. Its one primary, New credential, sits in
 * the section bar.
 */
export function AccessSection({
  gmToken,
  busy,
  onSignOut,
  onRevokeAll,
  onChangePassword
}: Readonly<{
  gmToken: string;
  busy: boolean;
  onSignOut?: () => void;
  onRevokeAll: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}>) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  return (
    <SettingsSection id="access" gmOnly>
      <SettingsPrimary>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New credential
        </Button>
      </SettingsPrimary>
      <SettingRow setting={SETTING.gmPassword}>
        <Button variant="secondary" onClick={() => setPasswordOpen(true)} disabled={busy}>
          Change GM password
        </Button>
      </SettingRow>
      {onSignOut && (
        <SettingRow setting={SETTING.signOut}>
          <Button variant="secondary" onClick={onSignOut} disabled={busy}>
            Sign out
          </Button>
        </SettingRow>
      )}
      <SettingRow setting={SETTING.everyGmBrowser}>
        <Button variant="destructive" onClick={onRevokeAll} disabled={busy}>
          Sign out every GM browser
        </Button>
      </SettingRow>
      <SettingRow setting={SETTING.credentials} stacked>
        <CredentialsTable gmToken={gmToken} creating={creating} onCreatingChange={setCreating} />
      </SettingRow>
      {passwordOpen && (
        <ChangePasswordDialog onClose={() => setPasswordOpen(false)} onChangePassword={onChangePassword} />
      )}
    </SettingsSection>
  );
}

/** Changing the GM password: the current one, then the new one, each with Show. */
function ChangePasswordDialog({
  onClose,
  onChangePassword
}: Readonly<{
  onClose: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}>) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (next.length < 12) {
      setError("Use a new GM password of at least 12 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    const refusal = await onChangePassword(current, next);
    setSaving(false);
    if (refusal) {
      setError(refusal);
      return;
    }
    toast("GM password changed. Every other GM browser signs in again with the new one.", { tone: "success" });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Change GM password"
      ariaLabel="Change GM password"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || !current || !next} onClick={() => void submit()}>
            {saving ? "Changing…" : "Change password"}
          </Button>
        </>
      }
    >
      <form
        className="settings-password"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Current password
          <Input
            type={shown ? "text" : "password"}
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label>
          New password
          <Input
            type={shown ? "text" : "password"}
            value={next}
            autoComplete="new-password"
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <Switch checked={shown} onChange={setShown} label="Show the passwords" />
        <p className="settings-note">Use at least 12 characters.</p>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        {/* Enter submits from either field. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
