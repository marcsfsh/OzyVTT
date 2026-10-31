import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Crumb, TitleLine } from "./Crumb";

// The crumb on a title's line (theme rule 14): the back chevron and where it goes, before the title.

describe("the crumb", () => {
  it("sits before the title on one line and goes back where it says", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <TitleLine crumb={<Crumb label="People" href="/codex/pages?group=people" onClick={onClick} />}>
        <h1>Sister Ilsa Varn</h1>
      </TitleLine>
    );
    const line = container.querySelector(".nh-titleline")!;
    const crumb = screen.getByRole("link", { name: "Back to People" });
    expect(line.firstElementChild).toBe(crumb);
    expect(line.querySelector("h1")).toHaveTextContent("Sister Ilsa Varn");
    expect(crumb).toHaveAttribute("href", "/codex/pages?group=people");
    await userEvent.setup().click(crumb);
    expect(onClick).toHaveBeenCalled();
  });

  it("is a button when it has no address", () => {
    render(<Crumb label="Encounters" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Back to Encounters" })).toHaveTextContent("Encounters");
  });
});
