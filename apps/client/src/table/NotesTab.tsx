import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@vtt/ui";

const KEY = "vtt.table-notes-view";

/** The GM's Notes tab: tonight's board and the Codex at the table, one at a time, the choice kept on this device. */
export function NotesTab({ tonight, codex }: Readonly<{ tonight?: ReactNode; codex?: ReactNode }>) {
  const views = [
    ...(tonight ? [{ value: "tonight", label: "Tonight" }] : []),
    ...(codex ? [{ value: "codex", label: "Codex" }] : [])
  ];
  const [chosen, setChosen] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "tonight";
    } catch {
      return "tonight";
    }
  });
  const view = views.some((entry) => entry.value === chosen) ? chosen : (views[0]?.value ?? "tonight");
  const choose = (next: string) => {
    setChosen(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the tab still works, it just won't remember */
    }
  };
  return (
    <div className="table-notes-tab">
      {views.length > 1 && (
        <div className="table-notes-tab-views">
          <SegmentedControl ariaLabel="Notes" size="sm" value={view} onChange={choose} options={views} />
        </div>
      )}
      <div className="table-notes-tab-body">{view === "codex" ? codex : tonight}</div>
    </div>
  );
}
