import { useContext, useMemo, useState } from "react";
import { Eyebrow, IconEyeOff, SegmentedControl, useToast, cx } from "@vtt/ui";
import {
  dateToInstant,
  instantToDate,
  type CodexEntityType,
  type CodexCalendar,
  type CodexInWorldDate
} from "@vtt/domain";
import type { CodexConnection, PlayerCodexConnection } from "@vtt/domain";
import { entityColor, entityIconId } from "../entities";
import { EntityIcon, iconChildren } from "../icons";
import { StandingAdjuster } from "../StandingAdjuster";
import { standingLabel, standingValueLabel } from "../chronicle";
import { pagePath, relationshipsPath, type RelationshipsView as ViewId } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { GmCodexContext, PlayerCodexContext, useCodexShell, useGmCodex } from "../shell/context";
import { PagePicker } from "../shared/PagePicker";
import "./relationships.css";

type AnyConnection = CodexConnection | PlayerCodexConnection;
type Node = Readonly<{ id: string; title: string; entityType: CodexEntityType; revealedToPlayers?: boolean }>;
type Tie = Readonly<{
  key: string;
  other: Node;
  /** As the focus page reads it: "Member of" for one it declares, "Member of Tidebound" for one pointing at it. */
  label: string;
  hidden: boolean;
  connection: AnyConnection;
}>;

const capitalized = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const isHidden = (connection: AnyConnection) => "layer" in connection && connection.layer === "gm";

/** What a line says: its label, "mentions" for a link written in a page's text, or "related to". */
const edgeWord = (connection: AnyConnection) =>
  connection.origin === "mention" ? "mentions" : connection.label?.trim() || "related to";

/** The focus page's ties to other pages, declared and mentioned alike, each read from the focus page's side. */
function tiesOf(focus: Node, connections: readonly AnyConnection[], nodes: ReadonlyMap<string, Node>): Tie[] {
  const ties: Tie[] = [];
  for (const connection of connections) {
    if (connection.fromKind !== "page") continue;
    const out = connection.fromId === focus.id;
    const inbound = connection.toPageId === focus.id;
    if (!out && !inbound) continue;
    const other = nodes.get(out ? connection.toPageId : connection.fromId);
    if (!other || other.id === focus.id) continue;
    const label = capitalized(edgeWord(connection));
    ties.push({
      key: `${connection.origin}:${connection.fromId}:${connection.toPageId}:${connection.label ?? ""}`,
      other,
      label: out ? label : `${label} ${focus.title}`,
      hidden: isHidden(connection),
      connection
    });
  }
  return ties;
}

