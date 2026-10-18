import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Button,
  IconButton,
  IconChevron,
  IconEyeOff,
  IconList,
  IconMore,
  IconPlus,
  IconTrash,
  Input,
  Menu,
  MenuItem,
  Textarea,
  applyMarkdownFormat,
  cx
} from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import type { CodexBlock } from "@vtt/domain";
import { entityDef } from "../entities";
import { EntityIcon } from "../icons";
import { HiddenBlock } from "../shared/HiddenBlock";
import { HIDDEN, sinceLabel, type Audience, type PartyCharacter } from "../shared/audience";
import { nextDraftKey, splitForBlock, type DraftItem } from "./document";
import { stampOf } from "../shared/reveals";

type Page = Readonly<{ id: string; title: string; entityType: CodexEntityType }>;

/** When the caret sits inside an unclosed `[[…`, the open bracket's offset and the typed name. */
function linkContext(value: string, caret: number): { start: number; query: string } | null {
  const prefix = value.slice(0, caret);
  const open = prefix.lastIndexOf("[[");
  if (open === -1) return null;
  const query = prefix.slice(open + 2);
  if (/[[\]\n]/.test(query)) return null;
  return { start: open, query };
}

/** A `/` typed at the start of a line, with the caret just after it, opens the block menu. */
function slashAt(value: string, caret: number): number | null {
  if (caret < 1 || value[caret - 1] !== "/") return null;
  const before = caret - 2;
  return before < 0 || value[before] === "\n" ? caret - 1 : null;
}

/** A textarea that grows with what is written in it, so the document reads as one page. */
function GrowingArea({
  value,
  onChange,
  areaRef,
  ...rest
}: Readonly<
  {
    value: string;
    onChange: (next: string, caret: number) => void;
    areaRef?: (element: HTMLTextAreaElement | null) => void;
  } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">
>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [value]);
  return (
    <Textarea
      {...rest}
      ref={(element) => {
        ref.current = element;
        areaRef?.(element);
      }}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
    />
  );
}

type Focus = Readonly<{ key: string; part: "text" | "title" }>;

/**
 * The page's document as the GM writes it: the player text in stretches, with each hidden block boxed where it sits
 * in the text. One tool bar formats whichever stretch has the caret; Hidden block (or `/` at the start of a line)
 * puts a new block at the caret's paragraph break; `[[` offers pages to link and a new page from the typed name.
 */
