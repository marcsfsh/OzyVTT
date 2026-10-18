import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useDragSurface } from "./dragSurface";
import { RowEditor } from "./RowEditor";

// A drag that lifts mid-motion on a `touch-action: none` element still starts a browser fling, and the tap after it
// only stops the fling. Every drag surface cancels its own touchmove so no fling starts.

const touchMoveCancelled = (element: Element) => {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("useDragSurface", () => {
  it("cancels a finger's movement on every element it is given, and on nothing else", () => {
    function Grips() {
      const surface = useDragSurface<HTMLSpanElement>();
      return (
        <>
          <span ref={surface} data-testid="first">
            <b data-testid="inside" />
          </span>
          <span ref={surface} data-testid="second" />
          <span data-testid="other" />
        </>
      );
    }
    const { unmount } = render(<Grips />);
    const [first, inside, second, other] = ["first", "inside", "second", "other"].map((id) => screen.getByTestId(id));
    expect(touchMoveCancelled(first)).toBe(true);
    expect(touchMoveCancelled(inside)).toBe(true);
    expect(touchMoveCancelled(second)).toBe(true);
    expect(touchMoveCancelled(other)).toBe(false);
    unmount();
    expect(touchMoveCancelled(first)).toBe(false);
  });

  it("hands the element on to a ref object or a ref callback, and takes it back when the element goes", () => {
    const callback = vi.fn();
    let object: { current: HTMLDivElement | null } = { current: null };
    function Surface({ shown }: Readonly<{ shown: boolean }>) {
      const forward = useRef<HTMLDivElement | null>(null);
      object = forward;
      const viaObject = useDragSurface(forward);
      const viaCallback = useDragSurface<HTMLDivElement>(callback);
      return shown ? (
        <>
          <div ref={viaObject} data-testid="object" />
          <div ref={viaCallback} data-testid="callback" />
        </>
      ) : null;
    }
    const { rerender } = render(<Surface shown />);
    expect(object.current).toBe(screen.getByTestId("object"));
    expect(callback).toHaveBeenLastCalledWith(screen.getByTestId("callback"));
    rerender(<Surface shown={false} />);
    expect(object.current).toBeNull();
    expect(callback).toHaveBeenLastCalledWith(null);
  });
});

describe("RowEditor", () => {
  it("cancels a finger's movement on each row's drag grip", () => {
    function Rows() {
      const [rows, setRows] = useState<readonly { id: string }[]>([{ id: "a" }, { id: "b" }]);
      return (
        <RowEditor
          rows={rows}
          onChange={setRows}
          rowKey={(row) => row.id}
          renderRow={(row) => <span>{row.id}</span>}
          onAdd={() => ({ id: "c" })}
          addLabel="Add row"
          ariaLabel="Rows"
        />
      );
    }
    const { container } = render(<Rows />);
    const grips = [...container.querySelectorAll(".nh-roweditor-grip")];
    expect(grips).toHaveLength(2);
    for (const grip of grips) expect(touchMoveCancelled(grip)).toBe(true);
  });

  it("is the only element the UI kit's stylesheets give `touch-action: none`", () => {
    // Vite rewrites `import.meta.url`, so the path starts from the package, the cwd vitest runs in.
    const source = join(process.cwd(), "src");
    const stylesheets = readdirSync(source, { recursive: true, encoding: "utf8" }).filter((name) =>
      name.endsWith(".css")
    );
    const ruled: string[] = [];
    for (const file of stylesheets) {
      const css = readFileSync(join(source, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(/([^{}]+)\{[^{}]*touch-action:\s*none[^{}]*\}/g)) ruled.push(match[1].trim());
    }
    expect(ruled).toEqual([".nh-roweditor-grip"]);
  });
});
