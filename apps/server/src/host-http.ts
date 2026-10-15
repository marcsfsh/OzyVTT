import express, { type Request } from "express";
import { z } from "zod";
import { HOST_PATHS } from "@vtt/api-contract";
import type { AuthService } from "./auth.js";
import { bearerToken, sendData, sendFailure } from "./http-kit.js";
import type { LoginRateLimiter } from "./login-rate-limit.js";

export type HostRouterOptions = Readonly<{
  auth: AuthService;
  loginLimiter: LoginRateLimiter;
  /** Whether a request came from the host machine itself, where the first GM password is set. */
  isLoopback: (ip: string | undefined) => boolean;
  /** Tells connected clients their projection changed after a GM session ends. */
  broadcast: () => void;
  viewerBaseUrls?: readonly string[];
}>;

const SetupSchema = z.object({ password: z.string().min(12).max(256) }).strict();
const SignInSchema = z.object({ password: z.string() }).strict();

/** The host's own GM account: first-run password setup, sign-in and sign-out. Not reachable with an
 *  integration credential: these act on the GM password and GM sessions themselves. */
export function createHostRouter(options: HostRouterOptions) {
  const { auth, loginLimiter } = options;
  const router = express.Router();
  const gmSession = (request: Request) => auth.verify(bearerToken(request));

  router.get(HOST_PATHS.setup, (_request, response) => sendData(response, 200, { bootstrapped: auth.isBootstrapped }));

  router.post(HOST_PATHS.setup, async (request, response) => {
    if (!options.isLoopback(request.ip))
      return sendFailure(response, 403, "forbidden", "Initial GM setup must be performed on the host machine.");
    const body = SetupSchema.safeParse(request.body);
    if (!body.success)
      return sendFailure(response, 400, "validation_failed", "Use a GM password of at least 12 characters.");
    try {
      await auth.bootstrap(body.data.password);
      return sendData(response, 201, { bootstrapped: true });
    } catch (error) {
      return sendFailure(response, 409, "conflict", (error as Error).message);
    }
  });

  router.post(HOST_PATHS.gmSignIn, async (request, response) => {
    const key = request.ip ?? "unknown";
    const decision = loginLimiter.check(key);
    if (!decision.allowed) {
      response.set("Retry-After", String(decision.retryAfterSeconds));
      return sendFailure(response, 429, "rate_limited", "Too many attempts. Try again later.");
    }
    const body = SignInSchema.safeParse(request.body);
    const token = body.success ? await auth.login(body.data.password) : null;
    if (!token) {
      loginLimiter.recordFailure(key);
      return body.success
        ? sendFailure(response, 401, "unauthenticated", "Invalid GM password.")
        : sendFailure(response, 400, "validation_failed", "Password is required.");
    }
    loginLimiter.recordSuccess(key);
    return sendData(response, 200, { token });
  });

  router.post(HOST_PATHS.gmSignOut, async (request, response) => {
    if (!(await auth.logout(bearerToken(request))))
      return sendFailure(response, 401, "unauthenticated", "A valid GM session is required to sign out.");
    options.broadcast();
    return sendData(response, 200, { signedOut: true });
  });

  router.post(HOST_PATHS.gmRevokeAll, async (request, response) => {
    if (!gmSession(request)) return sendFailure(response, 401, "unauthenticated", "A valid GM session is required.");
    await auth.revokeAllGmSessions();
    options.broadcast();
    return sendData(response, 200, { revoked: true });
  });

  router.get(HOST_PATHS.viewerUrls, (request, response) => {
    if (!gmSession(request)) return sendFailure(response, 401, "unauthenticated", "A valid GM session is required.");
    const viewerUrls = [
      ...new Set((options.viewerBaseUrls ?? []).map((url) => `${url.replace(/\/$/, "")}/viewer.html`))
    ];
    return sendData(response, 200, { viewerUrls });
  });

  return router;
}