export function DocEditor({
  items,
  onChange,
  serverBlocks,
  party,
  phone,
  pages,
  excludePageId,
  busy,
  onCreatePage,
  onReveal,
  onAudience,
  onOpenMap
}: Readonly<{
  items: readonly DraftItem[];
  onChange: (next: DraftItem[]) => void;
  /** The blocks the server has, for each one's audience and stamp. */
  serverBlocks: ReadonlyMap<string, CodexBlock>;
  party: readonly PartyCharacter[];
  phone: boolean;
  pages: readonly Page[];
  excludePageId: string;
  busy: boolean;
  onCreatePage: (title: string) => void;
  onReveal: (block: CodexBlock) => void;
  onAudience: (block: CodexBlock, next: Audience) => void;
  /** Opens the atlas, to put the page on a map. */
  onOpenMap?: () => void;
}>) {
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const focus = useRef<Focus | null>(null);
  const [link, setLink] = useState<{ key: string; start: number; query: string; index: number } | null>(null);
  const [slash, setSlash] = useState<{ key: string; at: number } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFocus) return;
    const element = areas.current.get(`${pendingFocus}:text`);
    element?.focus();
    setPendingFocus(null);
  }, [pendingFocus, items]);

  const suggestions = useMemo(() => {
    if (!link) return [];
    const needle = link.query.trim().toLowerCase();
    // A title that starts with what was typed comes before one that only contains it.
    const starts = (page: (typeof pages)[number]) => (page.title.toLowerCase().startsWith(needle) ? 0 : 1);
    return pages
      .filter((page) => page.id !== excludePageId && page.title.toLowerCase().includes(needle))
      .sort((a, b) => starts(a) - starts(b) || a.title.localeCompare(b.title))
      .slice(0, 6);
  }, [link, pages, excludePageId]);

  const replaceItem = (key: string, patch: Readonly<{ text?: string; title?: string }>) =>
    onChange(items.map((item) => (item.key === key ? ({ ...item, ...patch } as DraftItem) : item)));

  /** Writes a stretch's text and keeps the link and block menus in step with the caret. */
  const editText = (key: string, part: "text" | "title", next: string, caret: number) => {
    if (part === "title") {
      replaceItem(key, { title: next });
      return;
    }
    replaceItem(key, { text: next });
    const context = linkContext(next, caret);
    setLink(context ? { key, start: context.start, query: context.query, index: 0 } : null);
    // Blocks don't nest, so the block menu opens only in the page's own text.
    const at = items.find((item) => item.key === key)?.kind === "text" ? slashAt(next, caret) : null;
    setSlash(at !== null ? { key, at } : null);
  };

  const pickLink = (title: string) => {
    if (!link) return;
    const item = items.find((candidate) => candidate.key === link.key);
    const element = areas.current.get(`${link.key}:text`);
    if (!item) return;
    const text = item.text;
    const caret = element?.selectionStart ?? text.length;
    const after = text.slice(caret);
    const closing = after.startsWith("]]") ? "" : "]]";
    replaceItem(link.key, { text: `${text.slice(0, link.start)}[[${title}${closing}${after}` });
    setLink(null);
    const at = link.start + title.length + 4;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(at, at);
    });
  };

  /** A new Hidden block at the caret: the stretch splits at the caret's paragraph break. */
  const addBlock = (at?: Readonly<{ key: string; caret: number; dropSlash?: boolean }>) => {
    const target = at ?? (focus.current?.part === "text" ? focus.current : null);
    const newKey = nextDraftKey();
    const block: DraftItem = { kind: "block", key: newKey, id: null, title: "", text: "" };
    const index = target ? items.findIndex((item) => item.key === target.key) : -1;
    const holder = index >= 0 ? items[index] : null;
    if (!holder || holder.kind !== "text") {
      // No stretch has the caret: the block goes at the end of the page.
      const last = items[items.length - 1];
      onChange([
        ...items.slice(0, -1),
        ...(last?.kind === "text" ? [last] : []),
        block,
        { kind: "text", key: nextDraftKey(), text: "" }
      ]);
      setPendingFocus(newKey);
      return;
    }
    const element = areas.current.get(`${holder.key}:text`);
    let text = holder.text;
    let caret = at?.caret ?? element?.selectionStart ?? text.length;
    if (at?.dropSlash) {
      text = `${text.slice(0, caret)}${text.slice(caret + 1)}`;
    }
    caret = Math.min(caret, text.length);
    const [before, after] = splitForBlock(text, caret);
    onChange([
      ...items.slice(0, index),
      { ...holder, text: before },
      block,
      { kind: "text", key: nextDraftKey(), text: after },
      ...items.slice(index + 1)
    ]);
    setSlash(null);
    setPendingFocus(newKey);
  };

  /** Removes a block; the stretches either side of it join. */
  const removeBlock = (key: string) => {
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return;
    const before = items[index - 1];
    const after = items[index + 1];
    if (before?.kind === "text" && after?.kind === "text") {
      const joined = [before.text.trim(), after.text.trim()].filter(Boolean).join("\n\n");
      onChange([...items.slice(0, index - 1), { ...before, text: joined }, ...items.slice(index + 2)]);
    } else onChange(items.filter((item) => item.key !== key));
  };

  /** Moves a block one paragraph up or down the text, or past the block beside it. */
  const moveBlock = (key: string, direction: -1 | 1) => {
    const index = items.findIndex((item) => item.key === key);
    const block = items[index];
    const neighbour = items[index + direction];
    if (!block || !neighbour) return;
    if (neighbour.kind === "block") {
      const next = [...items];
      next[index] = neighbour;
      next[index + direction] = block;
      onChange(next);
      return;
    }
    const paragraphs = neighbour.text
      .trim()
      .split(/\n[ \t]*\n/)
      .filter((part) => part.trim());
    if (paragraphs.length === 0) {
      // An empty stretch: hop over it to the next block, or stay at the edge of the page.
      const beyond = items[index + 2 * direction];
      if (beyond?.kind !== "block") return;
      const next = [...items];
      next[index] = beyond;
      next[index + 2 * direction] = block;
      onChange(next);
      return;
    }
    const other = items[index - direction];
    const moved = direction === -1 ? paragraphs[paragraphs.length - 1] : paragraphs[0];
    const left = direction === -1 ? paragraphs.slice(0, -1) : paragraphs.slice(1);
    const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join("\n\n");
    const next = [...items];
    next[index + direction] = { ...neighbour, text: left.join("\n\n") };
    if (other?.kind === "text")
      next[index - direction] = {
        ...other,
        text: direction === -1 ? join(moved, other.text) : join(other.text, moved)
      };
    else next.splice(direction === -1 ? index + 1 : index, 0, { kind: "text", key: nextDraftKey(), text: moved });
    onChange(next);
  };

  /** Formats the stretch with the caret: bold, italic, a heading, a list or a link. */
  const format = (kind: string) => {
    const at = focus.current;
    if (!at) return;
    const element = areas.current.get(`${at.key}:${at.part}`);
    const item = items.find((candidate) => candidate.key === at.key);
    if (!element || !item || at.part === "title") return;
    const next = applyMarkdownFormat(item.text, element.selectionStart, element.selectionEnd, kind);
    replaceItem(at.key, { text: next.value });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (key: string, event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (link && link.key === key && (suggestions.length > 0 || link.query.trim())) {
      const total = suggestions.length + (link.query.trim() ? 1 : 0);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setLink({ ...link, index: Math.min(link.index + 1, total - 1) });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setLink({ ...link, index: Math.max(link.index - 1, 0) });
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (link.index < suggestions.length) pickLink(suggestions[link.index].title);
        else {
          onCreatePage(link.query.trim());
          pickLink(link.query.trim());
        }
      } else if (event.key === "Escape") setLink(null);
      return;
    }
    if (slash && slash.key === key) {
      if (event.key === "Enter") {
        event.preventDefault();
        addBlock({ key, caret: slash.at, dropSlash: true });
      } else if (event.key === "Escape") setSlash(null);
    }
  };

  const tools = (
    <div className={cx("cx-write-tools", phone && "is-phone")} role="toolbar" aria-label="Writing tools">
      {phone ? (
        <>
          <Button size="sm" onClick={() => format("wikilink")} aria-label="Link to another page">
            [[ ]]
          </Button>
          <Button size="sm" className="cx-write-hiddenbtn" onClick={() => addBlock()}>
            <IconEyeOff /> Hidden block
          </Button>
          <IconButton label="Heading" size="sm" onClick={() => format("heading")}>
            <span className="cx-write-letter">H</span>
          </IconButton>
          <IconButton label="Bullet list" size="sm" onClick={() => format("bullet")}>
            <IconList />
          </IconButton>
          <span className="cx-grow" />
          <Menu icon align="end" label="More formatting" trigger={<IconMore />}>
            <MenuItem onClick={() => format("bold")}>Bold</MenuItem>
            <MenuItem onClick={() => format("italic")}>Italic</MenuItem>
            <MenuItem onClick={() => format("numbered")}>Numbered list</MenuItem>
            <MenuItem onClick={() => format("quote")}>Quote</MenuItem>
          </Menu>
        </>
      ) : (
        <>
          <IconButton label="Bold" size="sm" onClick={() => format("bold")}>
            <span className="cx-write-letter is-bold">B</span>
          </IconButton>
          <IconButton label="Italic" size="sm" onClick={() => format("italic")}>
            <span className="cx-write-letter is-italic">I</span>
          </IconButton>
          <IconButton label="Heading" size="sm" onClick={() => format("heading")}>
            <span className="cx-write-letter">H</span>
          </IconButton>
          <IconButton label="Bullet list" size="sm" onClick={() => format("bullet")}>
            <IconList />
          </IconButton>
          <IconButton label="Link to another page" size="sm" onClick={() => format("wikilink")}>
            <span className="cx-write-letter">[[</span>
          </IconButton>
          <Button size="sm" className="cx-write-hiddenbtn" onClick={() => addBlock()}>
            <IconEyeOff /> Hidden block
          </Button>
          {onOpenMap && (
            <Button size="sm" variant="ghost" onClick={onOpenMap}>
              Put it on a map
            </Button>
          )}
          <span className="cx-hint cx-write-hint">Type / at the start of a line for a block.</span>
        </>
      )}
    </div>
  );

  const linkMenu = (key: string) =>
    link &&
    link.key === key && (
      <ul className="cx-write-menu" role="listbox" aria-label="Link to a page">
        {suggestions.map((page, index) => (
          <li
            key={page.id}
            role="option"
            aria-selected={index === link.index}
            className={cx("cx-write-option", index === link.index && "is-active")}
            onPointerDown={(event) => {
              event.preventDefault();
              pickLink(page.title);
            }}
          >
            <EntityIcon type={page.entityType} />
            <span className="cx-grow">{page.title}</span>
            <span className="cx-picker-meta">{entityDef(page.entityType).label}</span>
          </li>
        ))}
        {link.query.trim() && (
          <li
            role="option"
            aria-selected={link.index === suggestions.length}
            className={cx("cx-write-option", link.index === suggestions.length && "is-active")}
            onPointerDown={(event) => {
              event.preventDefault();
              onCreatePage(link.query.trim());
              pickLink(link.query.trim());
            }}
          >
            <IconPlus />
            <span>New page: {link.query.trim()}</span>
          </li>
        )}
      </ul>
    );

  const slashMenu = (key: string) =>
    slash &&
    slash.key === key && (
      <ul className="cx-write-menu" role="listbox" aria-label="Add a block">
        <li
          role="option"
          aria-selected
          className="cx-write-option is-active"
          onPointerDown={(event) => {
            event.preventDefault();
            addBlock({ key, caret: slash.at, dropSlash: true });
          }}
        >
          <IconEyeOff />
          <span>Hidden block</span>
        </li>
      </ul>
    );

  return (
    <div className={cx("cx-write", phone && "is-phone")}>
      {!phone && tools}
      <div className="cx-write-doc">
        {items.map((item, index) => {
          if (item.kind === "text") {
            const lastText = index === items.length - 1;
            return (
              <div key={item.key} className="cx-write-stretch">
                <GrowingArea
                  className="cx-write-area"
                  aria-label={index === 0 ? "Page text" : "Page text after the block above"}
                  placeholder={
                    index === 0 && items.length === 1
                      ? "What players read on this page. Add a Hidden block for what only you know."
                      : lastText
                        ? "Write more here."
                        : undefined
                  }
                  value={item.text}
                  areaRef={(element) => {
                    if (element) areas.current.set(`${item.key}:text`, element);
                    else areas.current.delete(`${item.key}:text`);
                  }}
                  onFocus={() => (focus.current = { key: item.key, part: "text" })}
                  onBlur={() => window.setTimeout(() => setLink(null), 120)}
                  onKeyDown={(event) => onKeyDown(item.key, event)}
                  onChange={(next, caret) => editText(item.key, "text", next, caret)}
                />
                {linkMenu(item.key)}
                {slashMenu(item.key)}
              </div>
            );
          }
          const server = item.id ? serverBlocks.get(item.id) : undefined;
          const value: Audience = server ? { audience: server.audience, characterIds: server.characterIds } : HIDDEN;
          const name = item.title.trim() || "Untitled block";
          return (
            <HiddenBlock
              key={item.key}
              title={item.title.trim() || "New block"}
              value={value}
              party={party}
              since={server ? sinceLabel(stampOf(server)) : null}
              draft={!server}
              busy={busy}
              menu={phone && Boolean(server)}
              onReveal={server ? () => onReveal(server) : undefined}
              onHide={server ? () => onAudience(server, HIDDEN) : undefined}
              onAudienceChange={server ? (next) => onAudience(server, next) : undefined}
              actions={
                <span className="cx-write-blocktools">
                  <IconButton label={`Move ${name} up`} size="sm" onClick={() => moveBlock(item.key, -1)}>
                    <IconChevron className="cx-flip" />
                  </IconButton>
                  <IconButton label={`Move ${name} down`} size="sm" onClick={() => moveBlock(item.key, 1)}>
                    <IconChevron />
                  </IconButton>
                  <IconButton label={`Remove ${name}`} size="sm" onClick={() => removeBlock(item.key)}>
                    <IconTrash />
                  </IconButton>
                </span>
              }
            >
              <Input
                className="cx-write-blocktitle"
                aria-label="Block title"
                placeholder="Title (optional)"
                value={item.title}
                ref={(element: HTMLInputElement | null) => {
                  if (element) areas.current.set(`${item.key}:title`, element as unknown as HTMLTextAreaElement);
                }}
                onFocus={() => (focus.current = { key: item.key, part: "title" })}
                onChange={(event) => editText(item.key, "title", event.target.value, 0)}
              />
              <GrowingArea
                className="cx-write-area is-block"
                aria-label={`${name} text`}
                placeholder="What only you know, until you reveal it."
                value={item.text}
                areaRef={(element) => {
                  if (element) areas.current.set(`${item.key}:text`, element);
                  else areas.current.delete(`${item.key}:text`);
                }}
                onFocus={() => (focus.current = { key: item.key, part: "text" })}
                onBlur={() => window.setTimeout(() => setLink(null), 120)}
                onKeyDown={(event) => onKeyDown(item.key, event)}
                onChange={(next, caret) => editText(item.key, "text", next, caret)}
              />
              {linkMenu(item.key)}
            </HiddenBlock>
          );
        })}
      </div>
      {phone && tools}
    </div>
  );
}
