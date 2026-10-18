import type { createServer } from "../src/server.js";

type Layer = Readonly<{
  route?: Readonly<{ path: string; methods: Record<string, boolean> }>;
  handle?: Readonly<{ stack?: readonly Layer[] }>;
}>;

function walk(stack: readonly Layer[]): Array<Readonly<{ method: string; path: string }>> {
  return stack.flatMap((layer) => {
    if (layer.route)
      return Object.keys(layer.route.methods)
        .filter((method) => method !== "_all")
        .map((method) => ({ method: method.toUpperCase(), path: layer.route!.path }));
    return layer.handle?.stack ? walk(layer.handle.stack) : [];
  });
}

/** Every `method path` the server mounts under `/api/v1`, read from Express's own route table so none is missed. */
export function mountedRoutes(server: ReturnType<typeof createServer>) {
  const stack = (server.app as unknown as { router: { stack: Layer[] } }).router.stack;
  return walk(stack).filter((route) => route.path.startsWith("/api/v1/"));
}
