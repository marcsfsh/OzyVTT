import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GmActor, PlayerActor } from "@vtt/domain";
import { IconButton, IconX, Select } from "@vtt/ui";
import { ConditionEditor } from "../encounter/conditions";
import { HpAdjust } from "../encounter/HpAdjust";
import { HealthAudienceOptions, HealthStyleOptions, type HealthStyle } from "../encounter/health-display";
import { command } from "../lib/command";
import { TokenLibrary } from "../tokens/TokenLibrary";
import { titleCase } from "../encounter/format";
import { useMenuDismiss, useMenuPlacement } from "./menuPlacement";
import "./token-menu.css";

type Actor = GmActor | PlayerActor;

/**
 * Right-click / long-press actions on a token. The GM acts on any token; a player only opens it on
 * their own claimed token (the caller gates that). Portaled to clear the docked panel and
 * enlarged-map stacking contexts. Uses existing commands only; the server stays authoritative.
 */
export function TokenContextMenu({
  actor,
  role,
  gmToken,
  x,
  y,
  reactionUsed,
  placed,
  moveModes,
  height,
  onOpenSheet,
  onReturnToTray,
  onClose
}: Readonly<{
  actor: Actor;
  role: "gm" | "player";
  gmToken: string | null;
  x: number;
  y: number;
  reactionUsed: boolean;
  placed: boolean;
  /** How the creature whose move counts now travels on its next drag. */
  moveModes?: ReactNode;
  /** How high the creature is, and the way to change it. */
  height?: ReactNode;
  onOpenSheet: () => void;
  onReturnToTray: () => void;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [library, setLibrary] = useState(false);
  const style = useMenuPlacement(ref, x, y, [library, role]);
  useMenuDismiss(ref, onClose);

  // The image picker replaces the menu while open; closing it dismisses the whole flow.
  if (library && gmToken)
    return (
      <TokenLibrary
        actorId={actor.id}
        actorName={actor.name}
        definitionId={actor.definitionId ?? null}
        currentAssetId={actor.tokenAssetId ?? null}
        gmToken={gmToken}
        onClose={onClose}
      />
    );

  // In fullscreen only the fullscreen element's subtree renders, so portal into it (document.body is
  // hidden). Falls back to body otherwise.
  return createPortal(
    <div
      ref={ref}
      className="token-context-menu anim-popover scroll-y"
      role="menu"
      style={style}
      aria-label={`Actions for ${actor.name}`}
    >
      <div className="token-context-head">
        <strong>{actor.name}</strong>
        <IconButton label="Close menu" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      <TokenControls
        actor={actor}
        role={role}
        gmToken={gmToken}
        reactionUsed={reactionUsed}
        placed={placed}
        moveModes={moveModes}
        height={height}
        onOpenSheet={() => {
          onOpenSheet();
          onClose();
        }}
        onReturnToTray={() => {
          onReturnToTray();
          onClose();
        }}
        onPickImage={() => setLibrary(true)}
      />
    </div>,
    document.fullscreenElement ?? document.body
  );
}

/**
 * What can be done to one token: the GM's HP, size, health display, conditions, sheet, image, visibility, reaction
 * and tray; a player's conditions, sheet and reaction on their own. The same controls sit in the token's menu on the
 * map and in the GM's Token tab.
 */
export function TokenControls({
  actor,
  role,
  gmToken,
  reactionUsed,
  placed,
  moveModes,
  height,
  onOpenSheet,
  onReturnToTray,
  onPickImage
}: Readonly<{
  actor: Actor;
  role: "gm" | "player";
  gmToken: string | null;
  reactionUsed: boolean;
  placed: boolean;
  moveModes?: ReactNode;
  height?: ReactNode;
  onOpenSheet: () => void;
  onReturnToTray: () => void;
  onPickImage: () => void;
}>) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const toggleReaction = () => {
    setBusy(true);
    void command("turn:use-reaction", { actorId: actor.id, used: !reactionUsed }).then((result) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "The reaction could not be updated.");
    });
  };
  const setSize = (size: string) => {
    setBusy(true);
    void command("actor:set-size", {
      actorId: actor.id,
      size: size as "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan"
    }).then((result) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "The token could not be resized.");
    });
  };
  const setHealthDisplay = (display: { style: HealthStyle; audience: "gm" | "all" } | null) => {
    setBusy(true);
    void command("actor:set-health-display", { actorId: actor.id, display }).then((result) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "The health display could not be changed.");
    });
  };
  // GM-only control: the token's per-token override (undefined = follows the table default).
  const healthOverride = role === "gm" ? (actor as GmActor).healthDisplay : undefined;
  // A token is either shown to players or hidden from them.
  const hiddenFromPlayers = actor.visibility === "gm-only";
  const toggleReveal = () => {
    const visibility = hiddenFromPlayers ? "public" : "gm-only";
    setBusy(true);
    void command("actor:set-visibility", { actorId: actor.id, visibility }).then((result) => {
      setBusy(false);
      setFeedback(
        result.ok
          ? visibility === "gm-only"
            ? "Hidden from players."
            : "Shown to players."
          : (result.message ?? "That could not be changed.")
      );
    });
  };
  const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
  const currentSize =
    actor.size ??
    (actor.sizeCells === 4
      ? "gargantuan"
      : actor.sizeCells === 3
        ? "huge"
        : actor.sizeCells === 2
          ? "large"
          : "medium");

  return (
    <>
      {moveModes}
      {height}
      {role === "gm" && <HpAdjust actor={actor} controls={["damage", "heal"]} onFeedback={setFeedback} />}
      {role === "gm" && (
        <label className="token-context-size">
          Size
          <Select value={currentSize} disabled={busy} onChange={(event) => setSize(event.target.value)}>
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {titleCase(size)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {role === "gm" && (
        <label className="token-context-size">
          Health
          <Select
            value={healthOverride?.style ?? "default"}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "default") setHealthDisplay(null);
              else
                setHealthDisplay({
                  style: value as HealthStyle,
                  audience: healthOverride?.audience ?? "gm"
                });
            }}
          >
            <option value="default">Default (table)</option>
            <HealthStyleOptions />
          </Select>
        </label>
      )}
      {role === "gm" && healthOverride && healthOverride.style !== "band" && (
        <label className="token-context-size">
          Health is
          <Select
            value={healthOverride.audience}
            disabled={busy}
            onChange={(event) =>
              setHealthDisplay({ style: healthOverride.style, audience: event.target.value as "gm" | "all" })
            }
          >
            <HealthAudienceOptions />
          </Select>
        </label>
      )}
      <details className="token-context-conditions">
        <summary className="token-context-conditions-summary">
          Conditions{actor.conditions.length > 0 ? ` (${actor.conditions.length})` : ""}
        </summary>
        <ConditionEditor
          actorId={actor.id}
          conditions={actor.conditions}
          effects={actor.effects}
          viewer={role}
          onFeedback={setFeedback}
        />
      </details>
      <button type="button" className="token-context-item" onClick={onOpenSheet}>
        Open {actor.kind === "player-character" ? "character sheet" : "stat block"}
      </button>
      {role === "gm" && gmToken && (
        <button type="button" className="token-context-item" onClick={onPickImage}>
          Set token image…
        </button>
      )}
      {role === "gm" && (
        <button
          type="button"
          className="token-context-item"
          disabled={busy}
          title={
            hiddenFromPlayers
              ? "Reveal this token to players and the shared screen"
              : "Hide this token from players and the shared screen"
          }
          onClick={toggleReveal}
        >
          {hiddenFromPlayers ? "Show to players" : "Hide from players"}
        </button>
      )}
      <button
        type="button"
        className="token-context-item"
        aria-pressed={reactionUsed}
        disabled={busy}
        onClick={toggleReaction}
      >
        {reactionUsed ? "Reaction spent · Restore" : "Use reaction"}
      </button>
      {role === "gm" && placed && (
        <button type="button" className="token-context-item" onClick={onReturnToTray}>
          Return to tray
        </button>
      )}
      {feedback && (
        <p className="token-context-feedback" role="status">
          {feedback}
        </p>
      )}
    </>
  );
}
