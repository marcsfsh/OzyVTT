import { useEffect, useRef, useState } from "react";
import { Button, IconArrow, Input, Modal, Switch, ThemeToggle, Wordmark } from "@vtt/ui";
import { Notice, type NoticeMessage } from "../components/feedback";
import { useMediaQuery } from "../lib/useMediaQuery";
import "./landing.css";

/**
 * The landing→app entry animation, one-shot. The choreography is CSS (`.landing--drive` in
 * landing.css); this is only the clock. `drive` keeps the landing mounted as a fixed curtain over the
 * frame; `settle` hands over to the app's cascade (`.anim-cascade`, opacity-led so no transform traps
 * a fixed overlay). Both classes are dropped when the entry finishes, so nothing persists and tab
 * navigation never replays it. Reduced motion skips it entirely.
 */
export function useEntryAnimation() {
  const [phase, setPhase] = useState<"drive" | "settle" | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  /**
   * `commit` is the caller's auth state change, which mounts the whole app. It runs only after the
   * curtain has painted and its animations have started (two frames): committing in the same batch
   * lets the app's first render block the animation start, and the title screen stalls then jumps.
   * The animations are transform/opacity, so once on the compositor they run through the mount.
   */
  const begin = (commit: () => void) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commit();
      return;
    }
    setPhase("drive");
    // rAF does not fire in a background tab, so a timeout races it and whichever is first commits, once.
    let committed = false;
    const once = () => {
      if (!committed) {
        committed = true;
        commit();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(once));
    timers.current.push(window.setTimeout(once, 120));
    // 1500ms drive + 400ms settle. Must match `--entry-drive` in landing.css, or the drive is cut short.
    timers.current.push(window.setTimeout(() => setPhase("settle"), 1500));
    timers.current.push(window.setTimeout(() => setPhase(null), 1900));
  };
  return { phase, begin };
}

/**
 * The landing page: one centred column with the wordmark and the two ways in. The GM password card
 * replaces the buttons in place. While the entry drives, it stays mounted as the curtain.
 */
/** The title screen's art, layer by layer: star field, the slatted sun behind the horizon, the mountains on it, the
 *  receding grid and grain. Colours are --landing-* tokens, re-skinned per theme. The picker reuses it. */
export function LandingScene() {
  return (
    <div className="landing-scene" aria-hidden="true">
      <span className="landing-stars-far" />
      <span className="landing-stars" />
      <span className="landing-skyband">
        <span className="landing-sun" />
      </span>
      <span className="landing-mountains" />
      <span className="landing-horizon" />
      <span className="landing-grid" />
      <span className="landing-noise" />
    </div>
  );
}

