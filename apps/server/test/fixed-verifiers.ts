import type { IntegrationScope } from "@vtt/api-contract";
import type { CredentialVerifiers, IntegrationVerdict } from "../src/request-auth.js";

/** Credential checks that accept fixed tokens, for router tests that run without the auth service. */
export function fixedVerifiers(
  tokens: Readonly<{
    gm?: readonly string[];
    player?: readonly string[];
    /** Player tokens that are the GM's preview, each reading as the characters listed (none: as everyone). */
    previews?: Readonly<Record<string, readonly string[]>>;
    integration?: (token: string, scope: IntegrationScope | null | "any") => IntegrationVerdict | null;
    viewer?: readonly string[] | ((token: string) => boolean);
  }>
): Required<CredentialVerifiers> {
  const viewer = tokens.viewer;
  const previews = tokens.previews ?? {};
  return {
    gm: (token) => (tokens.gm?.includes(token) ? { sessionId: `gm:${token}` } : null),
    player: (token) => {
      if (Object.hasOwn(previews, token))
        return { sessionId: `player:${token}`, preview: { characterIds: previews[token]! } };
      return tokens.player?.includes(token) ? { sessionId: `player:${token}` } : null;
    },
    integration: (token, scope) => tokens.integration?.(token, scope) ?? null,
    viewer: (token) => (typeof viewer === "function" ? viewer(token) : (viewer?.includes(token) ?? false))
  };
}

/** One credential per scope, named `int-<scope>`, so a router that ignored the scope would fail. */
export const credentialPerScope = (token: string, scope: IntegrationScope | null | "any"): IntegrationVerdict | null =>
  token.startsWith("int-")
    ? { id: "cred-1", name: "overlay", inScope: scope === "any" || token === `int-${scope}` }
    : null;
