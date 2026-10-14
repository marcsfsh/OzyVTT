import { Button } from "@vtt/ui";
import { navigate } from "../router";

/**
 * What an address that names nothing renders. A player asking for a GM-only address gets exactly
 * this too, so the response never confirms that the surface exists (the 404-not-403 rule).
 */
export function NotFoundView({ role: _role }: Readonly<{ role: "gm" | "player" }>) {
  return (
    <div className="codex-main-empty anim-view" role="status">
      <h3>Nothing lives at this address.</h3>
      <p>Check the link, or head back to the table.</p>
      <div className="codex-notfound-actions">
        <Button variant="primary" onClick={() => navigate("/codex")}>
          Go to the Codex
        </Button>
        <Button variant="secondary" onClick={() => navigate("/table")}>
          Go to the table
        </Button>
      </div>
    </div>
  );
}

/**
 * The not-found view as a whole pane. The view itself is shared with the codex shells, which supply
 * their own frame, so the page shape lives here: a `.pane-frame` column with one scroll region,
 * on the scene sky (`.pane-scene > .scroll-y` keeps the doors out of the horizon band).
 */
export function NotFoundPage({ role }: Readonly<{ role: "gm" | "player" }>) {
  return (
    <div className="pane-frame pane-scene scanlines frame-col">
      <div className="pane-sky" aria-hidden="true" />
      <div className="scroll-y frame-fill notfound-stage">
        <NotFoundView role={role} />
      </div>
    </div>
  );
}

/**
 * A known section whose named record is gone: a stale bookmark still lands in the section's list,
 * with this notice, rather than on the not-found view.
 */
export function MissingRecordNotice({ noun }: Readonly<{ noun: string }>) {
  return (
    <div className="codex-missing-record" role="status">
      That {noun} no longer exists. It may have been deleted.
    </div>
  );
}
