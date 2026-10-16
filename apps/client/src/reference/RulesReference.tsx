import { useEffect, useMemo, useState } from "react";
import type { ContentGlossaryEntry } from "@vtt/domain";
import { Badge, Button, Drawer, Input } from "@vtt/ui";
import { read } from "../lib/command";
import "./rules-reference.css";

type Glossary = Readonly<{ entries: readonly ContentGlossaryEntry[]; attribution: string }>;
let glossary: Promise<Glossary> | null = null;

/** The glossary, fetched once per page load; a failed read is forgotten so the next open retries. */
function loadGlossary(): Promise<Glossary> {
  glossary ??= read("content:glossary", {}).then((result) => {
    if (!result.ok || !result.glossary) {
      glossary = null;
      throw new Error(result.message ?? "The rules could not be loaded.");
    }
    return { entries: result.glossary, attribution: result.attribution ?? "" };
  });
  return glossary;
}

/**
 * The SRD Rules Glossary, searchable by term, for anyone at the table. A drawer, so the fight or sheet behind
 * it stays in view and usable. A term opens in place; its "See also" names other terms to search for.
 */
export function RulesReference({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const [loaded, setLoaded] = useState<Glossary | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!open || loaded) return;
    void loadGlossary().then(setLoaded, (failure: Error) => setError(failure.message));
  }, [open, loaded]);
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    const entries = loaded?.entries ?? [];
    if (!query) return entries;
    // Name matches first, then terms that only mention it.
    const named = entries.filter((entry) => entry.name.toLowerCase().includes(query));
    const mentioned = entries.filter(
      (entry) => !named.includes(entry) && entry.description.toLowerCase().includes(query)
    );
    return [...named, ...mentioned];
  }, [loaded, search]);

  return (
    <Drawer open={open} onClose={onClose} title="Rules" className="rules-reference">
      <Input
        type="search"
        aria-label="Search the rules"
        placeholder="Search: Prone, Opportunity Attack, cover…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {error && (
        <p className="rules-reference-status" role="alert">
          {error}
        </p>
      )}
      {!error && !loaded && <p className="rules-reference-status">Loading the rules…</p>}
      {loaded && (
        <div className="rules-reference-list scroll-y">
          {shown.map((entry) => (
            <details key={entry.id} className="rules-reference-entry">
              <summary>
                {entry.name}
                {entry.tag && <Badge tone="neutral">{entry.tag}</Badge>}
              </summary>
              <div className="rules-reference-text">{entry.description}</div>
            </details>
          ))}
          {shown.length === 0 && <p className="rules-reference-status">Nothing in the glossary matches that.</p>}
          {loaded.attribution && <p className="rules-reference-attribution">{loaded.attribution}</p>}
        </div>
      )}
    </Drawer>
  );
}

/** The app bar's way into the rules: a button and the drawer it opens. */
export function RulesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="rules-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        Rules
      </Button>
      <RulesReference open={open} onClose={() => setOpen(false)} />
    </>
  );
}
