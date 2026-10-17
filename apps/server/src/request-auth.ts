import type { Request, Response } from "express";
import { VIEWER_SESSION_COOKIE, type IntegrationScope } from "@vtt/api-contract";
import { bearerToken, cookie, sendFailure } from "./http-kit.js";

/**
 * Who sent a request, and the one rule for refusing them (ADR-0026). Every HTTP router and the socket handshake
 * read the caller here, so a credential gets the same answer everywhere:
 *
 * - 401 `unauthenticated` when there is no credential, or the one presented is malformed, expired or revoked. The
 *   caller has to sign in (or pair, or mint a new credential) before anything else helps.
 * - 403 `forbidden` only for a valid credential whose role or scope does not reach the route.
 *
 * The role comes from the credential alone: a GM session, a player session, a GM-minted integration credential or a
 * paired table screen's viewer credential.
 */

/** An integration credential that verified, and whether it carries the scope the route asked for. */
export type IntegrationVerdict = Readonly<{ id: string; name: string; inScope: boolean }>;

/** How a server checks each kind of credential. A kind a router leaves out is not accepted there. */
export type CredentialVerifiers = Readonly<{
  gm: (token: string) => Readonly<{ sessionId: string }> | null;
  player: (token: string) => Readonly<{ sessionId: string }> | null;
  /** Null when the token is not a live integration credential. `scope` is null on a route that takes none, so a
   *  valid credential there is out of scope; `any` asks only whether the credential is live. */
  integration?: (token: string, scope: IntegrationScope | null | "any") => IntegrationVerdict | null;
  /** A paired table screen's credential, from its cookie or a bearer header. */
  viewer?: (token: string) => boolean;
}>;

export type Caller =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "gm"; sessionId: string; token: string }>
  | Readonly<{ kind: "player"; sessionId: string; token: string }>
  | Readonly<{ kind: "integration"; id: string; name: string; inScope: boolean }>
  | Readonly<{ kind: "viewer"; token: string }>;

export type CallerNeeds = Readonly<{
  /** The integration scope the route accepts; omitted where integration credentials are not accepted. `any` counts
   *  every live credential, for a route that reads its real scope from the request and checks it next. */
  scope?: IntegrationScope | "any";
  /** Whether a table screen's viewer cookie counts on this route. */
  viewer?: boolean;
}>;

/** The caller a token names, checked GM, player, integration credential, then viewer credential. */
export function callerOfToken(token: string | undefined, verifiers: CredentialVerifiers, needs: CallerNeeds = {}) {
  // A socket handshake's token is whatever the client sent, not necessarily a string.
  if (typeof token !== "string" || token === "") return { kind: "none" } as const satisfies Caller;
  const gm = verifiers.gm(token);
  if (gm) return { kind: "gm", sessionId: gm.sessionId, token } as const satisfies Caller;
  const player = verifiers.player(token);
  if (player) return { kind: "player", sessionId: player.sessionId, token } as const satisfies Caller;
  const integration = verifiers.integration?.(token, needs.scope ?? null);
  if (integration)
    return {
      kind: "integration",
      id: integration.id,
      name: integration.name,
      inScope: needs.scope !== undefined && integration.inScope
    } as const satisfies Caller;
  if (verifiers.viewer?.(token)) return { kind: "viewer", token } as const satisfies Caller;
  return { kind: "invalid" } as const satisfies Caller;
}

/**
 * The request's caller. A bearer header wins over the viewer cookie, so a GM browser that also holds the preview's
 * viewer cookie is read as the GM, and a revoked GM token is refused even with that cookie present. Memoized per
 * request and need, because checking an integration credential writes its audit trail.
 */
export function callerOf(
  request: Request,
  response: Response,
  verifiers: CredentialVerifiers,
  needs: CallerNeeds = {}
): Caller {
  const key = `${needs.scope ?? ""}|${needs.viewer === true}`;
  const memo = (response.locals.callers ??= new Map<string, Caller>()) as Map<string, Caller>;
  const known = memo.get(key);
  if (known) return known;
  const bearer = bearerToken(request);
  const viewerCookie = needs.viewer ? cookie(request, VIEWER_SESSION_COOKIE) : undefined;
  const caller: Caller =
    bearer !== undefined
      ? callerOfToken(bearer, verifiers, needs)
      : viewerCookie !== undefined
        ? verifiers.viewer?.(viewerCookie)
          ? { kind: "viewer", token: viewerCookie }
          : { kind: "invalid" }
        : { kind: "none" };
  memo.set(key, caller);
  return caller;
}

/** Whether the caller acts with the GM's authority here: a GM session, or an integration credential in scope. */
export const isGmGradeCaller = (caller: Caller) =>
  caller.kind === "gm" || (caller.kind === "integration" && caller.inScope);

const NO_CREDENTIAL = "Sign in first. This needs a session or a credential.";
const DEAD_CREDENTIAL = "This session or credential is not valid any more. Sign in again.";

/** Whether the caller has to sign in before anything else helps: no credential, or a dead one. */
export const isUnauthenticated = (caller: Caller) => caller.kind === "none" || caller.kind === "invalid";

/**
 * Refuses a caller the route does not serve: 401 when they have no live credential, else 403 with `forbidden`, the
 * reason their valid credential does not reach this route.
 */
export function refuse(response: Response, caller: Caller, forbidden: string) {
  if (caller.kind === "none" || caller.kind === "invalid") return sendUnauthenticated(response, caller.kind);
  return sendFailure(response, 403, "forbidden", forbidden);
}

/** The 401: `none` when nothing was presented, `invalid` when the credential is dead. */
export function sendUnauthenticated(response: Response, why: "none" | "invalid") {
  return sendFailure(response, 401, "unauthenticated", why === "none" ? NO_CREDENTIAL : DEAD_CREDENTIAL);
}
