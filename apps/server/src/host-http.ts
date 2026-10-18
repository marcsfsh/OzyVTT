import express from "express";
import { hostRoutes as routes } from "@vtt/api-contract/routes";
import type { AuthService } from "./auth.js";
import { mount, sendData, sendFailure } from "./http-kit.js";
import type { LoginRateLimiter } from "./login-rate-limit.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";

export type HostRouterOptions = Readonly<{
  auth: AuthService;
  verifiers: CredentialVerifiers;
  loginLimiter: LoginRateLimiter;
  /** Whether a request came from the host machine itself, where the first GM password is set. */
  isLoopback: (ip: string | undefined) => boolean;
  /** Tells connected clients their projection changed after a GM session ends. */
  broadcast: () => void;
  /** Runs once the GM password is set. A new password brings a new token secret, so no older session verifies. */
  onBootstrapped?: () => Promise<void>;
  /** The addresses this host serves the app on: `http://localhost:<port>` first, then one per LAN interface. */
  viewerBaseUrls?: readonly string[];
  /** Where the first GM password is set, when opening the localhost address on the host is not the way (Docker). */
  gmSetupHint?: string;
  /** How long after a password change the other GM devices are told their session ended, so the device that made
   *  the change can move its socket to the new token first. */
  passwordChangeGraceMs?: number;
}>;

const isLocalhost = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

/** The host's own GM account: first-run password setup, sign-in and sign-out, the password, and the addresses the
 *  host is reachable on. Not reachable with an integration credential: these act on the GM account itself. */
export function createHostRouter(options: HostRouterOptions) {
  const { auth, loginLimiter } = options;
  const router = express.Router();
  const baseUrls = [...new Set((options.viewerBaseUrls ?? []).map((url) => url.replace(/\/$/, "")))];
  const hostUrl = baseUrls.find(isLocalhost) ?? "http://localhost:3001";
  /** Refuses a locked-out address with 429 and Retry-After; true when the attempt may go ahead. */
  const withinAttempts = (key: string, response: express.Response) => {
    const decision = loginLimiter.check(key);
    if (decision.allowed) return true;
    response.set("Retry-After", String(decision.retryAfterSeconds));
    sendFailure(response, 429, "rate_limited", "Too many attempts. Try again later.");
    return false;
  };

  mount(router, routes.getHostSetup, (_request, response) =>
    sendData(response, 200, { bootstrapped: auth.isBootstrapped })
  );

  mount(router, routes.setGmPassword, async (request, response) => {
    if (!options.isLoopback(request.ip))
      return sendFailure(
        response,
        403,
        "forbidden",
        options.gmSetupHint ?? `Set the GM password on the computer that runs OzyVTT. Open ${hostUrl} there.`
      );
    const body = routes.setGmPassword.body.schema.safeParse(request.body);
    if (!body.success)
      return sendFailure(response, 400, "validation_failed", "Use a GM password of at least 12 characters.");
    try {
      await auth.bootstrap(body.data.password);
      await options.onBootstrapped?.();
      return sendData(response, 201, { bootstrapped: true });
    } catch (error) {
      return sendFailure(response, 409, "conflict", (error as Error).message);
    }
  });

  mount(router, routes.signInGm, async (request, response) => {
    const key = request.ip ?? "unknown";
    if (!withinAttempts(key, response)) return;
    const body = routes.signInGm.body.schema.safeParse(request.body);
    const token = body.success ? await auth.login(body.data.password) : null;
    if (!token) {
      loginLimiter.recordFailure(key);
      return body.success
        ? sendFailure(response, 401, "unauthenticated", "That is not the GM password. Check it and try again.")
        : sendFailure(response, 400, "validation_failed", "Password is required.");
    }
    loginLimiter.recordSuccess(key);
    return sendData(response, 200, { token });
  });

  mount(router, routes.signOutGm, async (request, response) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind !== "gm") return refuse(response, caller, "Only a GM session signs out here.");
    await auth.logout(caller.token);
    options.broadcast();
    return sendData(response, 200, { signedOut: true });
  });

  mount(router, routes.revokeAllGmSessions, async (request, response) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind !== "gm") return refuse(response, caller, "Only a GM session ends the GM sessions.");
    await auth.revokeAllGmSessions();
    options.broadcast();
    return sendData(response, 200, { revoked: true });
  });

  // Counted with sign-in attempts, so a stolen GM session can't become a way to guess the password.
  mount(router, routes.changeGmPassword, async (request, response) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind !== "gm") return refuse(response, caller, "Only a GM session changes the GM password.");
    const key = request.ip ?? "unknown";
    if (!withinAttempts(key, response)) return;
    const body = routes.changeGmPassword.body.schema.safeParse(request.body);
    if (!body.success)
      return sendFailure(response, 400, "validation_failed", "Use a new GM password of at least 12 characters.");
    const token = await auth.changePassword(body.data.currentPassword, body.data.newPassword);
    if (!token) {
      loginLimiter.recordFailure(key);
      return sendFailure(
        response,
        400,
        "validation_failed",
        "That is not the current password. Check it and try again."
      );
    }
    loginLimiter.recordSuccess(key);
    // Every older GM session ended with the change. The other devices hear it after the grace.
    setTimeout(() => options.broadcast(), options.passwordChangeGraceMs ?? 5_000).unref?.();
    return sendData(response, 200, { token });
  });

  mount(router, routes.listViewerUrls, (request, response) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind !== "gm") return refuse(response, caller, "The table screen addresses are for the GM.");
    return sendData(response, 200, { viewerUrls: baseUrls.map((url) => `${url}/viewer.html`) });
  });

  // The addresses players open on the home network. A localhost address works only on this computer, so it is left
  // out; `hostUrl` is there for the case with no network address at all.
  mount(router, routes.listJoinUrls, (request, response) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind !== "gm") return refuse(response, caller, "The join addresses are for the GM.");
    return sendData(response, 200, { joinUrls: baseUrls.filter((url) => !isLocalhost(url)), hostUrl });
  });

  return router;
}
