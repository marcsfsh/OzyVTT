import type { KeyboardEvent } from "react";
import type { EncounterToken, EncounterTokenPosition, GmActor, HealthDisplay, PlayerActor } from "@vtt/domain";
import { conditionBadgeLabel, healthBandFor } from "../encounter/conditions";
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
  return (
    <g
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
