import { useEffect, useSyncExternalStore } from "react";
import type { IntegrationCredentialMetadata } from "@vtt/api-contract";
import { apiRequest } from "../lib/api";

const CREDENTIALS = "/api/v1/gm/integration-credentials";

/** How many credentials are active, as the credentials' table last read them; null until something has. */
let active: number | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Neither revoked nor past its expiry. */
const isActive = (credential: IntegrationCredentialMetadata, now: Date) =>
  !credential.revokedAt && !(credential.expiresAt && new Date(credential.expiresAt) <= now);

/** The credentials' table calls this after every read, so Settings' line for Access follows it. */
export function publishCredentials(credentials: readonly IntegrationCredentialMetadata[]): void {
  const now = new Date();
  active = credentials.filter((credential) => isActive(credential, now)).length;
  for (const listener of [...listeners]) listener();
}

/** The active count for Settings' line, read once when nothing has read the credentials yet. */
export function useActiveCredentialCount(gmToken: string | null): number | null {
  const count = useSyncExternalStore(
    subscribe,
    () => active,
    () => active
  );
  useEffect(() => {
    if (!gmToken || active !== null) return;
    apiRequest<{ credentials: IntegrationCredentialMetadata[] }>(CREDENTIALS, { token: gmToken })
      .then((data) => publishCredentials(data.credentials))
      .catch(() => undefined);
  }, [gmToken]);
  return count;
}
