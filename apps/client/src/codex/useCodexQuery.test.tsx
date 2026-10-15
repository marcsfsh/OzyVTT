import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const listeners = new Map<string, Set<() => void>>();
vi.mock("../socket", () => ({
  socket: {
    on: (event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener)
  }
}));

import { useCodexQuery } from "./useCodexQuery";

const ping = () => act(() => listeners.get("codex:changed")?.forEach((listener) => listener()));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

beforeEach(() => listeners.clear());

describe("useCodexQuery", () => {
  it("loads, then reloads on the codex:changed ping", async () => {
    let answer = 1;
    const load = vi.fn(async () => answer);
    const { result } = renderHook(() => useCodexQuery(load));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(result.current.loading).toBe(false);

    answer = 2;
    await ping();
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores the ping when it is not live", async () => {
    const load = vi.fn(async () => "settings");
    renderHook(() => useCodexQuery(load, { live: false }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await ping();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure apart from the last answer, and clears it on the next success", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("Offline."))
      .mockResolvedValue("third");
    const { result } = renderHook(() => useCodexQuery<string>(load));
    await waitFor(() => expect(result.current.data).toBe("first"));

    await ping();
    await waitFor(() => expect(result.current.error).toBe("Offline."));
    expect(result.current.data).toBe("first");

    await ping();
    await waitFor(() => expect(result.current.data).toBe("third"));
    expect(result.current.error).toBeNull();
  });

  it("drops an answer that a newer read overtook", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const { result } = renderHook(() => useCodexQuery<string>(load));

    await ping();
    await act(async () => fast.resolve("new"));
    await act(async () => slow.resolve("old"));
    expect(result.current.data).toBe("new");
  });

  it("reads nothing for a null load, and reads as loading again for a new one", async () => {
    const first = vi.fn(async () => "a");
    const second = vi.fn(() => new Promise<string>(() => {}));
    const { result, rerender } = renderHook(({ load }) => useCodexQuery<string>(load), {
      initialProps: { load: null as (() => Promise<string>) | null }
    });
    expect(result.current.loading).toBe(false);
    expect(listeners.get("codex:changed")?.size ?? 0).toBe(0);

    rerender({ load: first });
    await waitFor(() => expect(result.current.data).toBe("a"));
    rerender({ load: second });
    expect(result.current.loading).toBe(true);
    // The previous answer stays on screen while the new read is in flight.
    expect(result.current.data).toBe("a");
  });
});
