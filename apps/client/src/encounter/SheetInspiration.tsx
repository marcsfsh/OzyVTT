import { useState } from "react";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";

/**
 * Heroic Inspiration, held or not. A player spends it from a reroll button, so it has no button of its own here; the
 * GM gives it or takes it back.
 */
export function SheetInspiration({
  actorId,
  name,
  held,
  role,
  onFeedback
}: Readonly<{
  actorId: string;
  name: string;
  held: boolean;
  role: "gm" | "player";
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const toggle = () => {
    setBusy(true);
    void command("actor:set-heroic-inspiration", { actorId, has: !held }).then((result) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "Heroic Inspiration could not be changed.");
      else onFeedback(held ? `${name} no longer has Heroic Inspiration.` : `${name} has Heroic Inspiration.`);
    });
  };
  return (
    <div className="sheet-inspiration" role="group" aria-label="Heroic Inspiration">
      <span className="sheet-section-label">Heroic Inspiration</span>
      <div className="sheet-inspiration-row">
        <span className={`sheet-inspiration-state${held ? " is-held" : ""}`}>
          {held ? "Held · spend it to reroll one die" : "None"}
        </span>
        {role === "gm" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-label={held ? "Take back Heroic Inspiration" : "Give Heroic Inspiration"}
            onClick={toggle}
          >
            {held ? "Take back" : "Give"}
          </Button>
        )}
      </div>
    </div>
  );
}
