import { z } from "zod";

/** The host's own GM account (`host-http.ts`): first-run setup, sign-in, the password and the host's addresses. */

/** The fewest characters a GM password may have. */
export const MIN_GM_PASSWORD = 12;

export const HostSetupSchema = z.strictObject({ bootstrapped: z.boolean() });

export const HostSetupRequestSchema = z.object({ password: z.string().min(MIN_GM_PASSWORD).max(256) }).strict();

export const GmSignInRequestSchema = z.object({ password: z.string() }).strict();

export const GmPasswordChangeRequestSchema = z
  .object({ currentPassword: z.string().max(256), newPassword: z.string().min(MIN_GM_PASSWORD).max(256) })
  .strict();

export const GmSignInSchema = z.strictObject({ token: z.string() });

export const GmSignOutSchema = z.strictObject({ signedOut: z.literal(true) });

export const GmRevokeAllSchema = z.strictObject({ revoked: z.literal(true) });

export const JoinUrlsSchema = z.strictObject({ joinUrls: z.array(z.url()), hostUrl: z.url() });

export const ViewerUrlsSchema = z.strictObject({ viewerUrls: z.array(z.url()) });
