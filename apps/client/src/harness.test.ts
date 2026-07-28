import { describe, expect, it } from "vitest";

/** Proves the harness itself works before anything depends on it: DOM env + the shims in setup.ts. */
describe("client test harness", () => {
  it("runs in a DOM environment", () => {
    document.body.innerHTML = `<div id="probe">ok</div>`;
    expect(document.getElementById("probe")).toHaveTextContent("ok");
  });
  it("shims the native <dialog> the app's Modal relies on", () => {
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    expect(typeof dialog.showModal).toBe("function");
    dialog.showModal();
    expect(dialog.open).toBe(true);
    dialog.close();
    expect(dialog.open).toBe(false);
  });
});