/** Ties grouped under their label, the way a page's panel lists them. */
function TieList({ ties, go }: Readonly<{ ties: readonly Tie[]; go: (path: string) => void }>) {
  const groups = new Map<string, Tie[]>();
  for (const tie of ties) {
    const rows = groups.get(tie.label) ?? [];
    // A page that mentions this one twice is one row.
    if (!rows.some((row) => row.other.id === tie.other.id)) groups.set(tie.label, [...rows, tie]);
  }
  if (ties.length === 0) return <p className="cx-hint">No relationships yet.</p>;
  return (
    <div className="cx-meta-groups">
      {[...groups.entries()].map(([label, rows]) => (
        <div key={label} className="cx-meta-group">
          <span className="cx-meta-key">{label}</span>
          {rows.map((tie) => (
            <button
              key={tie.key}
              type="button"
              className={cx("cx-meta-link", tie.hidden && "is-hidden")}
              onClick={() => go(pagePath(tie.other.id))}
            >
              <EntityIcon type={tie.other.entityType} />
              <span className="cx-meta-link-title">{tie.other.title}</span>
              {tie.hidden && (
                <span className="cx-meta-hidden">
                  <IconEyeOff />
                  Hidden
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One page and its neighbours on labelled lines; a Hidden line is dashed violet. A neighbour re-centres the web. */
function Web({
  focus,
  ties,
  onCentre
}: Readonly<{ focus: Node; ties: readonly Tie[]; onCentre: (id: string) => void }>) {
  const width = 860;
  const height = 600;
  // One node per neighbour, its line naming every declared tie, or "mentions" when the text is the only tie.
  const neighbours = new Map<string, { other: Node; ties: Tie[] }>();
  for (const tie of ties) {
    const entry = neighbours.get(tie.other.id) ?? { other: tie.other, ties: [] };
    entry.ties.push(tie);
    neighbours.set(tie.other.id, entry);
  }
  const lines = [...neighbours.values()].map(({ other, ties: own }) => {
    const declared = own.filter((tie) => tie.connection.origin === "declared");
    const shown = declared.length > 0 ? declared : own.slice(0, 1);
    return {
      other,
      origin: declared.length > 0 ? "declared" : "mention",
      label: [...new Set(shown.map((tie) => edgeWord(tie.connection)))].join(", "),
      hidden: shown.every((tie) => tie.hidden)
    };
  });
  const radius = Math.min(250, 120 + lines.length * 12);
  const placed = lines.map((line, index) => {
    const angle = (index / Math.max(1, lines.length)) * Math.PI * 2 - Math.PI / 2;
    return { line, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const node = (target: Node, x: number, y: number, size: number, hiddenNode: boolean, centre: boolean) => (
    <g
      transform={`translate(${x} ${y})`}
      className={cx("cx-web-node", hiddenNode && "is-hidden", centre && "is-centre")}
    >
      <circle r={size} />
      <svg
        x={-size * 0.55}
        y={-size * 0.55}
        width={size * 1.1}
        height={size * 1.1}
        viewBox="0 0 24 24"
        style={{ color: entityColor(target.entityType) }}
      >
        <g fill="currentColor">{iconChildren(entityIconId(target.entityType))}</g>
      </svg>
      <text y={size + 16} textAnchor="middle" className="cx-web-label">
        {target.title}
      </text>
    </g>
  );
  return (
    <svg
      className="cx-web"
      viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
      role="img"
      aria-label={`${focus.title} and the pages tied to it`}
    >
      {placed.map(({ line, x, y }) => (
        <g key={line.other.id} className={cx("cx-web-edge", line.hidden && "is-hidden")} data-origin={line.origin}>
          <line x1={0} y1={0} x2={x} y2={y} />
          <text x={x / 2} y={y / 2 - 6} textAnchor="middle" className="cx-web-edgelabel">
            {line.label}
          </text>
        </g>
      ))}
      {node(focus, 0, 0, 28, focus.revealedToPlayers === false, true)}
      {placed.map(({ line, x, y }) => (
        <a
          key={`n${line.other.id}`}
          href={pagePath(line.other.id)}
          aria-label={`Centre on ${line.other.title}`}
          onClick={(event) => {
            event.preventDefault();
            onCentre(line.other.id);
          }}
        >
          {node(line.other, x, y, 20, line.other.revealedToPlayers === false, false)}
        </a>
      ))}
    </svg>
  );
}

/** A standing in words: its tier and its signed value, "Hunted -80". */
const standingWords = (value: number) => `${standingLabel(value)} ${standingValueLabel(value)}`;

type StandingRow = Readonly<{ factionPageId: string; value: number; revealedToPlayers?: boolean }>;

/**
 * How each faction stands with every other, from the declared relationships between them, and with the party.
 * The chosen faction's row is marked. A cell with no relationship reads None known.
 */
function FactionsGrid({
  factions,
  connections,
  standing,
  focusId,
  onAdjust
}: Readonly<{
  factions: readonly Node[];
  connections: readonly AnyConnection[];
  standing: readonly StandingRow[];
  focusId: string | null;
  onAdjust?: (factionPageId: string) => void;
}>) {
  const between = (a: Node, b: Node) =>
    connections.find(
      (connection) =>
        connection.origin === "declared" &&
        connection.fromKind === "page" &&
        ((connection.fromId === a.id && connection.toPageId === b.id) ||
          (connection.fromId === b.id && connection.toPageId === a.id))
    );
  if (factions.length === 0) return <p className="cx-hint">No faction pages yet.</p>;
  return (
    <table className="cx-grid">
      <thead>
        <tr>
          <td />
          {factions.map((faction) => (
            <th key={faction.id} scope="col">
              {faction.title}
            </th>
          ))}
          <th scope="col">Toward the party</th>
        </tr>
      </thead>
      <tbody>
        {factions.map((row) => {
          const party = standing.find((entry) => entry.factionPageId === row.id);
          return (
            <tr key={row.id} className={cx(row.id === focusId && "is-focus")}>
              <th scope="row">{row.title}</th>
              {factions.map((col) => {
                if (col.id === row.id) return <td key={col.id} className="cx-grid-self" />;
                const tie = between(row, col);
                return (
                  <td key={col.id} className={cx(tie && "has-tie", tie && isHidden(tie) && "is-hidden")}>
                    {tie ? (
                      <>
                        {capitalized(tie.label?.trim() || "related to")}
                        {isHidden(tie) && <span className="nh-sr-only"> (Hidden)</span>}
                      </>
                    ) : (
                      <span className="cx-hint">None known</span>
                    )}
                  </td>
                );
              })}
              <td className={cx("cx-grid-party", party?.revealedToPlayers === false && "is-hidden")}>
                {onAdjust ? (
                  <button type="button" className="cx-grid-adjust" onClick={() => onAdjust(row.id)}>
                    {party ? standingWords(party.value) : "Not set"}
                    <span className="nh-sr-only"> · Adjust {row.title}'s standing</span>
                  </button>
                ) : party ? (
                  standingWords(party.value)
                ) : (
                  <span className="cx-hint">None known</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The focus page's ties over time: each a bar from when it began (Before for one older than the campaign) to today,
 * with a diamond on when the party learned it.
 */
function OverTime({
  ties,
  calendar
}: Readonly<{ ties: readonly Tie[]; calendar: (CodexCalendar & { currentDate: CodexInWorldDate | null }) | null }>) {
  const instantOf = (date: CodexInWorldDate | null | undefined) =>
    calendar && date ? dateToInstant(calendar, date) : null;
  const today = instantOf(calendar?.currentDate);
  const rows = ties.map((tie) => {
    const began = tie.connection.began;
    const learned = tie.connection.learned;
    return {
      tie,
      start: began?.beforeCampaign ? null : (began?.calendarInstant ?? instantOf(began?.inWorldDate)),
      learnedAt: instantOf(learned?.inWorldDate),
      learnedSession: learned?.sessionNumber ?? null
    };
  });
  const instants = rows.flatMap((row) => [row.start, row.learnedAt]).filter((value): value is number => value !== null);
  if (today !== null) instants.push(today);
  const min = instants.length > 0 ? Math.min(...instants) : 0;
  const max = instants.length > 0 ? Math.max(...instants, min + 1) : 1;
  const left = 22; // the Before lane, in percent of the chart
  const at = (instant: number) => left + ((instant - min) / (max - min)) * (98 - left);
  // A few days along the axis, clear of Today's own label.
  const span = max - min;
  const ticks =
    calendar && span >= 2
      ? [...new Set([0, 0.25, 0.5, 0.75].map((part) => Math.round(min + span * part)))].filter(
          (instant) => today === null || Math.abs(instant - today) > span / 10
        )
      : [];
  const tickLabel = (instant: number) => {
    if (!calendar) return "";
    const date = instantToDate(calendar, instant);
    return `${calendar.months[date.month]?.name ?? ""} ${date.day}`;
  };
  if (ties.length === 0) return <p className="cx-hint">No relationships to draw yet.</p>;
  return (
    <div className="cx-time" role="list" aria-label="Relationships over time">
      <div className="cx-time-axis" aria-hidden="true">
        <span className="cx-time-before" style={{ width: `${left}%` }}>
          Before
        </span>
        {ticks.map((instant) => (
          <span key={instant} className="cx-time-tick" style={{ left: `${at(instant)}%` }}>
            {tickLabel(instant)}
          </span>
        ))}
        {today !== null && (
          <span className="cx-time-today" style={{ left: `${at(today)}%` }}>
            Today
          </span>
        )}
      </div>
      {rows.map(({ tie, start, learnedAt, learnedSession }) => {
        const from = start === null ? 0 : at(start);
        const to = today === null ? 98 : at(today);
        const began = tie.connection.began;
        const when = [
          began
            ? began.beforeCampaign
              ? "Before the campaign"
              : (began.inWorldLabel ?? "A date in the campaign")
            : "No start date",
          tie.connection.learned
            ? learnedSession !== null
              ? `learned in session ${learnedSession}`
              : "learned"
            : tie.hidden
              ? "Hidden"
              : "learned before stamps were kept"
        ].join(" · ");
        return (
          <div key={tie.key} className={cx("cx-time-row", tie.hidden && "is-hidden")} role="listitem">
            <span className="cx-time-name">
              <b>
                {tie.label}: {tie.other.title}
              </b>
              <span>{when}</span>
            </span>
            <span className="cx-time-track" aria-hidden="true">
              <span className="cx-time-bar" style={{ left: `${from}%`, width: `${Math.max(1, to - from)}%` }} />
              {learnedAt !== null && (
                <span className="cx-time-learned" style={{ left: `${at(learnedAt)}%` }}>
                  {learnedSession !== null ? `S${learnedSession}` : ""}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The GM's standing dialog for one faction, from a cell of the grid. */
function AdjustStanding({ faction, onClose }: Readonly<{ faction: Node; onClose: () => void }>) {
  const { token } = useCodexShell();
  const { feeds } = useGmCodex();
  const { toast } = useToast();
  return (
    <StandingAdjuster
      gmToken={token}
      factionPageId={faction.id}
      factionName={faction.title}
      standing={feeds.campaign.standing.find((row) => row.factionPageId === faction.id) ?? null}
      onSaved={() => {
        void feeds.campaignFeed.reload();
        toast("Standing updated.", { tone: "success" });
      }}
      onClose={onClose}
    />
  );
}

const VIEWS: ReadonlyArray<Readonly<{ value: ViewId; label: string }>> = [
  { value: "web", label: "Web" },
  { value: "grid", label: "Factions grid" },
  { value: "time", label: "Over time" }
];

/**
 * Relationships: centre on any page, then see its Web, the Factions grid, or its ties Over time. The GM's lines and
 * cells that players can't read are dashed violet; a player's view holds only what their projection does.
 */
export function RelationshipsView() {
  const { role, query, go, setFilter, phone } = useCodexShell();
  const gm = useContext(GmCodexContext);
  const player = useContext(PlayerCodexContext);
  const [adjusting, setAdjusting] = useState<string | null>(null);

  const gmFeeds = gm?.feeds;
  const playerFeeds = player?.feeds;
  const pages: readonly Node[] = useMemo(
    () => gmFeeds?.pages ?? playerFeeds?.pages ?? [],
    [gmFeeds?.pages, playerFeeds?.pages]
  );
  const connections = useMemo(
    () => (gmFeeds?.connections ?? playerFeeds?.connections ?? []) as unknown as readonly AnyConnection[],
    [gmFeeds?.connections, playerFeeds?.connections]
  );
  const standing: readonly StandingRow[] = gm ? gm.feeds.campaign.standing : (player?.feeds.standing ?? []);
  const calendar = gm ? gm.feeds.campaign.calendar : (player?.feeds.calendar ?? null);
  const nodes = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const factions = useMemo(
    () =>
      pages
        .filter((page) => page.entityType === "faction")
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title)),
    [pages]
  );
  const view = (VIEWS.find((candidate) => candidate.value === query.get("view"))?.value ??
    (phone ? "grid" : "web")) as ViewId;
  const focus = nodes.get(query.get("focus") ?? "") ?? factions[0] ?? pages[0] ?? null;
  const ties = useMemo(() => (focus ? tiesOf(focus, connections, nodes) : []), [focus, connections, nodes]);
  // Only a declared tie has dates, so only those go over time.
  const declaredTies = useMemo(() => ties.filter((tie) => tie.connection.origin === "declared"), [ties]);

  const picker = (
    <PagePicker
      label="Centre on"
      pages={pages}
      value={focus?.id ?? null}
      onChange={(id) => setFilter({ focus: id })}
      className="cx-rel-picker"
    />
  );
  const switcher = (
    <SegmentedControl
      ariaLabel="Relationships view"
      size="sm"
      options={VIEWS.map((option) => ({ value: option.value, label: option.label }))}
      value={view}
      onChange={(next) => setFilter({ view: next === "web" ? null : next })}
    />
  );
  const grid = (
    <div className="cx-grid-scroll" tabIndex={0} aria-label="Factions grid">
      <FactionsGrid
        factions={factions}
        connections={connections}
        standing={standing}
        focusId={focus?.id ?? null}
        onAdjust={role === "gm" ? setAdjusting : undefined}
      />
    </div>
  );
  const adjustingPage = adjusting ? nodes.get(adjusting) : undefined;
  const adjuster = gm && adjustingPage && (
    <AdjustStanding key={adjustingPage.id} faction={adjustingPage} onClose={() => setAdjusting(null)} />
  );
  const tieTitle = focus ? `${focus.title}'s ties` : "Ties";

  const loading = gm ? gm.feeds.list.loading : (player?.feeds.loading ?? false);
  if (pages.length === 0 && loading)
    return (
      <div className="cx-rel">
        <CodexPhoneBar title="Relationships" />
        <p className="cx-empty">Loading the pages.</p>
      </div>
    );
  if (pages.length === 0)
    return (
      <div className="cx-rel">
        <CodexPhoneBar title="Relationships" />
        <p className="cx-empty">
          {role === "gm"
            ? "No pages yet. Relationships appear here once pages are tied to each other."
            : "Relationships appear here once your GM shows the pages they tie."}
        </p>
      </div>
    );

  if (phone)
    return (
      <div className="cx-rel is-phone scroll-y">
        <CodexPhoneBar title="Relationships" />
        <div className="cx-rel-phonebody">
          {picker}
          {switcher}
          {view === "grid" && (
            <>
              <Eyebrow>Factions grid</Eyebrow>
              {grid}
              <span className="cx-hint">Swipe the grid sideways to see every column.</span>
            </>
          )}
          {view === "time" && <OverTime ties={declaredTies} calendar={calendar} />}
          <Eyebrow>{tieTitle}</Eyebrow>
          <TieList ties={ties} go={go} />
        </div>
        {adjuster}
      </div>
    );

  return (
    <div className="cx-rel">
      <div className="cx-sub">
        {picker}
        <span className="cx-grow" />
        {switcher}
      </div>
      <div className="cx-rel-cols">
        <div className="cx-rel-main scroll-y">
          {view === "web" && focus && <Web focus={focus} ties={ties} onCentre={(id) => go(relationshipsPath(id))} />}
          {view === "grid" && grid}
          {view === "time" && <OverTime ties={declaredTies} calendar={calendar} />}
        </div>
        <aside className="cx-page-meta scroll-y" aria-label={tieTitle}>
          <Eyebrow>{tieTitle}</Eyebrow>
          <TieList ties={ties} go={go} />
          {role === "gm" && <span className="cx-hint">Dashed violet lines and rows are hidden.</span>}
        </aside>
      </div>
      {adjuster}
    </div>
  );
}
