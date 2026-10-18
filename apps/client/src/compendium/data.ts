import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { socket } from "../socket";
import {
  homebrewApi,
  listAllHomebrew,
  type HomebrewOverview,
  type HomebrewPackList,
  type HomebrewRecordSummary,
  type HomebrewTableRow
} from "../homebrew/api";
import { KINDS, type Kind } from "./kinds";

/**
 * The GM's Compendium reads, each fetched once and shared by every view that shows it, and read again when the
 * content-free `homebrew:changed` ping says the store moved. A view that saves a record patches nothing by hand: the
 * ping that follows its own write refreshes the tables and counts.
 */

export type Loadable<T> = Readonly<{ data: T | null; error: string | null; unavailable: boolean }>;

type Entry<T> = { value: Loadable<T>; inFlight: Promise<void> | null; stale: boolean };
/** Keyed by token and read, so a new token never reads what an older one fetched. */
const entries = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function entry<T>(key: string): Entry<T> {
  let found = entries.get(key) as Entry<T> | undefined;
  if (!found) {
    found = { value: { data: null, error: null, unavailable: false }, inFlight: null, stale: true };
    entries.set(key, found as Entry<unknown>);
  }
  return found;
}

function publish(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

function load<T>(key: string, fetch: () => Promise<T>, force = false): Promise<void> {
  const held = entry<T>(key);
  if (held.inFlight) return held.inFlight;
  if (!force && !held.stale) return Promise.resolve();
  held.inFlight = fetch().then(
    (data) => {
      held.value = { data, error: null, unavailable: false };
      held.stale = false;
      held.inFlight = null;
      publish(key);
    },
    (error: unknown) => {
      const status = error instanceof ApiError ? error.status : 0;
      held.value = {
        data: held.value.data,
        error: error instanceof Error ? error.message : "Couldn't load the Compendium.",
        unavailable: status === 404 || status === 501
      };
      held.inFlight = null;
      publish(key);
    }
  );
  return held.inFlight;
}

/** Marks every read stale and reads again the ones on screen. */
export function refreshCompendium() {
  for (const [key, held] of entries) {
    held.stale = true;
    if ((listeners.get(key)?.size ?? 0) > 0) void fetchers.get(key)?.();
  }
}

const fetchers = new Map<string, () => Promise<void>>();

function useResource<T>(key: string | null, fetch: () => Promise<T>): Loadable<T> & { reload: () => Promise<void> } {
  const [, setTick] = useState(0);
  const reload = useCallback(() => (key ? load(key, fetch, true) : Promise.resolve()), [key, fetch]);
  useEffect(() => {
    if (!key) return;
    const listener = () => setTick((tick) => tick + 1);
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    fetchers.set(key, () => load(key, fetch, true));
    void load(key, fetch);
    return () => {
      set.delete(listener);
    };
  }, [key, fetch]);
  const value = key ? (entry<T>(key).value as Loadable<T>) : { data: null, error: null, unavailable: false };
  return { ...value, reload };
}

/** Reads again what is on screen whenever the store moves. */
export function useCompendiumPing() {
  useEffect(() => {
    const onChanged = () => refreshCompendium();
    socket.on("homebrew:changed", onChanged);
    return () => {
      socket.off("homebrew:changed", onChanged);
    };
  }, []);
}

const tableFetch = new Map<string, () => Promise<readonly HomebrewTableRow[]>>();
/** One kind's table, or every kind's (Kind: All), SRD and homebrew together. Archived rows come too, to be filtered.
    `enabled` false reads nothing, for a caller that needs the table only sometimes. */
export function useTable(token: string, kind: Kind | null, enabled = true) {
  const key = `${token}|table:${kind ?? "all"}`;
  let fetch = tableFetch.get(key);
  if (!fetch) {
    fetch = async () => {
      const kinds = kind ? [kind] : KINDS;
      const tables = await Promise.all(kinds.map((one) => homebrewApi.table(token, one, true)));
      return tables.flatMap((table) => table.rows);
    };
    tableFetch.set(key, fetch);
  }
  return useResource(enabled ? key : null, fetch);
}

const overviewFetch = new Map<string, () => Promise<HomebrewOverview>>();
export function useOverview(token: string) {
  let fetch = overviewFetch.get(token);
  if (!fetch) {
    fetch = () => homebrewApi.overview(token);
    overviewFetch.set(token, fetch);
  }
  return useResource(`${token}|overview`, fetch);
}

const packsFetch = new Map<string, () => Promise<HomebrewPackList>>();
export function usePacks(token: string) {
  let fetch = packsFetch.get(token);
  if (!fetch) {
    fetch = () => homebrewApi.packs(token);
    packsFetch.set(token, fetch);
  }
  return useResource(`${token}|packs`, fetch);
}

const listFetch = new Map<string, () => Promise<readonly HomebrewRecordSummary[]>>();
/** The GM's homebrew as flat summaries, archived ones included, for the sharing grid and the editor's pickers. */
export function useHomebrewList(token: string) {
  let fetch = listFetch.get(token);
  if (!fetch) {
    fetch = () => listAllHomebrew(token);
    listFetch.set(token, fetch);
  }
  return useResource(`${token}|list`, fetch);
}

/** For tests: forget every read, as a fresh page would. */
export function resetCompendiumData() {
  entries.clear();
  listeners.clear();
  fetchers.clear();
  tableFetch.clear();
  overviewFetch.clear();
  packsFetch.clear();
  listFetch.clear();
}
