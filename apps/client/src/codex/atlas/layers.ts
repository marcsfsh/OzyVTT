import { useCallback, useState } from "react";

/**
 * The atlas's layers, read from what the pins link. People: the character pages a pin links stand at that pin.
 * Factions: a pin that links a faction page is ground that faction holds. Hidden pins: the GM's pins players can't
 * see. A player's pins carry only the pages that player can read, so a player's layers can't show a hidden person or
 * a hidden faction's ground.
 */

export type PersonMark = Readonly<{ id: string; name: string; initials: string; hidden: boolean }>;

export type FactionGround = Readonly<{
  key: string;
  factionId: string;
  name: string;
  x: number;
  y: number;
  /** Which of the eight pin colours paints it. */
  tone: number;
  hidden: boolean;
  /** One label per faction per map, on its first patch. */
  labelled: boolean;
}>;

type LinkingPin = Readonly<{ id: string; x: number; y: number; pageIds: readonly string[] }>;
type LinkedPage = Readonly<{ id: string; title: string; entityType: string; revealedToPlayers?: boolean }>;

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Who stands at each pin: the character pages it links, in link order. */
export function peopleAtPins(
  pins: readonly LinkingPin[],
  pages: readonly LinkedPage[]
): ReadonlyMap<string, readonly PersonMark[]> {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const out = new Map<string, PersonMark[]>();
  for (const pin of pins) {
    const here = pin.pageIds
      .map((id) => byId.get(id))
      .filter((page): page is LinkedPage => page !== undefined && page.entityType === "character")
      .map((page) => ({
        id: page.id,
        name: page.title,
        initials: initialsOf(page.title),
        hidden: page.revealedToPlayers === false
      }));
    if (here.length > 0) out.set(pin.id, here);
  }
  return out;
}

/** The ground each faction holds on this map: a patch around every pin that links the faction's page. */
export function factionGround(pins: readonly LinkingPin[], pages: readonly LinkedPage[]): readonly FactionGround[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const tones = new Map<string, number>();
  const labelled = new Set<string>();
  const out: FactionGround[] = [];
  for (const pin of pins)
    for (const id of pin.pageIds) {
      const page = byId.get(id);
      if (!page || page.entityType !== "faction") continue;
      if (!tones.has(page.id)) tones.set(page.id, (tones.size % 8) + 1);
      out.push({
        key: `${pin.id}-${page.id}`,
        factionId: page.id,
        name: page.title,
        x: pin.x,
        y: pin.y,
        tone: tones.get(page.id)!,
        hidden: page.revealedToPlayers === false,
        labelled: !labelled.has(page.id)
      });
      labelled.add(page.id);
    }
  return out;
}

export type AtlasLayers = Readonly<{ people: boolean; hiddenPins: boolean; factions: boolean }>;
export type AtlasLayer = keyof AtlasLayers;

const LAYERS_KEY = "codex-atlas-layers";
const ALL_ON: AtlasLayers = { people: true, hiddenPins: true, factions: true };

function readLayers(): AtlasLayers {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "null") as Partial<AtlasLayers> | null;
    return saved ? { ...ALL_ON, ...saved } : ALL_ON;
  } catch {
    return ALL_ON;
  }
}

/** Which layers are on, kept per device. */
export function useAtlasLayers() {
  const [layers, setLayers] = useState<AtlasLayers>(readLayers);
  const toggle = useCallback((layer: AtlasLayer) => {
    setLayers((prev) => {
      const next = { ...prev, [layer]: !prev[layer] };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the choice lasts until the page closes */
      }
      return next;
    });
  }, []);
  return [layers, toggle] as const;
}

export const LAYER_META: ReadonlyArray<Readonly<{ id: AtlasLayer; label: string; iconId: string; gmOnly: boolean }>> = [
  { id: "people", label: "People", iconId: "person", gmOnly: false },
  { id: "hiddenPins", label: "Hidden pins", iconId: "eye", gmOnly: true },
  { id: "factions", label: "Factions", iconId: "banner", gmOnly: false }
];
