import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { EncounterToken, EncounterTokenPosition, GmActor, GmView, HealthDisplay, PlayerActor } from "@vtt/domain";
import { conditionBadgeLabel, healthBandFor } from "../encounter/conditions";
import { avatarUrl, useOnChange } from "@vtt/ui";
import { glideToken } from "./mapLight";
import { pictureOf } from "../actors/actor-picture";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
import { hpFillFraction, TokenAltitudeBadge, TokenHealthAura, TokenStatusBadges } from "./tokenGlyph";

/** One token on the encounter map: its art, health and condition badges, and its keyboard moves. */
export function MapToken({
  encounterToken,
  actor,
  role,
  authToken,
  movable,
  active,
  dragging,
  targetable,
  targeted,
  tableHealthDisplay,
  number,
  label,
  definitions,
  onKeyDown
}: Readonly<{
  encounterToken: EncounterToken & { position: EncounterTokenPosition };
  actor: GmActor | PlayerActor;
  role: "gm" | "player";
  /** The bearer token that fetches token art. */
  authToken: string | null;
  movable: boolean;
  active: boolean;
  dragging: boolean;
  targetable: boolean;
  targeted: boolean;
  /** The table's default (GM view only); a token's own `healthDisplay` overrides it. */
  tableHealthDisplay?: HealthDisplay;
  /** A monster's number among its kind, the same as in every list. */
  number?: number;
  /** The short text under the token. */
  label: string;
  /** The GM's definitions, for the default picture of a character's class. */
  definitions?: GmView["definitions"];
  onKeyDown: (event: KeyboardEvent<SVGGElement>) => void;
}>) {
  const band = healthBandFor(actor.hp);
  // The GM resolves the effective style (token override, else table default); a player gets only the
  // server-resolved style, present when the GM aimed a bar/ring at everyone.
  const healthStyle =
    role === "gm" ? (actor.healthDisplay?.style ?? tableHealthDisplay?.style ?? "band") : actor.healthDisplay?.style;
  const healthFraction = hpFillFraction(actor.hp);
  const healthBar: { style: "bar" | "ring"; fraction: number } | undefined =
    healthStyle === "bar" || healthStyle === "ring" ? { style: healthStyle, fraction: healthFraction } : undefined;
  // The aura paints under the token so the body and active-turn ring stay crisp.
  const auraFraction = healthStyle === "aura" ? healthFraction : undefined;
  const altitude = encounterToken.altitudeFeet ?? 0;
  // On the Border Ethereal (Etherealness, Blink): drawn faint for whoever may see it there.
  const ethereal = actor.effects.some((effect) => effect.tags.includes("ethereal"));
  const glide = useTokenGlide(encounterToken.position, dragging, encounterToken.sizePx, TONE[actor.kind]);
  return (
    <g
      ref={glide}
      data-token-id={actor.id}
      transform={`translate(${encounterToken.position.x} ${encounterToken.position.y})`}
      className={`encounter-token ${actor.kind}${movable ? " movable" : " locked"}${actor.visibility === "gm-only" ? " hidden" : ""}${active ? " active" : ""}${dragging ? " dragging" : ""}${targetable ? " targetable" : ""}${targeted ? " targeted" : ""}${ethereal ? " ethereal" : ""}`}
      role={movable ? "button" : "img"}
      tabIndex={movable ? 0 : undefined}
      aria-label={`${actor.name}${ethereal ? ", on the Border Ethereal" : ""}${altitude > 0 ? `, ${altitude} feet up` : ""}${active ? ", active turn" : ""}${targetable ? (targeted ? ", targeted" : ", can be targeted") : ""}${movable ? ". Drag to move; arrow keys move one step; Delete returns it to the tray." : ", view only."}`}
      aria-keyshortcuts={movable ? "ArrowUp ArrowDown ArrowLeft ArrowRight Delete" : undefined}
      onKeyDown={movable ? onKeyDown : undefined}
    >
      <title>
        {actor.name}
        {actor.visibility === "gm-only" ? " (hidden from players)" : ""}
      </title>
      {auraFraction !== undefined && <TokenHealthAura sizePx={encounterToken.sizePx} fraction={auraFraction} />}
      <AuthorizedTokenGlyph
        assetId={actor.tokenAssetId ?? null}
        token={authToken}
        sizePx={encounterToken.sizePx}
        name={actor.name}
        label={label}
        {...(number !== undefined ? { number } : {})}
        fallbackUrl={avatarUrl(pictureOf(actor, null, definitions).fallback)}
        active={active}
        turnClassName="encounter-token-turn"
        bodyClassName="encounter-token-body"
        initialsClassName="encounter-token-initials"
        nameClassName="encounter-token-name"
        nameY={encounterToken.sizePx * 0.72}
        initialsStyle={{ fontSize: Math.max(10, encounterToken.sizePx * 0.34) }}
        nameStyle={{ fontSize: Math.max(9, encounterToken.sizePx * 0.23) }}
      />
      <TokenStatusBadges
        sizePx={encounterToken.sizePx}
        health={band}
        conditions={actor.conditions.map((condition) => ({
          id: condition.id,
          label: conditionBadgeLabel(condition)
        }))}
        healthBar={healthBar}
      />
      <TokenAltitudeBadge sizePx={encounterToken.sizePx} {...(altitude > 0 ? { altitudeFeet: altitude } : {})} />
    </g>
  );
}

const TONE: Readonly<Record<(GmActor | PlayerActor)["kind"], string>> = {
  "player-character": "lr-tone-party",
  monster: "lr-tone-hostile",
  npc: "lr-tone-neutral"
};
/** How long after a drag ends its move still counts as the dragger's own, which they have already watched land. */
const DRAG_SETTLE_MS = 2000;

/**
 * A token gliding to where it moved (ADR-0045, group 6), with its trail. The token being dragged here, and the move
 * that drag makes, never glide: this device has already shown it there.
 */
function useTokenGlide(position: EncounterTokenPosition, dragging: boolean, size: number, tone: string) {
  const token = useRef<SVGGElement>(null);
  const dragged = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (dragging) dragged.current = performance.now();
  });
  useOnChange(
    position,
    (from, to) => {
      const el = token.current;
      const recent = dragged.current !== null && performance.now() - dragged.current < DRAG_SETTLE_MS;
      if (!el || dragging || recent) return;
      glideToken(el, from, to, size, tone);
    },
    (a, b) => a.x === b.x && a.y === b.y
  );
  return token;
}
