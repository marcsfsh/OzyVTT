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
export function NotFoundView({ role }: Readonly<{ role: "gm" | "player" }>) {
  return (
    <div className="codex-main-empty anim-view" role="status">
      <h3>Nothing lives at this address.</h3>
      <p>Check the link, or head back to the table.</p>
      <div className="codex-notfound-actions">
        <Button variant="primary" onClick={() => navigate("/codex")}>Go to the Codex</Button>
        <Button variant="secondary" onClick={() => navigate(role === "gm" ? "/encounter" : "/table")}>Go to the table</Button>
      </div>
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
