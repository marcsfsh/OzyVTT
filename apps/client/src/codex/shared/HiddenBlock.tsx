import type { ReactNode } from "react";
import {
  Button,
  IconEye,
  IconEyeOff,
  IconUser,
  cx,
  revealedLabel,
  type Audience,
  type PartyCharacter,
  WhoSeesItMenu
} from "@vtt/ui";
import "./shared.css";

/**
 * A block on the GM's page. Hidden, it is boxed in violet and labelled Hidden, with Reveal in its top-right corner.
 * Revealed, it says who it is revealed to and since when, with Hide again. On a phone (`menu`) the label and action
 * give way to the Who sees it control at the block's top, as a card.
 */
export function HiddenBlock({
  title,
  value,
  party,
  since,
  focus = false,
  draft = false,
  onReveal,
  onHide,
  onAudienceChange,
  menu = false,
  busy = false,
  actions,
  children
}: Readonly<{
  /** The block's title; an untitled block shows none. */
  title: string | null;
  value: Audience;
  party: readonly PartyCharacter[];
  /** When it reached its audience, as `sinceLabel` writes it. Shown only once revealed. */
  since?: string | null;
  focus?: boolean;
  /** A block being written: dashed, and no action until it is saved. */
  draft?: boolean;
  onReveal?: () => void;
  onHide?: () => void;
  /** With `menu`, the Who sees it control replaces the label and the action. */
  onAudienceChange?: (next: Audience) => void;
  menu?: boolean;
  busy?: boolean;
  /** Extra controls before the action (an editor's move or delete). */
  actions?: ReactNode;
  children: ReactNode;
}>) {
  const hidden = value.audience === "hidden";
  const name = title?.trim() || "Untitled block";
  return (
    <section
      className={cx("cx-block", `is-${value.audience}`, focus && "is-focus", draft && "is-draft", menu && "is-card")}
      aria-label={`${name} · ${revealedLabel(value, party)}`}
    >
      <div className="cx-block-head">
        {!menu &&
          (hidden ? (
            <IconEyeOff className="cx-block-icon" />
          ) : value.audience === "everyone" ? (
            <IconEye className="cx-block-icon" />
          ) : (
            <IconUser className="cx-block-icon" />
          ))}
        <h3 className="cx-block-title">{title?.trim() ? title : <span className="cx-block-untitled">{name}</span>}</h3>
        {actions}
        {menu && onAudienceChange ? (
          <WhoSeesItMenu value={value} party={party} what={name} disabled={busy} onChange={onAudienceChange} />
        ) : (
          <>
            <span className="cx-block-label">{revealedLabel(value, party)}</span>
            {!draft &&
              (hidden
                ? onReveal && (
                    <Button size="sm" onClick={onReveal} disabled={busy} aria-label={`Reveal ${name}`}>
                      <IconEye /> Reveal
                    </Button>
                  )
                : onHide && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onHide}
                      disabled={busy}
                      aria-label={`Hide ${name} again`}
                    >
                      Hide again
                    </Button>
                  ))}
          </>
        )}
      </div>
      <div className="cx-block-body">{children}</div>
      {!hidden && since && <span className="cx-block-since">{since}</span>}
    </section>
  );
}
