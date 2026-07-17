import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GmActor, PlayerActor } from "@vtt/domain";
import { ConditionEditor } from "../encounter/conditions";
import { newId } from "../lib/ids";
import { socket } from "../socket";

type Actor = GmActor | PlayerActor;

/**
 * Right-click / long-press actions on a token. GM acts on any token; a player only ever opens it on
 * their own claimed token (the caller gates that). Portaled to <body> so it clears the docked panel
 * and enlarged-map stacking contexts. Uses only existing commands — the server stays authoritative.
 */
export function TokenContextMenu({ actor, role, x, y, reactionUsed, placed, onOpenSheet, onReturnToTray, onClose }: Readonly<{
  actor: Actor;
  role: "gm" | "player";
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

  // Clamp so the menu stays on-screen near the pointer.
  const style: React.CSSProperties = { left: Math.max(8, Math.min(x, window.innerWidth - 240)), top: Math.max(8, Math.min(y, window.innerHeight - 340)) };

  return createPortal(
    <div ref={ref} className="token-context-menu" role="menu" style={style} aria-label={`Actions for ${actor.name}`}>
      <div className="token-context-head"><strong>{actor.name}</strong><button type="button" aria-label="Close menu" onClick={onClose}>✕</button></div>
      {role === "gm" && <div className="token-context-hp" role="group" aria-label="Adjust hit points">
        <input type="number" min="1" max="1000" placeholder="HP" aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button type="button" disabled={busy} onClick={() => adjustHp("actor:apply-damage", "Damaged")}>Dmg</button>
        <button type="button" disabled={busy} onClick={() => adjustHp("actor:heal", "Healed")}>Heal</button>
      </div>}
      <button type="button" className="token-context-item" onClick={() => { onOpenSheet(); onClose(); }}>Open {actor.kind === "player-character" ? "character sheet" : "stat block"}</button>
      <button type="button" className="token-context-item" aria-pressed={reactionUsed} disabled={busy} onClick={toggleReaction}>{reactionUsed ? "Reaction spent — restore" : "Use reaction"}</button>
      {role === "gm" && placed && <button type="button" className="token-context-item" onClick={() => { onReturnToTray(); onClose(); }}>Return to tray</button>}
      <div className="token-context-conditions"><ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setFeedback} /></div>
      {feedback && <p className="token-context-feedback" role="status">{feedback}</p>}
    </div>,
    document.body
  );
}
