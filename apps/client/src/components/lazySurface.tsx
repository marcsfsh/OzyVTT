import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";

/** How long a surface may take before it says what is loading (frame rule 3.9). */
export const LOADING_LINE_DELAY_MS = 400;

/**
 * What a surface shows while its code loads: the empty frame it is about to fill, announced to screen readers at once
 * and, after 400 ms with nothing, one line in --text-muted saying what is loading. No spinner and nothing that loops.
 */
export function SurfaceFallback({ name }: Readonly<{ name?: string }>) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), LOADING_LINE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="pane-frame frame-col surface-loading" role="status">
      {late && name ? (
        <p className="surface-loading-line">Loading the {name}</p>
      ) : (
        <span className="nh-sr-only">Loading</span>
      )}
    </div>
  );
}

/**
 * A surface whose code loads on first use (Codex, the Compendium, settings, the builder, replays, the map
 * library), each in its own Suspense boundary so loading one never blanks the rest of the shell. `name` finishes
 * "Loading the ..."; a `fallback` of null holds no place at all (a panel that floats over the table).
 */
export function lazySurface<P extends object>(
  load: () => Promise<ComponentType<P>>,
  name: string,
  fallback: ReactNode = <SurfaceFallback name={name} />
): ComponentType<P> {
  const Loaded = lazy(async () => ({ default: await load() }));
  return function LazySurface(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Loaded {...props} />
      </Suspense>
    );
  };
}
