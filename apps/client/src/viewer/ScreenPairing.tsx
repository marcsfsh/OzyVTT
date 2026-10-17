import { useEffect, useRef, useState } from "react";
import { VIEWER_PATHS } from "@vtt/api-contract";
import { ApiError, apiRequest } from "../lib/api";

type Pairing = Readonly<{ code: string; expiresAt: string }>;
type Current = Readonly<{ status: "waiting"; pairing: Pairing }> | Readonly<{ status: "paired" }>;

/** How often the screen asks whether the GM has let it in. */
const POLL_MS = 2_000;
/** The wait after the server says too many screens are asking. */
const BUSY_RETRY_MS = 60_000;

/** "482913" as the screen shows it, "482 913": two groups are easier to read across a room and to type. */
export const spacedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * An unpaired table screen (ADR-0028). It shows a short code and waits; the GM types the code on their own device,
 * so nothing has to be typed with a TV remote. The code renews itself when it runs out, and a reload shows the same
 * code until then, because the request's secret is in an HttpOnly cookie.
 */
export function ScreenPairing({ onPaired }: Readonly<{ onPaired: () => void }>) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [message, setMessage] = useState("");
  // The parent passes a new function each render; the polling loop must not restart for that.
  const paired = useRef(onPaired);
  paired.current = onPaired;

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const later = (ms: number) => {
      if (!stopped) timer = window.setTimeout(() => void step(), ms);
    };
    /** One round: read where this screen's request stands, opening a new one when there is none. */
    const step = async () => {
      try {
        const current = await apiRequest<Current>(VIEWER_PATHS.screenPairingsCurrent);
        if (stopped) return;
        if (current.status === "paired") {
          paired.current();
          return;
        }
        setPairing(current.pairing);
        setMessage("");
        later(POLL_MS);
      } catch (error) {
        if (stopped) return;
        if (error instanceof ApiError && error.status === 404) {
          try {
            const opened = await apiRequest<{ pairing: Pairing }>(VIEWER_PATHS.screenPairings, { method: "POST" });
            if (stopped) return;
            setPairing(opened.pairing);
            setMessage("");
            later(POLL_MS);
          } catch (openError) {
            if (stopped) return;
            const busy = openError instanceof ApiError && openError.status === 429;
            setPairing(null);
            setMessage(
              busy
                ? "Too many screens are asking to pair. This screen tries again in a minute."
                : (openError as Error).message
            );
            later(busy ? BUSY_RETRY_MS : POLL_MS * 2);
          }
          return;
        }
        setMessage("The table can't be reached. This screen keeps trying.");
        later(POLL_MS * 2);
      }
    };
    void step();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main className="viewer-pairing" aria-labelledby="pair-title">
      <div className="viewer-pairing-card">
        <span className="viewer-eyebrow">TABLE SCREEN</span>
        <h1 id="pair-title">Pair this screen</h1>
        {pairing ? (
          <>
            <p>On the GM's device, open Shared screen and enter this code.</p>
            <strong
              className="viewer-screen-code tabular"
              aria-label={`Pairing code ${pairing.code.split("").join(" ")}`}
            >
              {spacedCode(pairing.code)}
            </strong>
            <p className="viewer-pairing-note">
              The code changes every 10 minutes. This screen shows only what the GM presents.
            </p>
          </>
        ) : (
          <p>{message || "Getting a code…"}</p>
        )}
        {pairing && message && (
          <p className="viewer-feedback" role="alert">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
