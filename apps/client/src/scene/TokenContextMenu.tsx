import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GmActor, PlayerActor } from "@vtt/domain";
import { IconButton, IconX } from "@vtt/ui";
import { ConditionEditor } from "../encounter/conditions";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { TokenLibrary } from "../tokens/TokenLibrary";

type Actor = GmActor | PlayerActor;

/** Breathing room between the menu and the viewport edge, on every side. */
const MARGIN = 8;

/**
 * Right-click / long-press actions on a token. GM acts on any token; a player only ever opens it on
 * their own claimed token (the caller gates that). Portaled to <body> so it clears the docked panel
 * and enlarged-map stacking contexts. Uses only existing commands - the server stays authoritative.
 */
export function TokenContextMenu({ actor, role, gmToken, x, y, reactionUsed, placed, onOpenSheet, onReturnToTray, onClose }: Readonly<{
  actor: Actor;
  role: "gm" | "player";
  gmToken: string | null;
  x: number;
  y: number;
  reactionUsed: boolean;
  placed: boolean;
  onOpenSheet: () => void;
  onReturnToTray: () => void;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  // Measured, not guessed: the menu's real height decides where it sits and whether it needs to scroll.
  // Runs before paint (and again on resize/rotate) so the corrected box is the first one drawn.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const room = window.innerHeight - MARGIN * 2;
      // Measure the natural height: an earlier pass may have capped it, and a menu that has since
      // gained room should get it back rather than stay stuck at a stale cap.
      const previous = el.style.maxHeight;
      el.style.maxHeight = "none";
      const height = el.offsetHeight;
      const width = el.offsetWidth;
      el.style.maxHeight = previous;
      const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
      const top = height > room ? MARGIN : Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
      setBox({ left, top, maxHeight: room });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [x, y, library, role]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    // Defer the outside-click listener a tick so the opening gesture doesn't immediately dismiss it.
    const armed = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(armed); document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const adjustHp = (event: "actor:apply-damage" | "actor:heal", verb: string) => {
    const value = Number(amount.trim());
    if (!Number.isInteger(value) || value < 1 || value > 1000) { setFeedback("Enter a whole number (1-1000)."); return; }
    setBusy(true);
    socket.emit(event, { commandId: newId(), actorId: actor.id, amount: value }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      setFeedback(result.ok ? `${verb} ${value}.` : result.message ?? "That change was rejected.");
      if (result.ok) setAmount("");
    });
  };
  const toggleReaction = () => {
    setBusy(true);
    socket.emit("turn:use-reaction", { commandId: newId(), actorId: actor.id, used: !reactionUsed }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "The reaction could not be updated.");
    });
  };
  const setSize = (size: string) => {
    setBusy(true);
    socket.emit("actor:set-size", { commandId: newId(), actorId: actor.id, size: size as "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan" }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "The token could not be resized.");
    });
  };
  const setHealthDisplay = (display: { style: "band" | "bar" | "ring" | "aura"; audience: "gm" | "all" } | null) => {
    setBusy(true);
    socket.emit("actor:set-health-display", { commandId: newId(), actorId: actor.id, display }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "The health display could not be changed.");
    });
  };
  // GM-only control: the token's per-token override (undefined = follows the table default).
  const healthOverride = role === "gm" ? (actor as GmActor).healthDisplay : undefined;
  // The reveal words, not layer jargon (D28): a token is either shown to players or hidden from them.
  const hiddenFromPlayers = actor.visibility === "gm-only";
  const toggleReveal = () => {
    const visibility = hiddenFromPlayers ? "public" : "gm-only";
    setBusy(true);
    socket.emit("actor:set-visibility", { commandId: newId(), actorId: actor.id, visibility }, (result: { ok: boolean; message?: string }) => {
      setBusy(false);
      setFeedback(result.ok ? (visibility === "gm-only" ? "Hidden from players." : "Shown to players.") : result.message ?? "That could not be changed.");
    });
  };
  const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
  const cap = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;
  const currentSize = actor.size ?? (actor.sizeCells === 4 ? "gargantuan" : actor.sizeCells === 3 ? "huge" : actor.sizeCells === 2 ? "large" : "medium");

  // The image picker replaces the menu while open; closing it dismisses the whole flow.
  if (library && gmToken) return <TokenLibrary actorId={actor.id} actorName={actor.name} definitionId={actor.definitionId ?? null} currentAssetId={actor.tokenAssetId ?? null} gmToken={gmToken} onClose={onClose} />;

  // Clamp so the menu stays on-screen near the pointer. The old clamp guessed the menu's height at a
  // hard-coded 340px; the menu is 412-458px depending on role and token state, so at a 720px-tall
  // viewport its last actions ("Use reaction", "Return to tray") sat below the fold with nothing to
  // scroll them into reach. Measure instead, pull the box back up so its BOTTOM fits, and when even a
  // full-height menu cannot fit, give it the viewport column and let it scroll itself — §7's rule is
  // that a thing fits its box or scrolls itself, and this used to do neither. `.encounter-menu` next
  // door already worked this way; this is the same behaviour, measured rather than assumed.
  const style: React.CSSProperties = box
    ? { left: box.left, top: box.top, maxHeight: box.maxHeight }
    // First paint, before measurement: the pointer position, clamped to the viewport's own edges. The
    // layout effect corrects it in the same frame, so this is never what the eye sees.
    : { left: Math.max(MARGIN, Math.min(x, window.innerWidth - MARGIN)), top: Math.max(MARGIN, Math.min(y, window.innerHeight - MARGIN)), visibility: "hidden" };

  // In fullscreen, only the fullscreen element's subtree renders - portal into it (not document.body,
  // which is hidden) so the menu is visible. Falls back to body when not in fullscreen.
  return createPortal(
    <div ref={ref} className="token-context-menu anim-popover scroll-y" role="menu" style={style} aria-label={`Actions for ${actor.name}`}>
      <div className="token-context-head"><strong>{actor.name}</strong><IconButton label="Close menu" size="sm" onClick={onClose}><IconX /></IconButton></div>
      {role === "gm" && <div className="token-context-hp" role="group" aria-label="Adjust hit points">
        <input type="number" min="1" max="1000" placeholder="HP" aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button type="button" disabled={busy} onClick={() => adjustHp("actor:apply-damage", "Damaged")}>Dmg</button>
        <button type="button" disabled={busy} onClick={() => adjustHp("actor:heal", "Healed")}>Heal</button>
      </div>}
      {role === "gm" && <label className="token-context-size">Size
        <select value={currentSize} disabled={busy} onChange={(event) => setSize(event.target.value)}>
          {SIZES.map((size) => <option key={size} value={size}>{cap(size)}</option>)}
        </select>
      </label>}
      {role === "gm" && <label className="token-context-size">Health
        <select value={healthOverride?.style ?? "default"} disabled={busy} onChange={(event) => { const value = event.target.value; if (value === "default") setHealthDisplay(null); else setHealthDisplay({ style: value as "band" | "bar" | "ring" | "aura", audience: healthOverride?.audience ?? "gm" }); }}>
          <option value="default">Default (table)</option>
          <option value="band">Status badge</option>
          <option value="bar">HP bar</option>
          <option value="ring">Health ring</option>
          <option value="aura">Health aura</option>
        </select>
      </label>}
      {role === "gm" && healthOverride && healthOverride.style !== "band" && <label className="token-context-size">Health is
        <select value={healthOverride.audience} disabled={busy} onChange={(event) => setHealthDisplay({ style: healthOverride.style, audience: event.target.value as "gm" | "all" })}>
          <option value="gm">GM only</option>
          <option value="all">Shown to players</option>
        </select>
      </label>}
      <details className="token-context-conditions">
        <summary className="token-context-conditions-summary">Conditions{actor.conditions.length > 0 ? ` (${actor.conditions.length})` : ""}</summary>
        <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} />
      </details>
      <button type="button" className="token-context-item" onClick={() => { onOpenSheet(); onClose(); }}>Open {actor.kind === "player-character" ? "character sheet" : "stat block"}</button>
      {role === "gm" && gmToken && <button type="button" className="token-context-item" onClick={() => setLibrary(true)}>Set token image…</button>}
      {role === "gm" && <button type="button" className="token-context-item" disabled={busy} title={hiddenFromPlayers ? "Reveal this token to players and the shared screen" : "Hide this token from players and the shared screen"} onClick={toggleReveal}>{hiddenFromPlayers ? "Show to players" : "Hide from players"}</button>}
      <button type="button" className="token-context-item" aria-pressed={reactionUsed} disabled={busy} onClick={toggleReaction}>{reactionUsed ? "Reaction spent - restore" : "Use reaction"}</button>
      {role === "gm" && placed && <button type="button" className="token-context-item" onClick={() => { onReturnToTray(); onClose(); }}>Return to tray</button>}
      {feedback && <p className="token-context-feedback" role="status">{feedback}</p>}
    </div>,
    document.fullscreenElement ?? document.body
  );
}
