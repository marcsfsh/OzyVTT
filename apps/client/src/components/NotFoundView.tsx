import { Button } from "@vtt/ui";
import { navigate } from "../router";

/**
 * D3 — what an address that names nothing renders.
 *
 * **Also what a player gets for a GM-only address**, and that is the point: `/codex/settings` asked for
 * with a player token must be indistinguishable from `/codex/nonsense`, because an address that answered
 * differently would confirm the surface exists. Same family as the 404-not-403 rule the record routes
 * keep, one axis up.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function NotFoundView({ role: _role }: Readonly<{ role: "gm" | "player" }>) {
  return (
    <div className="codex-main-empty anim-view" role="status">
      <h3>Nothing lives at this address.</h3>
      <p>Check the link, or head back to the table.</p>
      <div className="codex-notfound-actions">
        <Button variant="primary" onClick={() => navigate("/codex")}>Go to the Codex</Button>
        <Button variant="secondary" onClick={() => navigate("/table")}>Go to the table</Button>
      </div>
    </div>
  );
}

/**
 * The not-found view as a WHOLE PANE, rather than as the codex main column's contents.
 *
 * The view itself is shared with the codex shells, which hand it their own frame, so the page shape
 * lives here instead of on the view's root: `.pane-frame` for the page column, one declared region so
 * a short viewport can still reach the doors, and the view centred inside it (§7.5).
 *
 * IT STANDS ON THE SKY (§9). This is the most content-light surface in the app — two lines and two
 * doors on a full pane — which is exactly the category the scene tier is for, and it shipped as the
 * only one of them on flat ground. The reserve comes with the tier (`.pane-scene > .scroll-y`), so
 * the doors never rest in the horizon band.
 */
export function NotFoundPage({ role }: Readonly<{ role: "gm" | "player" }>) {
  return (
    <div className="pane-frame pane-scene scanlines frame-col">
      <div className="pane-sky" aria-hidden="true" />
      <div className="scroll-y frame-fill notfound-stage"><NotFoundView role={role} /></div>
    </div>
  );
}

/**
 * A known section whose named RECORD is gone. Deliberately not the not-found view: a stale bookmark to a
 * deleted page should still land you in Pages with the list in front of you, saying what happened.
 */
export function MissingRecordNotice({ noun }: Readonly<{ noun: string }>) {
  return <div className="codex-missing-record" role="status">That {noun} no longer exists. It may have been deleted.</div>;
}
