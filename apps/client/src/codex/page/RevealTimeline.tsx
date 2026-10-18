import { Eyebrow, characterNames, type PartyCharacter } from "@vtt/ui";
import { entityDef } from "../entities";
import type { CodexEntityType } from "@vtt/domain";
import type { CodexBlock, PlayerCodexBlock } from "@vtt/domain";

type Row = Readonly<{
  at: string;
  sessionNumber: number | null;
  inWorldLabel: string | null;
  text: string;
}>;

const shortDate = (at: string) => {
  const day = new Date(at);
  return Number.isNaN(day.getTime()) ? "" : day.toLocaleDateString(undefined, { month: "long", day: "numeric" });
};

function TimelineRows({ rows, hiddenNote }: Readonly<{ rows: readonly Row[]; hiddenNote?: string | null }>) {
  return (
    <section className="cx-timeline" aria-label="Timeline">
      <Eyebrow>Timeline</Eyebrow>
      {rows.length === 0 && !hiddenNote && <p className="cx-hint">Nothing on this page has reached players yet.</p>}
      <ol className="cx-timeline-list">
        {rows.map((row, index) => (
          <li key={index} className="cx-timeline-row">
            <span className="cx-timeline-when">
              <b>{row.sessionNumber !== null ? `Session ${row.sessionNumber}` : shortDate(row.at)}</b>
              {row.inWorldLabel && <span>{row.inWorldLabel}</span>}
            </span>
            <span className="cx-timeline-what">{row.text}</span>
          </li>
        ))}
        {hiddenNote && (
          <li className="cx-timeline-row is-hidden">
            <span className="cx-timeline-when">
              <b>Hidden</b>
            </span>
            <span className="cx-timeline-what">{hiddenNote}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

const blockName = (title: string | null) => (title?.trim() ? `The block ${title.trim()}` : "A block");

/**
 * The GM's Timeline at the foot of a page: when players could first read it, each block's reveal with its session
 * and the players' date, and what has never been revealed.
 */
export function GmRevealTimeline({
  firstShownAt,
  blocks,
  hiddenFields,
  fields,
  entityType,
  party
}: Readonly<{
  firstShownAt: string | null;
  blocks: readonly CodexBlock[];
  hiddenFields: readonly string[];
  fields: Readonly<Record<string, string>>;
  entityType: CodexEntityType;
  party: readonly PartyCharacter[];
}>) {
  const rows: Row[] = [];
  if (firstShownAt)
    rows.push({ at: firstShownAt, sessionNumber: null, inWorldLabel: null, text: "The page was shown to everyone." });
  for (const block of blocks)
    for (const reveal of block.reveals) {
      const who = reveal.to === "everyone" ? "everyone" : (characterNames([reveal.to], party)[0] ?? "a character");
      rows.push({
        at: reveal.at,
        sessionNumber: reveal.sessionNumber,
        inWorldLabel: reveal.inWorldLabel,
        text: `${blockName(block.title)} was revealed to ${who}.`
      });
    }
  rows.sort((a, b) => a.at.localeCompare(b.at));

  const neverBlocks = blocks.filter((block) => block.reveals.length === 0).length;
  const labels = new Map(entityDef(entityType).fields.map((field) => [field.key, field.label]));
  const neverFields = hiddenFields.filter((key) => (fields[key] ?? "").trim()).map((key) => labels.get(key) ?? key);
  const parts = [
    neverBlocks > 0 ? `${neverBlocks} ${neverBlocks === 1 ? "block" : "blocks"}` : null,
    neverFields.length === 1
      ? `the ${neverFields[0]} field`
      : neverFields.length > 1
        ? `${neverFields.length} fields`
        : null
  ].filter((part): part is string => part !== null);
  const total = neverBlocks + neverFields.length;
  const hiddenNote =
    parts.length === 0 ? null : `${parts.join(" and ")} ${total === 1 ? "has" : "have"} never been revealed.`;
  return (
    <TimelineRows rows={rows} hiddenNote={hiddenNote ? hiddenNote[0].toUpperCase() + hiddenNote.slice(1) : null} />
  );
}

/** A player's Timeline: when the page was first shown, and when each block they read reached them. */
export function PlayerRevealTimeline({
  firstShownAt,
  blocks
}: Readonly<{ firstShownAt: string; blocks: readonly PlayerCodexBlock[] }>) {
  const rows: Row[] = [
    { at: firstShownAt, sessionNumber: null, inWorldLabel: null, text: "The page was shown to everyone." },
    ...blocks.map((block) => ({
      at: block.revealed.at,
      sessionNumber: block.revealed.sessionNumber,
      inWorldLabel: block.revealed.inWorldLabel,
      text: `${blockName(block.title)} was revealed to ${block.characterIds.length > 0 ? "you" : "everyone"}.`
    }))
  ];
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return <TimelineRows rows={rows} />;
}