export function Landing({
  driving,
  bootstrapped,
  busy,
  resuming,
  gmPrompt,
  notice,
  onJoin,
  onSignIn,
  onSetPassword,
  onClearNotice
}: Readonly<{
  driving: boolean;
  /** Whether a GM password exists yet; null until the server says. */
  bootstrapped: boolean | null;
  busy: boolean;
  /** A stored GM session is being tried; neither door opens until it settles. */
  resuming: boolean;
  /** Open on the GM sign-in, as after a GM session ended. */
  gmPrompt: boolean;
  notice: NoticeMessage;
  onJoin: () => void;
  onSignIn: (password: string, keepSignedIn: boolean) => void;
  onSetPassword: (password: string) => void;
  onClearNotice: () => void;
}>) {
  const [door, setDoor] = useState<"choose" | "gm">(gmPrompt ? "gm" : "choose");
  useEffect(() => {
    if (gmPrompt) setDoor("gm");
  }, [gmPrompt]);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [resetSteps, setResetSteps] = useState(false);
  // A phone shows the four themes as their marks alone, so the switch fits beside the thumb.
  const phone = useMediaQuery("(max-width: 560px)");
  const submit = () => {
    if (busy || !password) return;
    // The last attempt's error goes as this one starts, so it never sits beside the next answer.
    onClearNotice();
    if (bootstrapped) onSignIn(password, keepSignedIn);
    else onSetPassword(password);
  };
  return (
    <div className={driving ? "landing landing--drive" : "landing"}>
      {/* The title screen's art, with the vignette from `.landing::before` over it. */}
      <LandingScene />
      {/* A sibling of the scene, outside it: it must paint over the vignette and the content, and the
        scene is its own stacking context. */}
      <span className="landing-flare" aria-hidden="true" />
      <header className="home-hero anim-view">
        <h1 className="home-hero-title">
          <Wordmark variant="cabinet" className="home-hero-mark" />
        </h1>
      </header>
      {door === "choose" ? (
        <section className="choices anim-view">
          <Button variant="primary" size="md" lift onClick={onJoin} disabled={busy || resuming}>
            {busy ? "Connecting…" : "Join as Player"}
            <IconArrow className="nav-arrow" />
          </Button>
          <Button
            variant="secondary"
            lift
            disabled={resuming}
            onClick={() => {
              onClearNotice();
              setDoor("gm");
            }}
          >
            Enter as GM
            <IconArrow className="nav-arrow" />
          </Button>
        </section>
      ) : (
        <section className="card landing-gm anim-view" aria-labelledby="landing-gm-title">
          <h2 id="landing-gm-title">{bootstrapped ? "GM sign-in" : "Set up the GM password"}</h2>
          <p>
            {bootstrapped
              ? "Enter the GM password to run the table."
              : "Use at least 12 characters. Set it on this computer, the one that runs OzyVTT, before players join."}
          </p>
          <form
            className="landing-gm-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="landing-password">
              <Input
                type={shown ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="GM password"
                aria-label="GM password"
                autoComplete={bootstrapped ? "current-password" : "new-password"}
                autoFocus
              />
              <Button
                variant="ghost"
                className="landing-password-show"
                aria-label="Show password"
                aria-pressed={shown}
                onClick={() => setShown((current) => !current)}
              >
                {shown ? "Hide" : "Show"}
              </Button>
            </div>
            {bootstrapped && (
              <Switch
                className="landing-keep"
                checked={keepSignedIn}
                onChange={setKeepSignedIn}
                label="Keep me signed in on this computer"
              />
            )}
            <div className="landing-gm-actions">
              <Button variant="primary" type="submit" disabled={busy || !password}>
                {busy ? "Please wait…" : bootstrapped ? "Enter table" : "Set GM password"}
                {!busy && <IconArrow className="nav-arrow" />}
              </Button>
              <Button
                variant="ghost"
                className="link"
                onClick={() => {
                  onClearNotice();
                  setDoor("choose");
                }}
              >
                Back
              </Button>
            </div>
          </form>
          {/* In a dialog: the steps would push the card past a phone's screen, and the landing never scrolls. */}
          {bootstrapped && (
            <div className="landing-reset">
              <Button variant="ghost" className="link" onClick={() => setResetSteps(true)}>
                Forgot the password
              </Button>
              <Modal
                open={resetSteps}
                onClose={() => setResetSteps(false)}
                size="sm"
                title="Reset the GM password"
                ariaLabel="Reset the GM password"
              >
                <ResetSteps />
              </Modal>
            </div>
          )}
        </section>
      )}
      {/* Auth errors are the one inline exception to toast-only feedback. */}
      <Notice notice={notice} />
      <div className="home-theme-switch">
        <ThemeToggle compact={phone} />
      </div>
    </div>
  );
}

/** How to set a new GM password. The app can't do it: knowing the old one is the only proof of being the GM. */
export function ResetSteps() {
  return (
    <div className="landing-reset-steps" role="note">
      <p>The GM password can only be reset on the computer that runs OzyVTT.</p>
      <ol>
        <li>Stop OzyVTT there.</li>
        <li>
          Delete the file <code>apps/server/data/auth.json</code> in the OzyVTT folder. If you set <code>DATA_DIR</code>{" "}
          or run OzyVTT in Docker, delete <code>auth.json</code> from that folder or volume.
        </li>
        <li>Start OzyVTT again and set a new password on that computer.</li>
      </ol>
      <p>The campaign stays as it was. Players join again and claim their characters.</p>
    </div>
  );
}
