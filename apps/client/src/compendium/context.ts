import { createContext, useContext } from "react";
import type { PartyCharacter } from "../codex/shared/audience";
import type { Kind } from "./kinds";
import type { CompendiumView } from "./routes";

/** The phone layout: the tab bar under the thumb. The breakpoint ladder's 760. */
export const PHONE_QUERY = "(max-width: 760px)";
/** From 980 the preview is pinned beside the questions, and a record docks beside its table. */
export const WIDE_QUERY = "(min-width: 980px)";

/**
 * What every Compendium view reads from its shell: the GM's token, the party for Who sees it, the layout, the address
 * and how to move. A view takes no props of its own, so the shell, a test and a phone all mount it the same way.
 */
export type NewRecordOptions = Readonly<{
  kind?: Kind | null;
  /** The record to copy: an SRD record or one of this table's. */
  from?: Readonly<{ id: string; name: string }>;
}>;

export type CompendiumContextValue = Readonly<{
  token: string;
  /** The party's player characters, for every Who sees it control. */
  party: readonly PartyCharacter[];
  phone: boolean;
  wide: boolean;
  view: CompendiumView;
  query: URLSearchParams;
  go: (path: string, options?: Readonly<{ replace?: boolean }>) => void;
  /** Rewrites the query without a history entry: a table's filters and sort. */
  setQuery: (mutate: (query: URLSearchParams) => void) => void;
  /** Opens New homebrew at a kind when one is in view, or as a copy of one record, named first. */
  openNew: (options?: NewRecordOptions) => void;
  /** Opens the search (Ctrl K). */
  openSearch: () => void;
}>;

export const CompendiumContext = createContext<CompendiumContextValue | null>(null);

export function useCompendium(): CompendiumContextValue {
  const value = useContext(CompendiumContext);
  if (!value) throw new Error("A Compendium view rendered outside the Compendium shell.");
  return value;
}
