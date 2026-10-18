import { useCallback } from "react";
import { Eyebrow, IconChevronRight, IconEyeOff, IconUser, cx } from "@vtt/ui";
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
import type { CodexBlock } from "../contract";
import { characterNames, namesLabel, type PartyCharacter } from "../shared/audience";

/** Where the page's kind group lists it: People, Places, Factions, Things or Lore. */
export const groupPath = (type: CodexEntityType) => withQuery(pathForSection("pages"), { group: kindGroupOf(type).id });

/** The crumbs over a page's title: its kind group, then the page. */
export function PageCrumbs({
  title,
  entityType,
  go
}: Readonly<{ title: string; entityType: CodexEntityType; go: (path: string) => void }>) {
  return (
    <nav className="cx-crumbs" aria-label="Where this page sits">
      <button type="button" className="cx-crumb" onClick={() => go(groupPath(entityType))}>
        {kindGroupOf(entityType).label}
      </button>
      <IconChevronRight className="cx-crumb-sep" />
      <b className="cx-crumb-here">{title}</b>
    </nav>
  );
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

/** A record's header on a phone: initials, the title, and the kind with the role or kind field beside it. */
export function PhoneRecordHeader({
  title,
  entityType,
  fields
}: Readonly<{ title: string; entityType: CodexEntityType; fields: Readonly<Record<string, string>> }>) {
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  const role = fields.role?.trim() || fields.kind?.trim() || fields.type?.trim();
  return (
    <div className="cx-recordhead">
      <span className="cx-recordhead-avatar" aria-hidden="true">
        {initials}
      </span>
      <div className="cx-recordhead-text">
        <h1 className="cx-page-title is-phone">{title}</h1>
        <span className="cx-recordhead-sub">
          {entityDef(entityType).label}
          {role ? ` · ${role}` : ""}
        </span>
      </div>
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
        <span key={names} className="cx-aud is-characters">
          <IconUser className="cx-aud-icon" />
          {count} {count === 1 ? "block" : "blocks"} revealed to {names}
        </span>
      ))}
      {hiddenParts.length > 0 && (
        <span className="cx-aud is-hidden">
          <IconEyeOff className="cx-aud-icon" />
          {hiddenParts.join(" and ")} hidden
        </span>
      )}
    </>
  );
}

/** A stretch of player text as the reader reads it. */
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
      <CodexMarkdown text={text} token={token} audience={audience} onNavigate={onNavigate} knownTitles={knownTitles} />
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
