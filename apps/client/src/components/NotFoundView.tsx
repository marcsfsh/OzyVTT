import { Button, EmptyState } from "@vtt/ui";
import { navigate } from "../router";
import { PhoneHeader } from "../shell/SectionBar";

/**
 * What an address that names nothing renders (frame rule 3.7): the empty state's one line and one secondary button,
 * under the frame you came from. A player asking for a GM-only address gets exactly this too, so the response never
 * confirms that the surface exists (the 404-not-403 rule). Both roles go to `/table`.
 */
export function NotFoundView({ role: _role }: Readonly<{ role: "gm" | "player" }>) {
  return (
    <div className="notfound-view anim-view" role="status">
      <EmptyState
        action={
          <Button variant="secondary" onClick={() => navigate("/table")}>
            Go to the table
          </Button>
        }
      >
        Nothing lives at this address.
      </EmptyState>
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
    <div className="pane-frame pane-scene frame-col">
      <PhoneHeader title="Not found" />
      <div className="scroll-y frame-fill notfound-stage">
        <NotFoundView role={role} />
      </div>
    </div>
  );
}

/**
 * A known section whose named record is gone: a stale bookmark still lands in the section's list,
 * with this notice; the not-found view never shows.
 */
export function MissingRecordNotice({ noun }: Readonly<{ noun: string }>) {
  return (
    <div className="codex-missing-record" role="status">
      That {noun} no longer exists. It may have been deleted.
    </div>
  );
}
