import { useCallback } from "react";
import { Badge, Button, HiddenFromPlayers, IconButton, IconChevronRight, IconPencil, IconPlay, IconX } from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import { journalApi } from "../api";
import { ENTITY_DEFS } from "../entities";
import { CodexIcon, EntityIcon, pinSwatchVar } from "../icons";
import { useCodexQuery } from "../useCodexQuery";
import { EVERYONE, HIDDEN } from "../shared/audience";
import { AudienceChip } from "../shared/WhoSeesIt";

type ViewedPin = Readonly<{
  id: string;
  label: string | null;
  iconId: string;
  iconColor: string;
  tags: readonly string[];
  pageIds: readonly string[];
  subMapId: string | null;
  isParty: boolean;
  revealedToPlayers?: boolean;
  sceneIds?: readonly string[];
}>;
type ViewedPage = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
}>;
type ViewedScene = Readonly<{ id: string; name: string }>;

/** The line under a linked page's name: its role or kind when the GM wrote one, else what the page is. */
function pageLine(page: ViewedPage): string {
  const said = page.fields?.role?.trim() || page.fields?.kind?.trim();
  return said || ENTITY_DEFS[page.entityType].label;
}

/**
 * A pin as it reads: its name, who sees it, the pages it links, the map it opens and, for the GM, the scenes staged
 * there and the journal written at it. Viewing is separate from editing: Edit pin opens the form.
 */
export function PinView({
  gmToken = null,
  pin,
  pages,
  mapName,
  scenes = [],
  activeSceneId = null,
  onOpenPage,
  onOpenMap,
  onEdit,
  onSetParty,
  onActivateScene,
  onOpenReplay,
  onClose
}: Readonly<{
  /** The GM's token, which also turns on the GM's parts; null for a player. */
  gmToken?: string | null;
  pin: ViewedPin;
  pages: readonly ViewedPage[];
  mapName: (mapId: string) => string | null;
  scenes?: readonly ViewedScene[];
  activeSceneId?: string | null;
  onOpenPage: (pageId: string) => void;
  onOpenMap: (mapId: string) => void;
  onEdit?: () => void;
  onSetParty?: () => void;
  onActivateScene?: (sceneId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  onClose: () => void;
}>) {
  const gm = gmToken !== null;
  const linked = pin.pageIds
    .map((id) => pages.find((page) => page.id === id))
    .filter((page): page is ViewedPage => page !== undefined);
  const subMapName = pin.subMapId ? mapName(pin.subMapId) : null;
  const staged = (pin.sceneIds ?? [])
    .map((id) => scenes.find((scene) => scene.id === id))
    .filter((scene): scene is ViewedScene => scene !== undefined);
  const label = pin.label?.trim() || "Unlabelled pin";

  return (
    <section className="atlas-pinview" aria-label={`Pin: ${label}`}>
      <header className="atlas-pinview-head">
        <CodexIcon iconId={pin.iconId} className="atlas-pinview-icon" style={{ color: pinSwatchVar(pin.iconColor) }} />
        <h3 className="atlas-pinview-title">{label}</h3>
        {gm && <AudienceChip value={pin.revealedToPlayers === false ? HIDDEN : EVERYONE} party={[]} />}
        <IconButton label="Close" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </header>

      {pin.isParty && <p className="atlas-note">The party is here.</p>}

      {linked.length > 0 && (
        <ul className="atlas-pagelist" aria-label="Linked pages">
          {linked.map((page) => (
            <li key={page.id}>
              <button type="button" className="atlas-pagerow" onClick={() => onOpenPage(page.id)}>
                <EntityIcon type={page.entityType} className="atlas-pagerow-icon" />
                <span className="atlas-pagerow-text">
                  <span className="atlas-pagerow-title">{page.title}</span>
                  <span className="atlas-pagerow-line">{pageLine(page)}</span>
                </span>
                <IconChevronRight className="atlas-pagerow-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pin.subMapId && subMapName && (
        <Button variant="secondary" size="sm" arrow onClick={() => onOpenMap(pin.subMapId!)}>
          Open {subMapName}
        </Button>
      )}

      {gm && staged.length > 0 && (
        <div className="atlas-pinview-scenes">
          <h4 className="atlas-eyebrow">Scenes staged here</h4>
          {staged.map((scene) => (
            <div key={scene.id} className="atlas-scenerow">
              <span className="atlas-ellipsis">{scene.name}</span>
              {activeSceneId === scene.id ? (
                <Badge tone="success">Live</Badge>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => onActivateScene?.(scene.id)}>
                  <IconPlay /> Go live
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {pin.tags.length > 0 && (
        <ul className="atlas-tags" aria-label="Tags">
          {pin.tags.map((tag) => (
            <li key={tag}>
              <Badge>#{tag}</Badge>
            </li>
          ))}
        </ul>
      )}

      {linked.length === 0 && !subMapName && staged.length === 0 && (
        <p className="atlas-empty">
          {gm
            ? "This pin links nothing yet. Edit the pin to link pages or a map."
            : "Nothing has been shared about this place yet."}
        </p>
      )}

      {gm && (
        <div className="atlas-pinview-actions">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <IconPencil /> Edit pin
          </Button>
          <Button variant="secondary" size="sm" onClick={onSetParty}>
            <CodexIcon iconId="flag" className="atlas-btnicon" /> Set party position here
          </Button>
        </div>
      )}

      {gm && gmToken && <PinJournal gmToken={gmToken} pinId={pin.id} onOpenReplay={onOpenReplay} />}
    </section>
  );
}

/** What the journal holds at this pin, battles fought here included. A failed read shows nothing. */
function PinJournal({
  gmToken,
  pinId,
  onOpenReplay
}: Readonly<{ gmToken: string; pinId: string; onOpenReplay?: (archiveId: number) => void }>) {
  const history = useCodexQuery(useCallback(() => journalApi.forMarker(gmToken, pinId), [gmToken, pinId]));
  const entries = history.error ? [] : (history.data ?? []);
  return (
    <div className="atlas-pinjournal">
      <h4 className="atlas-eyebrow">Journal</h4>
      {entries.length === 0 ? (
        <p className="atlas-empty">Nothing logged at this pin yet. Battles fought here are logged automatically.</p>
      ) : (
        <ul className="atlas-pinjournal-list">
          {entries.map((entry) => (
            <li key={entry.id} className="atlas-pinjournal-item">
              <span className="atlas-pinjournal-meta">
                {entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}
                {[entry.sessionNumber != null ? `Session ${entry.sessionNumber}` : null, entry.inWorldLabel]
                  .filter(Boolean)
                  .join(" · ")}
                {!entry.revealedToPlayers && <HiddenFromPlayers />}
              </span>
              <span>{entry.playerText || entry.gmText}</span>
              {entry.kind === "combat" && entry.sourceEncounterId !== null && onOpenReplay && (
                <button
                  type="button"
                  className="atlas-linkbutton"
                  onClick={() => onOpenReplay(entry.sourceEncounterId!)}
                >
                  Open replay
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
