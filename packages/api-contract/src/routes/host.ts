import { HOST_PATHS } from "../index.js";
import {
  GmPasswordChangeRequestSchema,
  GmRevokeAllSchema,
  GmSignInRequestSchema,
  GmSignInSchema,
  GmSignOutSchema,
  HostSetupRequestSchema,
  HostSetupSchema,
  JoinUrlsSchema,
  ViewerUrlsSchema
} from "../schemas/host.js";
import { named } from "./components.js";
import { defineRoute, GM_SESSION, json, ok, PUBLIC, refused } from "./define.js";

/**
 * The GM account on the computer that runs OzyVTT (`host-http.ts`). These routes act on the account itself, so no
 * integration credential reaches them, and they send no CORS headers.
 */

named("HostSetup", HostSetupSchema);
named("HostSetupRequest", HostSetupRequestSchema);
named("GmSignInRequest", GmSignInRequestSchema);
named("GmPasswordChangeRequest", GmPasswordChangeRequestSchema);
named("GmSignIn", GmSignInSchema);
named("GmSignOut", GmSignOutSchema);
named("GmRevokeAll", GmRevokeAllSchema);
named("JoinUrls", JoinUrlsSchema);
named("ViewerUrls", ViewerUrlsSchema);

const RATE_LIMITED =
  "Too many failed attempts from this address. `Retry-After` says how many seconds to wait before the next one.";

export const getHostSetup = defineRoute({
  method: "get",
  path: HOST_PATHS.setup,
  operationId: "getHostSetup",
  tag: "Host",
  summary: "Read whether the GM password is set",
  access: PUBLIC,
  responses: { 200: ok(HostSetupSchema, "Whether the GM password is set.", { example: { bootstrapped: true } }) }
});

export const setGmPassword = defineRoute({
  method: "post",
  path: HOST_PATHS.setup,
  operationId: "setGmPassword",
  tag: "Host",
  summary: "Set the first GM password",
  description:
    "Sets the GM password, at least 12 characters, on a host that has none. Only a request from the host computer itself is accepted, and only once.",
  access: PUBLIC,
  body: json(HostSetupRequestSchema),
  responses: {
    201: ok(HostSetupSchema, "The password is set."),
    400: refused(),
    403: refused("The request did not come from the host computer."),
    409: refused("A GM password is already set.")
  }
});

export const signInGm = defineRoute({
  method: "post",
  path: HOST_PATHS.gmSignIn,
  operationId: "signInGm",
  tag: "Host",
  summary: "Sign in as the GM",
  description:
    "Exchanges the GM password for a GM session token that lasts 12 hours. Failed attempts from one address are counted, and too many are refused for a while.",
  access: PUBLIC,
  body: json(GmSignInRequestSchema),
  responses: {
    200: ok(GmSignInSchema, "A GM session token."),
    400: refused(),
    401: refused("The password is wrong."),
    429: refused(RATE_LIMITED)
  }
});

export const signOutGm = defineRoute({
  method: "post",
  path: HOST_PATHS.gmSignOut,
  operationId: "signOutGm",
  tag: "Host",
  summary: "End this GM session",
  description: "Revokes the GM session that sends it. The GM's other sessions stay signed in.",
  access: GM_SESSION,
  responses: {
    200: ok(GmSignOutSchema, "The session has ended."),
    401: refused(),
    403: refused()
  }
});

export const revokeAllGmSessions = defineRoute({
  method: "post",
  path: HOST_PATHS.gmRevokeAll,
  operationId: "revokeAllGmSessions",
  tag: "Host",
  summary: "End every GM session",
  description: "Revokes every GM session, this one included. Each GM device must sign in again.",
  access: GM_SESSION,
  responses: {
    200: ok(GmRevokeAllSchema, "Every GM session has ended."),
    401: refused(),
    403: refused()
  }
});

export const changeGmPassword = defineRoute({
  method: "post",
  path: HOST_PATHS.gmPassword,
  operationId: "changeGmPassword",
  tag: "Host",
  summary: "Change the GM password",
  description:
    "Checks the current password and sets a new one of at least 12 characters. Every GM session issued before the change ends, and the answer carries a new token for the caller. A wrong current password counts toward the sign-in limit.",
  access: GM_SESSION,
  body: json(GmPasswordChangeRequestSchema),
  responses: {
    200: ok(GmSignInSchema, "The password is changed. The new GM session token."),
    400: refused("A malformed body or a new password under 12 characters. A wrong current password is a 400 too."),
    401: refused(),
    403: refused(),
    429: refused(RATE_LIMITED)
  }
});

export const listJoinUrls = defineRoute({
  method: "get",
  path: HOST_PATHS.joinUrls,
  operationId: "listJoinUrls",
  tag: "Host",
  summary: "List the addresses players join at",
  description:
    "The addresses players open on the home network, one per network interface, and the host's own localhost address for a host with no network address.",
  access: GM_SESSION,
  responses: {
    200: ok(JoinUrlsSchema, "The join addresses."),
    401: refused(),
    403: refused()
  }
});

export const listViewerUrls = defineRoute({
  method: "get",
  path: HOST_PATHS.viewerUrls,
  operationId: "listViewerUrls",
  tag: "Host",
  summary: "List the addresses a table screen opens",
  description: "The table screen's address on each address the host serves, the localhost one first.",
  access: GM_SESSION,
  responses: {
    200: ok(ViewerUrlsSchema, "The table screen's addresses."),
    401: refused(),
    403: refused()
  }
});

export const HOST_ROUTES = [
  getHostSetup,
  setGmPassword,
  signInGm,
  signOutGm,
  revokeAllGmSessions,
  changeGmPassword,
  listJoinUrls,
  listViewerUrls
] as const;
