/**
 * Where this browser keeps the GM's session token (ADR-0026). Every tab keeps it in sessionStorage, so a reload stays
 * signed in. "Keep me signed in on this computer" also keeps it in localStorage until the token's own expiry. A new
 * tab with neither asks the tabs already open over a BroadcastChannel, which stays inside this browser and origin.
 * Storage can throw (private mode, blocked site data), and then the token lives only in memory, as before.
 */

const KEY = "vtt.gm-token";
const CHANNEL = "vtt.gm-session";

type Message = Readonly<{ kind: "ask" }> | Readonly<{ kind: "token"; token: string }>;

/** When the token stops working, read from its own signed payload; null when it can't be read. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[0];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { expiresAt?: unknown };
    return typeof json.expiresAt === "number" ? json.expiresAt : null;
  } catch {
    return null;
  }
}

/** A token that has not run out yet. The server still decides; this only saves a pointless try. */
const live = (token: string | null | undefined): token is string => {
  if (!token) return false;
  const expiry = tokenExpiry(token);
  return expiry === null || expiry > Date.now();
};

function read(storage: () => Storage): string | null {
  try {
    return storage().getItem(KEY);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, token: string | null) {
  try {
    if (token) storage().setItem(KEY, token);
    else storage().removeItem(KEY);
  } catch {
    /* blocked storage: the token stays in memory for this tab */
  }
}

/** The token this tab can resume with: its own, or the one this computer keeps. */
export function storedGmToken(): string | null {
  const own = read(() => sessionStorage);
  if (live(own)) return own;
  const kept = read(() => localStorage);
  return live(kept) ? kept : null;
}

/** Whether this computer keeps the GM signed in. */
export function keepsGmSignedIn(): boolean {
  return live(read(() => localStorage));
}

/** Keeps a new token for this tab, and on this computer when `keep` is set. */
export function storeGmToken(token: string, keep: boolean) {
  write(() => sessionStorage, token);
  write(() => localStorage, keep ? token : null);
}

/** Keeps a token this tab resumed with, leaving this computer's choice as it was. */
export function adoptGmToken(token: string) {
  write(() => sessionStorage, token);
}

/** Replaces the token wherever it is kept, as after a password change. */
export function replaceGmToken(token: string) {
  const kept = keepsGmSignedIn();
  storeGmToken(token, kept);
}

/**
 * Forgets the token in this tab and on this computer. Given the token that ended, it leaves alone a newer one
 * another tab has stored since.
 */
export function forgetGmToken(ended?: string) {
  for (const storage of [() => sessionStorage, () => localStorage]) {
    if (ended === undefined || read(storage) === ended) write(storage, null);
  }
}

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    return null;
  }
}

/** Answers other tabs that ask for the GM session while this tab holds one. Returns the stop function. */
export function shareGmToken(current: () => string | null): () => void {
  const open = channel();
  if (!open) return () => {};
  open.onmessage = (event: MessageEvent<Message>) => {
    const token = current();
    if (event.data?.kind === "ask" && live(token)) open.postMessage({ kind: "token", token } satisfies Message);
  };
  return () => open.close();
}

/** Asks the tabs open in this browser for a GM session; null when none answers in time. */
export function askOtherTabsForGmToken(waitMs = 250): Promise<string | null> {
  const open = channel();
  if (!open) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (token: string | null) => {
      window.clearTimeout(timer);
      open.close();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), waitMs);
    open.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.kind === "token" && live(event.data.token)) finish(event.data.token);
    };
    open.postMessage({ kind: "ask" } satisfies Message);
  });
}
