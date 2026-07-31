/**
 * Put the test at an address. D3 made every Codex surface route-driven, so a component test that
 * renders `CodexShell` must say which section it means — the same way a browser does.
 *
 * `replaceState` rather than `pushState`: a test is not walking history, it is starting somewhere. The
 * `popstate` afterwards is what the browser would fire on a real navigation and is how the router's
 * store learns the address changed — `replaceState` alone is silent by spec.
 */
export function goTo(path: string): void {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}
