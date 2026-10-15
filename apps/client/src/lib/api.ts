/** A refusal or failure from `/api/v1`, carrying the envelope's `error` fields. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly currentRevision: number | null = null,
    readonly details: Readonly<Record<string, unknown>> | null = null
  ) {
    super(message);
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

export type ApiRequest = Readonly<{
  token?: string | null;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** A plain value is sent as JSON; a Blob (an upload) is sent as is. */
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Shown when the server gives no message of its own. */
  failure?: string;
}>;

async function send(path: string, request: ApiRequest): Promise<Response> {
  const { token, method, body, headers, signal } = request;
  const isBlob = body instanceof Blob;
  try {
    return await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !isBlob ? { "content-type": "application/json" } : {}),
        ...headers
      },
      body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Couldn't reach the server.", 0, "offline");
  }
}

function failureOf(response: Response, envelope: unknown, failure: string): ApiError {
  const error = (envelope as { error?: Record<string, unknown> } | null)?.error;
  return new ApiError(
    typeof error?.message === "string" ? error.message : `${failure} (${response.status})`,
    response.status,
    typeof error?.code === "string" ? error.code : "error",
    typeof error?.currentRevision === "number" ? error.currentRevision : null,
    (error?.details as Record<string, unknown> | undefined) ?? null
  );
}

const DEFAULT_FAILURE = "The request failed.";

/** Calls `/api/v1` and returns the envelope's `data`, or throws an ApiError. */
export async function apiRequest<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const response = await send(path, request);
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.ok) throw failureOf(response, envelope, request.failure ?? DEFAULT_FAILURE);
  return envelope.data as T;
}

/** Fetches binary content under `/api/v1` (an image), or throws an ApiError. */
export async function apiBlob(path: string, request: Omit<ApiRequest, "body" | "method"> = {}): Promise<Blob> {
  const response = await send(path, request);
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throw failureOf(response, envelope, request.failure ?? DEFAULT_FAILURE);
  }
  return response.blob();
}

/**
 * Calls a route that answers bare JSON instead of the `/api/v1` envelope: the host's own routes outside
 * `/api/v1` (GM password setup, sign-in and sessions, the viewer addresses) and the OpenAPI document.
 * A failure's text is in `message`.
 */
export async function jsonRequest<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const response = await send(path, request);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : (request.failure ?? DEFAULT_FAILURE);
    throw new ApiError(message, response.status, "error");
  }
  return body as T;
}
