import { useEffect, useRef, useState } from "react";
import { HOST_PATHS } from "@vtt/api-contract";
import { Button, IconButton, IconCopy, QrCode, Roll, Select, canMove, comet, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import "./join-address.css";

type JoinUrls = Readonly<{ joinUrls: readonly string[]; hostUrl: string }>;

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

/**
 * The addresses a phone on the home network can open: the one this page came from when it isn't localhost (it
 * works), then every network address the host has. A localhost address never works on another device.
 */
export function joinCandidates(fromServer: readonly string[], pageOrigin: string): string[] {
  const first = isLocal(pageOrigin) ? [] : [pageOrigin.replace(/\/$/, "")];
  return [...new Set([...first, ...fromServer.filter((url) => !isLocal(url))])];
}

/** Copies through the clipboard API, or the older selection copy where a plain-http page has no clipboard API. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }
}

/**
 * "Players join at http://...": the address players open, with Copy and a QR code drawn on this device. The `hero`
 * layout shows the code at once on a laptop, for the Table before anyone has joined; `row` keeps it behind a button;
 * `strip` is one line for the strip above the map, with Copy as an icon.
 */
export function JoinAddress({ token, layout = "row" }: Readonly<{ token: string; layout?: "hero" | "row" | "strip" }>) {
  const [urls, setUrls] = useState<readonly string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  // The hero shows the code at once where there is room; on a phone it waits behind a button like the row.
  const roomy = useMediaQuery("(min-width: 980px)");
  const shownAtOnce = layout === "hero" && roomy;
  const [qrToggled, setQrToggled] = useState(false);
  const qrOpen = shownAtOnce || qrToggled;
  const { toast } = useToast();
  const section = useRef<HTMLElement>(null);
  const [justCopied, setJustCopied] = useState(false);
  useEffect(() => {
    if (!justCopied) return;
    const timer = window.setTimeout(() => setJustCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [justCopied]);
  useEffect(() => {
    let cancelled = false;
    apiRequest<JoinUrls>(HOST_PATHS.joinUrls, { token })
      .then((data) => {
        if (!cancelled) setUrls(joinCandidates(data.joinUrls, window.location.origin));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed || urls === null) return null;
  const url = chosen && urls.includes(chosen) ? chosen : urls[0];
  if (!url)
    return (
      <section className={`join-address join-address--${layout}`} aria-label="Join address">
        <p className="join-address-missing">
          This computer has no address on a network yet. Connect it to the Wi-Fi the players use, then reload this page.
        </p>
      </section>
    );
  const copy = async () => {
    const copied = await copyText(url);
    toast(copied ? "Join address copied." : "Copying didn't work in this browser. Select the address and copy it.", {
      tone: copied ? "success" : "error"
    });
    if (!copied) return;
    // A comet runs along the address, and Copy rolls over to Copied for two seconds (ADR-0045).
    const field = section.current?.querySelector<HTMLElement>(".join-address-url, select");
    if (field && canMove()) comet(field.parentElement ?? field, lineUnder(field));
    setJustCopied(true);
  };
  const choice =
    urls.length > 1 ? (
      <Select aria-label="Join address" value={url} onChange={(event) => setChosen(event.target.value)}>
        {urls.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </Select>
    ) : (
      <code className="join-address-url">{url}</code>
    );
  if (layout === "strip")
    return (
      <section ref={section} className="join-address join-address--strip" aria-label="Join address">
        <span className="join-address-label">Players join at</span>
        {choice}
        <IconButton label="Copy the join address" size="sm" onClick={() => void copy()}>
          <IconCopy />
        </IconButton>
      </section>
    );
  return (
    <section ref={section} className={`join-address join-address--${layout}`} aria-label="Join address">
      <div className="join-address-text">
        <span className="join-address-label">Players join at</span>
        {choice}
        <div className="join-address-actions">
          <Button variant="secondary" onClick={() => void copy()}>
            <Roll value={justCopied ? "Copied" : "Copy"} />
          </Button>
          {!shownAtOnce && (
            <Button variant="secondary" aria-expanded={qrOpen} onClick={() => setQrToggled((open) => !open)}>
              {qrOpen ? "Hide QR code" : "Show QR code"}
            </Button>
          )}
        </div>
        <p className="join-address-hint">Phones on the same Wi-Fi open it or scan the code.</p>
      </div>
      {qrOpen && (
        <div className="join-address-qr">
          <QrCode value={url} label={`QR code for ${url}`} />
        </div>
      )}
    </section>
  );
}

/** A trip along the bottom edge of `field`, in its parent's coordinates. */
function lineUnder(field: HTMLElement) {
  return {
    from: field.offsetLeft,
    to: field.offsetLeft + field.offsetWidth,
    line: field.offsetTop + field.offsetHeight,
    thick: 2,
    delay: 0,
    dur: 300
  };
}
