import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { API_VERSION, type ApiErrorCode } from "@vtt/api-contract";
import { InvalidRequestError } from "./invalid-request.js";

/**
 * The `/api/v1` conventions every router shares (ADR-0016): bearer tokens, request ids, the success and failure
 * envelopes, and how a caught error is answered. One copy, so the surfaces cannot drift apart.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuidV4 = (value: string) => UUID_V4.test(value);

/** The token in `Authorization: Bearer <token>`. Any other shape, a bare token included, is no token. */
export function bearerToken(request: Request): string | undefined {
  return request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}

/** One cookie's value; a cookie that is absent or does not decode is undefined. */
export function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.header("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The contract writes `{id}`; Express matches `:id`. */
export const expressPath = (path: string) => path.replace(/\{(\w+)\}/g, ":$1");

/** Express types a parameter `string | string[]`, but a named path segment is always one string. */
export function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}

/**
 * The request's id, stamped once: a caller's UUID v4 `x-request-id` is echoed and anything else replaced, so
 * caller text never reaches a body or a log. API answers are `no-store` so no shared cache keeps one.
 */
function requestIdOf(response: Response): string {
  if (typeof response.locals.requestId !== "string") {
    const supplied = response.req.header("x-request-id");
    response.locals.requestId = supplied && isUuidV4(supplied) ? supplied : randomUUID();
    response.setHeader("x-request-id", response.locals.requestId as string);
    response.setHeader("cache-control", "no-store");
  }
  return response.locals.requestId as string;
}

/** Mounted once ahead of every `/api/v1` router (and of the body parsers, so a parse failure carries the id). */
export function requestConventions(_request: Request, response: Response, next: NextFunction) {
  requestIdOf(response);
  next();
}

export function sendData(response: Response, status: number, data: unknown) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
}

/** `details` and `currentRevision` are omitted when absent: the contract makes them optional, not nullable. */
export function sendFailure(
  response: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  currentRevision?: number
) {
  return response.status(status).json({
    ok: false,
    apiVersion: API_VERSION,
    error: {
      code,
      message,
      requestId: requestIdOf(response),
      ...(details ? { details } : {}),
      ...(currentRevision !== undefined ? { currentRevision } : {})
    }
  });
}

/** Every problem a schema found, as `details.issues`. */
export const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: [...issue.path], message: issue.message }));

/** A fault, not a refusal: logged in full for the operator and answered with a fixed message, so driver text,
 *  file paths and stack details never reach a caller. */
export function sendInternalError(response: Response, error: unknown, message: string) {
  console.error(message, error);
  return sendFailure(response, 500, "internal_error", message);
}

/**
 * A caught error on a route whose refusals are a schema failure (answered `malformed`, with every problem in
 * `details.issues`) or an `InvalidRequestError` (its own message), both 400. Anything else is a fault.
 */
export function sendRefusal(response: Response, error: unknown, malformed: string, internal: string) {
  if (error instanceof z.ZodError)
    return sendFailure(response, 400, "validation_failed", malformed, { issues: issuesOf(error) });
  if (error instanceof InvalidRequestError) return sendFailure(response, 400, "validation_failed", error.message);
  return sendInternalError(response, error, internal);
}

/** A router's last handler: an oversized body is the caller's 413, anything else a fault. */
export function apiErrorHandler(internal: string, tooLarge = "The request body is too large.") {
  return (error: unknown, _request: Request, response: Response, _next: NextFunction) =>
    (error as { type?: string } | null)?.type === "entity.too.large"
      ? sendFailure(response, 413, "bad_request", tooLarge)
      : sendInternalError(response, error, internal);
}
