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

/** Calls `/api/v1` and returns the envelope's `data`, or throws an ApiError. */
export async function apiRequest<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const { token, method, body, headers, signal, failure = "The request failed." } = request;
  const isBlob = body instanceof Blob;
  let response: Response;
  try {
    response = await fetch(path, {
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
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.ok) {
    const error = envelope?.error;
    throw new ApiError(
      error?.message ?? `${failure} (${response.status})`,
      response.status,
      error?.code ?? "error",
      typeof error?.currentRevision === "number" ? error.currentRevision : null,
      error?.details ?? null
    );
  }
  return envelope.data as T;
}

/** Reads a binary `/api/v1` resource, such as an uploaded image's bytes, or throws an ApiError. */
export async function apiBlob(path: string, request: Pick<ApiRequest, "token" | "signal" | "failure"> = {}) {
  const { token, signal, failure = "The request failed." } = request;
  let response: Response;
  try {
    response = await fetch(path, { signal, headers: token ? { authorization: `Bearer ${token}` } : {} });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Couldn't reach the server.", 0, "offline");
  }
  if (response.ok) return response.blob();
  const error = (await response.json().catch(() => null))?.error;
  throw new ApiError(error?.message ?? `${failure} (${response.status})`, response.status, error?.code ?? "error");
}
