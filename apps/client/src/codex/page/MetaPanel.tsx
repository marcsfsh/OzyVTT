import { Eyebrow, IconEyeOff, Skeleton, cx } from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import type { CodexPageConnection, PlayerCodexPageConnection } from "@vtt/domain";
import { entityDef } from "../entities";
import { CodexIcon, EntityIcon } from "../icons";
import { MiniMap } from "../shared/MiniMap";
import type { usePagePins } from "./pageParts";

export type AnyPageConnection = CodexPageConnection | PlayerCodexPageConnection;
export type MetaField = Readonly<{ key: string; label: string; value: string; hidden: boolean }>;

const KIND_ICON: Readonly<Record<AnyPageConnection["otherKind"], string>> = {
  page: "scroll",
  session: "sessions",
  quest: "quest",
  journal: "book"
};

const capitalized = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** A page's fields in the order its kind lists them, each with its value and whether only the GM sees it. */
export function metaFields(
  entityType: CodexEntityType,
  fields: Readonly<Record<string, string>>,
  hiddenFields: readonly string[] = []
): MetaField[] {
  return entityDef(entityType)
    .fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: fields[field.key] ?? "",
      hidden: hiddenFields.includes(field.key)
    }))
    .filter((field) => field.value.trim() !== "");
}

/**
 * Declared relationships grouped by label. One this page declares reads by its label ("Member of"); one pointing
 * here reads with the page's name ("Member of Tidebound"), since a label has no inverse wording.
 */
export function relationshipGroups(
  connections: readonly AnyPageConnection[],
  pageTitle: string
): ReadonlyArray<Readonly<{ heading: string; rows: readonly AnyPageConnection[] }>> {
  const groups = new Map<string, AnyPageConnection[]>();
  for (const row of connections) {
    if (row.origin !== "declared") continue;
    const label = row.label?.trim() || "Related to";
    const heading = row.direction === "out" ? capitalized(label) : `${capitalized(label)} ${pageTitle}`;
    groups.set(heading, [...(groups.get(heading) ?? []), row]);
  }
  return [...groups.entries()].map(([heading, rows]) => ({ heading, rows }));
}

const isHiddenRow = (row: AnyPageConnection) => "layer" in row && row.layer === "gm";

function ConnectionButton({
  row,
  onOpen
}: Readonly<{ row: AnyPageConnection; onOpen: (kind: AnyPageConnection["otherKind"], id: string) => void }>) {
  const hidden = isHiddenRow(row);
  return (
    <button
      type="button"
      className={cx("cx-meta-link", hidden && "is-hidden")}
      onClick={() => onOpen(row.otherKind, row.otherId)}
    >
      {row.otherKind === "page" && row.otherEntityType ? (
        <EntityIcon type={row.otherEntityType} />
      ) : (
        <CodexIcon iconId={KIND_ICON[row.otherKind]} className="codex-ent-icon" />
      )}
      <span className="cx-meta-link-title">{row.otherTitle}</span>
      {hidden && (
        <span className="cx-meta-hidden">
          <IconEyeOff />
          Hidden
        </span>
      )}
    </button>
  );
}

/** A page's relationships, grouped by label. */
export function RelationshipList({
  connections,
  pageTitle,
  onOpen
}: Readonly<{
  connections: readonly AnyPageConnection[];
  pageTitle: string;
  onOpen: (kind: AnyPageConnection["otherKind"], id: string) => void;
}>) {
  const groups = relationshipGroups(connections, pageTitle);
  if (groups.length === 0) return <p className="cx-hint">No relationships yet.</p>;
  return (
    <div className="cx-meta-groups">
      {groups.map((group) => (
        <div key={group.heading} className="cx-meta-group">
          <span className="cx-meta-key">{group.heading}</span>
          {group.rows.map((row) => (
            <ConnectionButton key={`${row.otherKind}:${row.otherId}:${row.direction}`} row={row} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The fields as a list of label and value, the Hidden ones marked. */
export function FieldList({ fields }: Readonly<{ fields: readonly MetaField[] }>) {
  if (fields.length === 0) return null;
  return (
    <dl className="cx-meta-fields">
      {fields.map((field) => (
        <div key={field.key} className={cx("cx-meta-row", field.hidden && "is-hidden")}>
          <dt className="cx-meta-key">
            {field.label}
            {field.hidden && (
              <span className="cx-meta-hidden">
                <IconEyeOff />
                Hidden
              </span>
            )}
          </dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Where a page sits on the atlas: the first pin that links it, as a still map, and every pin by name. */
export function OnTheAtlas({
  token,
  pins,
  onOpenPin,
  height = 120
}: Readonly<{
  token: string;
  pins: ReturnType<typeof usePagePins>;
  onOpenPin: (markerId: string, mapId: string) => void;
  height?: number;
}>) {
  if (pins.loading) return <Skeleton variant="block" height="4rem" />;
  const markers = pins.data?.markers ?? [];
  const maps = pins.data?.maps ?? [];
  if (pins.error)
    return (
      <section className="cx-meta-section" aria-label="On the atlas">
        <Eyebrow>On the atlas</Eyebrow>
        <p className="cx-hint" role="alert">
          {pins.error}
        </p>
      </section>
    );
  if (markers.length === 0) return null;
  const first = markers[0];
  const map = maps.find((candidate) => candidate.id === first.mapId);
  return (
    <section className="cx-meta-section" aria-label="On the atlas">
      <Eyebrow>On the atlas</Eyebrow>
      {map && (
        <button
          type="button"
          className="cx-meta-map"
          aria-label={`Open ${first.label?.trim() || map.name} on the atlas`}
          onClick={() => onOpenPin(first.id, first.mapId)}
        >
          <MiniMap token={token} assetId={map.assetId} pin={first} height={height} />
        </button>
      )}
      {markers.map((marker) => {
        const pinMap = maps.find((candidate) => candidate.id === marker.mapId);
        const hidden = "revealedToPlayers" in marker && !marker.revealedToPlayers;
        return (
          <button
            key={marker.id}
            type="button"
            className={cx("cx-meta-link", hidden && "is-hidden")}
            onClick={() => onOpenPin(marker.id, marker.mapId)}
          >
            <CodexIcon iconId="pin" className="codex-ent-icon" />
            <span className="cx-meta-link-title">
              {marker.label?.trim() || "Unlabelled pin"}
              {pinMap ? ` · ${pinMap.name}` : ""}
            </span>
            {hidden && (
              <span className="cx-meta-hidden">
                <IconEyeOff />
                Hidden
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}

/** The records whose text names this page. */
export function MentionedOn({
  connections,
  onOpen
}: Readonly<{
  connections: readonly AnyPageConnection[];
  onOpen: (kind: AnyPageConnection["otherKind"], id: string) => void;
}>) {
  const rows = connections.filter((row) => row.origin === "mention" && row.direction === "in");
  if (rows.length === 0) return null;
  return (
    <section className="cx-meta-section" aria-label="Mentioned on">
      <Eyebrow>Mentioned on</Eyebrow>
      <div className="cx-meta-chips">
        {rows.map((row) => (
          <ConnectionButton key={`${row.otherKind}:${row.otherId}`} row={row} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

/** The page's tags, each opening everything else that carries it. */
export function TagChips({ tags, onPick }: Readonly<{ tags: readonly string[]; onPick: (tag: string) => void }>) {
  if (tags.length === 0) return null;
  return (
    <ul className="cx-meta-chips" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <button type="button" className="cx-tag interactive" onClick={() => onPick(tag)}>
            #{tag}
          </button>
        </li>
      ))}
    </ul>
  );
}
