import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContentSpellSummary } from "@vtt/domain";
import { Modal } from "@vtt/ui";
import { socket } from "../socket";
import { registerContentCache } from "../content/invalidate";
import { RichText } from "./RichText";

/**
 * One shared fetch of the SRD spell reference (rules text + header fields), cached for the session so
 * every spellcasting block links against the same list. Failures are never cached - a transient miss
 * retries on the next mount - mirroring the condition reference fetch. The list powers two things: an
 * in-tab spell-rules card, and the name matcher that turns spell mentions into buttons that open it.
 */
let spellCache: readonly ContentSpellSummary[] | null = null;
let spellInFlight: Promise<void> | null = null;
const spellListeners = new Set<(spells: readonly ContentSpellSummary[]) => void>();
export function requestSpellReference(force = false) {
  if (spellCache && !force) return;
  spellInFlight ??= new Promise((resolve) => {
    socket.emit("content:spells", {}, (result) => {
      spellInFlight = null;
      if (result.ok && result.spells && result.spells.length > 0) {
        spellCache = result.spells;
        for (const listener of spellListeners) listener(spellCache);
      }
      resolve();
    });
  });
}

// A homebrew spell can be published mid-session, so this list is not fixed for the
// session any more. Nothing happens for a cold cache. See `content/invalidate.ts`.
registerContentCache(() => { if (spellCache) requestSpellReference(true); });

export function useSpellReference(): readonly ContentSpellSummary[] {
  const [spells, setSpells] = useState<readonly ContentSpellSummary[]>(spellCache ?? []);
  useEffect(() => {
    // Subscribe unconditionally: a consumer mounting with a warm cache still has to hear
    // about the swap when a publish invalidates it.
    if (spellCache) setSpells(spellCache);
    spellListeners.add(setSpells);
    requestSpellReference();
    return () => { spellListeners.delete(setSpells); };
  }, []);
  return spells;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type SpellIndex = Readonly<{ byName: Map<string, ContentSpellSummary>; matcher: RegExp | null }>;
/** Longest-name-first alternation so "Detect Thoughts" wins over "Detect"; word-bounded, case-insensitive. */
function buildSpellIndex(spells: readonly ContentSpellSummary[]): SpellIndex {
  const byName = new Map<string, ContentSpellSummary>();
  for (const spell of spells) byName.set(spell.name.toLowerCase(), spell);
  if (spells.length === 0) return { byName, matcher: null };
  const escaped = spells
    .map((spell) => spell.name)
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { byName, matcher: new RegExp(`\\b(${escaped.join("|")})\\b`, "gi") };
}

/** Splits a plain-text run on recognized spell names, wrapping each hit in a button that opens its card. */
function linkSpells(text: string, index: SpellIndex, onOpen: (spell: ContentSpellSummary) => void, keyBase: string): ReactNode[] {
  if (!index.matcher) return [text];
  index.matcher.lastIndex = 0;
  const nodes: ReactNode[] = [];
  let last = 0;
  let counter = 0;
  let match: RegExpExecArray | null;
  while ((match = index.matcher.exec(text)) !== null) {
    const spell = index.byName.get(match[0].toLowerCase());
    if (!spell) continue;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const captured = spell;
    nodes.push(<button key={`${keyBase}-${counter++}`} type="button" className="spell-link" title={`Open the ${captured.name} rules`} onClick={() => onOpen(captured)}>{match[0]}</button>);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Bold (**...**) segments stay labels ("At Will:"); only the plain runs between them get spell links. */
function boldSplit(text: string): ReadonlyArray<{ bold: boolean; text: string }> {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    const bold = /^\*\*([\s\S]+)\*\*$/.exec(part);
    return bold ? { bold: true, text: bold[1] } : { bold: false, text: part };
  });
}

/**
 * The stat block's Spellcasting prose, rendered with room to breathe (each line its own paragraph) and
 * every recognized spell name turned into a button that opens the spell's SRD rules in an in-tab card.
 */
export function SpellcastingText({ text }: Readonly<{ text: string }>) {
  const spells = useSpellReference();
  const index = useMemo(() => buildSpellIndex(spells), [spells]);
  const [open, setOpen] = useState<ContentSpellSummary | null>(null);
  const lines = text.replace(/\s*—\s*/g, " - ").split("\n").map((line) => line.trim()).filter(Boolean);
  return <>
    <div className="spellcasting-text">
      {lines.map((line, lineIndex) => {
        const bullet = line.startsWith("- ") || line.startsWith("* ");
        const body = bullet ? line.slice(2) : line;
        const parts: ReactNode[] = [];
        boldSplit(body).forEach((segment, segmentIndex) => {
          if (segment.bold) parts.push(<strong key={`bold-${lineIndex}-${segmentIndex}`}>{segment.text}</strong>);
          else parts.push(...linkSpells(segment.text, index, setOpen, `plain-${lineIndex}-${segmentIndex}`));
        });
        return <p key={lineIndex} className={bullet ? "spellcasting-line spellcasting-bullet" : "spellcasting-line"}>{bullet ? "• " : null}{parts}</p>;
      })}
    </div>
    {open && <SpellCard spell={open} onClose={() => setOpen(null)} />}
  </>;
}

/** In-tab spell rules window: header, the four reference lines, full description, and upcast note. */
export function SpellCard({ spell, onClose }: Readonly<{ spell: ContentSpellSummary; onClose: () => void }>) {
  const levelLine = spell.level === 0 ? `${capitalize(spell.school)} cantrip` : `Level ${spell.level} ${spell.school}`;
  return <Modal open onClose={onClose} size="md" accent="violet" title={spell.name} ariaLabel={`${spell.name} spell rules`}>
    <p className="spell-card-type">{levelLine}{spell.ritual ? " · ritual" : ""}</p>
    <dl className="spell-card-meta">
      <div><dt>Casting Time</dt><dd>{capitalize(spell.castingTime)}</dd></div>
      <div><dt>Range</dt><dd>{spell.rangeText ?? "Self"}</dd></div>
      <div><dt>Components</dt><dd>{spell.componentsText}</dd></div>
      <div><dt>Duration</dt><dd>{spell.concentration ? `Concentration, ${spell.duration}` : spell.duration}</dd></div>
    </dl>
    <div className="spell-card-desc"><RichText text={spell.description} /></div>
    {spell.higherLevel && <div className="spell-card-higher"><RichText text={`**At Higher Levels.** ${spell.higherLevel}`} /></div>}
    <p className="spell-card-attribution">SRD 5.2.1, CC BY 4.0.</p>
  </Modal>;
}
