import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GmActor, PlayerActor } from "@vtt/domain";
import { ConditionEditor } from "../encounter/conditions";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { TokenLibrary } from "../tokens/TokenLibrary";

type Actor = GmActor | PlayerActor;

/**
 * Right-click / long-press actions on a token. GM acts on any token; a player only ever opens it on
 * their own claimed token (the caller gates that). Portaled to <body> so it clears the docked panel
 * and enlarged-map stacking contexts. Uses only existing commands — the server stays authoritative.
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
  const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
  const cap = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;
  const currentSize = actor.size ?? (actor.sizeCells === 4 ? "gargantuan" : actor.sizeCells === 3 ? "huge" : actor.sizeCells === 2 ? "large" : "medium");

  // The image picker replaces the menu while open; closing it dismisses the whole flow.
  if (library && gmToken) return <TokenLibrary actorId={actor.id} actorName={actor.name} definitionId={actor.definitionId ?? null} currentAssetId={actor.tokenAssetId ?? null} gmToken={gmToken} onClose={onClose} />;

  // Clamp so the menu stays on-screen near the pointer.
  const style: React.CSSProperties = { left: Math.max(8, Math.min(x, window.innerWidth - 240)), top: Math.max(8, Math.min(y, window.innerHeight - 340)) };

  // In fullscreen, only the fullscreen element's subtree renders — portal into it (not document.body,
  // which is hidden) so the menu is visible. Falls back to body when not in fullscreen.
  return createPortal(
    <div ref={ref} className="token-context-menu" role="menu" style={style} aria-label={`Actions for ${actor.name}`}>
      <div className="token-context-head"><strong>{actor.name}</strong><button type="button" aria-label="Close menu" onClick={onClose}>✕</button></div>
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
      <button type="button" className="token-context-item" onClick={() => { onOpenSheet(); onClose(); }}>Open {actor.kind === "player-character" ? "character sheet" : "stat block"}</button>
      {role === "gm" && gmToken && <button type="button" className="token-context-item" onClick={() => setLibrary(true)}>Set token image…</button>}
      <button type="button" className="token-context-item" aria-pressed={reactionUsed} disabled={busy} onClick={toggleReaction}>{reactionUsed ? "Reaction spent — restore" : "Use reaction"}</button>
      {role === "gm" && placed && <button type="button" className="token-context-item" onClick={() => { onReturnToTray(); onClose(); }}>Return to tray</button>}
      <div className="token-context-conditions"><ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} /></div>
      {feedback && <p className="token-context-feedback" role="status">{feedback}</p>}
    </div>,
    document.fullscreenElement ?? document.body
  );
}
