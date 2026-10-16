import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../lib/command", () => ({
  read: vi.fn(() =>
    Promise.resolve({
      ok: true,
      attribution: "This work includes material from the System Reference Document 5.2.1",
      glossary: [
        {
          id: "prone",
          name: "Prone",
          tag: "Condition",
          description: "While you have the Prone condition, you experience the following effects."
        },
        { id: "cover", name: "Cover", tag: null, description: "Walls, trees, creatures, and other obstacles." },
        { id: "crawling", name: "Crawling", tag: null, description: "While you are Prone, you crawl." }
      ]
    })
  )
}));

import { RulesReference } from "./RulesReference";

describe("the rules reference", () => {
  it("finds a term by name first, then the terms that mention it, with its tag", async () => {
    render(<RulesReference open onClose={() => undefined} />);
    expect(await screen.findByText("Cover")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the rules" }), { target: { value: "prone" } });
    const terms = Array.from(document.querySelectorAll("summary")).map((summary) => summary.textContent);
    expect(terms).toEqual(["ProneCondition", "Crawling"]);
    expect(screen.getByText(/System Reference Document 5.2.1/)).toBeTruthy();
  });
});
