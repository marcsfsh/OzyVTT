import { useEffect, useState } from "react";
import { IconEye, IconUser, Menu, MenuItem, Switch, type PartyCharacter } from "@vtt/ui";
import { codexApi } from "../api";

/** Who the GM is reading as: Everyone (null) or one party character. */
export type SeeAsViewer = Readonly<{ characterId: string | null }>;

/**
 * See as players, in place: a switch, and beside it the viewer it reads as (Everyone or one character). While it is
 * on the page shows exactly what that viewer's player receives, read through a preview token the server mints.
 */
export function SeeAsControl({
  on,
  viewer,
  party,
  onChange,
  compact = false
}: Readonly<{
  on: boolean;
  viewer: SeeAsViewer;
  party: readonly PartyCharacter[];
  onChange: (on: boolean, viewer: SeeAsViewer) => void;
  /** A phone's top bar: the menu alone, its first item turning the preview off. */
  compact?: boolean;
}>) {
  const name = viewer.characterId
    ? (party.find((character) => character.id === viewer.characterId)?.name ?? "A character")
    : "Everyone";
  const items = (
    <>
      <MenuItem
        role="menuitemradio"
        aria-checked={on && viewer.characterId === null}
        icon={<IconEye />}
        onClick={() => onChange(true, { characterId: null })}
      >
        Everyone
      </MenuItem>
      {party.map((character) => (
        <MenuItem
          key={character.id}
          role="menuitemradio"
          aria-checked={on && viewer.characterId === character.id}
          icon={<IconUser />}
          onClick={() => onChange(true, { characterId: character.id })}
        >
          {character.name}
        </MenuItem>
      ))}
    </>
  );
  if (compact)
    return (
      <Menu
        icon
        align="end"
        label={on ? `See as players: ${name}` : "See as players"}
        className="cx-seeas-menu"
        trigger={<IconEye />}
      >
        {on && (
          <MenuItem role="menuitemradio" aria-checked={false} onClick={() => onChange(false, viewer)}>
            Turn off See as players
          </MenuItem>
        )}
        {items}
      </Menu>
    );
  return (
    <span className="cx-seeas">
      <Switch checked={on} onChange={(next) => onChange(next, viewer)} label="See as players" />
      <Menu align="end" label={`See as: ${name}`} trigger={name} className="cx-seeas-menu">
        {items}
      </Menu>
    </span>
  );
}

/**
 * A preview token for the viewer while See as players is on, minted once per viewer and kept, so switching back
 * and forth costs one request per viewer. Null while it is off or loading.
 */
export function usePreviewToken(gmToken: string, on: boolean, viewer: SeeAsViewer) {
  const [tokens, setTokens] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const key = viewer.characterId ?? "everyone";
  useEffect(() => {
    if (!on || tokens.has(key)) return;
    let live = true;
    setError(null);
    codexApi
      .createPreviewSession(gmToken, viewer.characterId)
      .then((token) => {
        if (live) setTokens((current) => new Map(current).set(key, token));
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "Couldn't open the player preview.");
      });
    return () => {
      live = false;
    };
  }, [gmToken, on, key, viewer.characterId, tokens]);
  return { token: on ? (tokens.get(key) ?? null) : null, error: on ? error : null };
}
