import { useEffect, useRef, useState } from "react";
import { Button, IconArrow, Input, ThemeToggle, Wordmark } from "@vtt/ui";
import { Notice, type NoticeMessage } from "../components/feedback";

/**
 * The landing→app entry animation, one-shot. The choreography is CSS (`.landing--drive` in
 * styles.css); this is only the clock. `drive` keeps the landing mounted as a fixed curtain over the
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
    // 1500ms drive + 400ms settle. Must match `--entry-drive` in styles.css, or the drive is cut short.
    timers.current.push(window.setTimeout(() => setPhase("settle"), 1500));
    timers.current.push(window.setTimeout(() => setPhase(null), 1900));
  };
  return { phase, begin };
}

/**
 * The landing page: one centred column with the wordmark and the two doors. The GM password card
 * replaces the buttons in place. While the entry drives, it stays mounted as the curtain.
 */
export function Landing({
  driving,
  bootstrapped,
  busy,
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
  notice: NoticeMessage;
  onJoin: () => void;
  onSignIn: (password: string) => void;
  onSetPassword: (password: string) => void;
  onClearNotice: () => void;
}>) {
  const [door, setDoor] = useState<"choose" | "gm">("choose");
  const [password, setPassword] = useState("");
  const submit = () => (bootstrapped ? onSignIn(password) : onSetPassword(password));
  return (
    <div className={driving ? "landing landing--drive" : "landing"}>
      {/* The title screen, layer by layer: star field, the slatted sun behind the horizon, the receding
        grid, grain, and the CRT vignette/scanlines from `.landing`'s pseudo-elements. Colours are
        --landing-* tokens, re-skinned per theme. */}
      <div className="landing-scene" aria-hidden="true">
        <span className="landing-stars-far" />
        <span className="landing-stars" />
        <span className="landing-skyband">
          <span className="landing-sun" />
        </span>
        <span className="landing-planet" />
        <span className="landing-horizon" />
        <span className="landing-grid" />
        <span className="landing-noise" />
      </div>
      {/* A sibling of the scene, not inside it: it must paint over the CRT dressing and the content, and
        the scene is its own stacking context. */}
      <span className="landing-flare" aria-hidden="true" />
      <header className="home-hero anim-view">
        <h1 className="home-hero-title">
          <Wordmark>OZYVTT</Wordmark>
        </h1>
      </header>
      {door === "choose" ? (
        <section className="choices anim-view">
          <Button variant="primary" size="md" lift onClick={onJoin} disabled={busy}>
            {busy ? "Connecting…" : "Join as Player"}
            <IconArrow className="nav-arrow" />
          </Button>
          <Button
            variant="secondary"
            lift
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
        <section className="card anim-view">
          <h2>{bootstrapped ? "GM sign-in" : "Set up the GM password"}</h2>
          <p>
            {bootstrapped
              ? "Enter the GM password to run the table."
              : "Do this once, on the host machine, before players join."}
          </p>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="GM password"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) submit();
            }}
          />
          <Button variant="primary" onClick={submit} disabled={busy || !password}>
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
        </section>
      )}
      {/* Auth errors are the one inline exception to toast-only feedback. */}
      <Notice notice={notice} />
      <div className="home-theme-switch">
        <ThemeToggle />
      </div>
    </div>
  );
}
