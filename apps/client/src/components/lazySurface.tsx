import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * What a surface shows while its code loads: the empty frame it is about to fill, quiet on screen and
 * announced to screen readers.
 */
export function SurfaceFallback() {
  return (
    <div className="pane-frame frame-col" role="status">
      <span className="nh-sr-only">Loading</span>
    </div>
  );
}

/**
 * A surface whose code loads on first use (Codex, homebrew, settings, the builder, replays, the map
 * library), each in its own Suspense boundary so loading one never blanks the rest of the shell.
 */
export function lazySurface<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = <SurfaceFallback />
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
