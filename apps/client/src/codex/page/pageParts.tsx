import { useCallback } from "react";
import { Eyebrow, IconEyeOff, IconUser, cx, characterNames, namesLabel, type PartyCharacter, Crumb } from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import { atlasApi, codexApi, playerCodexApi } from "../api";
import { entityDef } from "../entities";
import { EntityIcon } from "../icons";
import { CodexMarkdown } from "../CodexMarkdown";
import { MiniMap } from "../shared/MiniMap";
import { useCodexQuery } from "../useCodexQuery";
import { pathForSection } from "../routes";
import { withQuery } from "../../router";
import { kindGroupOf } from "./document";
import type { CodexBlock } from "@vtt/domain";

/** Where the page's kind group lists it: People, Places, Factions, Things or Lore. */
export const groupPath = (type: CodexEntityType) => withQuery(pathForSection("pages"), { group: kindGroupOf(type).id });

/** The crumb on a page's title line (theme rule 14): back to its kind group, People, Places, Factions, Things or Lore. */
export function PageCrumb({ entityType, go }: Readonly<{ entityType: CodexEntityType; go: (path: string) => void }>) {
  const label = kindGroupOf(entityType).label;
  return <Crumb label={label} href={groupPath(entityType)} onClick={() => go(groupPath(entityType))} />;
}

/** The page's kind as a chip with its glyph. */
export function KindChip({ type }: Readonly<{ type: CodexEntityType }>) {
  return (
    <span className="cx-kind">
      <EntityIcon type={type} />
      {entityDef(type).label}
    </span>
  );
}

/** Every pin that links the page, with the maps they sit on, read on the reader's own token. */
export function usePagePins(role: "gm" | "player", token: string | null, pageId: string) {
  const load = useCallback(async () => {
    const reader = token ?? "";
    const [markers, maps] = await Promise.all([
      codexApi.markersForPage(reader, pageId),
      role === "gm" ? atlasApi.listMaps(reader) : playerCodexApi.listMaps(reader)
    ]);
    return { markers, maps };
  }, [role, token, pageId]);
  return useCodexQuery(token ? load : null, { failure: "Couldn't read where this page is on the atlas." });
}

/** A phone's map header: the map at the page's first pin, which scrolls away with the page. */
export function PageMapHeader({
  token,
  pins,
  onOpenPin
}: Readonly<{
  token: string;
  pins: ReturnType<typeof usePagePins>;
  onOpenPin: (markerId: string, mapId: string) => void;
}>) {
  const first = pins.data?.markers[0];
  const map = first && pins.data?.maps.find((candidate) => candidate.id === first.mapId);
  if (!first || !map) return null;
  return (
    <button type="button" className="cx-maphead" onClick={() => onOpenPin(first.id, first.mapId)}>
      <MiniMap token={token} assetId={map.assetId} pin={first} height={150} />
      <span className="cx-maphead-chip">{first.label?.trim() || map.name}</span>
    </button>
  );
}

/** A record's title on a phone (Codex frame 2.2): the title at 20px, then its line (the kind, and for the GM who sees it). */
export function PhoneRecordHeader({ title, children }: Readonly<{ title: string; children?: React.ReactNode }>) {
  return (
    <div className="cx-recordhead">
      <h1 className="cx-page-title is-phone">{title}</h1>
      {children}
    </div>
  );
}

/**
 * The GM's visibility line beside the page audience: how many blocks went to chosen characters, and what stays
 * Hidden. Counts the GM's own page only; nothing like it reaches a player.
 */
export function VisibilityCounts({
  blocks,
  hiddenFields,
  fields,
  party
}: Readonly<{
  blocks: readonly CodexBlock[];
  hiddenFields: readonly string[];
  fields: Readonly<Record<string, string>>;
  party: readonly PartyCharacter[];
}>) {
  const byCharacters = new Map<string, number>();
  for (const block of blocks)
    if (block.audience === "characters") {
      const key = namesLabel(characterNames(block.characterIds, party));
      byCharacters.set(key, (byCharacters.get(key) ?? 0) + 1);
    }
  const hiddenBlocks = blocks.filter((block) => block.audience === "hidden").length;
  const hiddenFieldCount = hiddenFields.filter((key) => (fields[key] ?? "").trim()).length;
  const hiddenParts = [
    hiddenBlocks > 0 ? `${hiddenBlocks} ${hiddenBlocks === 1 ? "block" : "blocks"}` : null,
    hiddenFieldCount > 0 ? `${hiddenFieldCount} ${hiddenFieldCount === 1 ? "field" : "fields"}` : null
  ].filter(Boolean);
  return (
    <>
      {[...byCharacters.entries()].map(([names, count]) => (
        <span key={names} className="nh-aud is-characters">
          <IconUser className="nh-aud-icon" />
          {count} {count === 1 ? "block" : "blocks"} revealed to {names}
        </span>
      ))}
      {hiddenParts.length > 0 && (
        <span className="nh-aud is-hidden" aria-label={`${hiddenParts.join(" and ")} hidden`}>
          <IconEyeOff className="nh-aud-icon" />
          {hiddenParts.join(", ")}
        </span>
      )}
    </>
  );
}

/** A stretch of player text as the reader reads it. The GM's copy offers to make the page a missing link names. */
export function DocText({
  text,
  token,
  audience,
  onNavigate,
  knownTitles,
  className
}: Readonly<{
  text: string;
  token: string;
  audience: "gm" | "player";
  onNavigate: (target: string) => void;
  knownTitles?: ReadonlySet<string>;
  className?: string;
}>) {
  return (
    <div className={cx("cx-doc-text", className)}>
      <CodexMarkdown
        text={text}
        token={token}
        audience={audience}
        onNavigate={onNavigate}
        knownTitles={knownTitles}
        onCreate={audience === "gm" ? onNavigate : undefined}
      />
    </div>
  );
}

/** An eyebrow-headed section of a page's side panel. */
export function MetaSection({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <section className="cx-meta-section" aria-label={label}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </section>
  );
}
